import { buildJsonTaskInputContent, callLlmPrompt } from './client.js'
import { getLlmConfig } from './config.js'
import { getJobRerankPrompt, getJobShortlistPrompt, getJobSingleMatchPrompt } from './prompt.js'
import { parseLlmContentToJson } from './parsers.js'
import { buildExperienceSummary, normalizeExperienceItems } from './experiences.js'
import {
  buildProjectExperienceDurationLabels,
  buildProjectExperiencesSummary,
  normalizeProjectExperiences,
  parseProjectDurationRange,
} from './project-experiences.js'
import {
  SCORING_DIMENSIONS,
  calculateWeightedMatch,
  normalizeScoringRubrics,
  normalizeScoringWeights,
} from '../jobs/scoring.js'
import { LlmOutputFormatError } from '../errors.js'

const normalizeText = (value) => String(value ?? '').trim()

const normalizeList = (value, limit = 20) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|/]+/)
      : []
  const deduped = []
  const seen = new Set()
  for (const item of source) {
    const text = normalizeText(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    deduped.push(text)
    if (deduped.length >= limit) break
  }
  return deduped
}

const normalizeScore = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))))
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const DEFAULT_EMPLOYMENT_GAP_LIMIT_MONTHS = 5
const EMPLOYMENT_GAP_LIST_THRESHOLD_MONTHS = 1

const getJobOutputKey = (dictionaryKey, job = {}) => normalizeText(job?.jobKey) || normalizeText(dictionaryKey)
const getJobTitle = (dictionaryKey, job = {}) => normalizeText(job?.title) || normalizeText(dictionaryKey)
const normalizeEmploymentGapLimitMonths = (value) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return DEFAULT_EMPLOYMENT_GAP_LIMIT_MONTHS
  return Math.round(numericValue)
}

const getCurrentMonthIndex = (date = new Date()) => {
  const source = date instanceof Date ? date : new Date(date)
  const safeDate = Number.isNaN(source.getTime()) ? new Date() : source
  return safeDate.getFullYear() * 12 + safeDate.getMonth() + 1
}

