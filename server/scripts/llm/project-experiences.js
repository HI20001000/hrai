export const PROJECT_GROUP_NAME = '專案'
export const PERSONAL_PROJECT_GROUP_NAME = PROJECT_GROUP_NAME

const MAX_PROJECT_SKILLS = 20
const MAX_PROJECT_RESPONSIBILITIES = 20
const MAX_DURATION_MONTHS = 600
const PROJECT_GROUP_TYPES = new Set(['company', 'internship', 'project'])

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

export const normalizeProjectResponsibilityList = (value, limit = MAX_PROJECT_RESPONSIBILITIES) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|]+/)
      : []

  const responsibilities = []
  const seen = new Set()
  for (const raw of source.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    const text = normalizeProjectText(raw).replace(/^[-*•·]\s*/, '')
    if (!text || seen.has(text)) continue
    seen.add(text)
    responsibilities.push(text)
    if (responsibilities.length >= limit) break
  }
  return responsibilities
}

const pickFirstProjectText = (...values) => {
  for (const value of values) {
    const text = normalizeProjectText(value)
    if (text) return text
  }
  return ''
}

const pickProjectResponsibilityList = (...values) => {
  const responsibilities = []
  const seen = new Set()
  for (const value of values) {
    for (const item of normalizeProjectResponsibilityList(value, MAX_PROJECT_RESPONSIBILITIES)) {
      if (seen.has(item)) continue
      seen.add(item)
      responsibilities.push(item)
      if (responsibilities.length >= MAX_PROJECT_RESPONSIBILITIES) return responsibilities
    }
  }
  return responsibilities
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

export const parseProjectDurationRange = (value) => {
  const text = normalizeProjectText(value)
  if (!text) return null

  const match = text.match(
    /(\d{4}(?:[./-]\d{1,2}|年\s*\d{1,2}\s*月?)?|\d{4})\s*(?:-|~|–|—|至|到|to)\s*(至今|現在|现今|目前|present|current|now|\d{4}(?:[./-]\d{1,2}|年\s*\d{1,2}\s*月?)?|\d{4})/i
  )
  if (!match) return null

  const start = parseYearMonthToken(match[1])
  const end = parseYearMonthToken(match[2])
  if (!start || !end) return null

  const startMonth = start.year * 12 + (start.month ?? 1)
  const endMonth = end.year * 12 + (end.month ?? 12)
  if (endMonth < startMonth) return null

  const months = endMonth - startMonth + 1
  if (!Number.isInteger(months) || months <= 0 || months > MAX_DURATION_MONTHS) return null
  return { startMonth, endMonth }
}

export const computeProjectDurationMonths = (value) => {
  const text = normalizeProjectText(value)
  if (!text) return null

  const range = parseProjectDurationRange(text)
  if (range) return range.endMonth - range.startMonth + 1

  let match = text.match(/(\d+)\s*年\s*(\d+)\s*(?:個月|个月|月|months?|mos?)/i)
  if (match) {
    const months = Number(match[1]) * 12 + Number(match[2])
    return months > 0 && months <= MAX_DURATION_MONTHS ? months : null
  }

  match = text.match(/(\d+)\s*(?:個月|个月|月|months?|mos?)/i)
  if (match) {
    const months = Number(match[1])
    return months > 0 && months <= MAX_DURATION_MONTHS ? months : null
  }

  match = text.match(/(\d+)\s*(?:年|years?|yrs?)/i)
  if (match) {
    const months = Number(match[1]) * 12
    return months > 0 && months <= MAX_DURATION_MONTHS ? months : null
  }

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
  const responsibilities = pickProjectResponsibilityList(
    value.responsibilities ??
      [],
    value.responsibilityText,
    value.responsibility,
    value.projectResponsibilities,
    value.roleResponsibilities,
    value.details,
    value.content,
    value.highlights,
    value.achievements,
    value.tasks
  )
  const durationMonths =
    typeof value.durationMonths === 'number' && Number.isFinite(value.durationMonths) && value.durationMonths > 0
      ? Math.round(value.durationMonths)
      : computeProjectDurationMonths(durationText)

  if (!projectName && !skills.length && !durationText && !responsibilities.length) return null
  return { projectName, skills, durationText, durationMonths, responsibilities }
}

const normalizeProjectGroupType = (value, companyName = '') => {
  const text = normalizeProjectText(value).toLowerCase()
  if (text === 'internship' || text === 'intern' || text === '實習' || text === '实习') return 'internship'
  if (text === 'project' || text === 'personal' || text === '專案' || text === '项目') return 'project'
  if (text === 'company' || text === 'work' || text === 'employment' || text === '公司') return 'company'
  if ([PROJECT_GROUP_NAME, '個人項目'].includes(normalizeProjectText(companyName))) return 'project'
  return PROJECT_GROUP_TYPES.has(text) ? text : 'company'
}

export const normalizeProjectExperiences = (value) => {
  if (!Array.isArray(value)) return []

  const groups = []
  for (const rawGroup of value) {
    if (!isPlainObject(rawGroup)) continue

    const rawCompanyName = pickFirstProjectText(
      rawGroup.companyName,
      rawGroup.company,
      rawGroup.employer,
      rawGroup.organization,
      rawGroup.groupName
    )
    const groupType = normalizeProjectGroupType(rawGroup.groupType, rawCompanyName)
    const companyName = groupType === 'project' ? PROJECT_GROUP_NAME : rawCompanyName
    const projects = Array.isArray(rawGroup.projects)
      ? rawGroup.projects.map((project) => normalizeProjectItem(project)).filter(Boolean)
      : []

    if (!projects.length) continue
    if ((groupType === 'company' || groupType === 'internship') && !companyName) continue

    groups.push({
      groupType,
      companyName,
      projects,
    })
  }

  return groups
}

const mergeDurationRanges = (ranges = []) => {
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

export const computeProjectExperienceDurationMonthsByType = (groups = []) => {
  const buckets = {
    company: { ranges: [], fallbackMonths: 0 },
    internship: { ranges: [], fallbackMonths: 0 },
    project: { ranges: [], fallbackMonths: 0 },
  }

  for (const group of normalizeProjectExperiences(groups)) {
    const bucket = buckets[group.groupType]
    if (!bucket) continue

    for (const project of group.projects || []) {
      const range = parseProjectDurationRange(project.durationText)
      if (range) {
        bucket.ranges.push(range)
        continue
      }

      const months = Number(project.durationMonths || computeProjectDurationMonths(project.durationText) || 0)
      if (Number.isInteger(months) && months > 0 && months <= MAX_DURATION_MONTHS) {
        bucket.fallbackMonths += months
      }
    }
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [
      key,
      mergeDurationRanges(bucket.ranges) + bucket.fallbackMonths,
    ])
  )
}

export const buildProjectExperienceDurationLabels = (groups = []) => {
  const durations = computeProjectExperienceDurationMonthsByType(groups)
  return {
    companyExperienceDuration: formatProjectDurationMonthsLabel(durations.company),
    internshipExperienceDuration: formatProjectDurationMonthsLabel(durations.internship),
    projectExperienceDuration: formatProjectDurationMonthsLabel(durations.project),
  }
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
          if (project.responsibilities.length) parts.push(`負責內容: ${project.responsibilities.join('、')}`)
          return parts.join(' | ')
        })
        .filter(Boolean)
      const label = group.groupType === 'internship' ? '實習' : group.groupType === 'project' ? '專案' : '公司'
      return `${label} - ${group.companyName}: ${projects.join('; ')}`
    })
    .filter(Boolean)
    .join('\n')
}
