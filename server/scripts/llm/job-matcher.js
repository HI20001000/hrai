import { buildJsonTaskInputContent, callLlmPrompt } from './client.js'
import { getLlmConfig } from './config.js'
import { getJobRerankPrompt, getJobShortlistPrompt, getJobSingleMatchPrompt } from './prompt.js'
import { parseLlmContentToJson } from './parsers.js'
import { buildProjectExperiencesSummary, normalizeProjectExperiences } from './project-experiences.js'
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

const getJobOutputKey = (dictionaryKey, job = {}) => normalizeText(job?.jobKey) || normalizeText(dictionaryKey)
const getJobTitle = (dictionaryKey, job = {}) => normalizeText(job?.title) || normalizeText(dictionaryKey)

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
    assertScore(item.matchScore, `rankedJobs[${index}].matchScore`)
    assertMatchLevel(item.matchLevel, `rankedJobs[${index}].matchLevel`)
    assertStringArray(item.strengths, `rankedJobs[${index}].strengths`, { min: 1, max: 3 })
    assertStringArray(item.gaps, `rankedJobs[${index}].gaps`, { min: 1, max: 3 })
    assertString(item.reasonSummary, `rankedJobs[${index}].reasonSummary`)
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
  assertScore(payload.matchScore, 'matchScore')
  assertMatchLevel(payload.matchLevel, 'matchLevel')
  assertStringArray(payload.strengths, 'strengths', { min: 1, max: 3 })
  assertStringArray(payload.gaps, 'gaps', { min: 1, max: 3 })
}

export const buildCandidateProfile = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}
  const projectExperiences = normalizeProjectExperiences(profile.projectExperiences)
  return {
    fullName: normalizeText(extracted?.fullName),
    education: normalizeText(profile.education),
    workYears: normalizeText(profile.workYears),
    languages: normalizeList(profile.languages, 20),
    technicalLanguages: normalizeList(profile.technicalLanguages, 30),
    technicalCertificates: normalizeList(profile.technicalCertificates, 20),
    industry: normalizeText(profile.industry),
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
        candidatePreference: normalizeList(job.candidatePreference, 10),
        salaryRange: {
          min: Number(job?.salaryRange?.min || 0),
          max: Number(job?.salaryRange?.max || 0),
        },
        weights: job?.weights && typeof job.weights === 'object' ? job.weights : {},
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
    candidatePreference: normalizeList(snapshot.candidatePreference, 10),
    salaryRange: {
      min: Number(snapshot?.salaryRange?.min || 0),
      max: Number(snapshot?.salaryRange?.max || 0),
    },
    weights: snapshot?.weights && typeof snapshot.weights === 'object' ? snapshot.weights : {},
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

const normalizeRankedJobs = (payload, dictionary) => {
  const jobs = Array.isArray(payload?.rankedJobs) ? payload.rankedJobs : []
  const deduped = []
  const seen = new Set()
  for (const item of jobs) {
    const dictionaryKey = findDictionaryJobKey(dictionary, item?.jobKey)
    if (!dictionaryKey || seen.has(dictionaryKey)) continue
    seen.add(dictionaryKey)
    const job = dictionary[dictionaryKey]
    const score = normalizeScore(item?.matchScore)
    deduped.push({
      jobKey: getJobOutputKey(dictionaryKey, job),
      jobTitle: getJobTitle(dictionaryKey, job),
      matchScore: score,
      matchLevel: normalizeMatchLevel(item?.matchLevel),
      strengths: normalizeList(item?.strengths, 3),
      gaps: normalizeList(item?.gaps, 3),
      reasonSummary: normalizeText(item?.reasonSummary),
    })
    if (deduped.length >= 3) break
  }
  return deduped
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
  return normalizeRankedJobs(rerankPayload, dictionary)
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

  return {
    jobKey: job.jobKey,
    jobTitle: job.title,
    matchedPosition: job.title,
    matchScore: normalizeScore(payload.matchScore),
    matchLevel: normalizeMatchLevel(payload.matchLevel),
    strengths: normalizeList(payload.strengths, 3),
    gaps: normalizeList(payload.gaps, 3),
    reasonSummary: normalizeText(payload.reasonSummary),
  }
}