const formatYearMonthLabel = (monthIndex) => {
  if (!Number.isInteger(monthIndex) || monthIndex <= 0) return ''
  const year = Math.floor((monthIndex - 1) / 12)
  const month = ((monthIndex - 1) % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

const formatDurationMonthsLabel = (months) => {
  const numericMonths = Number(months)
  if (!Number.isInteger(numericMonths) || numericMonths < 0) return ''
  if (numericMonths === 0) return '0個月'
  if (numericMonths < 12) return `${numericMonths}個月`
  const years = Math.floor(numericMonths / 12)
  const remainingMonths = numericMonths % 12
  return remainingMonths > 0 ? `${years}年${remainingMonths}個月` : `${years}年`
}

const normalizeCvYear = (value) => {
  const numericYear = Number(value)
  if (!Number.isInteger(numericYear)) return null
  if (numericYear >= 1000) return numericYear
  if (numericYear < 0 || numericYear > 99) return null
  return numericYear >= 70 ? 1900 + numericYear : 2000 + numericYear
}

const parseEmploymentYearMonthToken = (value) => {
  const text = normalizeText(value)
  if (!text) return null
  if (/^(至今|現在|现在|現今|现今|目前|present|current|now)$/i.test(text)) return { monthIndex: getCurrentMonthIndex() }

  let match = text.match(/^(\d{4}|\d{2})[./-](\d{1,2})$/)
  if (match) {
    const year = normalizeCvYear(match[1])
    const month = Number(match[2])
    if (year && month >= 1 && month <= 12) return { monthIndex: year * 12 + month }
  }

  match = text.match(/^(\d{4}|\d{2})\s*年\s*(\d{1,2})\s*月?$/)
  if (match) {
    const year = normalizeCvYear(match[1])
    const month = Number(match[2])
    if (year && month >= 1 && month <= 12) return { monthIndex: year * 12 + month }
  }

  match = text.match(/^(\d{4})$/)
  if (match) {
    const year = normalizeCvYear(match[1])
    if (year) return { monthIndex: year * 12 + 12 }
  }

  return null
}

const parseEmploymentDurationRange = (value) => {
  const text = normalizeText(value)
  if (!text) return null

  const parsedProjectRange = parseProjectDurationRange(text)
  if (parsedProjectRange) return parsedProjectRange

  const dateToken = String.raw`(?:\d{4}|\d{2})(?:[./-]\d{1,2}|\s*年\s*\d{1,2}\s*月?)?|\d{4}`
  const presentToken = String.raw`至今|現在|现在|現今|现今|目前|present|current|now`
  const match = text.match(new RegExp(`(${dateToken})\\s*(?:-|~|–|—|至|到|to)\\s*(${presentToken}|${dateToken})`, 'i'))
  if (!match) return null

  const start = parseEmploymentYearMonthToken(match[1])
  const end = parseEmploymentYearMonthToken(match[2])
  if (!start || !end || end.monthIndex < start.monthIndex) return null
  return { startMonth: start.monthIndex, endMonth: end.monthIndex }
}

const parseEmploymentEndMonth = (value) => {
  const range = parseEmploymentDurationRange(value)
  if (range) return range.endMonth

  const text = normalizeText(value)
  if (!text || !/(離職|离职|結束|结束|完結|完结|left|ended|end date)/i.test(text)) return null
  const datePattern = /(\d{4}|\d{2})(?:[./-](\d{1,2})|\s*年\s*(\d{1,2})\s*月?)/g
  let latest = null
  for (const match of text.matchAll(datePattern)) {
    const year = normalizeCvYear(match[1])
    const month = Number(match[2] || match[3])
    if (!year || month < 1 || month > 12) continue
    const monthIndex = year * 12 + month
    if (!latest || monthIndex > latest) latest = monthIndex
  }
  return latest
}

const findCompanyEmploymentRanges = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}
  const groups = normalizeProjectExperiences(profile.projectExperiences)
  const ranges = []

  for (const group of groups) {
    if (group.groupType !== 'company') continue
    for (const project of group.projects || []) {
      const range = parseEmploymentDurationRange(project.durationText)
      if (!range) continue
      ranges.push({
        companyName: normalizeText(group.companyName),
        projectName: normalizeText(project.projectName),
        durationText: normalizeText(project.durationText),
        startMonth: range.startMonth,
        endMonth: range.endMonth,
      })
    }
  }

  return ranges.sort((a, b) => a.startMonth - b.startMonth || a.endMonth - b.endMonth)
}

const findLatestCompanyEmploymentEndMonth = (extracted = {}) => {
  const ranges = findCompanyEmploymentRanges(extracted)
  let latest = null
  for (const range of ranges) {
    if (!latest || range.endMonth > latest.endMonth) latest = range
  }
  return latest
}

