import { extractCandidateInfoByLlm } from './client.js'
import {
  normalizeExtractedFields,
  parseLlmContentToJson,
  validateCvExtractionPayload,
} from './parsers.js'
import { extractTextFromBuffer } from './text-extractors.js'
import { HttpError, LlmOutputFormatError } from '../errors.js'

export const extractCandidateInfoFromCv = async (buffer, fileName = '', mimeType = '') => {
  const cvText = (await extractTextFromBuffer(buffer, fileName, mimeType)).slice(0, 12000)
  if (!cvText.trim()) {
    throw new HttpError(422, 'CV text extraction returned empty content')
  }

  const primaryContent = await extractCandidateInfoByLlm(cvText)
  const parsed = parseLlmContentToJson(primaryContent)
  if (!parsed) {
    throw new LlmOutputFormatError('CV extraction LLM output is not valid JSON')
  }

  try {
    validateCvExtractionPayload(parsed)
  } catch (error) {
    throw new LlmOutputFormatError(`CV extraction output schema mismatch: ${error?.message || error}`)
  }

  const normalized = normalizeExtractedFields(parsed)
  return {
    ...normalized,
    llmJson: parsed,
  }
}
