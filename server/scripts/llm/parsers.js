import {
  buildProjectExperienceDurationLabels,
  hasProjectExperiences,
  normalizeProjectExperiences,
} from './project-experiences.js'
import {
  normalizeExperienceItems,
} from './experiences.js'

export const safeJsonParse = (value) => {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const parseLlmContentToJson = (content) => {
  if (!content) return null
  if (typeof content === 'object') return content

  return safeJsonParse(String(content).trim())
}

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

const assertStringField = (payload, key) => {
  if (!(key in payload)) throw new Error(`Missing field: ${key}`)
  if (typeof payload[key] !== 'string') throw new Error(`Field ${key} must be a string`)
}

const assertStringArrayField = (payload, key) => {
  if (!(key in payload)) throw new Error(`Missing field: ${key}`)
  if (!Array.isArray(payload[key])) throw new Error(`Field ${key} must be an array`)
  for (const item of payload[key]) {
    if (typeof item !== 'string') throw new Error(`Field ${key} must contain only strings`)
  }
}

const assertProjectExperiencesField = (payload, key) => {
  if (!(key in payload)) throw new Error(`Missing field: ${key}`)
  if (!Array.isArray(payload[key])) throw new Error(`Field ${key} must be an array`)

  for (const [groupIndex, group] of payload[key].entries()) {
    if (!isPlainObject(group)) throw new Error(`Field ${key}[${groupIndex}] must be an object`)
    if (typeof group.groupType !== 'string') {
      throw new Error(`Field ${key}[${groupIndex}].groupType must be a string`)
    }
    if (!['company', 'internship', 'project', 'personal'].includes(group.groupType)) {
      throw new Error(`Field ${key}[${groupIndex}].groupType must be company, internship or project`)
    }
    if (typeof group.companyName !== 'string') {
      throw new Error(`Field ${key}[${groupIndex}].companyName must be a string`)
    }
    if (!Array.isArray(group.projects)) {
      throw new Error(`Field ${key}[${groupIndex}].projects must be an array`)
    }

    for (const [projectIndex, project] of group.projects.entries()) {
      if (!isPlainObject(project)) {
        throw new Error(`Field ${key}[${groupIndex}].projects[${projectIndex}] must be an object`)
      }
      if (typeof project.projectName !== 'string') {
        throw new Error(`Field ${key}[${groupIndex}].projects[${projectIndex}].projectName must be a string`)
      }
      if (!Array.isArray(project.skills)) {
        throw new Error(`Field ${key}[${groupIndex}].projects[${projectIndex}].skills must be an array`)
      }
      for (const skill of project.skills) {
        if (typeof skill !== 'string') {
          throw new Error(
            `Field ${key}[${groupIndex}].projects[${projectIndex}].skills must contain only strings`
          )
        }
      }
      if (typeof project.durationText !== 'string') {
        throw new Error(`Field ${key}[${groupIndex}].projects[${projectIndex}].durationText must be a string`)
      }
      if (!Array.isArray(project.responsibilities)) {
        throw new Error(`Field ${key}[${groupIndex}].projects[${projectIndex}].responsibilities must be an array`)
      }
      for (const responsibility of project.responsibilities) {
        if (typeof responsibility !== 'string') {
          throw new Error(
            `Field ${key}[${groupIndex}].projects[${projectIndex}].responsibilities must contain only strings`
          )
        }
      }
    }
  }
}

const assertExperienceItemsField = (payload, key) => {
  if (!(key in payload)) throw new Error(`Missing field: ${key}`)
  if (!Array.isArray(payload[key])) throw new Error(`Field ${key} must be an array`)

  for (const [index, item] of payload[key].entries()) {
    if (!isPlainObject(item)) throw new Error(`Field ${key}[${index}] must be an object`)
    for (const fieldKey of ['companyName', 'roleTitle', 'durationText']) {
      if (typeof item[fieldKey] !== 'string') {
        throw new Error(`Field ${key}[${index}].${fieldKey} must be a string`)
      }
    }
    if (!Array.isArray(item.highlights)) {
      throw new Error(`Field ${key}[${index}].highlights must be an array`)
    }
    for (const highlight of item.highlights) {
      if (typeof highlight !== 'string') {
        throw new Error(`Field ${key}[${index}].highlights must contain only strings`)
      }
    }
  }
}

export const validateCvExtractionPayload = (payload) => {
  if (!isPlainObject(payload)) throw new Error('CV extraction output must be a JSON object')

  for (const key of [
    'fullName',
    'email',
    'phone',
    'education',
    'workYears',
    'industry',
    'expectedSalary',
    'onboardingPreference',
  ]) {
    assertStringField(payload, key)
  }

  for (const key of [
    'companyExperienceDuration',
    'internshipExperienceDuration',
    'projectExperienceDuration',
  ]) {
    if (key in payload && typeof payload[key] !== 'string') {
      throw new Error(`Field ${key} must be a string`)
    }
  }

  for (const key of ['languages', 'technicalLanguages', 'technicalCertificates', 'targetPosition']) {
    assertStringArrayField(payload, key)
  }

  assertProjectExperiencesField(payload, 'projectExperiences')

  return payload
}

const normalizeString = (value) => String(value || '').trim()

const pickFirstString = (...values) => {
  for (const value of values) {
    const candidate = normalizeString(value)
    if (candidate) return candidate
  }
  return ''
}

const normalizeLongText = (value, depth = 0) => {
  if (depth > 3 || value == null) return ''

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalizeString(value)
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeLongText(item, depth + 1))
      .filter(Boolean)
    return [...new Set(parts)].join('\n').trim()
  }

  if (typeof value === 'object') {
    const preferredKeys = [
      'projectExperience',
      'projectExperiences',
      'projectSummary',
      'projectDescription',
      'summary',
      'description',
      'details',
      'content',
      'experience',
      'responsibilities',
      'responsibilityText',
      'projectResponsibilities',
      'achievements',
      'highlights',
      'project',
      'projects',
      'name',
      'title',
      'role',
    ]

    const parts = []
    for (const key of preferredKeys) {
      if (!(key in value)) continue
      const text = normalizeLongText(value[key], depth + 1)
      if (text) parts.push(text)
    }

    if (!parts.length) {
      for (const nested of Object.values(value)) {
        const text = normalizeLongText(nested, depth + 1)
        if (text) parts.push(text)
      }
    }

    return [...new Set(parts)].join('\n').trim()
  }

  return ''
}

