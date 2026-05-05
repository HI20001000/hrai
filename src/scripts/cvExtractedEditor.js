import { parseJsonObject } from './cvExtractedPreview.js'

export const EXTRACTED_EMPTY_TEXT = '（未提取）'
export const EXTRACTED_UNTAGGED_TEXT = '（未標記）'
export const PERSONAL_PROJECT_GROUP_NAME = '個人項目'

const PROJECT_SKILL_LIMIT = 20
const MAX_DURATION_MONTHS = 600

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
  {
    fieldKey: 'projectExperiences',
    label: '專案經歷',
    valueType: 'project-experiences',
    inputType: 'project-experiences',
    target: 'profile',
  },
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
  projectExperiences: '專案經歷',
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

export const normalizeProjectSkills = (value) => normalizeList(value, PROJECT_SKILL_LIMIT)

const PRESENT_TOKEN_PATTERN = /^(至今|現在|现今|目前|present|current|now)$/i

const resolveCurrentYearMonth = () => {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    precision: 'month',
  }
}

const parseYearMonthToken = (value) => {
  const text = normalizeText(value)
  if (!text) return null
  if (PRESENT_TOKEN_PATTERN.test(text)) return resolveCurrentYearMonth()

  let match = text.match(/^(\d{4})[./-](\d{1,2})$/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    if (month >= 1 && month <= 12) return { year, month, precision: 'month' }
  }

  match = text.match(/^(\d{4})年\s*(\d{1,2})月?$/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    if (month >= 1 && month <= 12) return { year, month, precision: 'month' }
  }

  match = text.match(/^(\d{4})$/)
  if (match) {
    return { year: Number(match[1]), month: null, precision: 'year' }
  }

  return null
}

const computeRangeMonths = (startToken, endToken) => {
  const start = parseYearMonthToken(startToken)
  const end = parseYearMonthToken(endToken)
  if (!start || !end) return null

  const startMonth = start.month ?? 1
  const endMonth = end.month ?? 12
  const months = (end.year - start.year) * 12 + (endMonth - startMonth) + 1
  if (!Number.isInteger(months) || months <= 0 || months > MAX_DURATION_MONTHS) return null
  return months
}

export const computeProjectDurationMonths = (value) => {
  const text = normalizeText(value)
  if (!text) return null

  let match = text.match(/(\d+)\s*年\s*(\d+)\s*(?:個月|个月|月|months?|mos?)/i)
  if (match) return Number(match[1]) * 12 + Number(match[2])

  match = text.match(/(\d+)\s*(?:個月|个月|月|months?|mos?)/i)
  if (match) return Number(match[1])

  match = text.match(/(\d+)\s*(?:年|years?|yrs?)/i)
  if (match) return Number(match[1]) * 12

  match = text.match(
    /(\d{4}(?:[./-]\d{1,2}|年\s*\d{1,2}\s*月?)?|\d{4})\s*(?:-|~|–|—|至|到|to)\s*(至今|現在|现今|目前|present|current|now|\d{4}(?:[./-]\d{1,2}|年\s*\d{1,2}\s*月?)?|\d{4})/i
  )
  if (match) return computeRangeMonths(match[1], match[2])

  return null
}

export const formatProjectDurationMonthsLabel = (months) => {
  const numericMonths = Number(months)
  if (!Number.isInteger(numericMonths) || numericMonths <= 0) return ''

  if (numericMonths < 12) return `${numericMonths}月`

  const years = Math.floor(numericMonths / 12)
  const remainingMonths = numericMonths % 12
  return remainingMonths > 0 ? `${years}年${remainingMonths}月` : `${years}年`
}

export const formatProjectDurationDisplay = (value) => {
  const text = normalizeText(value)
  if (!text) return ''
  const months = computeProjectDurationMonths(text)
  const durationLabel = formatProjectDurationMonthsLabel(months)
  return durationLabel ? `${text}（${durationLabel}）` : text
}

export const createEmptyProjectExperienceItem = () => ({
  projectName: '',
  skills: [],
  durationText: '',
  durationMonths: null,
})

export const createEmptyProjectExperienceGroup = (groupType = 'company') => ({
  groupType: groupType === 'personal' ? 'personal' : 'company',
  companyName: groupType === 'personal' ? PERSONAL_PROJECT_GROUP_NAME : '',
  projects: [createEmptyProjectExperienceItem()],
})

const normalizeProjectExperienceItem = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const projectName = normalizeText(value.projectName || value.name || value.title)
  const skills = normalizeProjectSkills(value.skills || value.techStack || value.technicalLanguages)
  const durationText = normalizeText(value.durationText || value.duration || value.projectDuration || value.timespan)
  const durationMonths =
    typeof value.durationMonths === 'number' && Number.isFinite(value.durationMonths) && value.durationMonths > 0
      ? Math.round(value.durationMonths)
      : computeProjectDurationMonths(durationText)

  if (!projectName && !skills.length && !durationText) return null

  return {
    projectName,
    skills,
    durationText,
    durationMonths,
  }
}

