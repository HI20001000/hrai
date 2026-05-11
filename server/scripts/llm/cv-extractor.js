import { extractCandidateInfoByLlm } from './client.js'
import {
  normalizeExtractedFields,
  parseLlmContentToJson,
  validateCvExtractionPayload,
} from './parsers.js'
import { extractTextFromBuffer } from './text-extractors.js'
import { HttpError, LlmOutputFormatError } from '../errors.js'

export const extractCandidateInfoFromCv = async (buffer, fileName = '', mimeType = '') => {
  const normalizedName = String(fileName || '').toLowerCase()
  const normalizedType = String(mimeType || '').toLowerCase()
  const cvText = (await extractTextFromBuffer(buffer, fileName, mimeType)).slice(0, 12000)
  if (!cvText.trim()) {
    if (normalizedName.endsWith('.pdf') || normalizedType.includes('pdf')) {
      throw new HttpError(
        422,
        'PDF 未提取到可用文字內容。系統目前只會讀取 PDF 內可選取的文字，圖片內容會自動忽略，請改上傳文字型 PDF 或 DOC/DOCX。'
      )
    }
    throw new HttpError(422, '履歷未提取到可用文字內容，請確認檔案不是圖片或空白檔。')
  }

  const primaryContent = await extractCandidateInfoByLlm(cvText, fileName)
  const parsed = parseLlmContentToJson(primaryContent)
  if (!parsed) {
    throw new LlmOutputFormatError('CV extraction LLM output is not valid JSON')
  }

  try {
    validateCvExtractionPayload(parsed)
  } catch (error) {
    throw new LlmOutputFormatError(`CV extraction output schema mismatch: ${error?.message || error}`)
  }

  const normalized = normalizeExtractedFields(parsed, { sourceText: cvText })
  return {
    ...normalized,
    llmJson: parsed,
  }
}
