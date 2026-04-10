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

export const validateCvExtractionPayload = (payload) => {
  if (!isPlainObject(payload)) throw new Error('CV extraction output must be a JSON object')

  for (const key of ['fullName', 'email', 'phone', 'education', 'workYears', 'industry', 'projectExperience', 'expectedSalary', 'onboardingPreference']) {
    assertStringField(payload, key)
  }

  for (const key of ['languages', 'technicalLanguages', 'technicalCertificates', 'targetPosition']) {
    assertStringArrayField(payload, key)
  }

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

const normalizeProfileFields = (raw = {}) => {
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
      basicAttributes.experienceYears
    ),
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
    projectExperience: pickFirstLongText(
      root.projectExperience,
      root.projectExperiences,
      root.projectSummary,
      root.projectDescription,
      root.projects,
      root.workExperience,
      root.workExperiences,
      root.workSummary,
      root.workHistory,
      root.employmentHistory,
      root.experienceSummary,
      profile.projectExperience,
      profile.projectExperiences,
      profile.projectSummary,
      profile.projectDescription,
      profile.projects,
      profile.workExperience,
      profile.workExperiences,
      profile.workSummary,
      profile.workHistory,
      profile.employmentHistory,
      profile.experienceSummary,
      industryExperience.projectExperience,
      industryExperience.projectExperiences,
      industryExperience.projectSummary,
      industryExperience.projects,
      industryExperience.workExperience,
      industryExperience.workExperiences,
      industryExperience.workSummary,
      industryExperience.workHistory,
      industryExperience.employmentHistory,
      industryExperience.experienceSummary
    ),
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

export const normalizeExtractedFields = (raw = {}) => {
  const profile = normalizeProfileFields(raw)
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
    { key: 'languages', value: extracted.profile.languages },
    { key: 'technicalLanguages', value: extracted.profile.technicalLanguages },
    { key: 'technicalCertificates', value: extracted.profile.technicalCertificates },
    { key: 'industry', value: extracted.profile.industry },
    { key: 'projectExperience', value: extracted.profile.projectExperience },
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
  const plusYear = normalized.match(/(\d+)\s*\+\s*(?:年|years?)/i)
  if (plusYear?.[1]) return `${plusYear[1]}年以上`
  const yearRange = normalized.match(/(\d+\s*[-~至]\s*\d+)\s*年/i)
  if (yearRange?.[1]) return `${yearRange[1].replace(/\s+/g, '')}年`
  const yearCount = normalized.match(/(\d+)\s*(?:年|years?)/i)
  if (yearCount?.[1]) return `${yearCount[1]}年`
  return ''
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
  })
}

export const extractCandidateInfoByRegex = (buffer) => extractCandidateInfoByRegexText(buffer.toString('utf8'))
