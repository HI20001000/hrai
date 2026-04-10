import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOG_DIR = path.resolve(__dirname, '../../logs')
const LLM_LOG_PATH = path.join(LOG_DIR, 'llm.log')
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_FILES = 5

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const getMaxBytes = () => toPositiveInt(process.env.LLM_LOG_MAX_BYTES, DEFAULT_MAX_BYTES)
const getMaxFiles = () => toPositiveInt(process.env.LLM_LOG_MAX_FILES, DEFAULT_MAX_FILES)

const ensureLogDir = () => {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

const rotateLogFile = (filePath, maxFiles) => {
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`
    const target = `${filePath}.${index + 1}`
    if (!fs.existsSync(source)) continue
    fs.renameSync(source, target)
  }

  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, `${filePath}.1`)
  }
}

const ensureLogRotation = (filePath, incomingSize) => {
  ensureLogDir()
  if (!fs.existsSync(filePath)) return

  const maxBytes = getMaxBytes()
  const currentSize = fs.statSync(filePath).size
  if (currentSize + incomingSize <= maxBytes) return

  const maxFiles = getMaxFiles()
  const lastBackup = `${filePath}.${maxFiles}`
  if (fs.existsSync(lastBackup)) {
    fs.rmSync(lastBackup, { force: true })
  }
  rotateLogFile(filePath, maxFiles)
}

const appendJsonLine = (filePath, payload) => {
  const line = `${JSON.stringify(payload)}\n`
  ensureLogRotation(filePath, Buffer.byteLength(line))
  fs.appendFileSync(filePath, line, 'utf8')
}

const maskSecret = (value = '') => {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return '***'
  return `${text.slice(0, 4)}***${text.slice(-4)}`
}

const sanitizeForJson = (value) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  return value
}

export const logLlmEvent = (eventType, payload = {}) => {
  try {
    appendJsonLine(LLM_LOG_PATH, {
      timestamp: new Date().toISOString(),
      type: eventType,
      ...sanitizeForJson(payload),
    })
  } catch (error) {
    console.error('[Log] Failed to write LLM log:', error)
  }
}

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

