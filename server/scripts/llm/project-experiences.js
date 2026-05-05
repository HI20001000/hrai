export const PERSONAL_PROJECT_GROUP_NAME = '個人項目'

const MAX_PROJECT_SKILLS = 20
const MAX_DURATION_MONTHS = 600

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

export const normalizeProjectText = (value) => String(value ?? '').trim()

export const normalizeProjectSkillList = (value, limit = MAX_PROJECT_SKILLS) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|/]+/)
      : []

  const skills = []
  const seen = new Set()
  for (const raw of source.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    const text = normalizeProjectText(raw)
    if (!text || seen.has(text)) continue
    seen.add(text)
    skills.push(text)
    if (skills.length >= limit) break
  }
  return skills
}

const pickFirstProjectText = (...values) => {
  for (const value of values) {
    const text = normalizeProjectText(value)
    if (text) return text
  }
  return ''
}

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
  const text = normalizeProjectText(value)
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
  const text = normalizeProjectText(value)
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
  const text = normalizeProjectText(value)
  if (!text) return ''
  const months = computeProjectDurationMonths(text)
  const durationLabel = formatProjectDurationMonthsLabel(months)
  return durationLabel ? `${text} (${durationLabel})` : text
}

export const normalizeProjectItem = (value) => {
  if (!isPlainObject(value)) return null

  const projectName = pickFirstProjectText(value.projectName, value.name, value.title)
  const skills = normalizeProjectSkillList(
    value.skills ?? value.techStack ?? value.technicalLanguages ?? value.technologies,
    MAX_PROJECT_SKILLS
  )
  const durationText = pickFirstProjectText(
    value.durationText,
    value.duration,
    value.projectDuration,
    value.timespan,
    value.period
  )
  const durationMonths =
    typeof value.durationMonths === 'number' && Number.isFinite(value.durationMonths) && value.durationMonths > 0
      ? Math.round(value.durationMonths)
      : computeProjectDurationMonths(durationText)

  if (!projectName && !skills.length && !durationText) return null
  return { projectName, skills, durationText, durationMonths }
}

export const normalizeProjectExperiences = (value) => {
  if (!Array.isArray(value)) return []

  const groups = []
  for (const rawGroup of value) {
    if (!isPlainObject(rawGroup)) continue

    const groupTypeValue = normalizeProjectText(rawGroup.groupType).toLowerCase()
    const rawCompanyName = pickFirstProjectText(
      rawGroup.companyName,
      rawGroup.company,
      rawGroup.employer,
      rawGroup.organization,
      rawGroup.groupName
    )
    const groupType =
      groupTypeValue === 'personal' || rawCompanyName === PERSONAL_PROJECT_GROUP_NAME
        ? 'personal'
        : 'company'
    const companyName = groupType === 'personal' ? PERSONAL_PROJECT_GROUP_NAME : rawCompanyName
    const projects = Array.isArray(rawGroup.projects)
      ? rawGroup.projects.map((project) => normalizeProjectItem(project)).filter(Boolean)
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

export const hasProjectExperiences = (groups = [], legacyText = '') => {
  return normalizeProjectExperiences(groups).length > 0 || !!normalizeProjectText(legacyText)
}

export const buildProjectExperiencesSummary = (groups = [], legacyText = '') => {
  const normalizedGroups = normalizeProjectExperiences(groups)
  if (!normalizedGroups.length) return normalizeProjectText(legacyText)

  return normalizedGroups
    .map((group) => {
      const projects = group.projects
        .map((project) => {
          const parts = []
          if (project.projectName) parts.push(project.projectName)
          if (project.skills.length) parts.push(`技能: ${project.skills.join('、')}`)
          if (project.durationText) parts.push(`時長: ${formatProjectDurationDisplay(project.durationText)}`)
          return parts.join(' | ')
        })
        .filter(Boolean)
      return `${group.companyName}: ${projects.join('; ')}`
    })
    .filter(Boolean)
    .join('\n')
}
