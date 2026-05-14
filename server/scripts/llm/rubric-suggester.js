import { SCORING_DIMENSIONS, normalizeScoringRubrics } from '../jobs/scoring.js'
import { buildJsonTaskInputContent, callLlmPrompt } from './client.js'
import { getLlmConfig } from './config.js'
import { getJobRubricSuggestionPrompt } from './prompt.js'
import { parseLlmContentToJson } from './parsers.js'
import { LlmOutputFormatError } from '../errors.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeList = (value, limit = 20) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|/]+/)
      : []
  return source.map((item) => normalizeText(item)).filter(Boolean).slice(0, limit)
}
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

const buildSuggestionJobInput = (job = {}) => ({
  title: normalizeText(job.title || job.jobKey),
  description: normalizeText(job.description),
  industry: normalizeList(job.industry, 10),
  roleKeywords: normalizeList(job.roleKeywords, 10),
  coreResponsibilities: normalizeList(job.coreResponsibilities, 10),
  requiredSkills: normalizeList(job.requiredSkills, 10),
  projectExperience: normalizeList(job.projectExperience, 10),
  preferredSkills: normalizeList(job.preferredSkills, 10),
  certifications: normalizeList(job.certifications, 10),
  minWorkYears: Number(job.minWorkYears ?? job.workYears ?? 0),
  candidatePreference: normalizeList(job.candidatePreference, 10),
})

export const suggestJobScoringRubrics = async (job = {}) => {
  const { maxTokens } = getLlmConfig()
  const content = await callLlmPrompt(
    buildJsonTaskInputContent(getJobRubricSuggestionPrompt(), {
      job: buildSuggestionJobInput(job),
      dimensions: SCORING_DIMENSIONS.map(({ key, label }) => ({ key, label })),
    }),
    { maxTokens, temperature: 0.2 }
  )
  const payload = parseLlmContentToJson(content)
  if (!isPlainObject(payload) || !isPlainObject(payload.scoringRubrics)) {
    throw new LlmOutputFormatError('Rubric suggestion output must contain scoringRubrics')
  }
  return normalizeScoringRubrics(payload.scoringRubrics)
}
