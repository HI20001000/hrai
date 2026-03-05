import { parseJsonObject } from './cvExtractedPreview.js'

export const EXTRACTED_EMPTY_TEXT = '（未提取）'
export const EXTRACTED_UNTAGGED_TEXT = '（未標記）'

export const EDITABLE_EXTRACTED_FIELDS = [
  { fieldKey: 'fullName', label: '姓名', valueType: 'text', inputType: 'input', target: 'root', required: true },
  { fieldKey: 'email', label: 'Email', valueType: 'text', inputType: 'input', target: 'root', lower: true },
  { fieldKey: 'phone', label: '電話', valueType: 'text', inputType: 'input', target: 'root' },
  { fieldKey: 'education', label: '學歷', valueType: 'text', inputType: 'input', target: 'profile' },
  { fieldKey: 'workYears', label: '工作年限', valueType: 'text', inputType: 'input', target: 'profile' },
  { fieldKey: 'languages', label: '語言', valueType: 'list', inputType: 'textarea', target: 'profile', limit: 20 },
  { fieldKey: 'technicalLanguages', label: '技術語言', valueType: 'list', inputType: 'textarea', target: 'profile', limit: 30 },
  { fieldKey: 'technicalCertificates', label: '技術證書', valueType: 'list', inputType: 'textarea', target: 'profile', limit: 20 },
  { fieldKey: 'industry', label: '所屬行業', valueType: 'text', inputType: 'input', target: 'profile' },
  { fieldKey: 'projectExperience', label: '專案經歷', valueType: 'text', inputType: 'textarea', target: 'profile' },
  { fieldKey: 'targetPosition', label: '目標職位', valueType: 'list', inputType: 'textarea', target: 'profile', limit: 10 },
  { fieldKey: 'expectedSalary', label: '期望薪資', valueType: 'text', inputType: 'input', target: 'profile' },
  { fieldKey: 'onboardingPreference', label: '入職意願', valueType: 'text', inputType: 'input', target: 'profile' },
]

const missingFieldLabelMap = {
  fullName: '姓名',
  email: 'Email',
  phone: '電話',
  education: '學歷',
  workYears: '工作年限',
  languages: '語言',
  technicalLanguages: '技術語言',
  technicalCertificates: '技術證書',
  industry: '所屬行業',
  projectExperience: '專案經歷',
  targetPosition: '目標職位',
  expectedSalary: '期望薪資',
  onboardingPreference: '入職意願',
}

export const normalizeText = (value) => String(value ?? '').trim()

export const normalizeList = (value, limit = 20) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|/]+/)
      : []

  const list = []
  const seen = new Set()
  for (const raw of source.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    const text = normalizeText(raw)
    if (!text || seen.has(text)) continue
    seen.add(text)
    list.push(text)
    if (list.length >= limit) break
  }
  return list
}

export const toDisplayText = (value, emptyText = EXTRACTED_EMPTY_TEXT) => {
  const text = normalizeText(value)
  return text || emptyText
}

export const toDisplayList = (value, limit = 20, emptyText = EXTRACTED_EMPTY_TEXT) => {
  const list = normalizeList(value, limit)
  return list.length ? list.join('、') : emptyText
}

const buildRow = ({
  label,
  value,
  rawValue,
  emptyText = EXTRACTED_EMPTY_TEXT,
  fieldKey = '',
  editable = false,
  valueType = 'text',
  inputType = 'input',
}) => ({
  label,
  value,
  rawValue,
  empty: value === emptyText,
  fieldKey,
  editable,
  valueType,
  inputType,
})

export const resolveExtractedPayload = ({
  content = '',
  extracted = null,
  parser = '',
  missingFields = [],
} = {}) => {
  const payloadFromContent = typeof content === 'string' ? parseJsonObject(content) : null
  const resolvedExtracted = extracted && typeof extracted === 'object' && Object.keys(extracted).length
    ? extracted
    : payloadFromContent?.extracted && typeof payloadFromContent.extracted === 'object'
      ? payloadFromContent.extracted
      : payloadFromContent && typeof payloadFromContent === 'object'
        ? payloadFromContent
        : {}

  const resolvedParser = normalizeText(parser) || normalizeText(payloadFromContent?.parser)
  const resolvedMissingFields = Array.isArray(missingFields) && missingFields.length
    ? normalizeList(missingFields, 40)
    : normalizeList(payloadFromContent?.missingFields, 40)

  return {
    extracted: resolvedExtracted,
    parser: resolvedParser,
    missingFields: resolvedMissingFields,
  }
}