export const buildEmploymentGapReport = (extracted = {}, job = {}, now = new Date()) => {
  const limitMonths = normalizeEmploymentGapLimitMonths(job?.employmentGapLimitMonths)
  const gapThresholdMonths = EMPLOYMENT_GAP_LIST_THRESHOLD_MONTHS
  const currentMonth = getCurrentMonthIndex(now)
  const lookbackStartMonth = currentMonth - Math.max(limitMonths - 1, 0)
  const employmentRanges = findCompanyEmploymentRanges(extracted)
  const relevantRanges = employmentRanges
    .filter((range) => range.endMonth >= lookbackStartMonth && range.startMonth <= currentMonth)
    .sort((a, b) => a.startMonth - b.startMonth || a.endMonth - b.endMonth)

  if (!relevantRanges.length) {
    return {
      status: 'unknown',
      exceeded: false,
      months: null,
      limitMonths,
      gapThresholdMonths,
      lookbackStartMonth: formatYearMonthLabel(lookbackStartMonth),
      latestEmploymentEnd: '',
      currentSystemMonth: formatYearMonthLabel(currentMonth),
      durationLabel: '',
      gaps: [],
      summary: `未能從 CV 中識別近 ${limitMonths} 個月內的正式工作經歷區間，暫無法列明經歷之間的空窗期。`,
    }
  }

  if (relevantRanges.length < 2) {
    return {
      status: 'insufficient_experience',
      exceeded: false,
      months: 0,
      limitMonths,
      gapThresholdMonths,
      lookbackStartMonth: formatYearMonthLabel(lookbackStartMonth),
      latestEmploymentEnd: formatYearMonthLabel(findLatestCompanyEmploymentEndMonth(extracted)?.endMonth || relevantRanges[0].endMonth),
      currentSystemMonth: formatYearMonthLabel(currentMonth),
      durationLabel: '',
      gaps: [],
      summary: `近 ${limitMonths} 個月內僅識別到 1 段正式工作經歷，未進行工作經歷之間的空窗期計算。`,
    }
  }

  const gaps = []
  let previous = relevantRanges[0]
  for (const current of relevantRanges.slice(1)) {
    if (current.startMonth <= previous.endMonth + 1) {
      if (current.endMonth > previous.endMonth) previous = current
      continue
    }

    const gapStartMonth = Math.max(previous.endMonth + 1, lookbackStartMonth)
    const gapEndMonth = Math.min(current.startMonth - 1, currentMonth)
    const gapMonths = gapEndMonth >= gapStartMonth ? gapEndMonth - gapStartMonth + 1 : 0
    if (gapMonths > EMPLOYMENT_GAP_LIST_THRESHOLD_MONTHS) {
      gaps.push({
        startMonth: formatYearMonthLabel(gapStartMonth),
        endMonth: formatYearMonthLabel(gapEndMonth),
        months: gapMonths,
        durationLabel: formatDurationMonthsLabel(gapMonths),
        previousCompanyName: previous.companyName,
        previousProjectName: previous.projectName,
        previousDurationText: previous.durationText,
        nextCompanyName: current.companyName,
        nextProjectName: current.projectName,
        nextDurationText: current.durationText,
        exceeded: true,
        note: `在${previous.companyName || previous.projectName || '上一段經歷'}離職後有${gapMonths}個月空窗期，建議面試確認原因`,
      })
    }
    previous = current
  }

  const longestGap = gaps.reduce((max, gap) => (gap.months > (max?.months || 0) ? gap : max), null)
  const gapMonths = longestGap?.months || 0
  const durationLabel = longestGap?.durationLabel || ''
  const currentSystemMonth = formatYearMonthLabel(currentMonth)
  const exceeded = gaps.some((gap) => gap.exceeded)
  const base = {
    status: gaps.length ? (exceeded ? 'exceeded' : 'within_limit') : 'no_gap',
    exceeded,
    months: gapMonths,
    limitMonths,
    gapThresholdMonths,
    lookbackStartMonth: formatYearMonthLabel(lookbackStartMonth),
    latestEmploymentEnd: formatYearMonthLabel(findLatestCompanyEmploymentEndMonth(extracted)?.endMonth || relevantRanges[relevantRanges.length - 1].endMonth),
    currentSystemMonth,
    durationLabel,
    gaps,
  }

  if (!gaps.length) {
    return {
      ...base,
      summary: `近 ${limitMonths} 個月內未識別到超過 ${EMPLOYMENT_GAP_LIST_THRESHOLD_MONTHS} 個月的正式工作經歷間隔。`,
    }
  }

  return {
    ...base,
    summary: `近 ${limitMonths} 個月內識別到 ${gaps.length} 段超過 ${EMPLOYMENT_GAP_LIST_THRESHOLD_MONTHS} 個月的工作經歷間隔，最長為 ${durationLabel}，建議面試中確認原因與期間安排。`,
  }
}

const findDictionaryJobKey = (dictionary, requestedKey) => {
  const normalizedKey = normalizeText(requestedKey)
  if (!normalizedKey) return ''
  if (dictionary[normalizedKey]) return normalizedKey

  for (const [dictionaryKey, job] of Object.entries(dictionary || {})) {
    if (getJobOutputKey(dictionaryKey, job) === normalizedKey || getJobTitle(dictionaryKey, job) === normalizedKey) {
      return dictionaryKey
    }
  }

  return ''
}

const assertString = (value, fieldName, { allowEmpty = true } = {}) => {
  if (typeof value !== 'string') {
    throw new LlmOutputFormatError(`Field ${fieldName} must be a string`)
  }
  if (!allowEmpty && !value.trim()) {
    throw new LlmOutputFormatError(`Field ${fieldName} cannot be empty`)
  }
}

