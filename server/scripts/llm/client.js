import { getLlmConfig } from './config.js'
import { getCvLlmPrompt } from './prompt.js'

export const buildLlmChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').trim().replace(/\/$/, '')
  if (!normalized) return ''
  if (normalized.endsWith('/chat/completions')) return normalized
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`
  return `${normalized}/chat/completions`
}

export const extractCandidateInfoByLlm = async (cvText) => {
  const { apiUrl, apiKey, model } = getLlmConfig()
  if (!apiUrl || !model) return null
  const llmEndpoint = buildLlmChatCompletionsUrl(apiUrl)
  if (!llmEndpoint) return null

  const response = await fetch(llmEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: getCvLlmPrompt() },
        { role: 'user', content: `履歷文字內容：\n${cvText}` },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.warn('[CV] LLM API request failed:', response.status, llmEndpoint, errorText)
    return null
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || null
  const preview = typeof content === 'string' ? content.slice(0, 4000) : JSON.stringify(content || '')
  console.log('[CV] LLM raw output:', preview)
  return content
}
