import { extractCandidateInfoByLlm } from './client.js'
import {
  extractCandidateNameFromText,
  extractCandidateInfoByRegexText,
  isLikelyCandidateName,
  normalizeExtractedFields,
  parseLlmContentToJson,
  validateCvExtractionPayload,
} from './parsers.js'
import { extractTextFromBuffer } from './text-extractors.js'
import { HttpError, LlmOutputFormatError } from '../errors.js'

export const extractCandidateNameFromFileName = (fileName = '') => {
  const baseName = String(fileName || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .trim()
  if (!baseName) return ''

  const candidates = []
  const afterBracket = baseName.includes('】') ? baseName.slice(baseName.lastIndexOf('】') + 1) : ''
  if (afterBracket) candidates.push(afterBracket)
  if (afterBracket) candidates.push(...afterBracket.split(/[-_＿\s（()）]+/u))
  candidates.push(...baseName.split(/[-_＿\s（()）]+/u))

  for (const rawCandidate of candidates) {
    const candidate = String(rawCandidate || '').replace(/[【】\[\]]/g, '').trim()
    if (isLikelyCandidateName(candidate)) return candidate
  }
  return ''
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

export const resolveCandidateFullName = ({
  currentName = '',
  cvText = '',
  fileName = '',
  preferCurrentName = false,
} = {}) => {
  const normalizedCurrentName = String(currentName || '').trim()
  if (preferCurrentName && isLikelyCandidateName(normalizedCurrentName)) return normalizedCurrentName

  const nameFromText = extractCandidateNameFromText(cvText)
  if (nameFromText) return nameFromText

  if (isLikelyCandidateName(normalizedCurrentName)) return normalizedCurrentName

  return extractCandidateNameFromFileName(fileName)
}

export const applyCandidateFullNameResolution = (
  extraction = {},
  cvText = '',
  fileName = '',
  { preferCurrentName = false } = {}
) => {
  const extracted = extraction?.extracted || {}
  const resolvedFullName = resolveCandidateFullName({
    currentName: extracted.fullName,
    cvText,
    fileName,
    preferCurrentName,
  })
  const missingFields = Array.isArray(extraction?.missingFields) ? extraction.missingFields : []
  const nextMissingFields = resolvedFullName
    ? missingFields.filter((field) => field !== 'fullName')
    : missingFields.includes('fullName')
      ? missingFields
      : ['fullName', ...missingFields]

  return {
    ...extraction,
    extracted: {
      ...extracted,
      fullName: resolvedFullName,
    },
    missingFields: nextMissingFields,
  }
}

const buildRegexFallbackExtraction = (cvText, fileName) => {
  const fallback = extractCandidateInfoByRegexText(cvText)
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
    fullName: fallbackExtracted.fullName || '',
  }
  const missingFields = Array.isArray(fallback.missingFields)
    ? fallback.missingFields.filter((field) => {
        if (field === 'fullName' && extracted.fullName) return false
        if (field === 'targetPosition' && nextProfile.targetPosition?.length) return false
        if (field === 'expectedSalary' && nextProfile.expectedSalary) return false
        return true
      })
    : []
  return applyCandidateFullNameResolution({
    ...fallback,
    extracted,
    missingFields,
    llmJson: null,
  }, cvText, fileName)
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

    const normalized = applyCandidateFullNameResolution(
      normalizeExtractedFields(parsed, { sourceText: cvText }),
      cvText,
      fileName,
      { preferCurrentName: true }
    )
    return {
      ...normalized,
      llmJson: parsed,
    }
  } catch (error) {
    return buildRegexFallbackExtraction(cvText, fileName)
  }
}
