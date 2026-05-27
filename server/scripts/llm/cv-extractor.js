import { extractCandidateInfoByLlm } from './client.js'
import {
  extractCandidateInfoByRegexText,
  normalizeExtractedFields,
  parseLlmContentToJson,
  validateCvExtractionPayload,
} from './parsers.js'
import { extractTextFromBuffer } from './text-extractors.js'
import { HttpError, LlmOutputFormatError } from '../errors.js'

const extractCandidateNameFromFileName = (fileName = '') => {
  const baseName = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .trim()
  const afterBracket = baseName.includes('】') ? baseName.slice(baseName.lastIndexOf('】') + 1) : ''
  const match = afterBracket.trim().match(/^([\p{Script=Han}A-Za-z·]{2,24})(?=[_\s（(]|$)/u)
  return match?.[1]?.trim() || ''
}

const extractBossMetaFromFileName = (fileName = '') => {
  const text = String(fileName || '').replace(/\.[^.]+$/, '').trim()
  const bracketMatch = text.match(/【([^】]+)】/)
  const bracketText = String(bracketMatch?.[1] || '').trim()
  if (!bracketText) return { targetPosition: '', expectedSalary: '' }

  const [rolePart = '', ...restParts] = bracketText.split(/[_＿]/)
  const targetPosition = rolePart.trim()
  const locationAndSalary = restParts.join('_').trim()
  const expectedSalary = locationAndSalary.match(/\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[kK]/)?.[0] || ''
  return { targetPosition, expectedSalary }
}

const buildRegexFallbackExtraction = (cvText, fileName) => {
  const fallback = extractCandidateInfoByRegexText(cvText)
  const nameFromFileName = extractCandidateNameFromFileName(fileName)
  const fileMeta = extractBossMetaFromFileName(fileName)
  const fallbackExtracted = fallback.extracted || {}
  const fallbackProfile = fallbackExtracted.profile || {}
  const nextProfile = {
    ...fallbackProfile,
  }
  if (fileMeta.targetPosition && !(Array.isArray(nextProfile.targetPosition) && nextProfile.targetPosition.length)) {
    nextProfile.targetPosition = [fileMeta.targetPosition]
  }
  if (fileMeta.expectedSalary && !nextProfile.expectedSalary) {
    nextProfile.expectedSalary = fileMeta.expectedSalary
  }

  const extracted = {
    ...fallbackExtracted,
    profile: nextProfile,
    fullName: nameFromFileName || fallbackExtracted.fullName || '',
  }
  const missingFields = Array.isArray(fallback.missingFields)
    ? fallback.missingFields.filter((field) => {
        if (field === 'fullName' && extracted.fullName) return false
        if (field === 'targetPosition' && nextProfile.targetPosition?.length) return false
        if (field === 'expectedSalary' && nextProfile.expectedSalary) return false
        return true
      })
    : []
  return {
    ...fallback,
    extracted,
    missingFields,
    llmJson: null,
  }
}

export const extractCandidateInfoFromCv = async (buffer, fileName = '', mimeType = '') => {
  const normalizedName = String(fileName || '').toLowerCase()
  const normalizedType = String(mimeType || '').toLowerCase()
  const cvText = (await extractTextFromBuffer(buffer, fileName, mimeType)).slice(0, 12000)
  if (!cvText.trim()) {
    const fileNameFallback = buildRegexFallbackExtraction('', fileName)
    const fallbackProfile = fileNameFallback?.extracted?.profile || {}
    const hasFileNameFallback = Boolean(
      fileNameFallback?.extracted?.fullName ||
      fileNameFallback?.extracted?.email ||
      fileNameFallback?.extracted?.phone ||
      (Array.isArray(fallbackProfile.targetPosition) && fallbackProfile.targetPosition.length) ||
      fallbackProfile.expectedSalary
    )
    if (hasFileNameFallback) return fileNameFallback

    if (normalizedName.endsWith('.pdf') || normalizedType.includes('pdf')) {
      throw new HttpError(
        422,
        'PDF 未提取到可用文字內容。系統目前只會讀取 PDF 內可選取的文字，圖片內容會自動忽略，請改上傳文字型 PDF 或 DOC/DOCX。'
      )
    }
    throw new HttpError(422, '履歷未提取到可用文字內容，請確認檔案不是圖片或空白檔。')
  }

  try {
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
  } catch (error) {
    return buildRegexFallbackExtraction(cvText, fileName)
  }
}
