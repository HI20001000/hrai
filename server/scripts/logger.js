import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOG_DIR = path.resolve(__dirname, '../../logs')
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const LOG_PREVIEW_LIMIT = 240
const logContext = new AsyncLocalStorage()

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const getCategoryMaxBytes = (category) => {
  const normalized = String(category || '').trim().toUpperCase()
  const categoryValue =
    process.env[`${normalized}_LOG_MAX_BYTES`] ||
    (normalized === 'DB' ? process.env.DB_OPERATION_LOG_MAX_BYTES || process.env.DATABASE_LOG_MAX_BYTES : '')
  return toPositiveInt(categoryValue || process.env.LOG_MAX_BYTES, DEFAULT_MAX_BYTES)
}

const pad = (value, length = 2) => String(value).padStart(length, '0')

const formatDateStamp = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const formatTimestamp = (date = new Date()) =>
  `${formatDateStamp(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getPatchFilePath = (category, incomingSize) => {
  const normalizedCategory = String(category || 'app').trim().toLowerCase()
  const dir = path.join(LOG_DIR, normalizedCategory)
  fs.mkdirSync(dir, { recursive: true })

  const dateStamp = formatDateStamp()
  const pattern = new RegExp(`^${escapeRegExp(dateStamp)}_patch(\\d+)\\.log$`)
  const patchNumbers = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(pattern)?.[1])
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)

  let patchNumber = patchNumbers.length ? Math.max(...patchNumbers) : 1
  let filePath = path.join(dir, `${dateStamp}_patch${pad(patchNumber, 3)}.log`)
  if (fs.existsSync(filePath)) {
    const currentSize = fs.statSync(filePath).size
    if (currentSize + incomingSize > getCategoryMaxBytes(normalizedCategory)) {
      patchNumber += 1
      filePath = path.join(dir, `${dateStamp}_patch${pad(patchNumber, 3)}.log`)
    }
  }

  return filePath
}

const appendLogLine = (category, line) => {
  const incomingSize = Buffer.byteLength(line)
  const filePath = getPatchFilePath(category, incomingSize)
  fs.appendFileSync(filePath, line, 'utf8')
}

const maskSecret = (value = '') => {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return '***'
  return `${text.slice(0, 4)}***${text.slice(-4)}`
}

const getContext = () => logContext.getStore() || {}

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const truncate = (value, limit = LOG_PREVIEW_LIMIT) => {
  const text = normalizeWhitespace(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

const normalizeLogUser = (value) => {
  if (value && typeof value === 'object') {
    const id = Number(value.id || 0) || ''
    const email = String(value.mail || value.email || '').trim().toLowerCase()
    const username = String(value.username || value.name || '').trim()
    const label = username || email || 'unknown'
    return id ? `${label}#${id}` : label
  }

  const text = String(value || '').trim()
  return text || 'system'
}

const formatLogValue = (value) => {
  if (value instanceof Error) {
    return truncate(`${value.name}: ${value.message}`)
  }
  if (value && typeof value === 'object') {
    return truncate(JSON.stringify(value))
  }
  return truncate(value)
}

const appendDetailParts = (parts, key, value) => {
  if (value === undefined || value === null || value === '') return

  if (['inputContent', 'responseText', 'content'].includes(key)) {
    const text = String(value || '')
    parts.push(`${key}字數=${text.length}`)
    const preview = truncate(text)
    if (preview) parts.push(`${key}預覽=${preview}`)
    return
  }

  parts.push(`${key}=${formatLogValue(value)}`)
}

const writeEventLog = (category, eventType, payload = {}) => {
  const context = getContext()
  const user = normalizeLogUser(payload.user || context.user || (category === 'db' ? 'anonymous' : 'system'))
  const parts = [
    `時間=${formatTimestamp()}`,
    `操作=${String(eventType || 'unknown')}`,
    `用戶=${user}`,
  ]

  const merged = {
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.method ? { method: context.method } : {}),
    ...(context.path ? { path: context.path } : {}),
    ...payload,
  }
  delete merged.user

  for (const [key, value] of Object.entries(merged)) {
    appendDetailParts(parts, key, value)
  }

  appendLogLine(category, `${parts.join(' | ')}\n`)
}

export const logLlmEvent = (eventType, payload = {}) => {
  try {
    writeEventLog('llm', eventType, payload)
  } catch (error) {
    console.error('[Log] Failed to write LLM log:', error)
  }
}

export const logDatabaseOperation = (eventType, payload = {}) => {
  try {
    writeEventLog('db', eventType, payload)
  } catch (error) {
    console.error('[Log] Failed to write database operation log:', error)
  }
}

export const runWithLogContext = (context, callback) => logContext.run(context || {}, callback)

export const buildLlmLogMeta = ({
  callId = '',
  endpoint = '',
  model = '',
  maxTokens = 0,
  temperature = 0,
  apiKey = '',
  inputContent = '',
} = {}) => ({
  callId,
  endpoint,
  model,
  maxTokens,
  temperature,
  apiKeyMasked: maskSecret(apiKey),
  inputContent: String(inputContent || ''),
})
