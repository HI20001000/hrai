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
  const llmInputContent = `${getCvLlmPrompt()}\n\n履歷文字內容：\n${cvText}`

  const response = await fetch(llmEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: llmInputContent,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    await response.text()
    return null
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || null
  return content
}
