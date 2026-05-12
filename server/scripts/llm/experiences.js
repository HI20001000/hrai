const MAX_EXPERIENCE_HIGHLIGHTS = 20

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

export const normalizeExperienceText = (value) => String(value ?? '').trim()

export const normalizeExperienceHighlights = (value, limit = MAX_EXPERIENCE_HIGHLIGHTS) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n;；]+/)
      : []

  const highlights = []
  const seen = new Set()
  for (const raw of source.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    const text = normalizeExperienceText(raw)
    if (!text || seen.has(text)) continue
    seen.add(text)
    highlights.push(text)
    if (highlights.length >= limit) break
  }
  return highlights
}

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = normalizeExperienceText(value)
    if (text) return text
  }
  return ''
}

export const normalizeExperienceItem = (value) => {
  if (!isPlainObject(value)) return null

  const companyName = pickFirstText(
    value.companyName,
    value.company,
    value.employer,
    value.organization
  )
  const roleTitle = pickFirstText(
    value.roleTitle,
    value.title,
    value.position,
    value.role
  )
  const durationText = pickFirstText(
    value.durationText,
    value.duration,
    value.period,
    value.timespan
  )
  const highlights = normalizeExperienceHighlights(
    value.highlights ??
      value.responsibilities ??
      value.achievements ??
      value.details ??
      value.content ??
      value.bullets
  )

  if (!companyName && !roleTitle && !durationText && !highlights.length) return null
  return { companyName, roleTitle, durationText, highlights }
}

export const normalizeExperienceItems = (value) => {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeExperienceItem(item)).filter(Boolean)
}

export const hasExperienceItems = (value) => normalizeExperienceItems(value).length > 0

export const buildExperienceSummary = (value = []) =>
  normalizeExperienceItems(value)
    .map((item) => {
      const header = [item.companyName, item.roleTitle, item.durationText].filter(Boolean).join(' | ')
      const highlights = item.highlights.length ? item.highlights.join('；') : ''
      return [header, highlights].filter(Boolean).join(' | ')
    })
    .filter(Boolean)
    .join('\n')