const pickFirstLongText = (...values) => {
  for (const value of values) {
    const candidate = normalizeLongText(value)
    if (candidate) return candidate
  }
  return ''
}

const pickFirstProjectExperienceGroups = (...values) => {
  for (const value of values) {
    const groups = normalizeProjectExperiences(value)
    if (groups.length) return groups
  }
  return []
}

const legacyExperienceItemsToProjectGroups = (value, groupType) => {
  const items = normalizeExperienceItems(value)
  const groups = new Map()
  for (const item of items) {
    const companyName = normalizeString(item.companyName)
    if (!companyName) continue
    const key = `${groupType}:${companyName}`
    const existing = groups.get(key) || {
      groupType,
      companyName,
      projects: [],
    }
    existing.projects.push({
      projectName: normalizeString(item.roleTitle) || companyName,
      skills: [],
      durationText: normalizeString(item.durationText),
      responsibilities: item.highlights,
    })
    groups.set(key, existing)
  }
  return [...groups.values()]
}

const mergeProjectExperienceGroups = (...values) => {
  const grouped = new Map()
  for (const value of values) {
    for (const group of normalizeProjectExperiences(value)) {
      const key = `${group.groupType}:${group.companyName}`
      const existing = grouped.get(key) || {
        groupType: group.groupType,
        companyName: group.companyName,
        projects: [],
      }
      existing.projects.push(...group.projects)
      grouped.set(key, existing)
    }
  }
  return [...grouped.values()]
}

const normalizeStringArray = (value, max = 20) => {
  const asArray = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|/]+/)
      : []

  const normalized = asArray
    .map((item) => normalizeString(item))
    .filter(Boolean)

  return [...new Set(normalized)].slice(0, max)
}