const assertStringArray = (value, fieldName, { min = 0, max = Infinity } = {}) => {
  if (!Array.isArray(value)) {
    throw new LlmOutputFormatError(`Field ${fieldName} must be an array`)
  }
  if (value.length < min) {
    throw new LlmOutputFormatError(`Field ${fieldName} must contain at least ${min} items`)
  }
  if (value.length > max) {
    throw new LlmOutputFormatError(`Field ${fieldName} must contain at most ${max} items`)
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new LlmOutputFormatError(`Field ${fieldName} must contain only strings`)
    }
  }
}

const assertMatchLevel = (value, fieldName) => {
  assertString(value, fieldName, { allowEmpty: false })
  if (!['high', 'medium', 'low'].includes(String(value).trim().toLowerCase())) {
    throw new LlmOutputFormatError(`Field ${fieldName} must be one of high, medium, low`)
  }
}

const assertScore = (value, fieldName) => {
  const score = Number(value)
  if (!Number.isFinite(score)) {
    throw new LlmOutputFormatError(`Field ${fieldName} must be a number`)
  }
  if (score < 0 || score > 100) {
    throw new LlmOutputFormatError(`Field ${fieldName} must be between 0 and 100`)
  }
}

const assertDimensionEvaluations = (value, fieldName) => {
  if (!Array.isArray(value)) {
    throw new LlmOutputFormatError(`Field ${fieldName} must be an array`)
  }
  const allowedKeys = new Set(SCORING_DIMENSIONS.map((dimension) => dimension.key))
  const seen = new Set()
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) {
      throw new LlmOutputFormatError(`${fieldName}[${index}] must be an object`)
    }
    assertString(item.dimensionKey, `${fieldName}[${index}].dimensionKey`, { allowEmpty: false })
    const dimensionKey = normalizeText(item.dimensionKey)
    if (!allowedKeys.has(dimensionKey)) {
      throw new LlmOutputFormatError(`${fieldName}[${index}].dimensionKey is not supported`)
    }
    if (seen.has(dimensionKey)) {
      throw new LlmOutputFormatError(`${fieldName}[${index}].dimensionKey is duplicated`)
    }
    seen.add(dimensionKey)
    assertMatchLevel(item.level, `${fieldName}[${index}].level`)
    assertString(item.evidence, `${fieldName}[${index}].evidence`)
    assertString(item.gap, `${fieldName}[${index}].gap`)
  }
}

const parseRequiredJsonObject = (content, label) => {
  const payload = parseLlmContentToJson(content)
  if (!isPlainObject(payload)) {
    throw new LlmOutputFormatError(`${label} LLM output must be a JSON object`)
  }
  return payload
}

const validateShortlistPayload = (payload, dictionary) => {
  if (!('shortlistedJobs' in payload)) {
    throw new LlmOutputFormatError('Shortlist output must contain shortlistedJobs')
  }
  if (!Array.isArray(payload.shortlistedJobs)) {
    throw new LlmOutputFormatError('Field shortlistedJobs must be an array')
  }
  if (!payload.shortlistedJobs.length) {
    throw new LlmOutputFormatError('Field shortlistedJobs must contain at least 1 item')
  }
  if (payload.shortlistedJobs.length > 5) {
    throw new LlmOutputFormatError('Field shortlistedJobs must contain at most 5 items')
  }

  for (const [index, item] of payload.shortlistedJobs.entries()) {
    if (!isPlainObject(item)) {
      throw new LlmOutputFormatError(`shortlistedJobs[${index}] must be an object`)
    }
    assertString(item.jobKey, `shortlistedJobs[${index}].jobKey`, { allowEmpty: false })
    assertString(item.reason, `shortlistedJobs[${index}].reason`)
    if (!findDictionaryJobKey(dictionary, item.jobKey)) {
      throw new LlmOutputFormatError(`shortlistedJobs[${index}].jobKey is not in job dictionary`)
    }
  }
}

