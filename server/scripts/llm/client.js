import crypto from 'node:crypto'
import { getLlmConfig } from './config.js'
import { getCvLlmPrompt } from './prompt.js'
import { buildLlmLogMeta, logLlmEvent } from '../logger.js'
import { LlmRequestError } from '../errors.js'

export const buildLlmChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').trim().replace(/\/$/, '')
  if (!normalized) return ''
  if (normalized.endsWith('/chat/completions')) return normalized
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`
  return `${normalized}/chat/completions`
}

const formatCurrentTaskDate = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const buildCvLlmInputContent = (cvText, fileName = '') =>
  `${getCvLlmPrompt()}\n\nCurrent task date:\n${formatCurrentTaskDate()}\n\nCV file name:\n${String(fileName || '')}\n\nCV text content:\n${String(cvText || '')}`

export const buildCvLlmRetryInputContent = (cvText, fileName = '', previousContent = '') => [
  getCvLlmPrompt(),
  '',
  'Current task date:',
  formatCurrentTaskDate(),
  '',
  '重要補充要求：',
  '1. 上一次輸出不是完整合法 JSON，可能被截斷或格式錯誤。',
  '2. 這一次請只輸出一個完整、可解析的 JSON 物件。',
  '3. 不要輸出任何額外說明、不要輸出 Markdown、不要輸出程式碼區塊。',
  previousContent ? `上一次的錯誤輸出如下，僅供你修正格式參考：\n${String(previousContent).slice(0, 1500)}` : '',
  '',
  'CV file name:',
  String(fileName || ''),
  '',
  'CV text content:',
  String(cvText || ''),
]
  .filter(Boolean)
  .join('\n')

export const buildJsonRepairInputContent = (rawContent) => [
  '你是 JSON 修復助手。',
  '請將下面內容修復為一個完整、合法、可解析的 JSON 物件。',
  '只能輸出 JSON，不要輸出解釋、Markdown 或程式碼區塊。',
  '如果原內容不完整，請僅在不改變原有欄位結構的前提下補齊必要的括號、引號與空值。',
  '',
  '待修復內容：',
  String(rawContent || ''),
]
  .filter(Boolean)
  .join('\n')

export const callLlmPrompt = async (inputContent, { maxTokens = 1000, temperature = 0.7 } = {}) => {
  const { apiUrl, completionsUrl, apiKey, model, disableThinking, extraBody, maxTokens: configMaxTokens } = getLlmConfig()
  if ((!apiUrl && !completionsUrl) || !model) {
    throw new LlmRequestError('LLM configuration is incomplete: endpoint or model is missing')
  }

  const llmEndpoint = String(completionsUrl || '').trim() || buildLlmChatCompletionsUrl(apiUrl)
  if (!llmEndpoint) {
    throw new LlmRequestError('LLM endpoint is empty after config resolution')
  }

  const callId = crypto.randomUUID()
  const startedAt = Date.now()
  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: String(inputContent || ''),
      },
    ],
    max_tokens: maxTokens || configMaxTokens || 2500,
    temperature,
    ...(extraBody && typeof extraBody === 'object' ? extraBody : {}),
  }

  if (disableThinking) {
    const currentChatTemplateKwargs =
      requestBody.chat_template_kwargs &&
      typeof requestBody.chat_template_kwargs === 'object' &&
      !Array.isArray(requestBody.chat_template_kwargs)
        ? requestBody.chat_template_kwargs
        : {}

    requestBody.chat_template_kwargs = {
      ...currentChatTemplateKwargs,
      enable_thinking: false,
    }
  }

  logLlmEvent(
    'llm_request',
    buildLlmLogMeta({
      callId,
      endpoint: llmEndpoint,
      model,
      maxTokens,
      temperature,
      apiKey,
      inputContent,
    })
  )

  try {
    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
    })
    const responseText = await response.text()
    const durationMs = Date.now() - startedAt

    if (!response.ok) {
      logLlmEvent('llm_response_error', {
        callId,
        endpoint: llmEndpoint,
        model,
        status: response.status,
        statusText: response.statusText,
        durationMs,
        responseText,
      })
      throw new LlmRequestError(
        `LLM request failed: ${response.status} ${response.statusText} @ ${llmEndpoint}`
      )
    }

    let data = null
    try {
      data = responseText ? JSON.parse(responseText) : null
    } catch (error) {
      logLlmEvent('llm_response_parse_error', {
        callId,
        endpoint: llmEndpoint,
        model,
        durationMs,
        responseText,
        error: {
          name: error?.name || 'Error',
          message: error?.message || String(error || 'Unknown error'),
        },
      })
      throw new LlmRequestError(`LLM API response is not valid JSON @ ${llmEndpoint}`)
    }

    const content = data?.choices?.[0]?.message?.content || null
    const reasoning = data?.choices?.[0]?.message?.reasoning || ''
    const finishReason = data?.choices?.[0]?.finish_reason || ''
    if (typeof content !== 'string' || !content.trim()) {
      logLlmEvent('llm_response_content_missing', {
        callId,
        endpoint: llmEndpoint,
        model,
        durationMs,
        responseText,
        finishReason,
        reasoningPreview: String(reasoning || '').slice(0, 1000),
      })
      if (reasoning && String(finishReason).toLowerCase() === 'length') {
        throw new LlmRequestError(
          'LLM used all max_tokens in reasoning mode before producing final content; disable thinking mode or increase max_tokens'
        )
      }
      throw new LlmRequestError(`LLM response content is empty @ ${llmEndpoint}`)
    }
    logLlmEvent('llm_response', {
      callId,
      endpoint: llmEndpoint,
      model,
      status: response.status,
      durationMs,
      responseText,
      content,
    })
    return content
  } catch (error) {
    const durationMs = Date.now() - startedAt
    logLlmEvent('llm_request_exception', {
      callId,
      endpoint: llmEndpoint,
      model,
      durationMs,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error || 'Unknown error'),
        stack: error?.stack || '',
      },
    })
    if (error instanceof LlmRequestError) throw error
    throw new LlmRequestError(error?.message || 'Unexpected LLM request error')
  }
}

export const buildJsonTaskInputContent = (prompt, payload) => {
  const promptText = String(prompt || '').trim()
  const taskPayload = payload && typeof payload === 'object' ? payload : {}
  const payloadText = JSON.stringify(taskPayload, null, 2)
  let hasTemplateToken = false
  const renderedPrompt = promptText.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => {
    if (!(key in taskPayload)) return match
    hasTemplateToken = true
    return JSON.stringify(taskPayload[key], null, 2)
  })

  return hasTemplateToken ? renderedPrompt : `${promptText}\n\nInput JSON:\n${payloadText}`
}

export const extractCandidateInfoByLlm = async (cvText, fileName = '') => {
  const { maxTokens } = getLlmConfig()
  const llmInputContent = buildCvLlmInputContent(cvText, fileName)
  return callLlmPrompt(llmInputContent, { maxTokens, temperature: 0 })
}

export const retryExtractCandidateInfoByLlm = async (cvText, fileName = '', previousContent = '') => {
  const { maxTokens } = getLlmConfig()
  const llmInputContent = buildCvLlmRetryInputContent(cvText, fileName, previousContent)
  return callLlmPrompt(llmInputContent, { maxTokens, temperature: 0 })
}

export const repairLlmJsonContent = async (rawContent) => {
  const { maxTokens } = getLlmConfig()
  const llmInputContent = buildJsonRepairInputContent(rawContent)
  return callLlmPrompt(llmInputContent, { maxTokens, temperature: 0 })
}