const mergeStringArrays = (...values) => {
  const merged = values.flatMap((value) => normalizeStringArray(value, 50))
  return [...new Set(merged)]
}

const WORK_SECTION_HEADER_PATTERN =
  /^(工作经历|工作經歷|工作经验|工作經驗|任职经历|任職經歷|职业经历|職業經歷|employment history|work experience|professional experience)$/i

const NON_WORK_SECTION_HEADER_PATTERN =
  /^(教育背景|教育经历|教育經歷|教育|学历|學歷|项目经验|項目經歷|项目经历|項目经历|校园经历|校園經歷|社团经历|社團經歷|培训经历|培訓經歷|专业技能|專業技能|技能|证书|證書|语言能力|語言能力|自我评价|自我評價|个人信息|個人信息|education|project experience|projects|skills|professional skills|certifications|languages|summary)$/i

const NON_WORK_RANGE_CONTEXT_PATTERN =
  /(教育|学历|學歷|本科|硕士|碩士|博士|大学|大學|学院|學院|学校|學校|校园|校園|社团|社團|培训|培訓|课程|課程|证书|證書|education|university|college|school|course|certification|certificate)/i

const PROJECT_RANGE_CONTEXT_PATTERN = /(项目|項目|project)/i

const WORK_RANGE_CONTEXT_PATTERN =
  /(工作|任职|任職|职位|職位|岗位|崗位|公司|有限公司|集团|集團|银行|銀行|科技|顾问|顧問|经理|經理|工程师|工程師|employment|experience|company|corp|ltd|inc|manager|analyst|engineer|developer|consultant|officer|specialist)/i

const INTERNSHIP_RANGE_CONTEXT_PATTERN =
  /(實習|实习|internship|intern\b|trainee)/i

const PRESENT_DATE_TOKEN_PATTERN = /^(至今|現在|现在|現今|现今|目前|present|current|now)$/i

const normalizeHeaderText = (line) =>
  String(line || '')
    .trim()
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, ' ')

const isWorkSectionHeader = (line) => WORK_SECTION_HEADER_PATTERN.test(normalizeHeaderText(line))
const isNonWorkSectionHeader = (line) => NON_WORK_SECTION_HEADER_PATTERN.test(normalizeHeaderText(line))
const isResumeSectionHeader = (line) => isWorkSectionHeader(line) || isNonWorkSectionHeader(line)

