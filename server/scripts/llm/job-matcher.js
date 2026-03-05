import { buildJsonTaskInputContent, callLlmPrompt } from './client.js'
import { getJobRerankPrompt, getJobShortlistPrompt, getJobSingleMatchPrompt } from './prompt.js'
import { parseLlmContentToJson } from './parsers.js'

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

export const buildCandidateProfile = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}
  return {
    fullName: normalizeText(extracted?.fullName),
    education: normalizeText(profile.education),
    workYears: normalizeText(profile.workYears),
    languages: normalizeList(profile.languages, 20),
    technicalLanguages: normalizeList(profile.technicalLanguages, 30),
    technicalCertificates: normalizeList(profile.technicalCertificates, 20),
    industry: normalizeText(profile.industry),
    projectExperience: normalizeText(profile.projectExperience),
    targetPosition: normalizeList(profile.targetPosition, 10),
    expectedSalary: normalizeText(profile.expectedSalary),
    onboardingPreference: normalizeText(profile.onboardingPreference),
  }
}

export const buildJobIndex = (dictionary = {}) =>
  Object.entries(dictionary).map(([jobKey, job]) => ({
    jobKey,
    title: normalizeText(job?.title),
    industry: normalizeList(job?.industry, 10),
    roleKeywords: normalizeList(job?.roleKeywords, 10),
    requiredSkills: normalizeList(job?.requiredSkills, 10),
    certifications: normalizeList(job?.certifications, 10),
    minWorkYears: Number(job?.minWorkYears || 0),
  }))

export const buildFullJobCards = (dictionary = {}, jobKeys = []) =>
  jobKeys
    .map((jobKey) => {
      const job = dictionary[jobKey]
      if (!job) return null
      return {
        jobKey,
        title: normalizeText(job.title),
        description: normalizeText(job.description),
        industry: normalizeList(job.industry, 10),
        roleKeywords: normalizeList(job.roleKeywords, 10),
        coreResponsibilities: normalizeList(job.coreResponsibilities, 10),
        requiredSkills: normalizeList(job.requiredSkills, 10),
        preferredSkills: normalizeList(job.preferredSkills, 10),
        certifications: normalizeList(job.certifications, 10),
        minWorkYears: Number(job.minWorkYears || 0),
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
    preferredSkills: normalizeList(snapshot.preferredSkills, 10),
    certifications: normalizeList(snapshot.certifications, 10),
    minWorkYears: Number(snapshot.minWorkYears || 0),
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
    const jobKey = normalizeText(item?.jobKey)
    if (!jobKey || !dictionary[jobKey] || seen.has(jobKey)) continue
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
    const jobKey = normalizeText(item?.jobKey)
    if (!jobKey || !dictionary[jobKey] || seen.has(jobKey)) continue
    seen.add(jobKey)
    const score = Math.max(0, Math.min(100, Math.round(Number(item?.matchScore || 0))))
    deduped.push({
      jobKey,
      jobTitle: normalizeText(dictionary[jobKey]?.title),
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
  if (!dictionary || typeof dictionary !== 'object' || !Object.keys(dictionary).length) return []

  const candidate = buildCandidateProfile(extracted)
  const shortlistContent = await callLlmPrompt(
    buildJsonTaskInputContent(getJobShortlistPrompt(), {
      candidate,
      jobs: buildJobIndex(dictionary),
    }),
    { maxTokens: 1200, temperature: 0.2 }
  )
  const shortlistPayload = parseLlmContentToJson(shortlistContent)
  const shortlistKeys = normalizeShortlistJobKeys(shortlistPayload, dictionary)
  if (!shortlistKeys.length) return []

  const rerankContent = await callLlmPrompt(
    buildJsonTaskInputContent(getJobRerankPrompt(), {
      candidate,
      jobs: buildFullJobCards(dictionary, shortlistKeys),
    }),
    { maxTokens: 1600, temperature: 0.2 }
  )
  const rerankPayload = parseLlmContentToJson(rerankContent)
  return normalizeRankedJobs(rerankPayload, dictionary)
}

export const matchCandidateToJobPost = async (extracted, jobSnapshot) => {
  const job = buildSingleJobCard(jobSnapshot)
  if (!job.jobKey || !job.title) return null

  const candidate = buildCandidateProfile(extracted)
  const content = await callLlmPrompt(
    buildJsonTaskInputContent(getJobSingleMatchPrompt(), {
      candidate,
      job,
    }),
    { maxTokens: 1200, temperature: 0.2 }
  )
  const payload = parseLlmContentToJson(content)
  if (!payload || typeof payload !== 'object') return null

  return {
    jobKey: job.jobKey,
    jobTitle: job.title,
    matchedPosition: normalizeText(payload.matchedPosition) || job.title,
    matchScore: Math.max(0, Math.min(100, Math.round(Number(payload.matchScore || 0)))),
    matchLevel: normalizeMatchLevel(payload.matchLevel),
    strengths: normalizeList(payload.strengths, 3),
    gaps: normalizeList(payload.gaps, 3),
    reasonSummary: normalizeText(payload.reasonSummary),
  }
}
