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
  const direct = safeJsonParse(content)
  if (direct) return direct

  const fenced = String(content).match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const parsed = safeJsonParse(fenced[1].trim())
    if (parsed) return parsed
  }
  return null
}

export const extractKeywordsFromLlmJson = (llmJson) => {
  if (!llmJson || typeof llmJson !== 'object') return []
  const candidates = [llmJson.keywords, llmJson.skills, llmJson.tags]
  const flattened = candidates
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  return [...new Set(flattened)].slice(0, 20)
}

export const normalizeExtractedFields = (raw = {}) => {
  const extracted = {
    fullName: String(raw.fullName || '').trim(),
    email: String(raw.email || '').trim().toLowerCase(),
    phone: String(raw.phone || '').trim(),
  }
  const missingFields = []
  if (!extracted.fullName) missingFields.push('fullName')
  if (!extracted.email) missingFields.push('email')
  if (!extracted.phone) missingFields.push('phone')
  return { extracted, missingFields, llmJson: null, keywords: [] }
}

export const extractCandidateInfoByRegex = (buffer) => {
  const text = buffer.toString('utf8')
  const normalized = text.replace(/\r/g, '\n')

  const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const phoneMatch = normalized.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/)
  const nameMatch =
    normalized.match(/(?:姓名|Name)\s*[:：]\s*([^\n]+)/i) ||
    normalized.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s]{1,30})$/mu)

  return normalizeExtractedFields({
    fullName: nameMatch?.[1] || '',
    email: emailMatch?.[0] || '',
    phone: phoneMatch?.[0] || '',
  })
}