const getWorkScopedText = (sourceText) => {
  const lines = String(sourceText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const hasWorkSection = lines.some((line) => isWorkSectionHeader(line))

  if (hasWorkSection) {
    const collected = []
    let inWorkSection = false
    for (const line of lines) {
      if (isWorkSectionHeader(line)) {
        inWorkSection = true
        continue
      }
      if (inWorkSection && isResumeSectionHeader(line)) {
        inWorkSection = false
      }
      if (inWorkSection) collected.push(line)
    }
    return { text: collected.join('\n'), hasWorkSection }
  }

  const collected = []
  let inExcludedSection = false
  for (const line of lines) {
    if (isNonWorkSectionHeader(line)) {
      inExcludedSection = true
      continue
    }
    if (isWorkSectionHeader(line)) {
      inExcludedSection = false
      continue
    }
    if (isResumeSectionHeader(line)) {
      inExcludedSection = false
      continue
    }
    if (!inExcludedSection) collected.push(line)
  }
  return { text: collected.join('\n'), hasWorkSection }
}

const formatWorkYearsNumber = (value, suffix = '') => {
  const numeric = Number(value)
  const normalized = Number.isFinite(numeric) && Number.isInteger(numeric)
    ? String(numeric)
    : String(value || '').trim()
  if (!normalized) return ''
  return `${normalized}年${suffix}`
}

const pickExplicitWorkYearsFromText = (sourceText) => {
  const text = String(sourceText || '').replace(/\s+/g, ' ')
  const patterns = [
    /(?:工作年限|工作經驗|工作经验|工作经历|工作經歷|experience)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(\+|以上)?\s*(?:年|years?|yrs?)/i,
    /(\d+(?:\.\d+)?)\s*(\+)?\s*(?:年|years?|yrs?)\s*(以上)?\s*(?:工作經驗|工作经验|工作经历|工作經歷|experience)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const hasPlus = Boolean(match[2] || match[3])
    return formatWorkYearsNumber(match[1], hasPlus ? '以上' : '')
  }
  return ''
}

const resolveCurrentYearMonth = (now = new Date()) => {
  const date = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date()
    return { year: fallback.getFullYear(), month: fallback.getMonth() + 1 }
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

const parseYearMonthToken = (value, now = new Date()) => {
  const text = String(value || '').trim()
  if (!text) return null
  if (PRESENT_DATE_TOKEN_PATTERN.test(text)) return resolveCurrentYearMonth(now)

  let match = text.match(/^(\d{4})[./-](\d{1,2})$/)
  if (match) {
    const month = Number(match[2])
    if (month >= 1 && month <= 12) return { year: Number(match[1]), month }
  }

  match = text.match(/^(\d{4})年\s*(\d{1,2})\s*月?$/)
  if (match) {
    const month = Number(match[2])
    if (month >= 1 && month <= 12) return { year: Number(match[1]), month }
  }

  match = text.match(/^(\d{4})$/)
  if (match) return { year: Number(match[1]), month: null }

  return null
}

const toMonthIndex = ({ year, month }, fallbackMonth) => year * 12 + (month ?? fallbackMonth)

const extractWorkDateRanges = (
  sourceText,
  { requireWorkContext = false, allowProjectContext = false, now = new Date() } = {}
) => {
  const lines = String(sourceText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const ranges = []
  const rangePattern =
    /(\d{4}(?:[./-]\d{1,2}|年\s*\d{1,2}\s*月?)?|\d{4})\s*(?:-|~|–|—|至|到|to)\s*(至今|現在|现在|現今|现今|目前|present|current|now|\d{4}(?:[./-]\d{1,2}|年\s*\d{1,2}\s*月?)?|\d{4})/gi

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const context = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join(' ')
    const internshipContext = [lines[index - 1], line].filter(Boolean).join(' ')
    if (NON_WORK_RANGE_CONTEXT_PATTERN.test(context)) continue
    if (!allowProjectContext && PROJECT_RANGE_CONTEXT_PATTERN.test(context)) continue
    if (INTERNSHIP_RANGE_CONTEXT_PATTERN.test(internshipContext)) continue
    if (requireWorkContext && !WORK_RANGE_CONTEXT_PATTERN.test(context)) continue

    for (const match of line.matchAll(rangePattern)) {
      const start = parseYearMonthToken(match[1], now)
      const end = parseYearMonthToken(match[2], now)
      if (!start || !end) continue
      const startMonth = toMonthIndex(start, 1)
      const endMonth = toMonthIndex(end, 12)
      if (endMonth < startMonth) continue
      ranges.push({ startMonth, endMonth })
    }
  }

  return ranges
}

const computeMergedRangeMonths = (ranges = []) => {
  const sorted = ranges
    .filter((range) => Number.isInteger(range?.startMonth) && Number.isInteger(range?.endMonth))
    .sort((a, b) => a.startMonth - b.startMonth)
  if (!sorted.length) return 0

  const merged = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || range.startMonth > previous.endMonth + 1) {
      merged.push({ ...range })
      continue
    }
    previous.endMonth = Math.max(previous.endMonth, range.endMonth)
  }

  return merged.reduce((total, range) => total + range.endMonth - range.startMonth + 1, 0)
}

const formatWorkDurationMonths = (months) => {
  if (!Number.isInteger(months) || months <= 0 || months > 600) return ''
  if (months < 12) return `${months}月`
  const years = Math.floor(months / 12)
  const remainingMonths = months % 12
  return remainingMonths > 0 ? `${years}年${remainingMonths}月` : `${years}年`
}