const validateRankedPayload = (payload, dictionary) => {
  if (!('rankedJobs' in payload)) {
    throw new LlmOutputFormatError('Rerank output must contain rankedJobs')
  }
  if (!Array.isArray(payload.rankedJobs)) {
    throw new LlmOutputFormatError('Field rankedJobs must be an array')
  }
  if (!payload.rankedJobs.length) {
    throw new LlmOutputFormatError('Field rankedJobs must contain at least 1 item')
  }
  if (payload.rankedJobs.length > 3) {
    throw new LlmOutputFormatError('Field rankedJobs must contain at most 3 items')
  }

  for (const [index, item] of payload.rankedJobs.entries()) {
    if (!isPlainObject(item)) {
      throw new LlmOutputFormatError(`rankedJobs[${index}] must be an object`)
    }
    assertString(item.jobKey, `rankedJobs[${index}].jobKey`, { allowEmpty: false })
    assertStringArray(item.strengths, `rankedJobs[${index}].strengths`, { min: 1, max: 3 })
    assertStringArray(item.gaps, `rankedJobs[${index}].gaps`, { min: 1, max: 3 })
    assertString(item.reasonSummary, `rankedJobs[${index}].reasonSummary`)
    assertDimensionEvaluations(item.dimensionEvaluations, `rankedJobs[${index}].dimensionEvaluations`)
    if (!findDictionaryJobKey(dictionary, item.jobKey)) {
      throw new LlmOutputFormatError(`rankedJobs[${index}].jobKey is not in job dictionary`)
    }
  }
}

const validateSingleMatchPayload = (payload, job) => {
  for (const key of ['jobKey', 'matchedPosition']) {
    if (payload[key] == null) continue
    assertString(payload[key], key)
  }
  assertString(payload.reasonSummary, 'reasonSummary')
  assertStringArray(payload.strengths, 'strengths', { min: 1, max: 3 })
  assertStringArray(payload.gaps, 'gaps', { min: 1, max: 3 })
  assertDimensionEvaluations(payload.dimensionEvaluations, 'dimensionEvaluations')
}

export const buildCandidateProfile = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}
  const projectExperiences = normalizeProjectExperiences(profile.projectExperiences)
  const companyProjectExperiences = projectExperiences.filter((group) => group.groupType === 'company')
  const internshipProjectExperiences = projectExperiences.filter((group) => group.groupType === 'internship')
  const legacyWorkExperiences = normalizeExperienceItems(profile.workExperiences)
  const legacyInternshipExperiences = normalizeExperienceItems(profile.internshipExperiences)
  const durationLabels = buildProjectExperienceDurationLabels(projectExperiences)
  return {
    fullName: normalizeText(extracted?.fullName),
    education: normalizeText(profile.education),
    workYears: normalizeText(profile.workYears),
    companyExperienceDuration: durationLabels.companyExperienceDuration || normalizeText(profile.companyExperienceDuration),
    internshipExperienceDuration: durationLabels.internshipExperienceDuration || normalizeText(profile.internshipExperienceDuration),
    projectExperienceDuration: durationLabels.projectExperienceDuration || normalizeText(profile.projectExperienceDuration),
    languages: normalizeList(profile.languages, 20),
    technicalLanguages: normalizeList(profile.technicalLanguages, 30),
    technicalCertificates: normalizeList(profile.technicalCertificates, 20),
    industry: normalizeText(profile.industry),
    workExperience: buildProjectExperiencesSummary(companyProjectExperiences) || buildExperienceSummary(legacyWorkExperiences),
    internshipExperience: buildProjectExperiencesSummary(internshipProjectExperiences) || buildExperienceSummary(legacyInternshipExperiences),
    projectExperience: buildProjectExperiencesSummary(projectExperiences, profile.projectExperience),
    targetPosition: normalizeList(profile.targetPosition, 10),
    expectedSalary: normalizeText(profile.expectedSalary),
    onboardingPreference: normalizeText(profile.onboardingPreference),
  }
}

export const buildJobIndex = (dictionary = {}) =>
  Object.entries(dictionary).map(([jobKey, job]) => ({
    jobKey: getJobOutputKey(jobKey, job),
    title: getJobTitle(jobKey, job),
    industry: normalizeList(job?.industry, 10),
    roleKeywords: normalizeList(job?.roleKeywords, 10),
    requiredSkills: normalizeList(job?.requiredSkills, 10),
    projectExperience: normalizeList(job?.projectExperience, 10),
    certifications: normalizeList(job?.certifications, 10),
    workYears: Number(job?.workYears ?? job?.minWorkYears ?? 0),
    employmentGapLimitMonths: normalizeEmploymentGapLimitMonths(job?.employmentGapLimitMonths),
  }))

