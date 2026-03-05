export const getLlmConfig = () => ({
  apiUrl: process.env.CV_LLM_API_URL || process.env.LLM_BASE_URL || process.env.LLM_API_URL || '',
  apiKey: process.env.CV_LLM_API_KEY || process.env.LLM_API_KEY || '',
  model: process.env.CV_LLM_MODEL || process.env.LLM_MODEL || '',
})