export const extractWorkYearsFromText = (sourceText = '', now = new Date()) => {
  const text = String(sourceText || '').replace(/\r/g, '\n')
  if (!text.trim()) return ''

  const explicitWorkYears = pickExplicitWorkYearsFromText(text)
  if (explicitWorkYears) return explicitWorkYears

  const scoped = getWorkScopedText(text)
  const ranges = extractWorkDateRanges(scoped.text, {
    requireWorkContext: !scoped.hasWorkSection,
    allowProjectContext: scoped.hasWorkSection,
    now,
  })
  return formatWorkDurationMonths(computeMergedRangeMonths(ranges))
}

const normalizeProfileFields = (raw = {}, options = {}) => {
  const root = raw && typeof raw === 'object' ? raw : {}
  const profile = root.profile && typeof root.profile === 'object' ? root.profile : {}

  const basicAttributes =
    (root.basicAttributes && typeof root.basicAttributes === 'object' ? root.basicAttributes : null) ||
    (profile.basicAttributes && typeof profile.basicAttributes === 'object' ? profile.basicAttributes : {})

  const professionalSkills =
    (root.professionalSkills && typeof root.professionalSkills === 'object' ? root.professionalSkills : null) ||
    (profile.professionalSkills && typeof profile.professionalSkills === 'object' ? profile.professionalSkills : {})

  const industryExperience =
    (root.industryExperience && typeof root.industryExperience === 'object' ? root.industryExperience : null) ||
    (profile.industryExperience && typeof profile.industryExperience === 'object' ? profile.industryExperience : {})

  const roleFit =
    (root.roleFit && typeof root.roleFit === 'object' ? root.roleFit : null) ||
    (profile.roleFit && typeof profile.roleFit === 'object' ? profile.roleFit : {})

  const projectExperiences = mergeProjectExperienceGroups(
    pickFirstProjectExperienceGroups(
      root.projectExperiences,
      profile.projectExperiences,
      industryExperience.projectExperiences
    ),
    legacyExperienceItemsToProjectGroups(
      root.workExperiences ?? profile.workExperiences ?? industryExperience.workExperiences,
      'company'
    ),
    legacyExperienceItemsToProjectGroups(
      root.internshipExperiences ?? profile.internshipExperiences ?? industryExperience.internshipExperiences,
      'internship'
    )
  )
  const durationLabels = buildProjectExperienceDurationLabels(projectExperiences)
  const workYearsFromProjects = durationLabels.companyExperienceDuration

  return {
    education: pickFirstString(
      root.education,
      profile.education,
      profile.degree,
      basicAttributes.education,
      basicAttributes.degree
    ),
    workYears: pickFirstString(
      root.workYears,
      profile.workYears,
      basicAttributes.workYears,
      basicAttributes.experienceYears,
      workYearsFromProjects,
      extractWorkYearsFromText(options.sourceText, options.now)
    ),
    companyExperienceDuration: durationLabels.companyExperienceDuration,
    internshipExperienceDuration: durationLabels.internshipExperienceDuration,
    projectExperienceDuration: durationLabels.projectExperienceDuration,
    languages: mergeStringArrays(root.languages, profile.languages, basicAttributes.languages).slice(0, 20),
    technicalLanguages: mergeStringArrays(
      root.technicalLanguages,
      profile.technicalLanguages,
      professionalSkills.technicalLanguages,
      root.skills,
      root.stack
    ).slice(0, 30),
    technicalCertificates: mergeStringArrays(
      root.technicalCertificates,
      root.certifications,
      profile.technicalCertificates,
      professionalSkills.technicalCertificates,
      professionalSkills.certifications
    ).slice(0, 20),
    industry: pickFirstString(
      root.industry,
      profile.industry,
      industryExperience.industry,
      industryExperience.industries
    ),
    projectExperiences,
    targetPosition: mergeStringArrays(
      root.targetPosition,
      root.targetRole,
      root.targetRoles,
      profile.targetPosition,
      roleFit.targetPosition,
      roleFit.targetRole,
      roleFit.targetRoles
    ).slice(0, 10),
    expectedSalary: pickFirstString(
      root.expectedSalary,
      profile.expectedSalary,
      roleFit.expectedSalary,
      roleFit.salaryExpectation
    ),
    onboardingPreference: pickFirstString(
      root.onboardingPreference,
      profile.onboardingPreference,
      roleFit.onboardingPreference,
      roleFit.joiningIntention,
      roleFit.availability
    ),
  }
}

