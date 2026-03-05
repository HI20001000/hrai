import { extractCandidateInfoByLlm } from './client.js'
import {
  extractCandidateInfoByRegex,
  extractKeywordsFromLlmJson,
  normalizeExtractedFields,
  parseLlmContentToJson,
} from './parsers.js'
import { extractTextFromBuffer } from './text-extractors.js'

export const extractCandidateInfoFromCv = async (buffer, fileName = '', mimeType = '') => {
  const cvText = (await extractTextFromBuffer(buffer, fileName, mimeType)).slice(0, 12000)
  const normalizedName = String(fileName || '').toLowerCase()
  const normalizedType = String(mimeType || '').toLowerCase()
  const isDocx = normalizedName.endsWith('.docx') || normalizedType.includes('wordprocessingml')

  if (isDocx) {
    console.log('[CV] DOCX extracted text:')
    console.log(cvText || '(empty)')
  }

  if (!cvText.trim()) return extractCandidateInfoByRegex(buffer)

  try {
    const content = await extractCandidateInfoByLlm(cvText)
    if (!content) return extractCandidateInfoByRegex(buffer)

    const parsed = parseLlmContentToJson(content)
    if (!parsed) return extractCandidateInfoByRegex(buffer)

    const normalized = normalizeExtractedFields(parsed)
    return {
      ...normalized,
      llmJson: parsed,
      keywords: extractKeywordsFromLlmJson(parsed),
    }
  } catch {
    return extractCandidateInfoByRegex(buffer)
  }
}