export const buildExtractedPreviewData = ({
  content = '',
  extracted = null,
  parser = '',
  missingFields = [],
} = {}) => {
  const resolved = resolveExtractedPayload({ content, extracted, parser, missingFields })
  const extractedObj = resolved.extracted && typeof resolved.extracted === 'object' ? resolved.extracted : {}
  const profile = extractedObj.profile && typeof extractedObj.profile === 'object' ? extractedObj.profile : {}
  const parserLower = normalizeText(resolved.parser).toLowerCase()
  const parserLabel = parserLower === 'llm' ? 'LLM' : parserLower === 'regex' ? 'Regex Fallback' : EXTRACTED_UNTAGGED_TEXT
  const missingFieldLabels = resolved.missingFields.map((key) => missingFieldLabelMap[key] || key)

  return {
    extracted: extractedObj,
    parser: parserLower || '',
    missingFields: resolved.missingFields,
    basicRows: [
      buildRow({ label: '姓名', value: toDisplayText(extractedObj.fullName), rawValue: extractedObj.fullName, fieldKey: 'fullName', editable: true }),
      buildRow({ label: 'Email', value: toDisplayText(extractedObj.email), rawValue: extractedObj.email, fieldKey: 'email', editable: true }),
      buildRow({ label: '電話', value: toDisplayText(extractedObj.phone), rawValue: extractedObj.phone, fieldKey: 'phone', editable: true }),
      buildRow({ label: '解析來源', value: parserLabel, rawValue: parserLabel, emptyText: EXTRACTED_UNTAGGED_TEXT }),
      buildRow({ label: '缺漏欄位', value: missingFieldLabels.length ? missingFieldLabels.join('、') : '無', rawValue: resolved.missingFields }),
    ],
    dimensionRows: [
      buildRow({ label: '學歷', value: toDisplayText(profile.education), rawValue: profile.education, fieldKey: 'education', editable: true }),
      buildRow({ label: '工作年限', value: toDisplayText(profile.workYears), rawValue: profile.workYears, fieldKey: 'workYears', editable: true }),
      buildRow({ label: '語言', value: toDisplayList(profile.languages, 20), rawValue: profile.languages, fieldKey: 'languages', editable: true, valueType: 'list', inputType: 'textarea' }),
      buildRow({ label: '技術語言', value: toDisplayList(profile.technicalLanguages, 30), rawValue: profile.technicalLanguages, fieldKey: 'technicalLanguages', editable: true, valueType: 'list', inputType: 'textarea' }),
      buildRow({ label: '技術證書', value: toDisplayList(profile.technicalCertificates, 20), rawValue: profile.technicalCertificates, fieldKey: 'technicalCertificates', editable: true, valueType: 'list', inputType: 'textarea' }),
      buildRow({ label: '所屬行業', value: toDisplayText(profile.industry), rawValue: profile.industry, fieldKey: 'industry', editable: true }),
      buildRow({ label: '專案經歷', value: toDisplayText(profile.projectExperience), rawValue: profile.projectExperience, fieldKey: 'projectExperience', editable: true, inputType: 'textarea' }),
      buildRow({ label: '目標職位', value: toDisplayList(profile.targetPosition, 10), rawValue: profile.targetPosition, fieldKey: 'targetPosition', editable: true, valueType: 'list', inputType: 'textarea' }),
      buildRow({ label: '期望薪資', value: toDisplayText(profile.expectedSalary), rawValue: profile.expectedSalary, fieldKey: 'expectedSalary', editable: true }),
      buildRow({ label: '入職意願', value: toDisplayText(profile.onboardingPreference), rawValue: profile.onboardingPreference, fieldKey: 'onboardingPreference', editable: true }),
    ],
  }
}

export const getEditableRows = (previewData) => {
  if (!previewData || typeof previewData !== 'object') return []
  return [...(previewData.basicRows || []), ...(previewData.dimensionRows || [])]
    .filter((row) => row.editable && row.fieldKey)
}

export const toDraftValue = (row) => {
  if (!row || typeof row !== 'object') return ''
  if (row.valueType === 'list') return normalizeList(row.rawValue, 50).join(', ')
  return normalizeText(row.rawValue)
}

export const buildDraftFieldsFromRows = (rows = []) => {
  const draft = {}
  for (const row of rows) {
    if (!row?.fieldKey) continue
    draft[row.fieldKey] = toDraftValue(row)
  }
  return draft
}

export const normalizeDraftForCompare = (row, value) => {
  if (row?.valueType === 'list') return normalizeList(value, 50).join('|')
  return normalizeText(value)
}

export const computeMissingFields = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}
  const requiredFieldDefs = [
    { key: 'fullName', value: extracted?.fullName },
    { key: 'email', value: extracted?.email },
    { key: 'phone', value: extracted?.phone },
    { key: 'education', value: profile.education },
    { key: 'workYears', value: profile.workYears },
    { key: 'languages', value: profile.languages },
    { key: 'technicalLanguages', value: profile.technicalLanguages },
    { key: 'technicalCertificates', value: profile.technicalCertificates },
    { key: 'industry', value: profile.industry },
    { key: 'projectExperience', value: profile.projectExperience },
    { key: 'targetPosition', value: profile.targetPosition },
    { key: 'expectedSalary', value: profile.expectedSalary },
    { key: 'onboardingPreference', value: profile.onboardingPreference },
  ]
  const isMissingValue = (value) => (Array.isArray(value) ? !value.length : !normalizeText(value))
  return requiredFieldDefs.filter((field) => isMissingValue(field.value)).map((field) => field.key)
}

export const buildEditedExtractedFromDraft = (draftFields = {}) => {
  const extracted = { profile: {} }
  for (const field of EDITABLE_EXTRACTED_FIELDS) {
    const rawValue = draftFields[field.fieldKey]
    if (field.valueType === 'list') {
      const list = normalizeList(rawValue, field.limit || 20)
      if (field.target === 'profile') extracted.profile[field.fieldKey] = list
      else extracted[field.fieldKey] = list
      continue
    }

    let text = normalizeText(rawValue)
    if (field.lower) text = text.toLowerCase()
    if (field.target === 'profile') extracted.profile[field.fieldKey] = text
    else extracted[field.fieldKey] = text
  }
  return extracted
}