export const normalizeExtractedFields = (raw = {}, options = {}) => {
  const profile = normalizeProfileFields(raw, options)
  const extracted = {
    fullName: pickFirstString(raw.fullName, raw.name, raw.candidateName),
    email: normalizeString(raw.email).toLowerCase(),
    phone: pickFirstString(raw.phone, raw.mobile, raw.tel),
    profile,
  }

  const isMissingValue = (value) => {
    if (Array.isArray(value)) return value.length === 0
    return !normalizeString(value)
  }

  const requiredFieldDefs = [
    { key: 'fullName', value: extracted.fullName },
    { key: 'email', value: extracted.email },
    { key: 'phone', value: extracted.phone },
    { key: 'education', value: extracted.profile.education },
    { key: 'workYears', value: extracted.profile.workYears },
    { key: 'companyExperienceDuration', value: extracted.profile.companyExperienceDuration },
    { key: 'internshipExperienceDuration', value: extracted.profile.internshipExperienceDuration },
    { key: 'projectExperienceDuration', value: extracted.profile.projectExperienceDuration },
    { key: 'languages', value: extracted.profile.languages },
    { key: 'technicalLanguages', value: extracted.profile.technicalLanguages },
    { key: 'technicalCertificates', value: extracted.profile.technicalCertificates },
    { key: 'industry', value: extracted.profile.industry },
    {
      key: 'projectExperiences',
      value: hasProjectExperiences(extracted.profile.projectExperiences, extracted.profile.projectExperience),
    },
    { key: 'targetPosition', value: extracted.profile.targetPosition },
    { key: 'expectedSalary', value: extracted.profile.expectedSalary },
    { key: 'onboardingPreference', value: extracted.profile.onboardingPreference },
  ]

  const missingFields = []
  for (const field of requiredFieldDefs) {
    if (isMissingValue(field.value)) missingFields.push(field.key)
  }

  return { extracted, missingFields, llmJson: null }
}

const findSectionBlock = (normalized, patterns = []) => {
  if (!normalized) return ''
  const lines = String(normalized)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return ''

  const matchesHeader = (line) => patterns.some((pattern) => pattern.test(line))
  const looksLikeHeader = (line) =>
    /[:：]$/.test(line) ||
    /^(工作经历|工作經歷|教育背景|教育|项目经验|項目經歷|项目经验|專業技能|专业技能|技能|證書|证书|語言能力|语言能力|工作經驗|certifications|languages|education|project experience|professional skills|work experience)$/i.test(
      line
    )

  const startIndex = lines.findIndex((line) => matchesHeader(line))
  if (startIndex < 0) return ''

  const collected = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (matchesHeader(line)) break
    if (looksLikeHeader(line)) break
    collected.push(line)
    if (collected.length >= 12) break
  }
  return collected.join('\n').trim()
}

const pickEducationFromText = (normalized) => {
  const directMatch = normalized.match(/(博士|硕士|碩士|MBA|本科|学士|學士|大專|专科|專科)/i)
  return directMatch?.[1] || ''
}

const pickWorkYearsFromText = (normalized) => {
  return extractWorkYearsFromText(normalized)
}

const pickIndustryFromText = (normalized) => {
  const industryKeywords = ['銀行', '银行', '金融服務', '金融服务', '保險', '保险', '證券', '证券', '企業財務', '企业财务', '風險管理', '风险管理', '合規', '合规']
  return industryKeywords.find((keyword) => normalized.includes(keyword)) || ''
}

const extractNameFromText = (normalized) => {
  const explicitMatch =
    normalized.match(/(?:姓名|Name)\s*[:：]\s*([^\n]+)/i) ||
    normalized.match(/^([^\n/]{2,40})\s*\/\s*([A-Za-z][A-Za-z\s\-]{2,40})/m)
  if (explicitMatch?.[1]) return explicitMatch[1].trim()

  const firstLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)

  return (
    firstLines.find((line) => /^[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s\-/.]{1,40}$/u.test(line) && !/@/.test(line)) ||
    ''
  )
}

