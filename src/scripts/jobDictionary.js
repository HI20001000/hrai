const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

const RESPONSE_META_KEYS = new Set(['dictionary', 'message', 'data', 'payload', 'result', 'jobDictionary'])

const looksLikeJobEntry = (value) => {
  if (!isPlainObject(value)) return false
  return [
    'description',
    'industry',
    'roleKeywords',
    'coreResponsibilities',
    'requiredSkills',
    'preferredSkills',
    'certifications',
    'minWorkYears',
    'salaryRange',
    'weights',
  ].some((key) => key in value)
}

const looksLikeJobDictionary = (value) => {
  if (!isPlainObject(value)) return false
  const entries = Object.entries(value)
  if (!entries.length) return true
  return entries.every(([, entry]) => looksLikeJobEntry(entry))
}

const findJobDictionary = (payload, depth = 0) => {
  if (!isPlainObject(payload) || depth > 2) return null
  if (looksLikeJobDictionary(payload)) return payload

  const candidateKeys = ['dictionary', 'jobDictionary', 'data', 'payload', 'result']
  for (const key of candidateKeys) {
    const nested = findJobDictionary(payload[key], depth + 1)
    if (nested) return nested
  }

  for (const [key, value] of Object.entries(payload)) {
    if (RESPONSE_META_KEYS.has(key)) continue
    const nested = findJobDictionary(value, depth + 1)
    if (nested) return nested
  }

  return null
}

export const resolveJobDictionary = (payload) => {
  return findJobDictionary(payload) || {}
}