export const buildFullJobCards = (dictionary = {}, jobKeys = []) =>
  jobKeys
    .map((jobKey) => {
      const job = dictionary[jobKey]
      if (!job) return null
      return {
        jobKey: getJobOutputKey(jobKey, job),
        title: getJobTitle(jobKey, job),
        description: normalizeText(job.description),
        industry: normalizeList(job.industry, 10),
        roleKeywords: normalizeList(job.roleKeywords, 10),
        coreResponsibilities: normalizeList(job.coreResponsibilities, 10),
        requiredSkills: normalizeList(job.requiredSkills, 10),
        projectExperience: normalizeList(job.projectExperience, 10),
        preferredSkills: normalizeList(job.preferredSkills, 10),
        certifications: normalizeList(job.certifications, 10),
        minWorkYears: Number(job.minWorkYears ?? job.workYears ?? 0),
        workYears: Number(job.workYears ?? job.minWorkYears ?? 0),
        employmentGapLimitMonths: normalizeEmploymentGapLimitMonths(job.employmentGapLimitMonths),
        candidatePreference: normalizeList(job.candidatePreference, 10),
        salaryRange: {
          min: Number(job?.salaryRange?.min || 0),
          max: Number(job?.salaryRange?.max || 0),
        },
        weights: normalizeScoringWeights(job?.weights),
        scoringRubrics: normalizeScoringRubrics(job?.scoringRubrics),
        scoringDimensions: SCORING_DIMENSIONS.map(({ key, label }) => ({ key, label })),
      }
    })
    .filter(Boolean)

export const buildSingleJobCard = (jobSnapshot = {}) => {
  const snapshot = jobSnapshot && typeof jobSnapshot === 'object' ? jobSnapshot : {}
  return {
    jobKey: normalizeText(snapshot.jobKey),
    title: normalizeText(snapshot.title),
    description: normalizeText(snapshot.description),
    industry: normalizeList(snapshot.industry, 10),
    roleKeywords: normalizeList(snapshot.roleKeywords, 10),
    coreResponsibilities: normalizeList(snapshot.coreResponsibilities, 10),
    requiredSkills: normalizeList(snapshot.requiredSkills, 10),
    projectExperience: normalizeList(snapshot.projectExperience, 10),
    preferredSkills: normalizeList(snapshot.preferredSkills, 10),
    certifications: normalizeList(snapshot.certifications, 10),
    minWorkYears: Number(snapshot.minWorkYears ?? snapshot.workYears ?? 0),
    workYears: Number(snapshot.workYears ?? snapshot.minWorkYears ?? 0),
    employmentGapLimitMonths: normalizeEmploymentGapLimitMonths(snapshot.employmentGapLimitMonths),
    candidatePreference: normalizeList(snapshot.candidatePreference, 10),
    salaryRange: {
      min: Number(snapshot?.salaryRange?.min || 0),
      max: Number(snapshot?.salaryRange?.max || 0),
    },
    weights: normalizeScoringWeights(snapshot?.weights),
    scoringRubrics: normalizeScoringRubrics(snapshot?.scoringRubrics),
    scoringDimensions: SCORING_DIMENSIONS.map(({ key, label }) => ({ key, label })),
  }
}

const normalizeShortlistJobKeys = (payload, dictionary) => {
  const jobs = Array.isArray(payload?.shortlistedJobs) ? payload.shortlistedJobs : []
  const deduped = []
  const seen = new Set()
  for (const item of jobs) {
    const jobKey = findDictionaryJobKey(dictionary, item?.jobKey)
    if (!jobKey || seen.has(jobKey)) continue
    seen.add(jobKey)
    deduped.push(jobKey)
    if (deduped.length >= 5) break
  }
  return deduped
}

const normalizeMatchLevel = (value) => {
  const level = normalizeText(value).toLowerCase()
  if (level === 'high' || level === 'medium' || level === 'low') return level
  return 'medium'
}

