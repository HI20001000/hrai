import { validateJobDictionary } from '../jobs/dictionary.js'
import { SCORING_DIMENSIONS } from '../jobs/scoring.js'
import { LlmOutputFormatError } from '../errors.js'
import { buildJsonTaskInputContent, callLlmPrompt } from './client.js'
import { getLlmConfig } from './config.js'
import { getJobDictionarySuggestionPrompt } from './prompt.js'
import { parseLlmContentToJson } from './parsers.js'

const normalizeText = (value) => String(value ?? '').trim()
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

const buildSuggestionInput = ({ jobTitle = '', jobKey = '', draft = {} } = {}) => ({
  jobTitle: normalizeText(jobTitle),
  jobKey: normalizeText(jobKey),
  draft: isPlainObject(draft) ? draft : {},
  dimensions: SCORING_DIMENSIONS.map(({ key, label }) => ({ key, label })),
})

export const suggestJobDictionaryDefinition = async ({ jobTitle = '', jobKey = '', draft = {} } = {}) => {
  const title = normalizeText(jobTitle || draft?.title || jobKey)
  const key = normalizeText(jobKey || draft?.jobKey || title)
  if (!title && !key) {
    throw new LlmOutputFormatError('jobTitle or jobKey is required')
  }

  const { maxTokens } = getLlmConfig()
  const content = await callLlmPrompt(
    buildJsonTaskInputContent(getJobDictionarySuggestionPrompt(), buildSuggestionInput({ jobTitle: title, jobKey: key, draft })),
    { maxTokens, temperature: 0.25 }
  )
  const payload = parseLlmContentToJson(content)
  const suggestedJob = isPlainObject(payload?.job) ? payload.job : payload
  if (!isPlainObject(suggestedJob)) {
    throw new LlmOutputFormatError('Job dictionary suggestion output must contain job')
  }

  const normalized = validateJobDictionary({
    [normalizeText(suggestedJob.title || title || key) || 'job']: {
      ...suggestedJob,
      title: normalizeText(suggestedJob.title || title || key),
      jobKey: normalizeText(suggestedJob.jobKey || key || title),
    },
  })
  return Object.values(normalized)[0]
}