export const normalizeProjectExperiences = (value) => {
  if (!Array.isArray(value)) return []

  const groups = []
  for (const rawGroup of value) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) continue

    const groupTypeValue = normalizeText(rawGroup.groupType).toLowerCase()
    const groupType =
      groupTypeValue === 'personal' || normalizeText(rawGroup.companyName) === PERSONAL_PROJECT_GROUP_NAME
        ? 'personal'
        : 'company'
    const companyName = groupType === 'personal' ? PERSONAL_PROJECT_GROUP_NAME : normalizeText(rawGroup.companyName)
    const projects = Array.isArray(rawGroup.projects)
      ? rawGroup.projects.map((item) => normalizeProjectExperienceItem(item)).filter(Boolean)
      : []

    if (!projects.length) continue
    if (groupType === 'company' && !companyName) continue

    groups.push({
      groupType,
      companyName,
      projects,
    })
  }

  return groups
}

export const cloneProjectExperiences = (value) =>
  normalizeProjectExperiences(JSON.parse(JSON.stringify(Array.isArray(value) ? value : [])))

export const hasProjectExperiences = (value, legacyText = '') =>
  normalizeProjectExperiences(value).length > 0 || !!normalizeText(legacyText)

export const buildProjectExperiencesSummary = (value, legacyText = '') => {
  const groups = normalizeProjectExperiences(value)
  if (!groups.length) return normalizeText(legacyText)

  return groups
    .map((group) => {
      const projects = group.projects
        .map((project) => {
          const parts = []
          if (project.projectName) parts.push(project.projectName)
          if (project.skills.length) parts.push(`技能：${project.skills.join('、')}`)
          if (project.durationText) parts.push(`時長：${formatProjectDurationDisplay(project.durationText)}`)
          return parts.join('｜')
        })
        .filter(Boolean)
      return `${group.companyName}：${projects.join('；')}`
    })
    .join('\n')
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
  legacyText = '',
}) => ({
  label,
  value,
  rawValue,
  empty: value === emptyText,
  fieldKey,
  editable,
  valueType,
  inputType,
  legacyText,
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

const buildProjectExperienceField = (profile = {}) => {
  const projectExperiences = normalizeProjectExperiences(profile.projectExperiences)
  const legacyText = normalizeText(profile.projectExperience)
  const value = hasProjectExperiences(projectExperiences, legacyText)
    ? buildProjectExperiencesSummary(projectExperiences, legacyText)
    : EXTRACTED_EMPTY_TEXT

  return buildRow({
    label: '專案經歷',
    value,
    rawValue: projectExperiences,
    fieldKey: 'projectExperiences',
    editable: true,
    valueType: 'project-experiences',
    inputType: 'project-experiences',
    legacyText,
  })
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
  const projectExperienceField = buildProjectExperienceField(profile)

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
      buildRow({ label: '目標職位', value: toDisplayList(profile.targetPosition, 10), rawValue: profile.targetPosition, fieldKey: 'targetPosition', editable: true, valueType: 'list', inputType: 'textarea' }),
      buildRow({ label: '期望薪資', value: toDisplayText(profile.expectedSalary), rawValue: profile.expectedSalary, fieldKey: 'expectedSalary', editable: true }),
      buildRow({ label: '入職意願', value: toDisplayText(profile.onboardingPreference), rawValue: profile.onboardingPreference, fieldKey: 'onboardingPreference', editable: true }),
    ],
    projectExperienceField,
  }
}

export const getEditableRows = (previewData) => {
  if (!previewData || typeof previewData !== 'object') return []
  const rows = [...(previewData.basicRows || []), ...(previewData.dimensionRows || [])]
  if (previewData.projectExperienceField) rows.push(previewData.projectExperienceField)
  return rows.filter((row) => row.editable && row.fieldKey)
}

export const toDraftValue = (row) => {
  if (!row || typeof row !== 'object') return ''
  if (row.valueType === 'list') return normalizeList(row.rawValue, 50).join(', ')
  if (row.valueType === 'project-experiences') return cloneProjectExperiences(row.rawValue)
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
  if (row?.valueType === 'project-experiences') return JSON.stringify(normalizeProjectExperiences(value))
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
    { key: 'projectExperiences', value: hasProjectExperiences(profile.projectExperiences, profile.projectExperience) },
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

    if (field.valueType === 'project-experiences') {
      const groups = normalizeProjectExperiences(rawValue)
      if (field.target === 'profile') extracted.profile[field.fieldKey] = groups
      else extracted[field.fieldKey] = groups
      continue
    }

    let text = normalizeText(rawValue)
    if (field.lower) text = text.toLowerCase()
    if (field.target === 'profile') extracted.profile[field.fieldKey] = text
    else extracted[field.fieldKey] = text
  }
  return extracted
}