const normalizeRankedJobs = (payload, dictionary, extracted = {}) => {
  const jobs = Array.isArray(payload?.rankedJobs) ? payload.rankedJobs : []
  const deduped = []
  const seen = new Set()
  for (const item of jobs) {
    const dictionaryKey = findDictionaryJobKey(dictionary, item?.jobKey)
    if (!dictionaryKey || seen.has(dictionaryKey)) continue
    seen.add(dictionaryKey)
    const job = dictionary[dictionaryKey]
    const scoring = calculateWeightedMatch({
      weights: job?.weights,
      scoringRubrics: job?.scoringRubrics,
      dimensionEvaluations: item?.dimensionEvaluations,
    })
    deduped.push({
      jobKey: getJobOutputKey(dictionaryKey, job),
      jobTitle: getJobTitle(dictionaryKey, job),
      matchScore: scoring.matchScore,
      matchLevel: scoring.matchLevel,
      strengths: normalizeList(item?.strengths, 3),
      gaps: normalizeList(item?.gaps, 3),
      employmentGap: buildEmploymentGapReport(extracted, job),
      reasonSummary: normalizeText(item?.reasonSummary),
      dimensionEvaluations: scoring.dimensionEvaluations,
    })
    if (deduped.length >= 3) break
  }
  return deduped.sort((a, b) => b.matchScore - a.matchScore)
}

export const matchCandidateToJobs = async (extracted, dictionary) => {
  if (!dictionary || typeof dictionary !== 'object' || !Object.keys(dictionary).length) {
    throw new LlmOutputFormatError('Job dictionary is empty, unable to run matching')
  }

  const { maxTokens } = getLlmConfig()
  const candidate = buildCandidateProfile(extracted)
  const shortlistContent = await callLlmPrompt(
    buildJsonTaskInputContent(getJobShortlistPrompt(), {
      candidate,
      jobs: buildJobIndex(dictionary),
    }),
    { maxTokens, temperature: 0.2 }
  )
  const shortlistPayload = parseRequiredJsonObject(shortlistContent, 'Shortlist')
  validateShortlistPayload(shortlistPayload, dictionary)
  const shortlistKeys = normalizeShortlistJobKeys(shortlistPayload, dictionary)
  if (!shortlistKeys.length) {
    throw new LlmOutputFormatError('Shortlist output produced zero valid job keys')
  }

  const rerankContent = await callLlmPrompt(
    buildJsonTaskInputContent(getJobRerankPrompt(), {
      candidate,
      jobs: buildFullJobCards(dictionary, shortlistKeys),
    }),
    { maxTokens, temperature: 0.2 }
  )
  const rerankPayload = parseRequiredJsonObject(rerankContent, 'Rerank')
  validateRankedPayload(rerankPayload, dictionary)
  return normalizeRankedJobs(rerankPayload, dictionary, extracted)
}

export const matchCandidateToJobPost = async (extracted, jobSnapshot) => {
  const job = buildSingleJobCard(jobSnapshot)
  if (!job.jobKey || !job.title) {
    throw new LlmOutputFormatError('Job snapshot is missing jobKey or title')
  }

  const { maxTokens } = getLlmConfig()
  const candidate = buildCandidateProfile(extracted)
  const content = await callLlmPrompt(
    buildJsonTaskInputContent(getJobSingleMatchPrompt(), {
      candidate,
      job,
    }),
    { maxTokens, temperature: 0.2 }
  )
  const payload = parseRequiredJsonObject(content, 'Single-job match')
  validateSingleMatchPayload(payload, job)
  const scoring = calculateWeightedMatch({
    weights: job.weights,
    scoringRubrics: job.scoringRubrics,
    dimensionEvaluations: payload.dimensionEvaluations,
  })

  return {
    jobKey: job.jobKey,
    jobTitle: job.title,
    matchedPosition: job.title,
    matchScore: scoring.matchScore,
    matchLevel: scoring.matchLevel,
    strengths: normalizeList(payload.strengths, 3),
    gaps: normalizeList(payload.gaps, 3),
    employmentGap: buildEmploymentGapReport(extracted, job),
    reasonSummary: normalizeText(payload.reasonSummary),
    dimensionEvaluations: scoring.dimensionEvaluations,
  }
}
