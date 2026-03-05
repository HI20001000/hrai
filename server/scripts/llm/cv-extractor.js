import { extractCandidateInfoByLlm, repairLlmJsonContent, retryExtractCandidateInfoByLlm } from './client.js'
import {
  extractCandidateInfoByRegex,
  extractCandidateInfoByRegexText,
  normalizeExtractedFields,
  parseLlmContentToJson,
} from './parsers.js'
import { extractTextFromBuffer } from './text-extractors.js'

export const extractCandidateInfoFromCv = async (buffer, fileName = '', mimeType = '') => {
  const cvText = (await extractTextFromBuffer(buffer, fileName, mimeType)).slice(0, 12000)

  if (!cvText.trim()) return extractCandidateInfoByRegex(buffer)

  try {
    const primaryContent = await extractCandidateInfoByLlm(cvText)
    if (!primaryContent) return extractCandidateInfoByRegexText(cvText)

    let parsed = parseLlmContentToJson(primaryContent)
    let finalContent = primaryContent

    if (!parsed) {
      console.error('[CV] LLM content is not valid JSON:', String(primaryContent).slice(0, 500))

      const retryContent = await retryExtractCandidateInfoByLlm(cvText, primaryContent)
      if (retryContent) {
        parsed = parseLlmContentToJson(retryContent)
        finalContent = retryContent
      }
    }

    if (!parsed && finalContent) {
      const repairedContent = await repairLlmJsonContent(finalContent)
      if (repairedContent) {
        parsed = parseLlmContentToJson(repairedContent)
        finalContent = repairedContent
      }
    }

    if (!parsed) {
      console.error('[CV] LLM retry/repair still invalid, fallback to regex text')
      return extractCandidateInfoByRegexText(cvText)
    }

    const normalized = normalizeExtractedFields(parsed)
    return {
      ...normalized,
      llmJson: parsed,
    }
  } catch (error) {
    console.error('[CV] LLM extraction failed, fallback to regex text:', error)
    return extractCandidateInfoByRegexText(cvText)
  }
}