const extractTechnicalSkillsFromText = (normalized) => {
  const section = findSectionBlock(normalized, [/^专业技能/i, /^專業技能/i, /^professional skills/i, /^技能/i])
  const skillKeywords = [
    'Excel',
    'Power BI',
    'PowerPoint',
    'SQL',
    'Python',
    'Oracle',
    'PostgreSQL',
    'ERP',
    'SAP',
    'AML',
    'KYC',
    'CFT',
    'RWA',
    'FP&A',
    'UAT',
  ]

  const source = `${section}\n${normalized}`
  return skillKeywords.filter((keyword) => new RegExp(keyword.replace(/[+]/g, '\\$&'), 'i').test(source))
}

const containsStandaloneKeyword = (source, keyword) => {
  const text = String(source || '')
  const normalizedKeyword = String(keyword || '')
  if (!normalizedKeyword) return false
  if (/[\u4e00-\u9fff]/.test(normalizedKeyword)) return text.includes(normalizedKeyword)
  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, 'i').test(text)
}

const extractLanguagesFromText = (normalized) => {
  const section = findSectionBlock(normalized, [/^語言能力/i, /^语言能力/i, /^languages/i])
  const languageKeywords = ['中文', '英文', 'English', 'Mandarin', 'Cantonese', '普通話', '廣東話', '粤语']
  const source = `${section}\n${normalized}`
  return [...new Set(languageKeywords.filter((keyword) => new RegExp(keyword, 'i').test(source)))]
}

const extractCertificationsFromText = (normalized) => {
  const section = findSectionBlock(normalized, [/^證書/i, /^证书/i, /^certifications/i])
  const certKeywords = ['CFA', 'FRM', 'CPA', 'CIA', 'CAMS', 'CFP', 'PL-300', 'LOMA']
  const source = `${section}\n${normalized}`
  return [...new Set(certKeywords.filter((keyword) => containsStandaloneKeyword(source, keyword)))]
}

const extractTargetPositionFromText = (normalized) => {
  const topLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
  const candidate = topLines.find((line) =>
    /(經理|经理|分析師|分析师|顧問|顾问|專員|专员|會計|会计|財務|财务|Strategy|Manager|Analyst|Advisor|Officer)/i.test(line)
  )
  return candidate ? [candidate] : []
}

const extractProjectExperienceFromText = (normalized) => {
  const section = findSectionBlock(normalized, [/^項目經歷/i, /^项目经验/i, /^project experience/i])
  if (section) return section.split('\n').slice(0, 4).join(' ').trim()

  const workSection = findSectionBlock(normalized, [/^工作經歷/i, /^工作经历/i, /^work experience/i])
  return workSection.split('\n').slice(0, 4).join(' ').trim()
}

export const extractCandidateInfoByRegexText = (text) => {
  const normalized = String(text || '').replace(/\r/g, '\n')

  const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const phoneMatch = normalized.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/)
  const fullName = extractNameFromText(normalized)
  const education = pickEducationFromText(normalized)
  const workYears = pickWorkYearsFromText(normalized)
  const languages = extractLanguagesFromText(normalized)
  const technicalLanguages = extractTechnicalSkillsFromText(normalized)
  const technicalCertificates = extractCertificationsFromText(normalized)
  const industry = pickIndustryFromText(normalized)
  const projectExperience = extractProjectExperienceFromText(normalized)
  const targetPosition = extractTargetPositionFromText(normalized)

  return normalizeExtractedFields({
    fullName,
    email: emailMatch?.[0] || '',
    phone: phoneMatch?.[0] || '',
    education,
    workYears,
    languages,
    technicalLanguages,
    technicalCertificates,
    industry,
    projectExperience,
    targetPosition,
  }, { sourceText: normalized })
}

export const extractCandidateInfoByRegex = (buffer) => extractCandidateInfoByRegexText(buffer.toString('utf8'))
