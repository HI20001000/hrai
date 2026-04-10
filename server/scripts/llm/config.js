const parseBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

const parseInteger = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const parseJson = (value) => {
  const text = String(value || '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const getLlmConfig = () => ({
  apiUrl: process.env.CV_LLM_API_URL || process.env.LLM_BASE_URL || process.env.LLM_API_URL || '',
  completionsUrl:
    process.env.CV_LLM_CHAT_COMPLETIONS_URL ||
    process.env.LLM_CHAT_COMPLETIONS_URL ||
    process.env.LLM_COMPLETIONS_URL ||
    '',
  apiKey: process.env.CV_LLM_API_KEY || process.env.LLM_API_KEY || '',
  model: process.env.CV_LLM_MODEL || process.env.LLM_MODEL || '',
  disableThinking: parseBoolean(
    process.env.CV_LLM_DISABLE_THINKING ?? process.env.LLM_DISABLE_THINKING,
    false
  ),
  extraBody: parseJson(process.env.CV_LLM_EXTRA_BODY_JSON || process.env.LLM_EXTRA_BODY_JSON || ''),
  maxTokens: parseInteger(process.env.LLM_MAX_TOKENS, 2500),
})
