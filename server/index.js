import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDatabasePool,
  ensureAuthTables,
  ensureCvTables,
  ensureDatabaseExists,
  getDatabaseName,
} from './scripts/database/index.js'
import { HttpError } from './scripts/errors.js'
import { extractCandidateInfoFromCv } from './scripts/llm/cv-extractor.js'
import { normalizeExperienceItems } from './scripts/llm/experiences.js'
import {
  buildProjectExperienceDurationLabels,
  hasProjectExperiences,
  normalizeProjectExperiences,
} from './scripts/llm/project-experiences.js'
import { extractTextFromBuffer } from './scripts/llm/text-extractors.js'
import {
  getJobDictionary,
  loadJobDictionary,
  normalizeEmploymentGapLimitMonths,
  saveJobDictionary,
} from './scripts/jobs/dictionary.js'
import { buildEmploymentGapReport, matchCandidateToJobPost, matchCandidateToJobs } from './scripts/llm/job-matcher.js'
import { suggestJobDictionaryDefinition } from './scripts/llm/job-dictionary-suggester.js'
import { suggestJobScoringRubrics } from './scripts/llm/rubric-suggester.js'
import { normalizeScoringRubrics, normalizeScoringWeights } from './scripts/jobs/scoring.js'
import { logDatabaseOperation, runWithLogContext } from './scripts/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CV_STORAGE_DIR = path.resolve(__dirname, 'storage', 'cv')

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFile(path.resolve(__dirname, '../.env'))
loadEnvFile(path.resolve(__dirname, '.env'))

const APP_TIME_ZONE = process.env.HRAI_TIMEZONE || process.env.APP_TIMEZONE || 'Asia/Hong_Kong'
process.env.TZ = APP_TIME_ZONE

const MYSQL_MAX_DATETIME = '9999-12-31 23:59:59'
const PERMANENT_AUTH_EXPIRES_AT = `${MYSQL_MAX_DATETIME.replace(' ', 'T')}+08:00`

const formatSqlDateTime = (date) => {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return MYSQL_MAX_DATETIME
  const pad = (number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

const resolveTokenTtlConfig = () => {
  const asMs = Number(process.env.AUTH_AUTO_LOGIN_TTL_MS || '')
  if (Number.isFinite(asMs) && asMs > 0) return { ttlMs: asMs, permanent: false }

  const asMinutes = Number(process.env.AUTH_AUTO_LOGIN_TTL_MINUTES || '')
  if (Number.isFinite(asMinutes) && asMinutes < 0) return { ttlMs: null, permanent: true }
  if (Number.isFinite(asMinutes) && asMinutes > 0) {
    return { ttlMs: Math.floor(asMinutes * 60 * 1000), permanent: false }
  }

  return { ttlMs: 60 * 60 * 1000, permanent: false }
}

const TOKEN_TTL_CONFIG = resolveTokenTtlConfig()
const CODE_TTL_MS = 60 * 1000
const verificationCodes = new Map()
const CV_CACHE_TTL_MS = 10 * 60 * 1000
const cvUploadCache = new Map()

const resolveInterviewStatusCheckIntervalMs = () => {
  const minuteCandidates = [
    process.env.INTERVIEW_STATUS_CHECK_INTERVAL_MINUTES,
    process.env.HRAI_INTERVIEW_STATUS_CHECK_INTERVAL_MINUTES,
  ]
  for (const value of minuteCandidates) {
    if (String(value ?? '').trim() === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric * 60 * 1000)
  }

  const millisecondCandidates = [
    process.env.INTERVIEW_STATUS_CHECK_INTERVAL_MS,
    process.env.HRAI_INTERVIEW_STATUS_CHECK_INTERVAL_MS,
  ]
  for (const value of millisecondCandidates) {
    if (String(value ?? '').trim() === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric)
  }
  return 60 * 1000
}

const INTERVIEW_STATUS_CHECK_INTERVAL_MS = resolveInterviewStatusCheckIntervalMs()

const DB_NAME = getDatabaseName()
const withCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-InnerAI-Auth-Token, X-HRAI-Client-Time')
}

const sendJson = (res, status, payload) => {
  withCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const getErrorStatusCode = (error) => {
  const statusCode = Number(error?.statusCode || error?.status || 0)
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500
}

const parseBody = async (req) => {
  if (Object.prototype.hasOwnProperty.call(req, 'parsedBody')) return req.parsedBody
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) {
    req.rawBody = ''
    req.parsedBody = null
    return req.parsedBody
  }

  req.rawBody = Buffer.concat(chunks).toString('utf8')
  try {
    req.parsedBody = JSON.parse(req.rawBody)
  } catch {
    req.parsedBody = null
  }
  return req.parsedBody
}

const hashPassword = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (error, derivedKey) => {
      if (error) return reject(error)
      resolve(derivedKey.toString('hex'))
    })
  })

const createAuthToken = () => crypto.randomBytes(32).toString('hex')
const tokenDigest = (token) => crypto.createHash('sha256').update(token).digest('hex')
const DEFAULT_AVATAR_BG_COLOR = '#334155'
const USER_ROLE_DEFINITIONS = [
  {
    value: 'admin',
    label: '系統管理員',
    description: '可管理全部資料、職位字典與用戶角色。',
    permissions: ['全部讀寫', '用戶與角色管理', '職位字典配置', '候選人/職缺/項目/黑名單管理'],
  },
  {
    value: 'hr',
    label: 'HR 使用者',
    description: '可處理日常招聘與人員資料，不可調整用戶角色。',
    permissions: ['職缺與候選人管理', 'CV 上傳與匹配', '狀態與對接人更新', '項目/黑名單資料維護'],
  },
  {
    value: 'viewer',
    label: '只讀檢視',
    description: '可登入查看資料，不可進行角色管理。',
    permissions: ['查看職缺、候選人與人員資料', '查看匹配與狀態紀錄'],
  },
]
const USER_ROLE_VALUES = new Set(USER_ROLE_DEFINITIONS.map((role) => role.value))

const normalizeUserRole = (value, fallback = 'hr') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'normal') return 'hr'
  return USER_ROLE_VALUES.has(normalized) ? normalized : fallback
}

const getUserRoleDefinition = (role) =>
  USER_ROLE_DEFINITIONS.find((item) => item.value === normalizeUserRole(role)) || USER_ROLE_DEFINITIONS[1]

const isAdminUser = (user) => normalizeUserRole(user?.role) === 'admin'

const deriveUserNameFromEmail = (email = '') => {
  const localPart = String(email || '').split('@')[0].trim()
  return localPart || 'user'
}

const normalizeHexColor = (value, fallback = DEFAULT_AVATAR_BG_COLOR) => {
  const color = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback
}

const normalizeAvatarText = (value, fallback = '') => {
  const text = String(value || '').trim()
  if (!text) return fallback
  return text.slice(0, 6)
}

const buildUserPayload = (row = {}) => {
  const mail = String(row.email || '').trim().toLowerCase()
  const username = String(row.username || '').trim() || deriveUserNameFromEmail(mail)
  const role = normalizeUserRole(row.role)
  const avatarText = normalizeAvatarText(row.avatarText, username.slice(0, 1).toUpperCase())
  const avatarBgColor = normalizeHexColor(row.avatarBgColor, DEFAULT_AVATAR_BG_COLOR)

  return {
    id: Number(row.id || 0) || null,
    mail,
    username,
    role,
    avatarText,
    avatarBgColor,
  }
}

const readBearerToken = (req) => {
  const raw = String(req.headers.authorization || '').trim()
  const match = raw.match(/^Bearer\s+(.+)$/i)
  if (match?.[1]) return match[1].trim()
  return String(req.headers['x-innerai-auth-token'] || '').trim()
}

const getAuthedUser = async (pool, req) => {
  const token = readBearerToken(req)
  if (!token) return null

  const [rows] = await pool.query(
    `SELECT
        u.id,
        u.email,
        u.username,
        u.\`role\` AS role,
        u.avatar_text AS avatarText,
        u.avatar_bg_color AS avatarBgColor
      FROM auth_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.expires_at > NOW()
      LIMIT 1`,
    [tokenDigest(token)]
  )

  return rows[0] || null
}

const getRequestOperatorUserId = async (pool, req) => {
  const user = await getAuthedUser(pool, req)
  return Number(user?.id || 0) || null
}

const DB_OPERATION_ROUTES = [
  { method: 'POST', pattern: /^\/api\/auth\/register$/, type: 'auth.register' },
  { method: 'POST', pattern: /^\/api\/auth\/login$/, type: 'auth.login' },
  { method: 'POST', pattern: /^\/api\/auth\/profile$/, type: 'user.profile.update' },
  { method: 'POST', pattern: /^\/api\/auth\/change-password$/, type: 'user.password.change' },
  { method: 'PATCH', pattern: /^\/api\/users\/\d+\/role$/, type: 'user.role.update' },
  { method: 'POST', pattern: /^\/api\/job-posts$/, type: 'job_post.create' },
  { method: 'PUT', pattern: /^\/api\/job-posts\/\d+$/, type: 'job_post.update' },
  { method: 'DELETE', pattern: /^\/api\/job-posts\/\d+$/, type: 'job_post.delete' },
  { method: 'POST', pattern: /^\/api\/projects$/, type: 'project.create' },
  { method: 'PATCH', pattern: /^\/api\/projects\/\d+$/, type: 'project.update' },
  { method: 'DELETE', pattern: /^\/api\/projects\/\d+$/, type: 'project.delete' },
  { method: 'POST', pattern: /^\/api\/projects\/\d+\/personnel$/, type: 'project_personnel.add' },
  { method: 'POST', pattern: /^\/api\/projects\/\d+\/personnel\/import-csv$/, type: 'project_personnel.import' },
  { method: 'POST', pattern: /^\/api\/project-personnel\/from-application$/, type: 'project_personnel.add_from_application' },
  { method: 'POST', pattern: /^\/api\/project-personnel-assignments\/\d+\/transfer$/, type: 'project_assignment.transfer' },
  { method: 'PATCH', pattern: /^\/api\/project-personnel-assignments\/\d+$/, type: 'project_assignment.update' },
  { method: 'DELETE', pattern: /^\/api\/project-personnel-assignments\/\d+$/, type: 'project_assignment.remove' },
  { method: 'POST', pattern: /^\/api\/candidates$/, type: 'candidate.create' },
  { method: 'POST', pattern: /^\/api\/candidates\/batch-delete$/, type: 'candidate.batch_delete' },
  { method: 'POST', pattern: /^\/api\/candidates\/\d+\/complete-profile$/, type: 'candidate.profile.complete' },
  { method: 'DELETE', pattern: /^\/api\/candidates\/\d+$/, type: 'candidate.delete' },
  { method: 'POST', pattern: /^\/api\/candidates\/\d+\/cvs$/, type: 'candidate_cv.upload' },
  { method: 'POST', pattern: /^\/api\/candidates\/\d+\/job-posts\/\d+\/intake$/, type: 'application.intake_existing_cv' },
  { method: 'POST', pattern: /^\/api\/personnel$/, type: 'personnel.create' },
  { method: 'PATCH', pattern: /^\/api\/personnel\/\d+$/, type: 'personnel.update' },
  { method: 'DELETE', pattern: /^\/api\/personnel\/\d+$/, type: 'personnel.delete' },
  { method: 'POST', pattern: /^\/api\/candidate-blacklist$/, type: 'blacklist.create' },
  { method: 'PATCH', pattern: /^\/api\/candidate-blacklist\/\d+$/, type: 'blacklist.update' },
  { method: 'DELETE', pattern: /^\/api\/candidate-blacklist\/\d+$/, type: 'blacklist.delete' },
  { method: 'POST', pattern: /^\/api\/cv\/intake$/, type: 'application.intake_cv' },
  { method: 'POST', pattern: /^\/api\/job-posts\/\d+\/cv\/intake$/, type: 'application.intake_cv' },
  { method: 'PATCH', pattern: /^\/api\/job-post-applications\/\d+$/, type: 'application.update' },
  { method: 'DELETE', pattern: /^\/api\/job-post-applications\/\d+$/, type: 'application.delete' },
  { method: 'POST', pattern: /^\/api\/job-post-applications\/batch-delete$/, type: 'application.batch_delete' },
  { method: 'PATCH', pattern: /^\/api\/job-post-applications\/\d+\/status$/, type: 'application.status.update' },
  { method: 'PATCH', pattern: /^\/api\/job-post-applications\/\d+\/interview-status$/, type: 'application.interview_status.update' },
  { method: 'POST', pattern: /^\/api\/job-post-applications\/\d+\/status-history$/, type: 'application.status_history.create' },
  { method: 'PATCH', pattern: /^\/api\/job-post-applications\/\d+\/status-history\/\d+$/, type: 'application.status_history.update' },
  { method: 'DELETE', pattern: /^\/api\/job-post-applications\/\d+\/status-history\/\d+$/, type: 'application.status_history.delete' },
  { method: 'POST', pattern: /^\/api\/candidate-cvs\/\d+\/extracted-field$/, type: 'candidate_cv.extracted_field.update' },
  { method: 'POST', pattern: /^\/api\/candidate-cvs\/\d+\/extracted-fields$/, type: 'candidate_cv.extracted_fields.update' },
]
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PUBLIC_WRITE_ROUTES = [
  { method: 'POST', pattern: /^\/api\/auth\/request-code$/ },
  { method: 'POST', pattern: /^\/api\/auth\/register$/ },
  { method: 'POST', pattern: /^\/api\/auth\/login$/ },
  { method: 'POST', pattern: /^\/api\/cv\/cache$/ },
  { method: 'POST', pattern: /^\/api\/cv\/parse$/ },
  { method: 'POST', pattern: /^\/api\/job-posts\/\d+\/cv\/cache$/ },
  { method: 'POST', pattern: /^\/api\/job-posts\/\d+\/cv\/parse$/ },
]
const SELF_SERVICE_WRITE_ROUTES = [
  { method: 'POST', pattern: /^\/api\/auth\/profile$/ },
  { method: 'POST', pattern: /^\/api\/auth\/change-password$/ },
]
const ROLE_ACCESS_ROUTES = [
  { method: 'GET', pattern: /^\/api\/users$/, roles: ['admin'] },
  { method: 'PATCH', pattern: /^\/api\/users\/\d+\/role$/, roles: ['admin'] },
  { method: 'PUT', pattern: /^\/api\/job-dictionary$/, roles: ['admin'] },
  { method: 'POST', pattern: /^\/api\/job-dictionary\/rubric-suggestions$/, roles: ['admin'] },
  { method: 'POST', pattern: /^\/api\/job-dictionary\/job-suggestions$/, roles: ['admin', 'hr'] },
]

const matchesMethodRoute = (routes, pathname, method) => {
  const normalizedMethod = String(method || '').trim().toUpperCase()
  return routes.some((route) => route.method === normalizedMethod && route.pattern.test(pathname))
}

const findRoleAccessRule = (pathname, method) => {
  const normalizedMethod = String(method || '').trim().toUpperCase()
  return ROLE_ACCESS_ROUTES.find((route) => route.method === normalizedMethod && route.pattern.test(pathname)) || null
}

const resolveDatabaseOperationType = (pathname, method) => {
  const normalizedMethod = String(method || '').trim().toUpperCase()
  const match = DB_OPERATION_ROUTES.find((route) => route.method === normalizedMethod && route.pattern.test(pathname))
  return match?.type || ''
}

const enforceRoleAccess = async (pool, req, res, url) => {
  const method = String(req.method || '').trim().toUpperCase()
  const roleRule = findRoleAccessRule(url.pathname, method)
  const isWriteRequest = WRITE_METHODS.has(method)

  if (!roleRule && !isWriteRequest) return true
  if (matchesMethodRoute(PUBLIC_WRITE_ROUTES, url.pathname, method)) return true

  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return false
  }

  const role = normalizeUserRole(user.role)
  if (roleRule && !roleRule.roles.includes(role)) {
    sendJson(res, 403, { message: 'Permission denied' })
    return false
  }

  const isSelfServiceWrite = SELF_SERVICE_WRITE_ROUTES.some(
    (route) => route.method === method && route.pattern.test(url.pathname)
  )
  if (!roleRule && isWriteRequest && !isSelfServiceWrite && role === 'viewer') {
    sendJson(res, 403, { message: 'Viewer role is read-only' })
    return false
  }

  return true
}

const resolveRequestLogUser = async (pool, req, { includeParsedBody = true } = {}) => {
  try {
    const authedUser = await getAuthedUser(pool, req)
    if (authedUser) return buildUserPayload(authedUser)
  } catch {
    // 日誌用戶解析不能影響主請求。
  }

  const body = includeParsedBody ? req.parsedBody : null
  const email = String(body?.email || body?.mail || '').trim().toLowerCase()
  if (email) return email
  return 'anonymous'
}

const writeDatabaseOperationLog = async (pool, req, res, operationType, startedAt, routeError, url) => {
  if (!operationType) return

  const statusCode = Number(res.statusCode || 0) || (routeError ? 500 : 200)
  const user = await resolveRequestLogUser(pool, req)
  logDatabaseOperation(operationType, {
    user,
    method: req.method,
    path: url.pathname,
    status: statusCode,
    result: routeError || statusCode >= 400 ? 'failed' : 'success',
    durationMs: Date.now() - startedAt,
    error: routeError
      ? {
          name: routeError?.name || 'Error',
          message: routeError?.message || String(routeError || 'Unknown error'),
        }
      : '',
  })
}

const sanitizeFileName = (name) =>
  String(name || 'cv-upload')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

const sanitizeNamePart = (value) => {
  const normalized = sanitizeFileName(value)
    .replace(/\./g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'x'
}

const normalizeIdentityValue = (value, field) => {
  const text = String(value || '').trim()
  if (!text) return ''

  if (field === 'fullName' && /^(x|unknown|n\/a|null|none)$/i.test(text)) return ''
  if (field === 'email' && !/@/.test(text)) return ''
  if (field === 'phone' && !/\d/.test(text)) return ''
  return text
}

const buildDatePart = (value) => {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return 'x'
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

const buildRenamedCandidateCvFileName = ({ fullName = '', createdAt = '', sourceFileName = '' }) => {
  const ext = path.extname(String(sourceFileName || '')).trim() || '.bin'
  const namePart = sanitizeNamePart(normalizeIdentityValue(fullName, 'fullName'))
  const datePart = sanitizeNamePart(buildDatePart(createdAt))
  return `${namePart}_${datePart}${ext}`
}

const ensureCvStorageDir = () => {
  fs.mkdirSync(CV_STORAGE_DIR, { recursive: true })
}

const resolveCandidateCvStoragePath = (storageKey) => {
  const fileName = path.basename(String(storageKey || '').trim())
  if (!fileName) return ''
  return path.join(CV_STORAGE_DIR, fileName)
}

const hasCandidateCvStoredFile = (storageKey) => {
  const storagePath = resolveCandidateCvStoragePath(storageKey)
  return !!storagePath && fs.existsSync(storagePath)
}
const sha256Buffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

const cleanupExpiredCvCache = () => {
  const now = Date.now()
  for (const [cacheId, item] of cvUploadCache.entries()) {
    if (!item || item.expiresAt <= now) cvUploadCache.delete(cacheId)
  }
}

const putCvIntoCache = ({ fileName, mimeType, buffer }) => {
  cleanupExpiredCvCache()
  const cacheId = crypto.randomBytes(16).toString('hex')
  const expiresAt = Date.now() + CV_CACHE_TTL_MS
  cvUploadCache.set(cacheId, { fileName, mimeType, buffer, expiresAt, parsed: null })
  return { cacheId, expiresAt }
}

const readCvFromCache = (cacheId) => {
  cleanupExpiredCvCache()
  const cached = cvUploadCache.get(cacheId)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    cvUploadCache.delete(cacheId)
    return null
  }
  return cached
}

const buildExtractionPayload = (extraction) => ({
  extracted: extraction?.extracted || {},
  missingFields: extraction?.missingFields || [],
  parser: extraction?.llmJson ? 'llm' : 'regex',
})

const parseCachedCvExtraction = async (cached) => {
  if (!cached) return null
  if (cached.parsed && typeof cached.parsed === 'object') return cached.parsed

  const { fileName, mimeType, buffer } = cached
  const extraction = await extractCandidateInfoFromCv(buffer, fileName, mimeType)
  const cvText = await extractTextFromBuffer(buffer, fileName, mimeType)
  const parser = extraction.llmJson ? 'llm' : 'regex'
  const extractedText = JSON.stringify(buildExtractionPayload(extraction), null, 2)

  const parsed = { extraction, cvText, parser, extractedText }
  cached.parsed = parsed
  return parsed
}

const requestCode = async (req, res) => {
  const body = await parseBody(req)
  const email = body?.email?.trim()?.toLowerCase()
  if (!email) {
    sendJson(res, 400, { message: 'Email is required' })
    return
  }
  const code = String(Math.floor(100000 + Math.random() * 900000))
  verificationCodes.set(email, { code, expiresAt: Date.now() + CODE_TTL_MS })
  console.log(`[Auth] verification code for ${email}: ${code}`)
  sendJson(res, 200, { message: 'Verification code sent' })
}

const registerUser = async (pool, req, res) => {
  const body = await parseBody(req)
  const email = body?.email?.trim()?.toLowerCase()
  const password = body?.password
  const code = body?.code?.trim()
  if (!email || !password || !code) {
    sendJson(res, 400, { message: 'Email, password and code are required' })
    return
  }

  const verification = verificationCodes.get(email)
  if (!verification || verification.expiresAt < Date.now() || verification.code !== code) {
    sendJson(res, 400, { message: 'Invalid or expired verification code' })
    return
  }

  const [exists] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
  if (exists.length > 0) {
    sendJson(res, 409, { message: 'Email already registered' })
    return
  }

  const [userCountRows] = await pool.query('SELECT COUNT(*) AS userCount FROM users')
  const nextRole = Number(userCountRows[0]?.userCount || 0) > 0 ? 'hr' : 'admin'
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(password, salt)
  const username = deriveUserNameFromEmail(email)
  const avatarText = username.slice(0, 1).toUpperCase() || 'U'
  await pool.query(
    'INSERT INTO users (email, username, `role`, avatar_text, avatar_bg_color, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
    email,
    username,
    nextRole,
    avatarText,
    DEFAULT_AVATAR_BG_COLOR,
    passwordHash,
    salt,
    ]
  )
  verificationCodes.delete(email)
  sendJson(res, 201, { message: 'Registered successfully' })
}

const loginUser = async (pool, req, res) => {
  const body = await parseBody(req)
  const email = body?.email?.trim()?.toLowerCase()
  const password = body?.password
  if (!email || !password) {
    sendJson(res, 400, { message: 'Email and password are required' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
      id,
      email,
      username,
      \`role\`,
      avatar_text AS avatarText,
      avatar_bg_color AS avatarBgColor,
      password_hash,
      password_salt
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  )
  const user = rows[0]
  if (!user) {
    sendJson(res, 401, { message: 'Invalid email or password' })
    return
  }

  const currentHash = await hashPassword(password, user.password_salt)
  if (currentHash !== user.password_hash) {
    sendJson(res, 401, { message: 'Invalid email or password' })
    return
  }

  const token = createAuthToken()
  const expiresAt = TOKEN_TTL_CONFIG.permanent
    ? PERMANENT_AUTH_EXPIRES_AT
    : new Date(Date.now() + TOKEN_TTL_CONFIG.ttlMs).toISOString()
  const expiresAtSql = TOKEN_TTL_CONFIG.permanent
    ? MYSQL_MAX_DATETIME
    : formatSqlDateTime(expiresAt)
  await pool.query('DELETE FROM auth_tokens WHERE user_id = ? OR expires_at <= NOW()', [user.id])
  await pool.query('INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [
    user.id,
    tokenDigest(token),
    expiresAtSql,
  ])

  sendJson(res, 200, {
    token,
    expiresAt,
    user: buildUserPayload(user),
  })
}

const getMyProfile = async (pool, req, res) => {
  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  sendJson(res, 200, { user: buildUserPayload(user) })
}

const listUserOptions = async (pool, req, res) => {
  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
        id,
        email,
        username,
        \`role\`,
        avatar_text AS avatarText,
        avatar_bg_color AS avatarBgColor
      FROM users
      ORDER BY username ASC, email ASC, id ASC`
  )

  sendJson(res, 200, {
    users: rows.map((row) => {
      const payload = buildUserPayload(row)
      return {
        id: payload.id,
        username: payload.username,
        email: payload.mail,
        avatarText: payload.avatarText,
        avatarBgColor: payload.avatarBgColor,
      }
    }),
  })
}

const buildRolePayload = (role) => {
  const definition = getUserRoleDefinition(role)
  return {
    value: definition.value,
    label: definition.label,
    description: definition.description,
    permissions: definition.permissions,
  }
}

const buildUserManagementPayload = (row = {}) => {
  const payload = buildUserPayload(row)
  const role = buildRolePayload(payload.role)
  return {
    ...payload,
    email: payload.mail,
    roleLabel: role.label,
    roleDescription: role.description,
    permissions: role.permissions,
    createdAt: row.createdAt || row.created_at || null,
  }
}

const requireAdminUser = async (pool, req, res) => {
  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return null
  }

  if (!isAdminUser(user)) {
    sendJson(res, 403, { message: 'Only system administrators can manage user roles' })
    return null
  }

  return user
}

const listUsersForManagement = async (pool, req, res) => {
  const user = await requireAdminUser(pool, req, res)
  if (!user) return

  const [rows] = await pool.query(
    `SELECT
        id,
        email,
        username,
        \`role\`,
        avatar_text AS avatarText,
        avatar_bg_color AS avatarBgColor,
        created_at AS createdAt
      FROM users
      ORDER BY created_at ASC, id ASC`
  )

  sendJson(res, 200, {
    roles: USER_ROLE_DEFINITIONS.map((role) => buildRolePayload(role.value)),
    users: rows.map((row) => buildUserManagementPayload(row)),
    currentUser: buildUserPayload(user),
  })
}

const updateUserRole = async (pool, req, res, userId) => {
  const operator = await requireAdminUser(pool, req, res)
  if (!operator) return

  const nextRole = normalizeUserRole((await parseBody(req))?.role, '')
  if (!nextRole) {
    sendJson(res, 400, { message: 'Invalid role' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
        id,
        email,
        username,
        \`role\`,
        avatar_text AS avatarText,
        avatar_bg_color AS avatarBgColor,
        created_at AS createdAt
      FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId]
  )
  const target = rows[0]
  if (!target) {
    sendJson(res, 404, { message: 'User not found' })
    return
  }

  if (normalizeUserRole(target.role) === 'admin' && nextRole !== 'admin') {
    const [adminRows] = await pool.query("SELECT COUNT(*) AS adminCount FROM users WHERE `role` = 'admin'")
    if (Number(adminRows[0]?.adminCount || 0) <= 1) {
      sendJson(res, 400, { message: 'At least one system administrator is required' })
      return
    }
  }

  await pool.query('UPDATE users SET `role` = ? WHERE id = ?', [nextRole, userId])
  const [updatedRows] = await pool.query(
    `SELECT
        id,
        email,
        username,
        \`role\`,
        avatar_text AS avatarText,
        avatar_bg_color AS avatarBgColor,
        created_at AS createdAt
      FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId]
  )

  sendJson(res, 200, {
    message: 'User role updated',
    user: buildUserManagementPayload(updatedRows[0]),
    currentUser: Number(operator.id) === Number(userId) ? buildUserPayload(updatedRows[0]) : buildUserPayload(operator),
  })
}

const updateMyProfile = async (pool, req, res) => {
  const authedUser = await getAuthedUser(pool, req)
  if (!authedUser) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const body = await parseBody(req)
  const currentPayload = buildUserPayload(authedUser)

  const rawUsername = String(body?.username ?? '').trim()
  const nextUsername = rawUsername || currentPayload.username
  if (!nextUsername || nextUsername.length > 80) {
    sendJson(res, 400, { message: 'username is required and must be 80 characters or less' })
    return
  }

  const rawAvatarText = String(body?.avatarText ?? '').trim()
  const fallbackAvatarText = currentPayload.avatarText || nextUsername.slice(0, 1).toUpperCase() || 'U'
  const nextAvatarText = normalizeAvatarText(rawAvatarText || fallbackAvatarText, fallbackAvatarText)
  if (!nextAvatarText) {
    sendJson(res, 400, { message: 'avatarText is required' })
    return
  }

  const rawColor = String(body?.avatarBgColor ?? '').trim()
  if (rawColor && !/^#[0-9a-fA-F]{6}$/.test(rawColor)) {
    sendJson(res, 400, { message: 'avatarBgColor must be a hex color like #112233' })
    return
  }
  const nextAvatarBgColor = normalizeHexColor(rawColor || currentPayload.avatarBgColor, DEFAULT_AVATAR_BG_COLOR)

  await pool.query(
    'UPDATE users SET username = ?, avatar_text = ?, avatar_bg_color = ? WHERE id = ?',
    [nextUsername, nextAvatarText, nextAvatarBgColor, Number(currentPayload.id)]
  )

  const [rows] = await pool.query(
    'SELECT id, email, username, `role`, avatar_text AS avatarText, avatar_bg_color AS avatarBgColor FROM users WHERE id = ? LIMIT 1',
    [Number(currentPayload.id)]
  )

  sendJson(res, 200, {
    message: 'Profile updated',
    user: buildUserPayload(rows[0] || {}),
  })
}

const changeMyPassword = async (pool, req, res) => {
  const authedUser = await getAuthedUser(pool, req)
  if (!authedUser) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const body = await parseBody(req)
  const currentPassword = String(body?.currentPassword || '')
  const newPassword = String(body?.newPassword || '')

  if (!currentPassword || !newPassword) {
    sendJson(res, 400, { message: 'currentPassword and newPassword are required' })
    return
  }
  if (newPassword.length < 6) {
    sendJson(res, 400, { message: 'newPassword must be at least 6 characters' })
    return
  }

  const [rows] = await pool.query(
    'SELECT id, password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ? LIMIT 1',
    [Number(authedUser.id)]
  )
  const user = rows[0]
  if (!user) {
    sendJson(res, 404, { message: 'User not found' })
    return
  }

  const currentHash = await hashPassword(currentPassword, user.passwordSalt)
  if (currentHash !== user.passwordHash) {
    sendJson(res, 400, { message: 'Current password is incorrect' })
    return
  }

  const nextSalt = crypto.randomBytes(16).toString('hex')
  const nextHash = await hashPassword(newPassword, nextSalt)
  await pool.query('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [
    nextHash,
    nextSalt,
    Number(user.id),
  ])

  sendJson(res, 200, { message: 'Password updated' })
}

const getJobDictionaryHandler = async (pool, req, res) => {
  const authedUser = await getAuthedUser(pool, req)
  if (!authedUser) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  sendJson(res, 200, { dictionary: getJobDictionary() })
}

const updateJobDictionaryHandler = async (pool, req, res) => {
  const authedUser = await getAuthedUser(pool, req)
  if (!authedUser) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const body = await parseBody(req)
  const dictionary = body?.dictionary
  if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
    sendJson(res, 400, { message: '請提供職位字典資料' })
    return
  }

  try {
    const saved = saveJobDictionary(dictionary)
    sendJson(res, 200, { message: '職位字典已更新', dictionary: saved })
  } catch (error) {
    sendJson(res, 400, { message: error?.message || '職位字典資料格式錯誤' })
  }
}

const suggestJobDictionaryRubricsHandler = async (pool, req, res) => {
  const authedUser = await getAuthedUser(pool, req)
  if (!authedUser) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const body = await parseBody(req)
  const job = body?.job
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    sendJson(res, 400, { message: '請提供職位資料' })
    return
  }

  try {
    const scoringRubrics = await suggestJobScoringRubrics(job)
    sendJson(res, 200, { scoringRubrics })
  } catch (error) {
    sendJson(res, getErrorStatusCode(error), { message: error?.message || '生成量化標準失敗' })
  }
}

const suggestJobDictionaryDefinitionHandler = async (pool, req, res) => {
  const authedUser = await getAuthedUser(pool, req)
  if (!authedUser) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const body = await parseBody(req)
  try {
    const job = await suggestJobDictionaryDefinition({
      jobTitle: body?.jobTitle,
      jobKey: body?.jobKey,
      draft: body?.draft,
    })
    sendJson(res, 200, { job })
  } catch (error) {
    sendJson(res, getErrorStatusCode(error), { message: error?.message || '生成職位資料失敗' })
  }
}

const listJobPosts = async (pool, req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const status = normalizeJobPostStatus(url.searchParams.get('status') || '')
  const hasStatusFilter = url.searchParams.has('status')
  const [rows] = await pool.query(
    `SELECT
        jp.id,
        jp.title,
        jp.job_key AS jobKey,
        jp.job_snapshot_json AS jobSnapshotJson,
        jp.status,
        jp.created_at AS createdAt,
        jp.updated_at AS updatedAt,
        COUNT(app.id) AS applicationCount
      FROM job_posts jp
      LEFT JOIN job_post_applications app ON app.job_post_id = jp.id
      ${hasStatusFilter ? 'WHERE jp.status = ?' : ''}
      GROUP BY jp.id
      ORDER BY jp.created_at DESC`,
    hasStatusFilter ? [status] : []
  )

  sendJson(res, 200, {
    jobPosts: rows.map((row) => {
      const snapshot = parseJobSnapshot(row.jobSnapshotJson)
      return {
        id: Number(row.id),
        title: normalizeText(row.title),
        jobKey: normalizeText(row.jobKey),
        status: normalizeJobPostStatus(row.status),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        applicationCount: Number(row.applicationCount || 0),
        matchedPosition: normalizeText(snapshot?.title),
      }
    }),
  })
}

const createJobPost = async (pool, req, res) => {
  const body = await parseBody(req)
  const title = normalizeText(body?.title)
  const jobKey = normalizeText(body?.jobKey)
  const statusResult = resolveJobPostStatusInput(body?.status, 'open')
  const status = statusResult.status
  const dictionary = getJobDictionary()
  const dictionaryJob = dictionary?.[jobKey]

  if (!title) {
    sendJson(res, 400, { message: 'title is required' })
    return
  }
  if (!jobKey) {
    sendJson(res, 400, { message: 'jobKey is required' })
    return
  }
  if (!dictionaryJob) {
    sendJson(res, 400, { message: 'Invalid jobKey' })
    return
  }
  if (!statusResult.valid) {
    sendJson(res, 400, { message: 'Invalid status' })
    return
  }

  const snapshot = buildJobSnapshot(jobKey, dictionaryJob)
  const [result] = await pool.query(
    `INSERT INTO job_posts (title, job_key, job_snapshot_json, status)
     VALUES (?, ?, ?, ?)`,
    [title, jobKey, stringifyJson(snapshot), status]
  )

  sendJson(res, 201, {
    message: 'Job post created',
    jobPost: {
      id: Number(result.insertId),
      title,
      jobKey,
      status,
      jobSnapshot: snapshot,
    },
  })
}

const getJobPostDetail = async (pool, _req, res, jobPostId) => {
  const jobPost = await getJobPostById(pool, jobPostId)
  if (!jobPost) {
    sendJson(res, 404, { message: 'Job post not found' })
    return
  }

  const [rows] = await pool.query(
    'SELECT COUNT(*) AS totalApplications FROM job_post_applications WHERE job_post_id = ?',
    [jobPostId]
  )

  sendJson(res, 200, {
    jobPost: {
      ...jobPost,
      applicationCount: Number(rows[0]?.totalApplications || 0),
    },
  })
}

const updateJobPost = async (pool, req, res, jobPostId) => {
  const existing = await getJobPostById(pool, jobPostId)
  if (!existing) {
    sendJson(res, 404, { message: 'Job post not found' })
    return
  }

  const body = await parseBody(req)
  const title = normalizeText(body?.title)
  const jobKey = normalizeText(body?.jobKey || existing.jobKey)
  const isJobKeyChanged = jobKey !== existing.jobKey
  const statusResult = resolveJobPostStatusInput(body?.status, existing.status)
  const status = statusResult.status
  const dictionary = getJobDictionary()
  const dictionaryJob = dictionary?.[jobKey]
  if (!title) {
    sendJson(res, 400, { message: 'title is required' })
    return
  }
  if (!jobKey) {
    sendJson(res, 400, { message: 'jobKey is required' })
    return
  }
  if (isJobKeyChanged && !dictionaryJob) {
    sendJson(res, 400, { message: 'Invalid jobKey' })
    return
  }
  if (!statusResult.valid) {
    sendJson(res, 400, { message: 'Invalid status' })
    return
  }

  const snapshot = dictionaryJob
    ? buildJobSnapshot(jobKey, dictionaryJob)
    : existing.jobSnapshot || buildJobSnapshot(jobKey, { jobKey, title })

  await pool.query(
    'UPDATE job_posts SET title = ?, job_key = ?, job_snapshot_json = ?, status = ? WHERE id = ?',
    [title, jobKey, stringifyJson(snapshot), status, jobPostId]
  )
  const updated = await getJobPostById(pool, jobPostId)
  sendJson(res, 200, { message: 'Job post updated', jobPost: updated })
}

const deleteJobPost = async (pool, _req, res, jobPostId) => {
  const existing = await getJobPostById(pool, jobPostId)
  if (!existing) {
    sendJson(res, 404, { message: 'Job post not found' })
    return
  }

  const connection = await pool.getConnection()
  const storageKeysToDelete = []

  try {
    await connection.beginTransaction()

    const [applicationRows] = await connection.query(
      `SELECT
          app.candidate_cv_id AS candidateCvId,
          cv.storage_key AS storageKey
        FROM job_post_applications app
        INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
        WHERE app.job_post_id = ?`,
      [jobPostId]
    )

    const candidateCvIds = applicationRows
      .map((row) => Number(row.candidateCvId))
      .filter((id) => Number.isInteger(id) && id > 0)
    storageKeysToDelete.push(
      ...applicationRows
        .map((row) => normalizeText(row.storageKey))
        .filter(Boolean)
    )

    if (candidateCvIds.length) {
      const cvPlaceholders = candidateCvIds.map(() => '?').join(', ')
      await connection.query(`DELETE FROM candidate_cvs WHERE id IN (${cvPlaceholders})`, candidateCvIds)
    }

    await connection.query('DELETE FROM job_posts WHERE id = ?', [jobPostId])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    console.error('[JobPost] Failed to delete job post:', error)
    sendJson(res, 500, { message: 'Failed to delete job post' })
    return
  } finally {
    connection.release()
  }

  for (const storageKey of storageKeysToDelete) {
    const storagePath = resolveCandidateCvStoragePath(storageKey)
    if (storagePath && fs.existsSync(storagePath)) {
      try {
        fs.unlinkSync(storagePath)
      } catch (error) {
        console.error('[CV] Failed to delete file:', error)
      }
    }
  }

  sendJson(res, 200, {
    message: 'Job post deleted',
    jobPostId: Number(jobPostId),
  })
}

const listJobPostApplications = async (pool, _req, res, jobPostId) => {
  const jobPost = await getJobPostById(pool, jobPostId)
  if (!jobPost) {
    sendJson(res, 404, { message: 'Job post not found' })
    return
  }

  const blacklistEntries = await listCandidateBlacklistRows(pool)
  const duplicateApplicationIds = await listDuplicateApplicationIds(pool)

  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.application_status AS applicationStatus,
        app.first_interview_arrangement AS firstInterviewArrangement,
        app.interview_scheduled_at AS interviewScheduledAt,
        app.interview_duration_minutes AS interviewDurationMinutes,
        app.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        app.interview_location AS interviewLocation,
        app.interview_status AS interviewStatus,
        app.remark AS remark,
        app.matched_score AS matchedScore,
        app.matched_level AS matchedLevel,
        app.matched_position AS matchedPosition,
        app.owner_user_id AS ownerUserId,
        owner_user.email AS ownerEmail,
        owner_user.username AS ownerUsername,
        owner_user.avatar_text AS ownerAvatarText,
        owner_user.avatar_bg_color AS ownerAvatarBgColor,
        app.created_at AS createdAt,
        app.updated_at AS updatedAt,
        c.id AS candidateId,
        c.full_name AS fullName,
        c.email AS email,
        c.phone AS phone,
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
        cv.source AS source,
        cv.storage_key AS storageKey,
        extracts.target_position AS targetPosition,
        CASE WHEN extracts.cv_text IS NOT NULL AND extracts.cv_text <> '' THEN 1 ELSE 0 END AS hasCvPreview,
        CASE WHEN extracts.extracted_text IS NOT NULL AND extracts.extracted_text <> '' THEN 1 ELSE 0 END AS hasExtractedPreview
      FROM job_post_applications app
      INNER JOIN candidates c ON c.id = app.candidate_id
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      LEFT JOIN users owner_user ON owner_user.id = app.owner_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = app.interviewer_user_id
      WHERE app.job_post_id = ?
      ORDER BY app.created_at DESC, app.id DESC`,
    [jobPostId]
  )

  sendJson(res, 200, {
    jobPost: {
      id: jobPost.id,
      title: jobPost.title,
      jobKey: jobPost.jobKey,
      status: jobPost.status,
      matchedPosition: normalizeText(jobPost.jobSnapshot?.title),
    },
    applications: rows.map((row) => {
      const match = findCandidateBlacklistMatch(blacklistEntries, {
        phone: row.phone,
        email: row.email,
      })

      return {
        applicationId: Number(row.applicationId),
        applicationStatus: normalizeApplicationStatus(row.applicationStatus),
        firstInterviewArrangement: normalizeFirstInterviewArrangement(row.firstInterviewArrangement),
        remark: normalizeText(row.remark),
        candidateId: Number(row.candidateId),
        fullName: normalizeText(row.fullName),
        targetPosition: normalizeText(row.targetPosition),
        matchedPosition: normalizeText(row.matchedPosition),
        source: normalizeCvSource(row.source),
        ownerUser: buildOwnerUserPayload(row),
        isDuplicateApplication: duplicateApplicationIds.has(Number(row.applicationId)),
        matchedScore: Number(row.matchedScore || 0),
        matchedLevel: normalizeText(row.matchedLevel) || '',
        phone: normalizeText(row.phone),
        cvId: Number(row.cvId),
        cvFileName: normalizeText(row.cvFileName),
        extractedFileName:
          Number(row.hasExtractedPreview || 0) === 1 && row.cvFileName
            ? `${row.cvFileName}.extracted.txt`
            : '',
        hasDownload: hasCandidateCvStoredFile(row.storageKey),
        hasCvPreview: Number(row.hasCvPreview || 0) === 1,
        hasExtractedPreview: Number(row.hasExtractedPreview || 0) === 1,
        createdAt: row.createdAt,
        updatedAt: formatDateTimeForPayload(row.updatedAt || row.createdAt),
        ...buildCandidateBlacklistFlags(match, {
          phone: row.phone,
          email: row.email,
        }),
      }
    }),
  })
}

const getJobPostApplication = async (pool, _req, res, applicationId) => {
  await runTemporalInterviewStatusRefresh(pool)
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.job_post_id AS jobPostId,
        app.candidate_id AS candidateId,
        app.candidate_cv_id AS candidateCvId,
        app.application_status AS applicationStatus,
        app.first_interview_arrangement AS firstInterviewArrangement,
        app.interview_scheduled_at AS interviewScheduledAt,
        app.interview_duration_minutes AS interviewDurationMinutes,
        app.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        app.interview_location AS interviewLocation,
        app.interview_status AS interviewStatus,
        app.remark AS remark,
        app.matched_score AS matchedScore,
        app.matched_level AS matchedLevel,
        app.matched_position AS matchedPosition,
        app.owner_user_id AS ownerUserId,
        owner_user.email AS ownerEmail,
        owner_user.username AS ownerUsername,
        owner_user.avatar_text AS ownerAvatarText,
        owner_user.avatar_bg_color AS ownerAvatarBgColor,
        app.created_at AS createdAt,
        app.updated_at AS updatedAt,
        jp.title AS jobPostTitle,
        c.full_name AS fullName,
        c.email AS email,
        c.phone AS phone,
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
        cv.source AS source,
        cv.storage_key AS storageKey,
        COALESCE(extracts.target_position, '') AS targetPosition,
        CASE WHEN extracts.cv_text IS NOT NULL AND extracts.cv_text <> '' THEN 1 ELSE 0 END AS hasCvPreview,
        CASE WHEN extracts.extracted_text IS NOT NULL AND extracts.extracted_text <> '' THEN 1 ELSE 0 END AS hasExtractedPreview
      FROM job_post_applications app
      INNER JOIN job_posts jp ON jp.id = app.job_post_id
      INNER JOIN candidates c ON c.id = app.candidate_id
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      LEFT JOIN users owner_user ON owner_user.id = app.owner_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = app.interviewer_user_id
      WHERE app.id = ?
      LIMIT 1`,
    [applicationId]
  )

  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }

  const blacklistEntries = await listCandidateBlacklistRows(pool)
  const blacklistMatch = findCandidateBlacklistMatch(blacklistEntries, {
    phone: row.phone,
    email: row.email,
  })
  const statusHistory = await listJobPostApplicationStatusHistory(pool, applicationId)
  const latestStatusHistory = statusHistory[0] || null
  const duplicateApplicationIds = await listDuplicateApplicationIds(pool)
  const matches = await listCandidateCvJobMatches(pool, Number(row.cvId))
  const primaryMatch = matches[0] || null

  sendJson(res, 200, {
    application: {
      applicationId: Number(row.applicationId),
      jobPostId: Number(row.jobPostId),
      candidateId: Number(row.candidateId),
      candidateCvId: Number(row.candidateCvId),
      applicationStatus: latestStatusHistory
        ? latestStatusHistory.applicationStatus
        : normalizeApplicationStatus(row.applicationStatus),
      firstInterviewArrangement: latestStatusHistory
        ? latestStatusHistory.firstInterviewArrangement
        : normalizeFirstInterviewArrangement(row.firstInterviewArrangement),
      interview: latestStatusHistory ? latestStatusHistory.interview : buildInterviewPayload(row),
      remark: latestStatusHistory ? normalizeText(latestStatusHistory.remark) : normalizeText(row.remark),
      matchedScore: Number(row.matchedScore || 0),
      matchedLevel: normalizeText(row.matchedLevel),
      matchedPosition: normalizeText(row.matchedPosition),
      source: normalizeCvSource(row.source),
      ownerUser: buildOwnerUserPayload(row),
      isDuplicateApplication: duplicateApplicationIds.has(Number(row.applicationId)),
      match: primaryMatch,
      dimensionEvaluations: primaryMatch?.dimensionEvaluations || [],
      jobPostTitle: normalizeText(row.jobPostTitle),
      fullName: normalizeText(row.fullName),
      email: normalizeEmailIdentity(row.email),
      phone: normalizeText(row.phone),
      cvId: Number(row.cvId),
      cvFileName: normalizeText(row.cvFileName),
      extractedFileName:
        Number(row.hasExtractedPreview || 0) === 1 && row.cvFileName
          ? `${row.cvFileName}.extracted.txt`
          : '',
      targetPosition: normalizeText(row.targetPosition),
      hasDownload: hasCandidateCvStoredFile(row.storageKey),
      hasCvPreview: Number(row.hasCvPreview || 0) === 1,
      hasExtractedPreview: Number(row.hasExtractedPreview || 0) === 1,
      createdAt: row.createdAt,
      updatedAt: formatDateTimeForPayload(row.updatedAt || row.createdAt),
      ...buildCandidateBlacklistFlags(blacklistMatch, {
        phone: row.phone,
        email: row.email,
      }),
      blacklistEntry: blacklistMatch
        ? {
            id: Number(blacklistMatch.id),
            displayName: normalizeText(blacklistMatch.displayName),
            phone: normalizeText(blacklistMatch.phone),
            email: normalizeEmailIdentity(blacklistMatch.email),
            reason: normalizeRemark(blacklistMatch.reason),
            status: normalizeDirectoryStatus(blacklistMatch.status),
            remark: normalizeRemark(blacklistMatch.remark),
          }
        : null,
      statusHistory,
    },
  })
}

const updateJobPostApplicationStatus = async (pool, req, res, applicationId) => {
  const [rows] = await pool.query(
    `SELECT
        id,
        application_status AS applicationStatus,
        first_interview_arrangement AS firstInterviewArrangement,
        interview_scheduled_at AS interviewScheduledAt,
        interview_duration_minutes AS interviewDurationMinutes,
        interviewer_user_id AS interviewerUserId,
        interview_location AS interviewLocation,
        interview_status AS interviewStatus,
        remark
      FROM job_post_applications
      WHERE id = ?
      LIMIT 1`,
    [applicationId]
  )
  const existing = rows[0]
  if (!existing) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }

  const body = await parseBody(req)
  const hasStatus = body && Object.prototype.hasOwnProperty.call(body, 'applicationStatus')
  const hasFirstInterviewArrangement =
    body && Object.prototype.hasOwnProperty.call(body, 'firstInterviewArrangement')
  const hasRemark = body && Object.prototype.hasOwnProperty.call(body, 'remark')
  const hasInterview = body && Object.prototype.hasOwnProperty.call(body, 'interview')
  if (!hasStatus && !hasFirstInterviewArrangement && !hasRemark && !hasInterview) {
    sendJson(res, 400, { message: 'applicationStatus, firstInterviewArrangement, interview or remark is required' })
    return
  }

  const nextStatus = hasStatus
    ? normalizeApplicationStatus(body?.applicationStatus, '')
    : normalizeApplicationStatus(existing.applicationStatus)
  if (hasStatus && !nextStatus) {
    sendJson(res, 400, { message: 'Invalid applicationStatus' })
    return
  }

  const currentStatus = normalizeApplicationStatus(existing.applicationStatus)
  const arrangementResult = hasFirstInterviewArrangement
    ? resolveFirstInterviewArrangementInput(body?.firstInterviewArrangement, '')
    : {
        valid: true,
        value: normalizeFirstInterviewArrangement(existing.firstInterviewArrangement),
      }
  if (!arrangementResult.valid) {
    sendJson(res, 400, { message: 'Invalid firstInterviewArrangement' })
    return
  }
  const nextRemark = hasRemark ? normalizeApplicationRemark(body?.remark) : normalizeApplicationRemark(existing.remark)
  const interviewResult = resolveInterviewInput(hasInterview ? body?.interview : {}, buildInterviewFallback(existing))
  if (!interviewResult.valid) {
    sendJson(res, 400, { message: 'Invalid interview' })
    return
  }
  if (!(await ensureInterviewInputUserExists(pool, interviewResult.value))) {
    sendJson(res, 400, { message: 'Invalid interviewerUserId' })
    return
  }
  const willAppendStatusHistory = hasStatus && nextStatus !== currentStatus
  const latestHistory = willAppendStatusHistory
    ? null
    : await getLatestJobPostApplicationStatusHistory(pool, applicationId)
  if (willAppendStatusHistory || hasInterviewScheduleChanged(existing, interviewResult.value)) {
    await validateInterviewScheduleAvailability(pool, {
      applicationStatus: nextStatus,
      interview: interviewResult.value,
      excludeStatusHistoryId: Number(latestHistory?.id || 0),
    })
  }
  const operatorUserId = await getRequestOperatorUserId(pool, req)
  const requestUpdatedAt = getRequestLocalDateTime(req)

  await pool.query(
    `UPDATE job_post_applications
      SET application_status = ?,
          first_interview_arrangement = ?,
          interview_scheduled_at = ?,
          interview_duration_minutes = ?,
          interviewer_user_id = ?,
          interview_location = ?,
          interview_status = ?,
          remark = ?,
          owner_user_id = COALESCE(?, owner_user_id),
          updated_at = ?
     WHERE id = ?`,
    [
      nextStatus,
      arrangementResult.value || null,
      interviewResult.value.scheduledAt,
      interviewResult.value.durationMinutes,
      interviewResult.value.interviewerUserId,
      interviewResult.value.location,
      interviewResult.value.status,
      nextRemark,
      operatorUserId,
      requestUpdatedAt,
      applicationId,
    ]
  )
  await syncJobPostApplicationStatusHistory(
    pool,
    applicationId,
    {
      applicationStatus: nextStatus,
      firstInterviewArrangement: arrangementResult.value,
      interview: interviewResult.value,
      remark: nextRemark,
    },
    { append: willAppendStatusHistory, operatorUserId, updatedAtSql: requestUpdatedAt }
  )

  sendJson(res, 200, {
    message: interviewResult.statusRule?.message || 'Candidate application updated',
    application: {
      applicationId,
      applicationStatus: nextStatus,
      firstInterviewArrangement: arrangementResult.value,
      interview: interviewResult.value,
      remark: nextRemark || '',
    },
    statusRule: interviewResult.statusRule || null,
  })
}

const createJobPostApplicationStatusHistory = async (pool, req, res, applicationId) => {
  const [applicationRows] = await pool.query('SELECT id FROM job_post_applications WHERE id = ? LIMIT 1', [applicationId])
  if (!applicationRows.length) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }

  const body = await parseBody(req)
  const nextStatus = normalizeApplicationStatus(body?.applicationStatus, '')
  if (!nextStatus) {
    sendJson(res, 400, { message: 'Invalid applicationStatus' })
    return
  }

  const arrangementResult = resolveFirstInterviewArrangementInput(body?.firstInterviewArrangement, '')
  if (!arrangementResult.valid) {
    sendJson(res, 400, { message: 'Invalid firstInterviewArrangement' })
    return
  }
  const nextRemark = normalizeApplicationRemark(body?.remark)
  const interviewResult = resolveInterviewInput(body?.interview || {})
  if (!interviewResult.valid) {
    sendJson(res, 400, { message: 'Invalid interview' })
    return
  }
  if (!(await ensureInterviewInputUserExists(pool, interviewResult.value))) {
    sendJson(res, 400, { message: 'Invalid interviewerUserId' })
    return
  }
  await validateInterviewScheduleAvailability(pool, {
    applicationStatus: nextStatus,
    interview: interviewResult.value,
  })
  const operatorUserId = await getRequestOperatorUserId(pool, req)
  const requestUpdatedAt = getRequestLocalDateTime(req)
  const [result] = await pool.query(
    `INSERT INTO job_post_application_status_history
      (application_id, application_status, first_interview_arrangement, interview_scheduled_at, interview_duration_minutes, interviewer_user_id, interview_location, interview_status, remark, operator_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      applicationId,
      nextStatus,
      arrangementResult.value || null,
      interviewResult.value.scheduledAt,
      interviewResult.value.durationMinutes,
      interviewResult.value.interviewerUserId,
      interviewResult.value.location,
      interviewResult.value.status,
      nextRemark,
      operatorUserId,
      requestUpdatedAt,
      requestUpdatedAt,
    ]
  )
  await syncApplicationFromLatestStatusHistory(pool, applicationId)
  const statusHistory = await listJobPostApplicationStatusHistory(pool, applicationId)
  const history = statusHistory.find((item) => Number(item.id) === Number(result.insertId)) || statusHistory[0] || null

  sendJson(res, 201, {
    message: interviewResult.statusRule?.message || 'Candidate application status history created',
    history,
    statusHistory,
    statusRule: interviewResult.statusRule || null,
  })
}

const updateJobPostApplicationStatusHistory = async (pool, req, res, applicationId, historyId) => {
  const [rows] = await pool.query(
    `SELECT
        id,
        application_id AS applicationId,
        application_status AS applicationStatus,
        first_interview_arrangement AS firstInterviewArrangement,
        interview_scheduled_at AS interviewScheduledAt,
        interview_duration_minutes AS interviewDurationMinutes,
        interviewer_user_id AS interviewerUserId,
        interview_location AS interviewLocation,
        interview_status AS interviewStatus,
        remark
      FROM job_post_application_status_history
      WHERE id = ? AND application_id = ?
      LIMIT 1`,
    [historyId, applicationId]
  )
  const existing = rows[0]
  if (!existing) {
    sendJson(res, 404, { message: 'Status history not found' })
    return
  }

  const body = await parseBody(req)
  const hasStatus = body && Object.prototype.hasOwnProperty.call(body, 'applicationStatus')
  const hasFirstInterviewArrangement =
    body && Object.prototype.hasOwnProperty.call(body, 'firstInterviewArrangement')
  const hasRemark = body && Object.prototype.hasOwnProperty.call(body, 'remark')
  const hasInterview = body && Object.prototype.hasOwnProperty.call(body, 'interview')
  if (!hasStatus && !hasFirstInterviewArrangement && !hasRemark && !hasInterview) {
    sendJson(res, 400, { message: 'applicationStatus, firstInterviewArrangement, interview or remark is required' })
    return
  }

  const nextStatus = hasStatus
    ? normalizeApplicationStatus(body?.applicationStatus, '')
    : normalizeApplicationStatus(existing.applicationStatus)
  if (!nextStatus) {
    sendJson(res, 400, { message: 'Invalid applicationStatus' })
    return
  }

  const arrangementResult = hasFirstInterviewArrangement
    ? resolveFirstInterviewArrangementInput(body?.firstInterviewArrangement, '')
    : {
        valid: true,
        value: normalizeFirstInterviewArrangement(existing.firstInterviewArrangement),
      }
  if (!arrangementResult.valid) {
    sendJson(res, 400, { message: 'Invalid firstInterviewArrangement' })
    return
  }
  const nextRemark = hasRemark ? normalizeApplicationRemark(body?.remark) : normalizeApplicationRemark(existing.remark)
  const interviewResult = resolveInterviewInput(hasInterview ? body?.interview : {}, buildInterviewFallback(existing))
  if (!interviewResult.valid) {
    sendJson(res, 400, { message: 'Invalid interview' })
    return
  }
  if (!(await ensureInterviewInputUserExists(pool, interviewResult.value))) {
    sendJson(res, 400, { message: 'Invalid interviewerUserId' })
    return
  }
  if (
    normalizeApplicationStatus(existing.applicationStatus, '') !== nextStatus ||
    hasInterviewScheduleChanged(existing, interviewResult.value)
  ) {
    await validateInterviewScheduleAvailability(pool, {
      applicationStatus: nextStatus,
      interview: interviewResult.value,
      excludeStatusHistoryId: historyId,
    })
  }
  const operatorUserId = await getRequestOperatorUserId(pool, req)
  const requestUpdatedAt = getRequestLocalDateTime(req)
  await pool.query(
    `UPDATE job_post_application_status_history
      SET application_status = ?, first_interview_arrangement = ?,
          interview_scheduled_at = ?, interview_duration_minutes = ?, interviewer_user_id = ?, interview_location = ?, interview_status = ?,
          remark = ?,
          operator_user_id = COALESCE(?, operator_user_id),
          updated_at = ?
     WHERE id = ? AND application_id = ?`,
    [
      nextStatus,
      arrangementResult.value || null,
      interviewResult.value.scheduledAt,
      interviewResult.value.durationMinutes,
      interviewResult.value.interviewerUserId,
      interviewResult.value.location,
      interviewResult.value.status,
      nextRemark,
      operatorUserId,
      requestUpdatedAt,
      historyId,
      applicationId,
    ]
  )
  await syncApplicationFromLatestStatusHistory(pool, applicationId)
  const statusHistory = await listJobPostApplicationStatusHistory(pool, applicationId)
  const history = statusHistory.find((item) => Number(item.id) === Number(historyId)) || null

  sendJson(res, 200, {
    message: interviewResult.statusRule?.message || 'Candidate application status history updated',
    history,
    statusHistory,
    statusRule: interviewResult.statusRule || null,
  })
}

const deleteJobPostApplicationStatusHistory = async (pool, _req, res, applicationId, historyId) => {
  const [existingRows] = await pool.query(
    'SELECT id FROM job_post_application_status_history WHERE id = ? AND application_id = ? LIMIT 1',
    [historyId, applicationId]
  )
  if (!existingRows.length) {
    sendJson(res, 404, { message: 'Status history not found' })
    return
  }

  await pool.query('DELETE FROM job_post_application_status_history WHERE id = ? AND application_id = ?', [
    historyId,
    applicationId,
  ])
  await syncApplicationFromLatestStatusHistory(pool, applicationId)
  const statusHistory = await listJobPostApplicationStatusHistory(pool, applicationId)

  sendJson(res, 200, {
    message: 'Candidate application status history deleted',
    historyId: Number(historyId),
    statusHistory,
  })
}

const getJobPostApplicationMatch = async (pool, _req, res, applicationId) => {
  const [rows] = await pool.query(
    `SELECT candidate_cv_id AS candidateCvId
      FROM job_post_applications
      WHERE id = ?
      LIMIT 1`,
    [applicationId]
  )
  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }

  const matches = await listCandidateCvJobMatches(pool, Number(row.candidateCvId))
  sendJson(res, 200, { applicationId: Number(applicationId), match: matches[0] || null })
}

const deleteJobPostApplication = async (pool, _req, res, applicationId) => {
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.candidate_cv_id AS candidateCvId,
        cv.storage_key AS storageKey
      FROM job_post_applications app
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      WHERE app.id = ?
      LIMIT 1`,
    [applicationId]
  )

  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }

  const candidateCvId = Number(row.candidateCvId)
  const storageKey = normalizeText(row.storageKey)
  await pool.query('DELETE FROM candidate_cvs WHERE id = ?', [candidateCvId])

  if (storageKey) {
    const storagePath = resolveCandidateCvStoragePath(storageKey)
    if (storagePath && fs.existsSync(storagePath)) {
      try {
        fs.unlinkSync(storagePath)
      } catch (error) {
        console.error('[CV] Failed to delete file:', error)
      }
    }
  }

  sendJson(res, 200, { message: 'Application deleted', applicationId: Number(applicationId) })
}

const deleteJobPostApplicationsBatch = async (pool, req, res) => {
  const body = await parseBody(req)
  const ids = Array.isArray(body?.applicationIds)
    ? body.applicationIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : []

  if (!ids.length) {
    sendJson(res, 400, { message: 'applicationIds is required' })
    return
  }

  const uniqueIds = [...new Set(ids)]
  const placeholders = uniqueIds.map(() => '?').join(', ')
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.candidate_cv_id AS candidateCvId,
        cv.storage_key AS storageKey
      FROM job_post_applications app
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      WHERE app.id IN (${placeholders})`,
    uniqueIds
  )

  if (!rows.length) {
    sendJson(res, 404, { message: 'Applications not found' })
    return
  }

  const candidateCvIds = rows
    .map((row) => Number(row.candidateCvId))
    .filter((id) => Number.isInteger(id) && id > 0)
  const storageKeys = rows
    .map((row) => normalizeText(row.storageKey))
    .filter(Boolean)

  if (candidateCvIds.length) {
    const cvPlaceholders = candidateCvIds.map(() => '?').join(', ')
    await pool.query(`DELETE FROM candidate_cvs WHERE id IN (${cvPlaceholders})`, candidateCvIds)
  }

  for (const storageKey of storageKeys) {
    const storagePath = resolveCandidateCvStoragePath(storageKey)
    if (storagePath && fs.existsSync(storagePath)) {
      try {
        fs.unlinkSync(storagePath)
      } catch (error) {
        console.error('[CV] Failed to delete file:', error)
      }
    }
  }

  sendJson(res, 200, {
    message: 'Applications deleted',
    deletedCount: rows.length,
  })
}

const createCandidate = async (pool, req, res) => {
  const body = await parseBody(req)
  const fullName = body?.fullName?.trim()
  const email = body?.email?.trim() || null
  const phone = body?.phone?.trim() || null

  if (!fullName) {
    sendJson(res, 400, { message: 'fullName is required' })
    return
  }

  const [result] = await pool.query(
    'INSERT INTO candidates (full_name, email, phone) VALUES (?, ?, ?)',
    [fullName, email, phone]
  )

  sendJson(res, 201, {
    message: 'Candidate created',
    candidate: { id: result.insertId, fullName, email, phone },
  })
}

const completeCandidateProfile = async (pool, req, res, candidateId) => {
  const body = await parseBody(req)
  const fullName = body?.fullName?.trim()
  const email = body?.email?.trim() || null
  const phone = body?.phone?.trim() || null

  if (!fullName) {
    sendJson(res, 400, { message: 'fullName is required' })
    return
  }

  await pool.query('UPDATE candidates SET full_name = ?, email = ?, phone = ? WHERE id = ?', [
    fullName,
    email,
    phone,
    candidateId,
  ])

  sendJson(res, 200, {
    message: 'Candidate profile updated',
    candidate: { id: candidateId, fullName, email, phone },
  })
}

const listCandidates = async (pool, _req, res) => {
  const [rows] = await pool.query(
    'SELECT id, full_name AS fullName, email, phone, created_at AS createdAt FROM candidates ORDER BY created_at DESC'
  )
  sendJson(res, 200, { candidates: rows })
}

const getCandidateById = async (pool, candidateId) => {
  const [rows] = await pool.query(
    `SELECT
        id,
        full_name AS fullName,
        email,
        phone,
        created_at AS createdAt
      FROM candidates
      WHERE id = ?
      LIMIT 1`,
    [candidateId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: Number(row.id),
    fullName: normalizeText(row.fullName),
    email: normalizeEmailIdentity(row.email),
    phone: normalizeText(row.phone),
    createdAt: row.createdAt,
  }
}

const insertCandidateCv = async (
  pool,
  candidateId,
  fileName,
  mimeType,
  buffer,
  { fullName = '', createdAt = '', source = '' } = {}
) => {
  const normalizedSource = normalizeCvSource(source) || null
  const renamedFileName = buildRenamedCandidateCvFileName({
    fullName,
    createdAt,
    sourceFileName: fileName,
  })
  const [versionRows] = await pool.query(
    'SELECT COALESCE(MAX(version_no), 0) AS maxVersion FROM candidate_cvs WHERE candidate_id = ?',
    [candidateId]
  )
  const nextVersion = Number(versionRows[0]?.maxVersion || 0) + 1
  const fileHash = sha256Buffer(buffer)
  ensureCvStorageDir()
  const storageFileName = sanitizeFileName(
    `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${renamedFileName}`
  )
  const storagePath = path.join(CV_STORAGE_DIR, storageFileName)
  fs.writeFileSync(storagePath, buffer)

  const [result] = await pool.query(
    `INSERT INTO candidate_cvs
      (candidate_id, version_no, storage_provider, storage_key, original_filename, mime_type, file_size, sha256, source)
     VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?)`,
    [
      candidateId,
      nextVersion,
      storageFileName,
      renamedFileName,
      mimeType || 'application/octet-stream',
      buffer.length,
      fileHash,
      normalizedSource,
    ]
  )

  return {
    id: result.insertId,
    candidateId,
    versionNo: nextVersion,
    originalFileName: renamedFileName,
    source: normalizedSource || '',
    size: buffer.length,
    storagePath,
  }
}

const parseJsonObject = (value) => {
  if (!value) return null
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const normalizeText = (value) => String(value ?? '').trim()

const normalizeEmailIdentity = (value) => normalizeText(value).toLowerCase()

const normalizePhoneIdentity = (value) => normalizeText(value).replace(/[\s\-()]/g, '')

const CV_SOURCE_VALUES = new Set(['BOSS', '智聯', '內推'])

const normalizeCvSource = (value) => {
  const text = normalizeText(value)
  if (!text) return ''
  if (/^boss$/i.test(text)) return 'BOSS'
  if (text === '智联' || text === '智聯') return '智聯'
  if (text === '内推' || text === '內推') return '內推'
  return CV_SOURCE_VALUES.has(text) ? text : ''
}

const detectCvSourceFromFileName = (fileName = '') => {
  const text = normalizeText(fileName)
  if (!text) return ''
  if (/boss/i.test(text)) return 'BOSS'
  if (/(智联简历|智聯簡歷)/.test(text)) return '智聯'
  if (/(内推|內推)/.test(text)) return '內推'
  if (/^[A-Za-z]?\s*【[^】]+[_＿][^】]+】\s*[^\\/]+?\.(pdf|docx?|txt)$/i.test(text)) return 'BOSS'
  return ''
}

const resolveCvSource = (value, fileName = '') =>
  normalizeCvSource(value) || detectCvSourceFromFileName(fileName)

const buildOwnerUserPayload = (row = {}) => {
  if (!row.ownerUserId) return null
  return buildUserPayload({
    id: row.ownerUserId,
    email: row.ownerEmail,
    username: row.ownerUsername,
    avatarText: row.ownerAvatarText,
    avatarBgColor: row.ownerAvatarBgColor,
  })
}

// 重複投遞以「姓名+電話」或「姓名+郵件」跨全部投遞建桶，列表端只需要查 id 是否在集合內。
const buildDuplicateApplicationIdSet = (rows = []) => {
  const buckets = new Map()
  const addBucket = (key, applicationId) => {
    if (!key || !applicationId) return
    const ids = buckets.get(key) || new Set()
    ids.add(Number(applicationId))
    buckets.set(key, ids)
  }

  for (const row of rows) {
    const applicationId = Number(row.applicationId || 0)
    const name = normalizeText(row.fullName)
    if (!applicationId || !name) continue
    const phone = normalizePhoneIdentity(row.phone)
    const email = normalizeEmailIdentity(row.email)
    if (phone) addBucket(`phone:${name}:${phone}`, applicationId)
    if (email) addBucket(`email:${name}:${email}`, applicationId)
  }

  const duplicateIds = new Set()
  for (const ids of buckets.values()) {
    if (ids.size <= 1) continue
    for (const id of ids) duplicateIds.add(id)
  }
  return duplicateIds
}

const listDuplicateApplicationIds = async (pool) => {
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        c.full_name AS fullName,
        c.email AS email,
        c.phone AS phone
      FROM job_post_applications app
      INNER JOIN candidates c ON c.id = app.candidate_id`
  )
  return buildDuplicateApplicationIdSet(rows)
}

const PERSONNEL_STATUS_VALUES = new Set(['active', 'inactive'])

const normalizeDirectoryStatus = (value, fallback = 'active') => {
  const normalized = normalizeText(value).toLowerCase()
  return PERSONNEL_STATUS_VALUES.has(normalized) ? normalized : fallback
}

const normalizeRemark = (value, limit = 4000) => {
  const text = normalizeText(value)
  return text ? text.slice(0, limit) : ''
}

const normalizePersonnelPayload = (payload = {}) => ({
  fullName: normalizeText(payload.fullName),
  department: normalizeText(payload.department),
  team: normalizeText(payload.team),
  title: normalizeText(payload.title),
  email: normalizeEmailIdentity(payload.email),
  phone: normalizeText(payload.phone),
  managerPersonnelId: Number(payload.managerPersonnelId) > 0 ? Number(payload.managerPersonnelId) : null,
  status: normalizeDirectoryStatus(payload.status),
  remark: normalizeRemark(payload.remark),
})

const normalizeBlacklistPayload = (payload = {}) => {
  const displayName = normalizeText(payload.displayName)
  const phone = normalizeText(payload.phone)
  const email = normalizeEmailIdentity(payload.email)
  return {
    displayName,
    phone,
    normalizedPhone: normalizePhoneIdentity(phone),
    email,
    normalizedEmail: normalizeEmailIdentity(email),
    reason: normalizeRemark(payload.reason),
    status: normalizeDirectoryStatus(payload.status),
    remark: normalizeRemark(payload.remark),
  }
}

const buildPersonnelPayload = (row = {}) => ({
  id: Number(row.id || 0),
  fullName: normalizeText(row.fullName),
  department: normalizeText(row.department),
  team: normalizeText(row.team),
  title: normalizeText(row.title),
  email: normalizeEmailIdentity(row.email),
  phone: normalizeText(row.phone),
  managerPersonnelId: row.managerPersonnelId ? Number(row.managerPersonnelId) : null,
  managerName: normalizeText(row.managerName),
  status: normalizeDirectoryStatus(row.status),
  remark: normalizeRemark(row.remark),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const buildCandidateBlacklistPayload = (row = {}) => ({
  id: Number(row.id || 0),
  displayName: normalizeText(row.displayName),
  phone: normalizeText(row.phone),
  normalizedPhone: normalizePhoneIdentity(row.normalizedPhone || row.phone),
  email: normalizeEmailIdentity(row.email),
  normalizedEmail: normalizeEmailIdentity(row.normalizedEmail || row.email),
  reason: normalizeRemark(row.reason),
  status: normalizeDirectoryStatus(row.status),
  remark: normalizeRemark(row.remark),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const PROJECT_STATUS_VALUES = new Set(['planned', 'active', 'paused', 'completed'])
const ASSIGNMENT_STATUS_VALUES = new Set(['active', 'transferred', 'removed'])
const ASSIGNMENT_SOURCE_VALUES = new Set(['manual', 'csv', 'candidate'])

const normalizeProjectStatus = (value, fallback = 'planned') => {
  const normalized = normalizeText(value).toLowerCase()
  return PROJECT_STATUS_VALUES.has(normalized) ? normalized : fallback
}

const normalizeAssignmentStatus = (value, fallback = 'active') => {
  const normalized = normalizeText(value).toLowerCase()
  return ASSIGNMENT_STATUS_VALUES.has(normalized) ? normalized : fallback
}

const normalizeAssignmentSource = (value, fallback = 'manual') => {
  const normalized = normalizeText(value).toLowerCase()
  return ASSIGNMENT_SOURCE_VALUES.has(normalized) ? normalized : fallback
}

const normalizeDateInput = (value, fieldName = 'date') => {
  const text = normalizeText(value)
  if (!text) return null

  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!match) throw new HttpError(400, `${fieldName} must use YYYY-MM-DD format`)

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, `${fieldName} is invalid`)
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const getTodayDateText = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const normalizeProjectPayload = (payload = {}) => ({
  projectName: normalizeText(payload.projectName || payload.project_name || payload.name),
  status: normalizeProjectStatus(payload.status),
  ownerPersonnelId: Number(payload.ownerPersonnelId) > 0 ? Number(payload.ownerPersonnelId) : null,
  startDate: normalizeDateInput(payload.startDate, 'startDate'),
  endDate: normalizeDateInput(payload.endDate, 'endDate'),
  remark: normalizeRemark(payload.remark),
})

const normalizeProjectAssignmentPayload = (payload = {}, fallbackSource = 'manual') => ({
  personnelId: Number(payload.personnelId) > 0 ? Number(payload.personnelId) : null,
  fullName: normalizeText(payload.fullName),
  department: normalizeText(payload.department),
  team: normalizeText(payload.team),
  title: normalizeText(payload.title),
  email: normalizeEmailIdentity(payload.email),
  phone: normalizeText(payload.phone),
  managerPersonnelId: Number(payload.managerPersonnelId) > 0 ? Number(payload.managerPersonnelId) : null,
  projectRole: normalizeText(payload.projectRole || payload.role),
  startDate: normalizeDateInput(payload.startDate, 'startDate'),
  endDate: normalizeDateInput(payload.endDate, 'endDate'),
  source: normalizeAssignmentSource(payload.source, fallbackSource),
  status: normalizeAssignmentStatus(payload.status),
  remark: normalizeRemark(payload.remark),
})

const buildProjectPayload = (row = {}) => ({
  id: Number(row.id || 0),
  projectName: normalizeText(row.projectName),
  status: normalizeProjectStatus(row.status),
  ownerPersonnelId: row.ownerPersonnelId ? Number(row.ownerPersonnelId) : null,
  ownerName: normalizeText(row.ownerName),
  startDate: row.startDate || null,
  endDate: row.endDate || null,
  remark: normalizeRemark(row.remark),
  assignmentCount: Number(row.assignmentCount || 0),
  activeAssignmentCount: Number(row.activeAssignmentCount || 0),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const buildProjectAssignmentPayload = (row = {}) => ({
  id: Number(row.id || 0),
  projectId: Number(row.projectId || 0),
  projectName: normalizeText(row.projectName),
  personnelId: Number(row.personnelId || 0),
  fullName: normalizeText(row.fullName),
  department: normalizeText(row.department),
  team: normalizeText(row.team),
  title: normalizeText(row.title),
  email: normalizeEmailIdentity(row.email),
  phone: normalizeText(row.phone),
  managerPersonnelId: row.managerPersonnelId ? Number(row.managerPersonnelId) : null,
  managerName: normalizeText(row.managerName),
  projectRole: normalizeText(row.projectRole),
  startDate: row.startDate || null,
  endDate: row.endDate || null,
  source: normalizeAssignmentSource(row.source),
  status: normalizeAssignmentStatus(row.status),
  remark: normalizeRemark(row.remark),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const normalizeList = (value, limit = 20) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；、|/]+/)
      : []

  const seen = new Set()
  const normalized = []
  for (const item of source.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))) {
    const text = normalizeText(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
    if (normalized.length >= limit) break
  }
  return normalized
}

const stringifyJson = (value) => JSON.stringify(value ?? null)

const JOB_POST_STATUS_VALUES = new Set(['open', 'draft', 'closed'])

const normalizeJobPostStatus = (value, fallback = 'open') => {
  const status = normalizeText(value).toLowerCase()
  return JOB_POST_STATUS_VALUES.has(status) ? status : fallback
}

const resolveJobPostStatusInput = (value, fallback = 'open') => {
  const status = normalizeText(value).toLowerCase()
  if (!status) return { valid: true, status: fallback }
  if (JOB_POST_STATUS_VALUES.has(status)) return { valid: true, status }
  return { valid: false, status: fallback }
}

const APPLICATION_STATUS_VALUES = new Set([
  'screening',
  'screening_rejected',
  'screening_hr_approved',
  'screening_hr_rejected',
  'screening_department_approved',
  'screening_department_rejected',
  'hr_interview',
  'hr_interview_rejected',
  'department_interview',
  'department_interview_rejected',
  'salary_review',
  'offer_sent',
  'onboarded',
  'transferred',
  'no_show_or_unreachable',
  'offer_rejected',
  'hr_withdrew_onboarding',
])

const INTERVIEW_APPLICATION_STATUS_VALUES = new Set(['hr_interview', 'department_interview'])
const FIRST_INTERVIEW_ARRANGEMENT_VALUES = new Set(['can_invite', 'unsuitable'])
const INTERVIEW_LOCATION_VALUES = new Set(['zhuhai', 'macau', 'online'])
const INTERVIEW_STATUS_VALUES = new Set(['not_started', 'in_progress', 'ended', 'passed', 'failed'])
const TERMINAL_INTERVIEW_STATUS_VALUES = new Set(['passed', 'failed'])
const INTERVIEW_STATUS_LABELS = {
  not_started: '未開始',
  in_progress: '進行中',
  ended: '已結束',
  passed: '通過',
  failed: '不通過',
}
const DEFAULT_INTERVIEW_DURATION_MINUTES = 30
const MIN_INTERVIEW_DURATION_MINUTES = 1
const MAX_INTERVIEW_DURATION_MINUTES = 480

const normalizeApplicationStatus = (value, fallback = 'screening') => {
  const normalized = normalizeText(value).toLowerCase()
  const mapped = normalized === 'submitted'
    ? 'screening'
    : normalized === 'rejected'
      ? 'screening_rejected'
      : normalized
  return APPLICATION_STATUS_VALUES.has(mapped) ? mapped : fallback
}

const normalizeFirstInterviewArrangement = (value, fallback = '') => {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return ''
  return FIRST_INTERVIEW_ARRANGEMENT_VALUES.has(normalized) ? normalized : fallback
}

const resolveFirstInterviewArrangementInput = (value, fallback = '') => {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return { valid: true, value: '' }
  if (FIRST_INTERVIEW_ARRANGEMENT_VALUES.has(normalized)) {
    return { valid: true, value: normalized }
  }
  return { valid: false, value: fallback }
}

const normalizeApplicationRemark = (value) => {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, 4000) : null
}

const buildApplicationStatusHistoryPayload = (row = {}) => ({
  id: Number(row.id || 0),
  applicationId: Number(row.applicationId || 0),
  applicationStatus: normalizeApplicationStatus(row.applicationStatus),
  firstInterviewArrangement: normalizeFirstInterviewArrangement(row.firstInterviewArrangement),
  interview: buildInterviewPayload(row),
  remark: normalizeText(row.remark),
  operatorUser: row.operatorUserId
    ? buildUserPayload({
        id: row.operatorUserId,
        email: row.operatorEmail,
        username: row.operatorUsername,
        avatarText: row.operatorAvatarText,
        avatarBgColor: row.operatorAvatarBgColor,
      })
    : null,
  createdAt: formatDateTimeForPayload(row.createdAt),
  updatedAt: formatDateTimeForPayload(row.updatedAt || row.createdAt),
})

const listJobPostApplicationStatusHistory = async (pool, applicationId) => {
  const [rows] = await pool.query(
    `SELECT
        history.id,
        history.application_id AS applicationId,
        history.application_status AS applicationStatus,
        history.first_interview_arrangement AS firstInterviewArrangement,
        history.interview_scheduled_at AS interviewScheduledAt,
        history.interview_duration_minutes AS interviewDurationMinutes,
        history.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        history.interview_location AS interviewLocation,
        history.interview_status AS interviewStatus,
        history.remark,
        history.operator_user_id AS operatorUserId,
        operator_user.email AS operatorEmail,
        operator_user.username AS operatorUsername,
        operator_user.avatar_text AS operatorAvatarText,
        operator_user.avatar_bg_color AS operatorAvatarBgColor,
        history.created_at AS createdAt,
        history.updated_at AS updatedAt
      FROM job_post_application_status_history history
      LEFT JOIN users operator_user ON operator_user.id = history.operator_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = history.interviewer_user_id
      WHERE history.application_id = ?
      ORDER BY history.updated_at DESC, history.id DESC`,
    [applicationId]
  )
  return rows.map((row) => buildApplicationStatusHistoryPayload(row))
}

const listJobPostApplicationStatusHistories = async (pool, applicationIds = []) => {
  const ids = [...new Set(applicationIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return new Map()

  const placeholders = ids.map(() => '?').join(', ')
  const [rows] = await pool.query(
    `SELECT
        history.id,
        history.application_id AS applicationId,
        history.application_status AS applicationStatus,
        history.first_interview_arrangement AS firstInterviewArrangement,
        history.interview_scheduled_at AS interviewScheduledAt,
        history.interview_duration_minutes AS interviewDurationMinutes,
        history.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        history.interview_location AS interviewLocation,
        history.interview_status AS interviewStatus,
        history.remark,
        history.operator_user_id AS operatorUserId,
        operator_user.email AS operatorEmail,
        operator_user.username AS operatorUsername,
        operator_user.avatar_text AS operatorAvatarText,
        operator_user.avatar_bg_color AS operatorAvatarBgColor,
        history.created_at AS createdAt,
        history.updated_at AS updatedAt
      FROM job_post_application_status_history history
      LEFT JOIN users operator_user ON operator_user.id = history.operator_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = history.interviewer_user_id
      WHERE history.application_id IN (${placeholders})
      ORDER BY history.application_id ASC, history.updated_at DESC, history.id DESC`,
    ids
  )

  const grouped = new Map(ids.map((id) => [id, []]))
  for (const row of rows) {
    const applicationId = Number(row.applicationId)
    const history = buildApplicationStatusHistoryPayload(row)
    grouped.set(applicationId, [...(grouped.get(applicationId) || []), history])
  }
  return grouped
}

const normalizeInterviewLocation = (value, fallback = '') => {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return ''
  return INTERVIEW_LOCATION_VALUES.has(normalized) ? normalized : fallback
}

const normalizeInterviewStatus = (value, fallback = 'not_started') => {
  const normalized = normalizeText(value).toLowerCase()
  return INTERVIEW_STATUS_VALUES.has(normalized) ? normalized : fallback
}

const isTerminalInterviewStatus = (value) =>
  TERMINAL_INTERVIEW_STATUS_VALUES.has(normalizeInterviewStatus(value, ''))

const parseInterviewDateTime = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const formatInterviewValidationDateTime = (date) => {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const normalizeInterviewScheduledAt = (value, fallback = null) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fallback
    const pad = (number) => String(number).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:00`
  }
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace('T', ' ').slice(0, 16)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) return fallback
  const parsed = new Date(`${normalized.replace(' ', 'T')}:00`)
  if (Number.isNaN(parsed.getTime())) return fallback
  return `${normalized}:00`
}

const normalizeInterviewDurationMinutes = (value, fallback = DEFAULT_INTERVIEW_DURATION_MINUTES) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const minutes = Math.round(number)
  if (minutes < MIN_INTERVIEW_DURATION_MINUTES || minutes > MAX_INTERVIEW_DURATION_MINUTES) return fallback
  return minutes
}

const getInterviewTemporalStatus = (
  scheduledAt,
  durationMinutes = DEFAULT_INTERVIEW_DURATION_MINUTES,
  now = new Date()
) => {
  const start = parseInterviewDateTime(scheduledAt)
  if (!start) return 'not_started'
  const minutes = normalizeInterviewDurationMinutes(durationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES)
  const end = new Date(start.getTime() + minutes * 60 * 1000)
  if (now < start) return 'not_started'
  if (now <= end) return 'in_progress'
  return 'ended'
}

const resolveStoredInterviewStatus = (
  status,
  scheduledAt,
  durationMinutes = DEFAULT_INTERVIEW_DURATION_MINUTES,
  now = new Date()
) => {
  const requestedStatus = normalizeInterviewStatus(status, '')
  if (!requestedStatus) {
    return { valid: false, status: '', requestedStatus: '', expectedStatus: '', changed: false, message: 'Invalid interview status' }
  }
  if (isTerminalInterviewStatus(requestedStatus)) {
    return {
      valid: true,
      status: requestedStatus,
      requestedStatus,
      expectedStatus: requestedStatus,
      changed: false,
      message: '',
    }
  }

  const start = parseInterviewDateTime(scheduledAt)
  if (!start) {
    const expectedStatus = 'not_started'
    return {
      valid: true,
      status: expectedStatus,
      requestedStatus,
      expectedStatus,
      changed: requestedStatus !== expectedStatus,
      message: '',
    }
  }

  const minutes = normalizeInterviewDurationMinutes(durationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES)
  const end = new Date(start.getTime() + minutes * 60 * 1000)
  const expectedStatus = getInterviewTemporalStatus(start, minutes, now)
  const changed = requestedStatus !== expectedStatus
  const requestedLabel = INTERVIEW_STATUS_LABELS[requestedStatus] || requestedStatus
  const expectedLabel = INTERVIEW_STATUS_LABELS[expectedStatus] || expectedStatus
  return {
    valid: true,
    status: expectedStatus,
    requestedStatus,
    expectedStatus,
    changed,
    message: changed
      ? `目前本機時間為 ${formatInterviewValidationDateTime(now)}，面試時段為 ${formatInterviewValidationDateTime(start)}-${formatInterviewValidationDateTime(end)}，已依時間規則將「${requestedLabel}」套用為「${expectedLabel}」。`
      : '',
  }
}

const formatDateTimeForPayload = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

const normalizeClientLocalDateTime = (value) => {
  const text = normalizeText(value)
  if (!text) return ''
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hours = Number(match[4])
  const minutes = Number(match[5])
  const seconds = Number(match[6] || 0)
  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return ''
  }
  const pad = (number) => String(number).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

const getRequestLocalDateTime = (req) =>
  normalizeClientLocalDateTime(req?.headers?.['x-hrai-client-time']) || formatDateTimeForPayload(new Date())

const resolveInterviewInput = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {}
  const scheduledAt = Object.prototype.hasOwnProperty.call(source, 'scheduledAt')
    ? normalizeInterviewScheduledAt(source.scheduledAt, undefined)
    : normalizeInterviewScheduledAt(fallback.scheduledAt, null)
  const location = Object.prototype.hasOwnProperty.call(source, 'location')
    ? normalizeInterviewLocation(source.location, undefined)
    : normalizeInterviewLocation(fallback.location, '')
  const inputStatus = Object.prototype.hasOwnProperty.call(source, 'status')
    ? normalizeInterviewStatus(source.status, undefined)
    : normalizeInterviewStatus(fallback.status, 'not_started')
  const interviewerUserId = Object.prototype.hasOwnProperty.call(source, 'interviewerUserId')
    ? Number(source.interviewerUserId || 0) || null
    : Number(fallback.interviewerUserId || 0) || null
  const durationMinutes = Object.prototype.hasOwnProperty.call(source, 'durationMinutes')
    ? normalizeInterviewDurationMinutes(source.durationMinutes, undefined)
    : normalizeInterviewDurationMinutes(fallback.durationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES)
  const statusResult = resolveStoredInterviewStatus(inputStatus, scheduledAt, durationMinutes)

  return {
    valid:
      scheduledAt !== undefined &&
      location !== undefined &&
      inputStatus !== undefined &&
      durationMinutes !== undefined &&
      statusResult.valid,
    value: {
      scheduledAt: scheduledAt || null,
      interviewerUserId,
      durationMinutes,
      location: location || null,
      status: statusResult.status,
    },
    statusRule: statusResult,
  }
}

const buildInterviewPayload = (row = {}) => ({
  scheduledAt: formatDateTimeForPayload(row.interviewScheduledAt),
  durationMinutes: normalizeInterviewDurationMinutes(row.interviewDurationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES),
  interviewerUser: row.interviewerUserId
    ? buildUserPayload({
        id: row.interviewerUserId,
        email: row.interviewerEmail,
        username: row.interviewerUsername,
        avatarText: row.interviewerAvatarText,
        avatarBgColor: row.interviewerAvatarBgColor,
      })
    : null,
  location: normalizeInterviewLocation(row.interviewLocation),
  status: normalizeInterviewStatus(row.interviewStatus),
})

const buildInterviewFallback = (row = {}) => ({
  scheduledAt: row.interviewScheduledAt || null,
  interviewerUserId: row.interviewerUserId || null,
  durationMinutes: row.interviewDurationMinutes || DEFAULT_INTERVIEW_DURATION_MINUTES,
  location: row.interviewLocation || '',
  status: row.interviewStatus || 'not_started',
})

const ensureInterviewInputUserExists = async (pool, interview) => {
  const interviewerUserId = Number(interview?.interviewerUserId || 0) || null
  if (!interviewerUserId) return true
  const [rows] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [interviewerUserId])
  return rows.length > 0
}

const getLatestJobPostApplicationStatusHistory = async (pool, applicationId) => {
  const [rows] = await pool.query(
    `SELECT
        history.id,
        history.application_id AS applicationId,
        history.application_status AS applicationStatus,
        history.first_interview_arrangement AS firstInterviewArrangement,
        history.interview_scheduled_at AS interviewScheduledAt,
        history.interview_duration_minutes AS interviewDurationMinutes,
        history.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        history.interview_location AS interviewLocation,
        history.interview_status AS interviewStatus,
        history.remark,
        history.operator_user_id AS operatorUserId,
        operator_user.email AS operatorEmail,
        operator_user.username AS operatorUsername,
        operator_user.avatar_text AS operatorAvatarText,
        operator_user.avatar_bg_color AS operatorAvatarBgColor,
        history.created_at AS createdAt,
        history.updated_at AS updatedAt
      FROM job_post_application_status_history history
      LEFT JOIN users operator_user ON operator_user.id = history.operator_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = history.interviewer_user_id
      WHERE history.application_id = ?
      ORDER BY history.updated_at DESC, history.id DESC
      LIMIT 1`,
    [applicationId]
  )
  return rows[0] ? buildApplicationStatusHistoryPayload(rows[0]) : null
}

// 候選人列表顯示的狀態欄位以最新狀態歷史為準，對接人也會跟隨最近一次操作人補齊。
const syncApplicationFromLatestStatusHistory = async (pool, applicationId) => {
  const latest = await getLatestJobPostApplicationStatusHistory(pool, applicationId)
  if (!latest) return null
  const latestOperatorUserId = Number(latest.operatorUser?.id || 0) || null

  await pool.query(
    `UPDATE job_post_applications
      SET application_status = ?,
          first_interview_arrangement = ?,
          interview_scheduled_at = ?,
          interview_duration_minutes = ?,
          interviewer_user_id = ?,
          interview_location = ?,
          interview_status = ?,
          remark = ?,
          owner_user_id = COALESCE(?, owner_user_id),
          updated_at = ?
     WHERE id = ?`,
    [
      latest.applicationStatus,
      latest.firstInterviewArrangement || null,
      latest.interview.scheduledAt || null,
      latest.interview.durationMinutes || DEFAULT_INTERVIEW_DURATION_MINUTES,
      latest.interview.interviewerUser?.id || null,
      latest.interview.location || null,
      latest.interview.status || 'not_started',
      normalizeApplicationRemark(latest.remark),
      latestOperatorUserId,
      latest.updatedAt || formatDateTimeForPayload(new Date()),
      applicationId,
    ]
  )
  return latest
}

const syncJobPostApplicationStatusHistory = async (
  pool,
  applicationId,
  { applicationStatus, firstInterviewArrangement = '', interview = {}, remark = '' } = {},
  { append = false, operatorUserId = null, updatedAtSql = '' } = {}
) => {
  const nextStatus = normalizeApplicationStatus(applicationStatus)
  const nextFirstInterviewArrangement = normalizeFirstInterviewArrangement(firstInterviewArrangement)
  const interviewResult = resolveInterviewInput(interview)
  const nextInterview = interviewResult.value
  const nextRemark = normalizeApplicationRemark(remark)
  const normalizedOperatorUserId = Number(operatorUserId || 0) || null
  const statusTimestamp = normalizeClientLocalDateTime(updatedAtSql) || formatDateTimeForPayload(new Date())

  if (append) {
    await pool.query(
      `INSERT INTO job_post_application_status_history
        (application_id, application_status, first_interview_arrangement, interview_scheduled_at, interview_duration_minutes, interviewer_user_id, interview_location, interview_status, remark, operator_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        nextStatus,
        nextFirstInterviewArrangement || null,
        nextInterview.scheduledAt,
        nextInterview.durationMinutes,
        nextInterview.interviewerUserId,
        nextInterview.location,
        nextInterview.status,
        nextRemark,
        normalizedOperatorUserId,
        statusTimestamp,
        statusTimestamp,
      ]
    )
    return
  }

  const [rows] = await pool.query(
    `SELECT id
      FROM job_post_application_status_history
      WHERE application_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [applicationId]
  )

  if (!rows[0]) {
    await pool.query(
      `INSERT INTO job_post_application_status_history
        (application_id, application_status, first_interview_arrangement, interview_scheduled_at, interview_duration_minutes, interviewer_user_id, interview_location, interview_status, remark, operator_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        nextStatus,
        nextFirstInterviewArrangement || null,
        nextInterview.scheduledAt,
        nextInterview.durationMinutes,
        nextInterview.interviewerUserId,
        nextInterview.location,
        nextInterview.status,
        nextRemark,
        normalizedOperatorUserId,
        statusTimestamp,
        statusTimestamp,
      ]
    )
    return
  }

  await pool.query(
    `UPDATE job_post_application_status_history
      SET application_status = ?, first_interview_arrangement = ?,
          interview_scheduled_at = ?, interview_duration_minutes = ?, interviewer_user_id = ?, interview_location = ?, interview_status = ?,
          remark = ?,
          operator_user_id = COALESCE(?, operator_user_id),
          updated_at = ?
     WHERE id = ?`,
    [
      nextStatus,
      nextFirstInterviewArrangement || null,
      nextInterview.scheduledAt,
      nextInterview.durationMinutes,
      nextInterview.interviewerUserId,
      nextInterview.location,
      nextInterview.status,
      nextRemark,
      normalizedOperatorUserId,
      statusTimestamp,
      Number(rows[0].id),
    ]
  )
}

const parseJobSnapshot = (value) => {
  if (!value) return null
  const parsed = typeof value === 'string' ? parseJsonObject(value) : value
  return parsed && typeof parsed === 'object' ? parsed : null
}

const buildJobSnapshot = (jobKey, dictionaryJob = {}) => ({
  jobKey: normalizeText(dictionaryJob?.jobKey) || normalizeText(jobKey),
  title: normalizeText(dictionaryJob?.title) || normalizeText(jobKey),
  description: normalizeText(dictionaryJob?.description),
  industry: normalizeList(dictionaryJob?.industry, 20),
  roleKeywords: normalizeList(dictionaryJob?.roleKeywords, 20),
  coreResponsibilities: normalizeList(dictionaryJob?.coreResponsibilities, 20),
  requiredSkills: normalizeList(dictionaryJob?.requiredSkills, 20),
  projectExperience: normalizeList(dictionaryJob?.projectExperience, 20),
  preferredSkills: normalizeList(dictionaryJob?.preferredSkills, 20),
  certifications: normalizeList(dictionaryJob?.certifications, 20),
  minWorkYears: Number(dictionaryJob?.minWorkYears ?? dictionaryJob?.workYears ?? 0),
  workYears: Number(dictionaryJob?.workYears ?? dictionaryJob?.minWorkYears ?? 0),
  employmentGapLimitMonths: normalizeEmploymentGapLimitMonths(dictionaryJob?.employmentGapLimitMonths),
  candidatePreference: normalizeList(dictionaryJob?.candidatePreference, 20),
  salaryRange: {
    min: Number(dictionaryJob?.salaryRange?.min || 0),
    max: Number(dictionaryJob?.salaryRange?.max || 0),
  },
  weights: normalizeScoringWeights(dictionaryJob?.weights),
  scoringRubrics: normalizeScoringRubrics(dictionaryJob?.scoringRubrics),
})

const findCurrentDictionaryJobEntry = (identity = {}) => {
  const dictionary = getJobDictionary()
  const identifiers = [
    identity.jobKey,
    identity.title,
    identity.jobTitle,
    identity.matchedPosition,
  ].map(normalizeText).filter(Boolean)

  for (const identifier of identifiers) {
    if (dictionary?.[identifier]) return [identifier, dictionary[identifier]]
  }

  for (const [dictionaryKey, job] of Object.entries(dictionary || {})) {
    const jobIdentifiers = [
      dictionaryKey,
      job?.jobKey,
      job?.title,
    ].map(normalizeText).filter(Boolean)
    if (identifiers.some((identifier) => jobIdentifiers.includes(identifier))) {
      return [dictionaryKey, job]
    }
  }

  return null
}

const resolveCurrentJobSnapshot = (jobSnapshot = {}) => {
  const entry = findCurrentDictionaryJobEntry(jobSnapshot)
  if (!entry) return jobSnapshot
  const [jobKey, dictionaryJob] = entry
  return buildJobSnapshot(jobKey, dictionaryJob)
}

const getJobPostById = async (pool, jobPostId) => {
  const [rows] = await pool.query(
    `SELECT
        id,
        title,
        job_key AS jobKey,
        job_snapshot_json AS jobSnapshotJson,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM job_posts
      WHERE id = ?
      LIMIT 1`,
    [jobPostId]
  )
  const row = rows[0]
  if (!row) return null

  return {
    id: Number(row.id),
    title: normalizeText(row.title),
    jobKey: normalizeText(row.jobKey),
    status: normalizeJobPostStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    jobSnapshot: parseJobSnapshot(row.jobSnapshotJson),
  }
}

const listPersonnelRows = async (pool) => {
  const [rows] = await pool.query(
    `SELECT
        p.id,
        p.full_name AS fullName,
        p.department,
        p.team,
        p.title,
        p.email,
        p.phone,
        p.manager_personnel_id AS managerPersonnelId,
        p.status,
        p.remark,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        manager.full_name AS managerName
      FROM personnel p
      LEFT JOIN personnel manager ON manager.id = p.manager_personnel_id
      ORDER BY p.updated_at DESC, p.id DESC`
  )
  return rows.map((row) => buildPersonnelPayload(row))
}

const ensurePersonnelManagerIsValid = async (pool, personnelId, managerPersonnelId) => {
  if (!managerPersonnelId) return
  if (personnelId && Number(personnelId) === Number(managerPersonnelId)) {
    throw new HttpError(400, 'Manager cannot be self')
  }

  const rows = await listPersonnelRows(pool)
  const rowMap = new Map(rows.map((row) => [Number(row.id), row]))
  if (!rowMap.has(Number(managerPersonnelId))) {
    throw new HttpError(400, 'Manager not found')
  }

  let currentId = Number(managerPersonnelId)
  while (currentId) {
    if (personnelId && currentId === Number(personnelId)) {
      throw new HttpError(400, 'Manager hierarchy cannot be cyclic')
    }
    currentId = Number(rowMap.get(currentId)?.managerPersonnelId || 0)
  }
}

const assertDateRange = (startDate, endDate, label = 'date range') => {
  if (startDate && endDate && startDate > endDate) {
    throw new HttpError(400, `${label} startDate cannot be later than endDate`)
  }
}

const getPersonnelById = async (pool, personnelId) => {
  const [rows] = await pool.query(
    `SELECT
        p.id,
        p.full_name AS fullName,
        p.department,
        p.team,
        p.title,
        p.email,
        p.phone,
        p.manager_personnel_id AS managerPersonnelId,
        p.status,
        p.remark,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        manager.full_name AS managerName
      FROM personnel p
      LEFT JOIN personnel manager ON manager.id = p.manager_personnel_id
      WHERE p.id = ?
      LIMIT 1`,
    [personnelId]
  )
  return rows[0] ? buildPersonnelPayload(rows[0]) : null
}

const findPersonnelByIdentity = async (pool, { email = '', phone = '' } = {}) => {
  const normalizedEmail = normalizeEmailIdentity(email)
  const normalizedPhone = normalizePhoneIdentity(phone)

  if (normalizedEmail) {
    const [rows] = await pool.query(
      `SELECT
          p.id,
          p.full_name AS fullName,
          p.department,
          p.team,
          p.title,
          p.email,
          p.phone,
          p.manager_personnel_id AS managerPersonnelId,
          p.status,
          p.remark,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          manager.full_name AS managerName
        FROM personnel p
        LEFT JOIN personnel manager ON manager.id = p.manager_personnel_id
        WHERE LOWER(p.email) = ?
        ORDER BY p.id ASC
        LIMIT 1`,
      [normalizedEmail]
    )
    if (rows[0]) return buildPersonnelPayload(rows[0])
  }

  if (normalizedPhone) {
    const [rows] = await pool.query(
      `SELECT
          p.id,
          p.full_name AS fullName,
          p.department,
          p.team,
          p.title,
          p.email,
          p.phone,
          p.manager_personnel_id AS managerPersonnelId,
          p.status,
          p.remark,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          manager.full_name AS managerName
        FROM personnel p
        LEFT JOIN personnel manager ON manager.id = p.manager_personnel_id
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(p.phone, ' ', ''), '-', ''), '(', ''), ')', '') = ?
        ORDER BY p.id ASC
        LIMIT 1`,
      [normalizedPhone]
    )
    if (rows[0]) return buildPersonnelPayload(rows[0])
  }

  return null
}

const createOrUpdatePersonnelForProject = async (pool, payload, { requireIdentity = false } = {}) => {
  const existing = payload.personnelId
    ? await getPersonnelById(pool, payload.personnelId)
    : await findPersonnelByIdentity(pool, { email: payload.email, phone: payload.phone })

  if (payload.personnelId && !existing) {
    throw new HttpError(404, 'Personnel not found')
  }

  const fullName = payload.fullName || existing?.fullName || ''
  const email = payload.email || existing?.email || ''
  const phone = payload.phone || existing?.phone || ''

  if (!fullName) throw new HttpError(400, 'fullName is required')
  if (requireIdentity && !email && !phone) {
    throw new HttpError(400, 'email or phone is required')
  }

  const nextPayload = {
    fullName,
    department: payload.department || existing?.department || '',
    team: payload.team || existing?.team || '',
    title: payload.title || existing?.title || '',
    email,
    phone,
    managerPersonnelId: payload.managerPersonnelId || existing?.managerPersonnelId || null,
    status: existing?.status || 'active',
    remark: existing?.remark || '',
  }

  await ensurePersonnelManagerIsValid(pool, existing?.id || null, nextPayload.managerPersonnelId)

  if (existing?.id) {
    await pool.query(
      `UPDATE personnel
        SET full_name = ?, department = ?, team = ?, title = ?, email = ?, phone = ?,
            manager_personnel_id = ?, status = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        nextPayload.fullName,
        nextPayload.department || null,
        nextPayload.team || null,
        nextPayload.title || null,
        nextPayload.email || null,
        nextPayload.phone || null,
        nextPayload.managerPersonnelId,
        nextPayload.status,
        nextPayload.remark || null,
        existing.id,
      ]
    )
    return getPersonnelById(pool, existing.id)
  }

  const [result] = await pool.query(
    `INSERT INTO personnel
      (full_name, department, team, title, email, phone, manager_personnel_id, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      nextPayload.fullName,
      nextPayload.department || null,
      nextPayload.team || null,
      nextPayload.title || null,
      nextPayload.email || null,
      nextPayload.phone || null,
      nextPayload.managerPersonnelId,
      nextPayload.remark || null,
    ]
  )

  return getPersonnelById(pool, Number(result.insertId))
}

const listProjectRows = async (pool) => {
  const [rows] = await pool.query(
    `SELECT
        p.id,
        p.project_name AS projectName,
        p.status,
        p.owner_personnel_id AS ownerPersonnelId,
        owner.full_name AS ownerName,
        DATE_FORMAT(p.start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(p.end_date, '%Y-%m-%d') AS endDate,
        p.remark,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        COALESCE(counts.assignmentCount, 0) AS assignmentCount,
        COALESCE(counts.activeAssignmentCount, 0) AS activeAssignmentCount
      FROM projects p
      LEFT JOIN personnel owner ON owner.id = p.owner_personnel_id
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) AS assignmentCount,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeAssignmentCount
        FROM project_personnel_assignments
        GROUP BY project_id
      ) counts ON counts.project_id = p.id
      ORDER BY p.updated_at DESC, p.id DESC`
  )
  return rows.map((row) => buildProjectPayload(row))
}

const getProjectById = async (pool, projectId) => {
  const [rows] = await pool.query(
    `SELECT
        p.id,
        p.project_name AS projectName,
        p.status,
        p.owner_personnel_id AS ownerPersonnelId,
        owner.full_name AS ownerName,
        DATE_FORMAT(p.start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(p.end_date, '%Y-%m-%d') AS endDate,
        p.remark,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        COALESCE(counts.assignmentCount, 0) AS assignmentCount,
        COALESCE(counts.activeAssignmentCount, 0) AS activeAssignmentCount
      FROM projects p
      LEFT JOIN personnel owner ON owner.id = p.owner_personnel_id
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) AS assignmentCount,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeAssignmentCount
        FROM project_personnel_assignments
        GROUP BY project_id
      ) counts ON counts.project_id = p.id
      WHERE p.id = ?
      LIMIT 1`,
    [projectId]
  )
  return rows[0] ? buildProjectPayload(rows[0]) : null
}

const listProjectAssignments = async (pool, projectId) => {
  const [rows] = await pool.query(
    `SELECT
        a.id,
        a.project_id AS projectId,
        project.project_name AS projectName,
        a.personnel_id AS personnelId,
        personnel.full_name AS fullName,
        personnel.department,
        personnel.team,
        personnel.title,
        personnel.email,
        personnel.phone,
        personnel.manager_personnel_id AS managerPersonnelId,
        manager.full_name AS managerName,
        a.project_role AS projectRole,
        DATE_FORMAT(a.start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(a.end_date, '%Y-%m-%d') AS endDate,
        a.source,
        a.status,
        a.remark,
        a.created_at AS createdAt,
        a.updated_at AS updatedAt
      FROM project_personnel_assignments a
      INNER JOIN projects project ON project.id = a.project_id
      INNER JOIN personnel personnel ON personnel.id = a.personnel_id
      LEFT JOIN personnel manager ON manager.id = personnel.manager_personnel_id
      WHERE a.project_id = ?
      ORDER BY FIELD(a.status, 'active', 'transferred', 'removed'), a.updated_at DESC, a.id DESC`,
    [projectId]
  )
  return rows.map((row) => buildProjectAssignmentPayload(row))
}

const getProjectAssignmentById = async (pool, assignmentId) => {
  const [rows] = await pool.query(
    `SELECT
        a.id,
        a.project_id AS projectId,
        project.project_name AS projectName,
        a.personnel_id AS personnelId,
        personnel.full_name AS fullName,
        personnel.department,
        personnel.team,
        personnel.title,
        personnel.email,
        personnel.phone,
        personnel.manager_personnel_id AS managerPersonnelId,
        manager.full_name AS managerName,
        a.project_role AS projectRole,
        DATE_FORMAT(a.start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(a.end_date, '%Y-%m-%d') AS endDate,
        a.source,
        a.status,
        a.remark,
        a.created_at AS createdAt,
        a.updated_at AS updatedAt
      FROM project_personnel_assignments a
      INNER JOIN projects project ON project.id = a.project_id
      INNER JOIN personnel personnel ON personnel.id = a.personnel_id
      LEFT JOIN personnel manager ON manager.id = personnel.manager_personnel_id
      WHERE a.id = ?
      LIMIT 1`,
    [assignmentId]
  )
  return rows[0] ? buildProjectAssignmentPayload(rows[0]) : null
}

const insertProjectMovement = async (pool, {
  assignmentId = null,
  personnelId,
  fromProjectId = null,
  toProjectId = null,
  movementType,
  movementDate = null,
  projectRole = '',
  source = 'manual',
  remark = '',
} = {}) => {
  await pool.query(
    `INSERT INTO project_personnel_movements
      (assignment_id, personnel_id, from_project_id, to_project_id, movement_type, movement_date, project_role, source, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assignmentId || null,
      personnelId,
      fromProjectId || null,
      toProjectId || null,
      normalizeText(movementType),
      movementDate || getTodayDateText(),
      normalizeText(projectRole) || null,
      normalizeAssignmentSource(source),
      normalizeRemark(remark) || null,
    ]
  )
}

const upsertProjectAssignment = async (
  pool,
  projectId,
  personnelId,
  payload,
  movementType = 'joined',
  { recordMovement = true } = {}
) => {
  assertDateRange(payload.startDate, payload.endDate, 'assignment')

  const [existingRows] = await pool.query(
    'SELECT id FROM project_personnel_assignments WHERE project_id = ? AND personnel_id = ? LIMIT 1',
    [projectId, personnelId]
  )
  const existingId = existingRows[0]?.id ? Number(existingRows[0].id) : null
  const status = normalizeAssignmentStatus(payload.status, 'active')

  if (existingId) {
    await pool.query(
      `UPDATE project_personnel_assignments
        SET project_role = ?, start_date = ?, end_date = ?, source = ?, status = ?, remark = ?,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.projectRole || null,
        payload.startDate,
        payload.endDate,
        payload.source,
        status,
        payload.remark || null,
        existingId,
      ]
    )
    const assignment = await getProjectAssignmentById(pool, existingId)
    if (recordMovement) {
      await insertProjectMovement(pool, {
        assignmentId: existingId,
        personnelId,
        toProjectId: projectId,
        movementType: movementType === 'joined' ? 'updated' : movementType,
        movementDate: payload.startDate,
        projectRole: payload.projectRole,
        source: payload.source,
        remark: payload.remark,
      })
    }
    return { assignment, action: 'updated' }
  }

  const [result] = await pool.query(
    `INSERT INTO project_personnel_assignments
      (project_id, personnel_id, project_role, start_date, end_date, source, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      personnelId,
      payload.projectRole || null,
      payload.startDate,
      payload.endDate,
      payload.source,
      status,
      payload.remark || null,
    ]
  )
  const assignmentId = Number(result.insertId)
  const assignment = await getProjectAssignmentById(pool, assignmentId)
  if (recordMovement) {
    await insertProjectMovement(pool, {
      assignmentId,
      personnelId,
      toProjectId: projectId,
      movementType,
      movementDate: payload.startDate,
      projectRole: payload.projectRole,
      source: payload.source,
      remark: payload.remark,
    })
  }
  return { assignment, action: 'created' }
}

const parseCsvRows = (csvText) => {
  const text = String(csvText || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(cell)
      if (row.some((value) => normalizeText(value))) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((value) => normalizeText(value))) rows.push(row)
  return rows
}

const normalizeCsvHeader = (value) => normalizeText(value).toLowerCase().replace(/\s+/g, '')

const PROJECT_PERSONNEL_IMPORT_HEADERS = {
  姓名: 'fullName',
  name: 'fullName',
  fullname: 'fullName',
  full_name: 'fullName',
  部門: 'department',
  部门: 'department',
  department: 'department',
  組別: 'team',
  组别: 'team',
  team: 'team',
  職稱: 'title',
  职称: 'title',
  title: 'title',
  email: 'email',
  'e-mail': 'email',
  電話: 'phone',
  电话: 'phone',
  phone: 'phone',
  mobile: 'phone',
  主管: 'managerName',
  直屬主管: 'managerName',
  直属主管: 'managerName',
  manager: 'managerName',
  managername: 'managerName',
  項目角色: 'projectRole',
  项目角色: 'projectRole',
  角色: 'projectRole',
  projectrole: 'projectRole',
  role: 'projectRole',
  入組日期: 'startDate',
  入组日期: 'startDate',
  startdate: 'startDate',
  start_date: 'startDate',
  離組日期: 'endDate',
  离组日期: 'endDate',
  enddate: 'endDate',
  end_date: 'endDate',
  備註: 'remark',
  备注: 'remark',
  remark: 'remark',
  note: 'remark',
}

const listCandidateBlacklistRows = async (pool) => {
  const [rows] = await pool.query(
    `SELECT
        id,
        display_name AS displayName,
        phone,
        normalized_phone AS normalizedPhone,
        email,
        normalized_email AS normalizedEmail,
        reason,
        status,
        remark,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM candidate_blacklist
      ORDER BY updated_at DESC, id DESC`
  )
  return rows.map((row) => buildCandidateBlacklistPayload(row))
}

const ensureCandidateBlacklistUniqueness = async (pool, payload, excludeId = null) => {
  const rows = await listCandidateBlacklistRows(pool)
  const targetPhone = payload.normalizedPhone
  const targetEmail = payload.normalizedEmail

  const duplicate = rows.find((row) => {
    if (excludeId && Number(row.id) === Number(excludeId)) return false
    if (targetPhone && row.normalizedPhone === targetPhone) return true
    if (targetEmail && row.normalizedEmail === targetEmail) return true
    return false
  })

  if (duplicate) {
    throw new HttpError(400, 'Blacklist entry already exists with the same phone or email')
  }
}

const findCandidateBlacklistMatch = (entries, { phone = '', email = '' } = {}) => {
  const normalizedPhone = normalizePhoneIdentity(phone)
  const normalizedEmail = normalizeEmailIdentity(email)
  return entries.find((entry) => {
    if (entry.status !== 'active') return false
    if (normalizedPhone && entry.normalizedPhone && entry.normalizedPhone === normalizedPhone) return true
    if (normalizedEmail && entry.normalizedEmail && entry.normalizedEmail === normalizedEmail) return true
    return false
  }) || null
}

const buildCandidateBlacklistFlags = (match, identity = {}) => {
  const normalizedPhone = normalizePhoneIdentity(identity.phone)
  const normalizedEmail = normalizeEmailIdentity(identity.email)
  const matchedBy = match
    ? match.normalizedPhone && normalizedPhone && match.normalizedPhone === normalizedPhone
      ? 'phone'
      : match.normalizedEmail && normalizedEmail && match.normalizedEmail === normalizedEmail
        ? 'email'
        : ''
    : ''

  return {
    isBlacklisted: !!match,
    blacklistReason: match ? match.reason : '',
    blacklistMatchedBy: matchedBy,
    blacklistEntryId: match ? Number(match.id) : null,
  }
}

const findCandidateByIdentity = async (pool, { email = '', phone = '' } = {}) => {
  const normalizedEmail = normalizeText(email).toLowerCase()
  const normalizedPhone = normalizeText(phone)
  if (normalizedEmail) {
    const [rows] = await pool.query(
      'SELECT id, full_name AS fullName, email, phone, created_at AS createdAt FROM candidates WHERE email = ? ORDER BY id ASC LIMIT 1',
      [normalizedEmail]
    )
    if (rows[0]) return rows[0]
  }

  if (normalizedPhone) {
    const [rows] = await pool.query(
      'SELECT id, full_name AS fullName, email, phone, created_at AS createdAt FROM candidates WHERE phone = ? ORDER BY id ASC LIMIT 1',
      [normalizedPhone]
    )
    if (rows[0]) return rows[0]
  }

  return null
}

const findOrCreateCandidateForApplication = async (pool, { fullName = '', email = '', phone = '' } = {}) => {
  const normalizedName = normalizeText(fullName) || 'x'
  const normalizedEmail = normalizeText(email).toLowerCase() || null
  const normalizedPhone = normalizeText(phone) || null
  const existing = await findCandidateByIdentity(pool, {
    email: normalizedEmail,
    phone: normalizedPhone,
  })

  if (!existing) {
    const [result] = await pool.query(
      'INSERT INTO candidates (full_name, email, phone) VALUES (?, ?, ?)',
      [normalizedName, normalizedEmail, normalizedPhone]
    )
    return {
      id: Number(result.insertId),
      fullName: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      createdAt: new Date(),
    }
  }

  const nextName = normalizedName || normalizeText(existing.fullName) || 'x'
  const nextEmail = normalizedEmail || normalizeText(existing.email).toLowerCase() || null
  const nextPhone = normalizedPhone || normalizeText(existing.phone) || null
  await pool.query(
    'UPDATE candidates SET full_name = ?, email = ?, phone = ? WHERE id = ?',
    [nextName, nextEmail, nextPhone, Number(existing.id)]
  )

  return {
    id: Number(existing.id),
    fullName: nextName,
    email: nextEmail,
    phone: nextPhone,
    createdAt: existing.createdAt,
  }
}

const createJobPostApplication = async (
  pool,
  jobPostId,
  candidateId,
  candidateCvId,
  match = null,
  { ownerUserId = null } = {}
) => {
  const normalizedOwnerUserId = Number(ownerUserId || 0) || null
  const [result] = await pool.query(
    `INSERT INTO job_post_applications
      (job_post_id, candidate_id, candidate_cv_id, application_status, owner_user_id, matched_score, matched_level, matched_position)
     VALUES (?, ?, ?, 'screening', ?, ?, ?, ?)`,
    [
      jobPostId,
      candidateId,
      candidateCvId,
      normalizedOwnerUserId,
      match ? Number(match.matchScore || 0) : null,
      match ? normalizeText(match.matchLevel) || null : null,
      match ? normalizeText(match.matchedPosition || match.jobTitle) || null : null,
    ]
  )
  const applicationId = Number(result.insertId)
  await syncJobPostApplicationStatusHistory(pool, applicationId, {
    applicationStatus: 'screening',
    firstInterviewArrangement: '',
    remark: '',
  }, { operatorUserId: normalizedOwnerUserId })
  return applicationId
}

const updateJobPostApplicationMatch = async (pool, applicationId, match = null) => {
  await pool.query(
    `UPDATE job_post_applications
      SET matched_score = ?, matched_level = ?, matched_position = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      match ? Number(match.matchScore || 0) : null,
      match ? normalizeText(match.matchLevel) || null : null,
      match ? normalizeText(match.matchedPosition || match.jobTitle) || null : null,
      applicationId,
    ]
  )
}

const getApplicationContextByCandidateCvId = async (pool, candidateCvId) => {
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.job_post_id AS jobPostId,
        jp.job_snapshot_json AS jobSnapshotJson
      FROM job_post_applications app
      INNER JOIN job_posts jp ON jp.id = app.job_post_id
      WHERE app.candidate_cv_id = ?
      LIMIT 1`,
    [candidateCvId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    applicationId: Number(row.applicationId),
    jobPostId: Number(row.jobPostId),
    jobSnapshot: parseJobSnapshot(row.jobSnapshotJson),
  }
}

const replaceCandidateCvJobMatches = async (pool, candidateId, candidateCvId, matches = []) => {
  await pool.query('DELETE FROM candidate_cv_job_matches WHERE candidate_cv_id = ?', [candidateCvId])
  if (!Array.isArray(matches) || !matches.length) return

  for (const [index, match] of matches.entries()) {
    await pool.query(
      `INSERT INTO candidate_cv_job_matches
        (candidate_id, candidate_cv_id, job_key, job_title, rank_no, match_score, match_level, reason_summary, strengths_json, gaps_json, raw_llm_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        candidateId,
        candidateCvId,
        normalizeText(match.jobKey),
        normalizeText(match.jobTitle),
        index + 1,
        Number(match.matchScore || 0),
        normalizeText(match.matchLevel) || 'medium',
        normalizeText(match.reasonSummary) || null,
        stringifyJson(normalizeList(match.strengths, 10)),
        stringifyJson(normalizeList(match.gaps, 10)),
        stringifyJson(match),
      ]
    )
  }
}

const normalizeMatchDimensionEvaluations = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      dimensionKey: normalizeText(item.dimensionKey),
      dimensionLabel: normalizeText(item.dimensionLabel),
      weight: Number(item.weight || 0),
      level: normalizeText(item.level),
      levelScore: Number(item.levelScore || 0),
      weightedScore: Number(item.weightedScore || 0),
      criteria: normalizeText(item.criteria),
      evidence: normalizeText(item.evidence),
      gap: normalizeText(item.gap),
    }))
    .filter((item) => item.dimensionKey)
}

const normalizeEmploymentGapReport = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const status = normalizeText(value.status)
  const summary = normalizeText(value.summary)
  const limitMonths = normalizeEmploymentGapLimitMonths(value.limitMonths)
  const thresholdValue = Number(value.gapThresholdMonths)
  const gapThresholdMonths = Number.isFinite(thresholdValue) ? Math.max(0, Math.round(thresholdValue)) : null
  const monthsValue = Number(value.months)
  const months = Number.isFinite(monthsValue) ? Math.max(0, Math.round(monthsValue)) : null
  const gaps = Array.isArray(value.gaps)
    ? value.gaps
        .filter((gap) => gap && typeof gap === 'object' && !Array.isArray(gap))
        .map((gap) => ({
          startMonth: normalizeText(gap.startMonth),
          endMonth: normalizeText(gap.endMonth),
          months: Number.isFinite(Number(gap.months)) ? Math.max(0, Math.round(Number(gap.months))) : 0,
          durationLabel: normalizeText(gap.durationLabel),
          previousCompanyName: normalizeText(gap.previousCompanyName),
          previousProjectName: normalizeText(gap.previousProjectName),
          previousDurationText: normalizeText(gap.previousDurationText),
          nextCompanyName: normalizeText(gap.nextCompanyName),
          nextProjectName: normalizeText(gap.nextProjectName),
          nextDurationText: normalizeText(gap.nextDurationText),
          exceeded: Boolean(gap.exceeded),
          note: normalizeText(gap.note),
        }))
        .filter((gap) => gap.startMonth || gap.endMonth || gap.months > 0)
    : []
  const normalized = {
    status: ['exceeded', 'within_limit', 'unknown', 'insufficient_experience', 'no_gap'].includes(status) ? status : '',
    exceeded: Boolean(value.exceeded),
    months,
    limitMonths,
    gapThresholdMonths,
    lookbackStartMonth: normalizeText(value.lookbackStartMonth),
    latestEmploymentEnd: normalizeText(value.latestEmploymentEnd),
    currentSystemMonth: normalizeText(value.currentSystemMonth),
    durationLabel: normalizeText(value.durationLabel),
    gaps,
    summary,
  }
  return normalized.summary || normalized.status || normalized.months !== null || normalized.gaps.length ? normalized : null
}

const listCandidateCvJobMatches = async (pool, candidateCvId) => {
  const [extractionRows] = await pool.query(
    'SELECT extracted_text AS extractedText FROM candidate_cv_extractions WHERE candidate_cv_id = ? LIMIT 1',
    [candidateCvId]
  )
  const extractedPayload = parseJsonObject(extractionRows[0]?.extractedText) || {}
  const extracted = extractedPayload.extracted && typeof extractedPayload.extracted === 'object'
    ? extractedPayload.extracted
    : null

  const [rows] = await pool.query(
    `SELECT
        job_key AS jobKey,
        job_title AS jobTitle,
        rank_no AS rankNo,
        match_score AS matchScore,
        match_level AS matchLevel,
        reason_summary AS reasonSummary,
        strengths_json AS strengthsJson,
        gaps_json AS gapsJson,
        raw_llm_json AS rawLlmJson,
        created_at AS createdAt
      FROM candidate_cv_job_matches
      WHERE candidate_cv_id = ?
      ORDER BY rank_no ASC, id ASC`,
    [candidateCvId]
  )

  return rows.map((row) => {
    const rawLlm = parseJsonObject(row.rawLlmJson) || {}
    const currentJobEntry = findCurrentDictionaryJobEntry({
      jobKey: row.jobKey,
      jobTitle: row.jobTitle,
      matchedPosition: rawLlm.matchedPosition,
    })
    if (extracted && currentJobEntry) {
      const [jobKey, dictionaryJob] = currentJobEntry
      rawLlm.employmentGap = buildEmploymentGapReport(extracted, buildJobSnapshot(jobKey, dictionaryJob))
    }
    return {
      jobKey: normalizeText(row.jobKey),
      jobTitle: normalizeText(row.jobTitle),
      rankNo: Number(row.rankNo || 0),
      matchScore: Number(row.matchScore || 0),
      matchLevel: normalizeText(row.matchLevel) || 'medium',
      reasonSummary: normalizeText(row.reasonSummary),
      strengths: normalizeList(parseJsonObject(row.strengthsJson), 10),
      gaps: normalizeList(parseJsonObject(row.gapsJson), 10),
      employmentGap: normalizeEmploymentGapReport(rawLlm.employmentGap),
      dimensionEvaluations: normalizeMatchDimensionEvaluations(rawLlm.dimensionEvaluations),
      createdAt: row.createdAt,
    }
  })
}

const buildEmbeddedMatchReport = (match = null) => {
  if (!match || typeof match !== 'object') return null

  const jobKey = normalizeText(match.jobKey)
  const jobTitle = normalizeText(match.jobTitle || match.matchedPosition)
  const matchedPosition = normalizeText(match.matchedPosition || match.jobTitle)
  const reasonSummary = normalizeText(match.reasonSummary)
  const matchLevel = normalizeText(match.matchLevel).toLowerCase()
  const matchScore = Number(match.matchScore || 0)

  if (!jobKey && !jobTitle && !matchedPosition && !reasonSummary && !Number.isFinite(matchScore)) {
    return null
  }

  return {
    jobKey,
    jobTitle,
    matchedPosition,
    matchScore: Number.isFinite(matchScore) ? matchScore : 0,
    matchLevel: matchLevel === 'high' || matchLevel === 'medium' || matchLevel === 'low' ? matchLevel : '',
    reasonSummary,
    strengths: normalizeList(match.strengths, 10),
    gaps: normalizeList(match.gaps, 10),
    employmentGap: normalizeEmploymentGapReport(match.employmentGap),
    dimensionEvaluations: normalizeMatchDimensionEvaluations(match.dimensionEvaluations),
  }
}

const attachMatchReportToExtractedPayload = (payload = {}, match = null) => {
  const nextPayload = payload && typeof payload === 'object' ? { ...payload } : {}
  const matchReport = buildEmbeddedMatchReport(match)
  if (matchReport) nextPayload.matchReport = matchReport
  else delete nextPayload.matchReport
  return nextPayload
}

const runCandidateCvMatching = async (pool, candidateId, candidateCvId, extracted) => {
  const matches = await matchCandidateToJobs(extracted, getJobDictionary())
  await replaceCandidateCvJobMatches(pool, candidateId, candidateCvId, matches)
  return matches
}

const runJobPostApplicationMatching = async (pool, { applicationId = null, candidateId, candidateCvId, extracted, jobSnapshot }) => {
  const match = await matchCandidateToJobPost(extracted, resolveCurrentJobSnapshot(jobSnapshot))
  const matches = match ? [{ ...match, rankNo: 1 }] : []
  await replaceCandidateCvJobMatches(pool, candidateId, candidateCvId, matches)
  if (applicationId) {
    await updateJobPostApplicationMatch(pool, applicationId, match)
  }
  return match
}

const computeMissingFields = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}
  const durationLabels = buildProjectExperienceDurationLabels(profile.projectExperiences)

  const isMissingValue = (value) => {
    if (Array.isArray(value)) return value.length === 0
    return !normalizeText(value)
  }

  const requiredFieldDefs = [
    { key: 'fullName', value: extracted?.fullName },
    { key: 'email', value: extracted?.email },
    { key: 'phone', value: extracted?.phone },
    { key: 'education', value: profile.education },
    { key: 'workYears', value: profile.workYears },
    { key: 'companyExperienceDuration', value: durationLabels.companyExperienceDuration || profile.companyExperienceDuration },
    { key: 'internshipExperienceDuration', value: durationLabels.internshipExperienceDuration || profile.internshipExperienceDuration },
    { key: 'projectExperienceDuration', value: durationLabels.projectExperienceDuration || profile.projectExperienceDuration },
    { key: 'languages', value: profile.languages },
    { key: 'technicalLanguages', value: profile.technicalLanguages },
    { key: 'technicalCertificates', value: profile.technicalCertificates },
    { key: 'industry', value: profile.industry },
    {
      key: 'projectExperiences',
      value: hasProjectExperiences(profile.projectExperiences, profile.projectExperience),
    },
    { key: 'targetPosition', value: profile.targetPosition },
    { key: 'expectedSalary', value: profile.expectedSalary },
    { key: 'onboardingPreference', value: profile.onboardingPreference },
  ]

  return requiredFieldDefs
    .filter((field) => isMissingValue(field.value))
    .map((field) => field.key)
}

const applyProjectExperienceDurationFields = (extracted = {}) => {
  const root = extracted && typeof extracted === 'object' ? extracted : {}
  root.profile = root.profile && typeof root.profile === 'object' ? root.profile : {}
  const existingProjectExperiences = normalizeProjectExperiences(root.profile.projectExperiences)
  if (!existingProjectExperiences.length) {
    const legacyGroups = []
    const appendLegacyItems = (items, groupType) => {
      const groupMap = new Map()
      for (const item of normalizeExperienceItems(items)) {
        const companyName = normalizeText(item.companyName)
        if (!companyName) continue
        const key = `${groupType}:${companyName}`
        const group = groupMap.get(key) || {
          groupType,
          companyName,
          projects: [],
        }
        group.projects.push({
          projectName: normalizeText(item.roleTitle) || companyName,
          skills: [],
          durationText: normalizeText(item.durationText),
        })
        groupMap.set(key, group)
      }
      legacyGroups.push(...groupMap.values())
    }
    appendLegacyItems(root.profile.workExperiences, 'company')
    appendLegacyItems(root.profile.internshipExperiences, 'internship')
    root.profile.projectExperiences = normalizeProjectExperiences(legacyGroups)
  } else {
    root.profile.projectExperiences = existingProjectExperiences
  }
  const durationLabels = buildProjectExperienceDurationLabels(root.profile.projectExperiences)
  root.profile.companyExperienceDuration = durationLabels.companyExperienceDuration
  root.profile.internshipExperienceDuration = durationLabels.internshipExperienceDuration
  root.profile.projectExperienceDuration = durationLabels.projectExperienceDuration
  if (!normalizeText(root.profile.workYears) && durationLabels.companyExperienceDuration) {
    root.profile.workYears = durationLabels.companyExperienceDuration
  }
  delete root.profile.workExperiences
  delete root.profile.internshipExperiences
  return root
}

const applyExtractedFieldUpdate = (extracted, fieldKey, inputValue) => {
  const root = extracted && typeof extracted === 'object' ? extracted : {}
  root.profile = root.profile && typeof root.profile === 'object' ? root.profile : {}

  const map = {
    fullName: { kind: 'text', target: 'root', required: true },
    email: { kind: 'text', target: 'root', lower: true },
    phone: { kind: 'text', target: 'root' },
    education: { kind: 'text', target: 'profile' },
    workYears: { kind: 'text', target: 'profile' },
    companyExperienceDuration: { kind: 'computed', target: 'profile' },
    internshipExperienceDuration: { kind: 'computed', target: 'profile' },
    projectExperienceDuration: { kind: 'computed', target: 'profile' },
    languages: { kind: 'list', target: 'profile', limit: 20 },
    technicalLanguages: { kind: 'list', target: 'profile', limit: 30 },
    technicalCertificates: { kind: 'list', target: 'profile', limit: 20 },
    industry: { kind: 'text', target: 'profile' },
    projectExperiences: { kind: 'project-experiences', target: 'profile' },
    targetPosition: { kind: 'list', target: 'profile', limit: 10 },
    expectedSalary: { kind: 'text', target: 'profile' },
    onboardingPreference: { kind: 'text', target: 'profile' },
  }

  const config = map[fieldKey]
  if (!config) return { error: 'fieldKey is not editable' }
  if (config.kind === 'computed') return { error: `${fieldKey} is calculated by rules and is not editable` }

  if (config.kind === 'list') {
    const list = normalizeList(inputValue, config.limit || 20)
    if (config.target === 'profile') root.profile[fieldKey] = list
    else root[fieldKey] = list
    return { extracted: applyProjectExperienceDurationFields(root) }
  }

  if (config.kind === 'project-experiences') {
    const groups = normalizeProjectExperiences(inputValue)
    if (config.target === 'profile') {
      root.profile[fieldKey] = groups
      delete root.profile.projectExperience
    } else {
      root[fieldKey] = groups
      delete root.projectExperience
    }
    return { extracted: applyProjectExperienceDurationFields(root) }
  }

  let text = normalizeText(inputValue)
  if (config.lower) text = text.toLowerCase()
  if (config.required && !text) return { error: `${fieldKey} cannot be empty` }

  if (config.target === 'profile') root.profile[fieldKey] = text
  else root[fieldKey] = text

  return { extracted: applyProjectExperienceDurationFields(root) }
}

const applyEditedExtractedPayload = (baseExtracted, editedExtracted) => {
  if (!editedExtracted || typeof editedExtracted !== 'object') {
    return { extracted: baseExtracted && typeof baseExtracted === 'object' ? baseExtracted : {} }
  }

  const root = baseExtracted && typeof baseExtracted === 'object'
    ? JSON.parse(JSON.stringify(baseExtracted))
    : {}
  const sourceProfile = editedExtracted.profile && typeof editedExtracted.profile === 'object'
    ? editedExtracted.profile
    : {}
  const fieldUpdates = [
    ['fullName', editedExtracted.fullName],
    ['email', editedExtracted.email],
    ['phone', editedExtracted.phone],
    ['education', sourceProfile.education],
    ['workYears', sourceProfile.workYears],
    ['languages', sourceProfile.languages],
    ['technicalLanguages', sourceProfile.technicalLanguages],
    ['technicalCertificates', sourceProfile.technicalCertificates],
    ['industry', sourceProfile.industry],
    ['projectExperiences', sourceProfile.projectExperiences],
    ['targetPosition', sourceProfile.targetPosition],
    ['expectedSalary', sourceProfile.expectedSalary],
    ['onboardingPreference', sourceProfile.onboardingPreference],
  ]

  let next = root
  for (const [fieldKey, inputValue] of fieldUpdates) {
    if (inputValue === undefined) continue
    const result = applyExtractedFieldUpdate(next, fieldKey, inputValue)
    if (result.error) return { error: `Invalid editedExtracted.${fieldKey}: ${result.error}` }
    next = result.extracted
  }

  return { extracted: applyProjectExperienceDurationFields(next) }
}

const insertCandidateCvExtraction = async (
  pool,
  candidateId,
  candidateCvId,
  { targetPosition = '', cvText = '', extractedText = '' } = {}
) => {
  await pool.query(
    `INSERT INTO candidate_cv_extractions
      (candidate_id, candidate_cv_id, target_position, cv_text, extracted_text)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      target_position = VALUES(target_position),
      cv_text = VALUES(cv_text),
      extracted_text = VALUES(extracted_text)`,
    [candidateId, candidateCvId, targetPosition || null, cvText || null, extractedText || null]
  )
}

const cacheCvUpload = async (pool, req, res, jobPostId = null) => {
  if (jobPostId) {
    const jobPost = await getJobPostById(pool, jobPostId)
    if (!jobPost) {
      sendJson(res, 404, { message: 'Job post not found' })
      return
    }
  }

  const body = await parseBody(req)
  const fileName = body?.fileName
  const contentBase64 = body?.contentBase64
  const mimeType = body?.mimeType || 'application/octet-stream'
  const source = resolveCvSource(body?.source, fileName)

  if (!fileName || !contentBase64) {
    sendJson(res, 400, { message: 'fileName and contentBase64 are required' })
    return
  }

  const buffer = Buffer.from(contentBase64, 'base64')
  if (!buffer.length) {
    sendJson(res, 400, { message: 'Invalid file content' })
    return
  }

  const cached = putCvIntoCache({ fileName, mimeType, buffer })
  sendJson(res, 201, {
    message: 'CV cached',
    cacheId: cached.cacheId,
    expiresAt: new Date(cached.expiresAt).toISOString(),
    fileName,
    mimeType,
    size: buffer.length,
  })
}

const parseCvFromCache = async (pool, req, res, jobPostId = null) => {
  if (jobPostId) {
    const jobPost = await getJobPostById(pool, jobPostId)
    if (!jobPost) {
      sendJson(res, 404, { message: 'Job post not found' })
      return
    }
  }

  const body = await parseBody(req)
  const cacheId = String(body?.cacheId || '').trim()
  if (!cacheId) {
    sendJson(res, 400, { message: 'cacheId is required, please cache file before parsing' })
    return
  }

  const cached = readCvFromCache(cacheId)
  if (!cached) {
    sendJson(res, 404, { message: 'Cached CV not found or expired, please upload again' })
    return
  }

  const parsed = await parseCachedCvExtraction(cached)
  const extraction = parsed?.extraction || {}
  const extracted = extraction?.extracted || {}

  sendJson(res, 200, {
    message: 'CV parsed',
    cacheId,
    fileName: cached.fileName,
    mimeType: cached.mimeType,
    source: detectCvSourceFromFileName(cached.fileName),
    extractedText: parsed?.extractedText || '',
    candidate: {
      fullName: extracted.fullName || '',
      email: extracted.email || '',
      phone: extracted.phone || '',
      extracted,
      missingFields: extraction.missingFields || [],
      llmJson: extraction.llmJson || null,
      parser: parsed?.parser || (extraction.llmJson ? 'llm' : 'regex'),
    },
  })
}


const intakeCv = async (pool, req, res, jobPostId = null) => {
  if (!jobPostId) {
    sendJson(res, 400, { message: 'jobPostId is required' })
    return
  }

  const jobPost = await getJobPostById(pool, jobPostId)
  if (!jobPost || !jobPost.jobSnapshot) {
    sendJson(res, 404, { message: 'Job post not found' })
    return
  }

  const body = await parseBody(req)
  const cacheId = String(body?.cacheId || '').trim()
  const editedExtractedInput = body?.editedExtracted
  if (!cacheId) {
    sendJson(res, 400, { message: 'cacheId is required, please cache file before intake' })
    return
  }

  const cached = readCvFromCache(cacheId)
  if (!cached) {
    sendJson(res, 404, { message: 'Cached CV not found or expired, please upload again' })
    return
  }

  // 最終入庫前重新從快取解析來源與結構化結果，確保 HR 編輯內容、來源與匹配快照一起提交。
  const { fileName, mimeType, buffer } = cached
  const source = resolveCvSource(body?.source, fileName)
  if (!source) {
    sendJson(res, 400, { message: 'source is required and must be BOSS, 智聯, or 內推' })
    return
  }
  const operatorUserId = await getRequestOperatorUserId(pool, req)
  const parsed = await parseCachedCvExtraction(cached)
  const extraction = parsed?.extraction || {}
  const cvText = parsed?.cvText || ''
  const parsedParser = parsed?.parser || (extraction.llmJson ? 'llm' : 'regex')
  const editedResult = applyEditedExtractedPayload(extraction?.extracted || {}, editedExtractedInput)
  if (editedResult.error) {
    sendJson(res, 400, { message: editedResult.error })
    return
  }

  const finalExtracted = editedResult.extracted || {}
  const finalMissingFields = computeMissingFields(finalExtracted)
  const parser = editedExtractedInput && typeof editedExtractedInput === 'object' ? 'manual' : parsedParser
  const derivedName = finalExtracted?.fullName || 'x'
  const derivedEmail = finalExtracted?.email || null
  const derivedPhone = finalExtracted?.phone || null
  const candidate = await findOrCreateCandidateForApplication(pool, {
    fullName: derivedName,
    email: derivedEmail,
    phone: derivedPhone,
  })
  const candidateId = Number(candidate.id)
  const cv = await insertCandidateCv(pool, candidateId, fileName, mimeType, buffer, {
    fullName: candidate.fullName || derivedName,
    createdAt: candidate.createdAt || new Date(),
    source,
  })
  const targetPosition = Array.isArray(finalExtracted?.profile?.targetPosition)
    ? finalExtracted.profile.targetPosition.join(', ')
    : ''
  const applicationId = await createJobPostApplication(pool, jobPostId, candidateId, cv.id, null, {
    ownerUserId: operatorUserId,
  })
  const match = await runJobPostApplicationMatching(pool, {
    applicationId,
    candidateId,
    candidateCvId: cv.id,
    extracted: finalExtracted,
    jobSnapshot: jobPost.jobSnapshot,
  })
  const extractedPayload = attachMatchReportToExtractedPayload(
    {
      extracted: finalExtracted,
      missingFields: finalMissingFields,
      parser,
      source,
    },
    match
  )
  const extractedText = JSON.stringify(extractedPayload, null, 2)
  await insertCandidateCvExtraction(pool, candidateId, cv.id, {
    targetPosition,
    cvText,
    extractedText,
  })

  sendJson(res, 201, {
    message: 'CV uploaded and parsed',
    jobPost: {
      id: jobPost.id,
      title: jobPost.title,
      jobKey: jobPost.jobKey,
      matchedPosition: normalizeText(jobPost.jobSnapshot?.title),
    },
    application: {
      id: applicationId,
      jobPostId: jobPost.id,
      applicationStatus: 'screening',
      remark: '',
      source,
      matchedScore: Number(match?.matchScore || 0),
      matchedLevel: normalizeText(match?.matchLevel),
      matchedPosition: normalizeText(match?.matchedPosition || match?.jobTitle),
    },
    candidate: {
      id: candidateId,
      fullName: candidate.fullName || derivedName,
      email: candidate.email || derivedEmail,
      phone: candidate.phone || derivedPhone,
      extracted: finalExtracted,
      missingFields: finalMissingFields,
      llmJson: extraction?.llmJson || null,
      parser,
      source,
    },
    cv,
    match,
  })
}

const uploadCandidateCv = async (pool, req, res, candidateId) => {
  const body = await parseBody(req)
  const fileName = body?.fileName
  const contentBase64 = body?.contentBase64
  const mimeType = body?.mimeType || 'application/octet-stream'

  if (!fileName || !contentBase64) {
    sendJson(res, 400, { message: 'fileName and contentBase64 are required' })
    return
  }

  const [candidateRows] = await pool.query(
    'SELECT id, full_name AS fullName, email, phone, created_at AS createdAt FROM candidates WHERE id = ? LIMIT 1',
    [candidateId]
  )
  if (!candidateRows.length) {
    sendJson(res, 404, { message: 'Candidate not found' })
    return
  }
  const candidate = candidateRows[0]

  const buffer = Buffer.from(contentBase64, 'base64')
  if (!buffer.length) {
    sendJson(res, 400, { message: 'Invalid file content' })
    return
  }

  const cv = await insertCandidateCv(pool, candidateId, fileName, mimeType, buffer, {
    fullName: candidate.fullName || '',
    createdAt: candidate.createdAt || '',
    source,
  })
  const cvText = await extractTextFromBuffer(buffer, fileName, mimeType)
  await insertCandidateCvExtraction(pool, candidateId, cv.id, {
    cvText,
    extractedText: '',
  })
  sendJson(res, 201, { message: 'CV uploaded', cv })
}

const intakeCandidateCvToJobPost = async (pool, req, res, candidateId, jobPostId) => {
  const candidate = await getCandidateById(pool, candidateId)
  if (!candidate) {
    sendJson(res, 404, { message: 'Candidate not found' })
    return
  }

  const jobPost = await getJobPostById(pool, jobPostId)
  if (!jobPost || !jobPost.jobSnapshot) {
    sendJson(res, 404, { message: 'Job post not found' })
    return
  }

  if (jobPost.status !== 'open') {
    sendJson(res, 400, { message: 'Job post is not open' })
    return
  }

  const body = await parseBody(req)
  const fileName = normalizeText(body?.fileName)
  const contentBase64 = body?.contentBase64
  const mimeType = normalizeText(body?.mimeType) || 'application/octet-stream'
  const source = resolveCvSource(body?.source, fileName)

  if (!fileName || !contentBase64) {
    sendJson(res, 400, { message: 'fileName and contentBase64 are required' })
    return
  }
  if (!source) {
    sendJson(res, 400, { message: 'source is required and must be BOSS, 智聯, or 內推' })
    return
  }

  const buffer = Buffer.from(contentBase64, 'base64')
  if (!buffer.length) {
    sendJson(res, 400, { message: 'Invalid file content' })
    return
  }

  const extraction = await extractCandidateInfoFromCv(buffer, fileName, mimeType)
  const finalExtracted = extraction?.extracted || {}
  const finalMissingFields = computeMissingFields(finalExtracted)
  const parser = extraction?.llmJson ? 'llm' : 'regex'
  const cvText = await extractTextFromBuffer(buffer, fileName, mimeType)

  const nextFullName = normalizeText(finalExtracted.fullName) || candidate.fullName || 'x'
  const nextEmail = normalizeEmailIdentity(finalExtracted.email) || candidate.email || null
  const nextPhone = normalizeText(finalExtracted.phone) || candidate.phone || null

  await pool.query(
    'UPDATE candidates SET full_name = ?, email = ?, phone = ? WHERE id = ?',
    [nextFullName, nextEmail, nextPhone, Number(candidateId)]
  )

  const cv = await insertCandidateCv(pool, Number(candidateId), fileName, mimeType, buffer, {
    fullName: nextFullName,
    createdAt: candidate.createdAt || new Date(),
    source,
  })

  const targetPosition = Array.isArray(finalExtracted?.profile?.targetPosition)
    ? finalExtracted.profile.targetPosition.join(', ')
    : ''
  const operatorUserId = await getRequestOperatorUserId(pool, req)
  const applicationId = await createJobPostApplication(pool, Number(jobPostId), Number(candidateId), cv.id, null, {
    ownerUserId: operatorUserId,
  })
  const match = await runJobPostApplicationMatching(pool, {
    applicationId,
    candidateId: Number(candidateId),
    candidateCvId: cv.id,
    extracted: finalExtracted,
    jobSnapshot: jobPost.jobSnapshot,
  })

  const extractedPayload = attachMatchReportToExtractedPayload(
    {
      extracted: finalExtracted,
      missingFields: finalMissingFields,
      parser,
      source,
    },
    match
  )
  const extractedText = JSON.stringify(extractedPayload, null, 2)

  await insertCandidateCvExtraction(pool, Number(candidateId), cv.id, {
    targetPosition,
    cvText,
    extractedText,
  })

  sendJson(res, 201, {
    message: 'Candidate CV uploaded and matched',
    jobPost: {
      id: jobPost.id,
      title: jobPost.title,
      jobKey: jobPost.jobKey,
      matchedPosition: normalizeText(jobPost.jobSnapshot?.title),
    },
    application: {
      id: applicationId,
      jobPostId: jobPost.id,
      applicationStatus: 'screening',
      remark: '',
      source,
      matchedScore: Number(match?.matchScore || 0),
      matchedLevel: normalizeText(match?.matchLevel),
      matchedPosition: normalizeText(match?.matchedPosition || match?.jobTitle),
    },
    candidate: {
      id: Number(candidateId),
      fullName: nextFullName,
      email: nextEmail,
      phone: nextPhone,
      extracted: finalExtracted,
      missingFields: finalMissingFields,
      llmJson: extraction?.llmJson || null,
      parser,
      source,
    },
    cv,
    match,
  })
}

const listCandidateCvs = async (pool, _req, res, candidateId) => {
  const [rows] = await pool.query(
    `SELECT id, candidate_id AS candidateId, version_no AS versionNo, original_filename AS originalFileName,
            mime_type AS mimeType, file_size AS fileSize, uploaded_at AS uploadedAt
     FROM candidate_cvs
     WHERE candidate_id = ?
     ORDER BY version_no DESC`,
    [candidateId]
  )
  sendJson(res, 200, { files: rows })
}

const listCandidateCvTable = async (pool, _req, res) => {
  const [rows] = await pool.query(
      `SELECT
        c.id AS candidateId,
        c.full_name AS fullName,
        c.phone AS phone,
        c.created_at AS createdAt,
        latest_cv.id AS cvId,
        latest_cv.original_filename AS cvFileName,
        latest_cv.storage_key AS storageKey,
        latest_cv.uploaded_at AS cvUploadedAt,
        COALESCE(extracts.target_position, '') AS targetPosition,
        COALESCE(top_match.job_title, '') AS matchedPosition,
        COALESCE(top_match.match_score, 0) AS matchedScore,
        CASE WHEN extracts.cv_text IS NOT NULL AND extracts.cv_text <> '' THEN 1 ELSE 0 END AS hasCvPreview,
        CASE WHEN extracts.extracted_text IS NOT NULL AND extracts.extracted_text <> '' THEN 1 ELSE 0 END AS hasExtractedPreview
      FROM candidates c
      LEFT JOIN candidate_cvs latest_cv ON latest_cv.id = (
        SELECT c2.id
        FROM candidate_cvs c2
        WHERE c2.candidate_id = c.id
        ORDER BY c2.version_no DESC
        LIMIT 1
      )
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = latest_cv.id
      LEFT JOIN candidate_cv_job_matches top_match ON top_match.id = (
        SELECT m.id
        FROM candidate_cv_job_matches m
        WHERE m.candidate_cv_id = latest_cv.id
        ORDER BY m.rank_no ASC, m.id ASC
        LIMIT 1
      )
      ORDER BY c.created_at DESC`
  )

  const tableRows = rows.map((row) => ({
    candidateId: Number(row.candidateId),
    fullName: row.fullName,
    targetPosition: row.targetPosition || '',
    matchedPosition: row.matchedPosition || '',
    matchedScore: Number(row.matchedScore || 0),
    phone: row.phone || '',
    cvId: row.cvId ? Number(row.cvId) : null,
    cvFileName: row.cvFileName || '',
    extractedFileName:
      Number(row.hasExtractedPreview || 0) === 1 && row.cvFileName
        ? `${row.cvFileName}.extracted.txt`
        : '',
    hasDownload: hasCandidateCvStoredFile(row.storageKey),
    hasCvPreview: Number(row.hasCvPreview || 0) === 1,
    hasExtractedPreview: Number(row.hasExtractedPreview || 0) === 1,
    createdAt: row.createdAt,
  }))

  sendJson(res, 200, { candidates: tableRows })
}

const listAllJobPostApplicationsTable = async (pool, _req, res) => {
  await runTemporalInterviewStatusRefresh(pool)
  const blacklistEntries = await listCandidateBlacklistRows(pool)
  const duplicateApplicationIds = await listDuplicateApplicationIds(pool)
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.application_status AS applicationStatus,
        app.first_interview_arrangement AS firstInterviewArrangement,
        app.interview_scheduled_at AS interviewScheduledAt,
        app.interview_duration_minutes AS interviewDurationMinutes,
        app.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        app.interview_location AS interviewLocation,
        app.interview_status AS interviewStatus,
        app.remark AS remark,
        app.matched_score AS matchedScore,
        app.matched_level AS matchedLevel,
        app.matched_position AS matchedPosition,
        app.owner_user_id AS ownerUserId,
        owner_user.email AS ownerEmail,
        owner_user.username AS ownerUsername,
        owner_user.avatar_text AS ownerAvatarText,
        owner_user.avatar_bg_color AS ownerAvatarBgColor,
        app.created_at AS createdAt,
        app.updated_at AS updatedAt,
        jp.id AS jobPostId,
        jp.title AS jobPostTitle,
        c.id AS candidateId,
        c.full_name AS fullName,
        c.email AS email,
        c.phone AS phone,
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
        cv.source AS source,
        cv.storage_key AS storageKey,
        COALESCE(extracts.target_position, '') AS targetPosition,
        CASE WHEN extracts.cv_text IS NOT NULL AND extracts.cv_text <> '' THEN 1 ELSE 0 END AS hasCvPreview,
        CASE WHEN extracts.extracted_text IS NOT NULL AND extracts.extracted_text <> '' THEN 1 ELSE 0 END AS hasExtractedPreview
      FROM job_post_applications app
      INNER JOIN job_posts jp ON jp.id = app.job_post_id
      INNER JOIN candidates c ON c.id = app.candidate_id
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      LEFT JOIN users owner_user ON owner_user.id = app.owner_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = app.interviewer_user_id
      ORDER BY app.created_at DESC, app.id DESC`
  )
  const statusHistories = await listJobPostApplicationStatusHistories(
    pool,
    rows.map((row) => row.applicationId)
  )

  sendJson(res, 200, {
    applications: rows.map((row) => {
      const applicationId = Number(row.applicationId)
      const match = findCandidateBlacklistMatch(blacklistEntries, {
        phone: row.phone,
        email: row.email,
      })

      return {
        applicationId,
        applicationStatus: normalizeApplicationStatus(row.applicationStatus),
        firstInterviewArrangement: normalizeFirstInterviewArrangement(row.firstInterviewArrangement),
        interview: buildInterviewPayload(row),
        remark: normalizeText(row.remark),
        matchedScore: Number(row.matchedScore || 0),
        matchedLevel: normalizeText(row.matchedLevel),
        matchedPosition: normalizeText(row.matchedPosition),
        source: normalizeCvSource(row.source),
        ownerUser: buildOwnerUserPayload(row),
        isDuplicateApplication: duplicateApplicationIds.has(applicationId),
        createdAt: row.createdAt,
        updatedAt: formatDateTimeForPayload(row.updatedAt || row.createdAt),
        jobPostId: Number(row.jobPostId),
        jobPostTitle: normalizeText(row.jobPostTitle),
        candidateId: Number(row.candidateId),
        fullName: normalizeText(row.fullName),
        email: normalizeEmailIdentity(row.email),
        phone: normalizeText(row.phone),
        cvId: Number(row.cvId),
        cvFileName: normalizeText(row.cvFileName),
        extractedFileName:
          Number(row.hasExtractedPreview || 0) === 1 && row.cvFileName
            ? `${row.cvFileName}.extracted.txt`
            : '',
        targetPosition: normalizeText(row.targetPosition),
        hasDownload: hasCandidateCvStoredFile(row.storageKey),
        hasCvPreview: Number(row.hasCvPreview || 0) === 1,
        hasExtractedPreview: Number(row.hasExtractedPreview || 0) === 1,
        statusHistory: statusHistories.get(applicationId) || [],
        ...buildCandidateBlacklistFlags(match, {
          phone: row.phone,
          email: row.email,
        }),
      }
    }),
  })
}

const parseScheduleMonth = (value) => {
  const text = normalizeText(value)
  const match = text.match(/^(\d{4})-(\d{2})$/)
  const now = new Date()
  const year = match ? Number(match[1]) : now.getFullYear()
  const monthIndex = match ? Number(match[2]) - 1 : now.getMonth()
  const start = new Date(year, monthIndex, 1, 0, 0, 0)
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0)
  const pad = (number) => String(number).padStart(2, '0')
  return {
    key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
    startSql: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01 00:00:00`,
    endSql: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-01 00:00:00`,
  }
}

const getInterviewDateKey = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const parseScheduleDate = (value) => {
  const text = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const date = new Date(`${text}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return text
}

const parseSqlDateTime = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000)

const toSqlDateTime = (date) => {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

const minutesBetween = (start, end) => Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))

const buildAvailabilityIntervalPayload = (start, end, extra = {}) => ({
  start: toSqlDateTime(start),
  end: toSqlDateTime(end),
  durationMinutes: minutesBetween(start, end),
  ...extra,
})

const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA

const getScheduleDayBounds = (dateKey) => {
  const dayStart = `${dateKey} 00:00:00`
  const nextDay = new Date(`${dateKey}T00:00:00`)
  nextDay.setDate(nextDay.getDate() + 1)
  return {
    dayStart,
    dayEnd: toSqlDateTime(nextDay),
    workdayStart: new Date(`${dateKey}T09:00:00`),
    workdayEnd: new Date(`${dateKey}T18:00:00`),
  }
}

const isInterviewApplicationStatus = (status) =>
  INTERVIEW_APPLICATION_STATUS_VALUES.has(normalizeApplicationStatus(status, ''))

const listInterviewerInterviewHistorySlots = async (pool, interviewerUserId, dateKey) => {
  const bounds = getScheduleDayBounds(dateKey)
  const [rows] = await pool.query(
    `SELECT
        history.id AS statusHistoryId,
        history.application_id AS applicationId,
        history.application_status AS applicationStatus,
        history.interview_scheduled_at AS interviewScheduledAt,
        history.interview_duration_minutes AS interviewDurationMinutes,
        history.interview_status AS interviewStatus,
        jp.title AS jobPostTitle,
        c.full_name AS fullName
      FROM job_post_application_status_history history
      INNER JOIN job_post_applications app ON app.id = history.application_id
      INNER JOIN job_posts jp ON jp.id = app.job_post_id
      INNER JOIN candidates c ON c.id = app.candidate_id
      WHERE history.interviewer_user_id = ?
        AND history.application_status IN ('hr_interview', 'department_interview')
        AND history.interview_scheduled_at IS NOT NULL
        AND history.interview_scheduled_at >= ?
        AND history.interview_scheduled_at < ?
      ORDER BY history.interview_scheduled_at ASC, history.id ASC`,
    [interviewerUserId, bounds.dayStart, bounds.dayEnd]
  )

  return rows
    .map((row) => {
      const start = parseSqlDateTime(row.interviewScheduledAt)
      if (!start) return null
      const minutes = normalizeInterviewDurationMinutes(row.interviewDurationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES)
      return {
        start,
        end: addMinutes(start, minutes),
        payload: {
          statusHistoryId: Number(row.statusHistoryId),
          applicationId: Number(row.applicationId),
          fullName: normalizeText(row.fullName),
          jobPostTitle: normalizeText(row.jobPostTitle),
          applicationStatus: normalizeApplicationStatus(row.applicationStatus),
          interviewStatus: normalizeInterviewStatus(row.interviewStatus),
        },
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

const validateInterviewScheduleAvailability = async (
  pool,
  { applicationStatus, interview = {}, excludeStatusHistoryId = 0 } = {}
) => {
  if (!isInterviewApplicationStatus(applicationStatus)) return

  const interviewerUserId = Number(interview?.interviewerUserId || 0) || null
  const start = parseSqlDateTime(interview?.scheduledAt)
  if (!interviewerUserId || !start) {
    throw new HttpError(400, '請提供面試官與面試時間')
  }

  const durationMinutes = normalizeInterviewDurationMinutes(interview?.durationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES)
  const end = addMinutes(start, durationMinutes)
  const currentMinute = new Date()
  currentMinute.setSeconds(0, 0)
  if (start < currentMinute) {
    throw new HttpError(400, '面試時間不可早於當前時間')
  }

  const dateKey = getInterviewDateKey(start)
  const { workdayStart, workdayEnd } = getScheduleDayBounds(dateKey)
  if (start < workdayStart || end > workdayEnd) {
    throw new HttpError(400, '面試時間必須在 09:00-18:00 內')
  }

  const booked = await listInterviewerInterviewHistorySlots(pool, interviewerUserId, dateKey)
  const conflict = booked.find((item) => {
    if (Number(item.payload.statusHistoryId || 0) === Number(excludeStatusHistoryId || 0)) return false
    return rangesOverlap(start, end, item.start, item.end)
  })

  if (conflict) {
    throw new HttpError(
      400,
      `面試官該時段已有面試：${conflict.payload.fullName || '候選人'} ${toSqlDateTime(conflict.start).slice(11, 16)}-${toSqlDateTime(conflict.end).slice(11, 16)}`
    )
  }
}

const hasInterviewScheduleChanged = (existing = {}, interview = {}) => {
  const existingScheduledAt = normalizeInterviewScheduledAt(existing.interviewScheduledAt, '') || ''
  const nextScheduledAt = normalizeInterviewScheduledAt(interview.scheduledAt, '') || ''
  const existingDuration = normalizeInterviewDurationMinutes(
    existing.interviewDurationMinutes,
    DEFAULT_INTERVIEW_DURATION_MINUTES
  )
  const nextDuration = normalizeInterviewDurationMinutes(interview.durationMinutes, DEFAULT_INTERVIEW_DURATION_MINUTES)
  const existingInterviewerId = Number(existing.interviewerUserId || 0) || 0
  const nextInterviewerId = Number(interview.interviewerUserId || 0) || 0

  return (
    existingScheduledAt !== nextScheduledAt ||
    existingDuration !== nextDuration ||
    existingInterviewerId !== nextInterviewerId
  )
}

const buildScheduleApplicationPayload = (row = {}, statusHistory = []) => ({
  rowId: row.statusHistoryId
    ? `history-${Number(row.statusHistoryId)}`
    : `application-${Number(row.applicationId)}`,
  statusHistoryId: Number(row.statusHistoryId || 0),
  applicationId: Number(row.applicationId),
  applicationStatus: normalizeApplicationStatus(row.applicationStatus),
  firstInterviewArrangement: normalizeFirstInterviewArrangement(row.firstInterviewArrangement),
  interview: buildInterviewPayload(row),
  remark: normalizeText(row.remark),
  ownerUser: buildOwnerUserPayload(row),
  createdAt: row.statusCreatedAt || row.createdAt,
  updatedAt: row.statusUpdatedAt || row.updatedAt,
  jobPostId: Number(row.jobPostId),
  jobPostTitle: normalizeText(row.jobPostTitle),
  candidateId: Number(row.candidateId),
  fullName: normalizeText(row.fullName),
  email: normalizeEmailIdentity(row.email),
  phone: normalizeText(row.phone),
  targetPosition: normalizeText(row.targetPosition),
  matchedPosition: normalizeText(row.matchedPosition),
  source: normalizeCvSource(row.source),
  statusHistory: Array.isArray(statusHistory) ? statusHistory : [],
})

const listScheduledInterviewHistoryApplicationRows = async (pool, { currentUserId = 0 } = {}) => {
  const userId = Number(currentUserId || 0)
  const userFilter = userId ? 'AND (app.owner_user_id = ? OR history.interviewer_user_id = ?)' : ''
  const params = userId ? [userId, userId] : []
  const [rows] = await pool.query(
    `SELECT
        history.id AS statusHistoryId,
        app.id AS applicationId,
        history.application_status AS applicationStatus,
        history.first_interview_arrangement AS firstInterviewArrangement,
        history.interview_scheduled_at AS interviewScheduledAt,
        history.interview_duration_minutes AS interviewDurationMinutes,
        history.interviewer_user_id AS interviewerUserId,
        interviewer_user.email AS interviewerEmail,
        interviewer_user.username AS interviewerUsername,
        interviewer_user.avatar_text AS interviewerAvatarText,
        interviewer_user.avatar_bg_color AS interviewerAvatarBgColor,
        history.interview_location AS interviewLocation,
        history.interview_status AS interviewStatus,
        history.remark AS remark,
        app.owner_user_id AS ownerUserId,
        owner_user.email AS ownerEmail,
        owner_user.username AS ownerUsername,
        owner_user.avatar_text AS ownerAvatarText,
        owner_user.avatar_bg_color AS ownerAvatarBgColor,
        app.created_at AS createdAt,
        app.updated_at AS updatedAt,
        history.created_at AS statusCreatedAt,
        history.updated_at AS statusUpdatedAt,
        jp.id AS jobPostId,
        jp.title AS jobPostTitle,
        c.id AS candidateId,
        c.full_name AS fullName,
        c.email AS email,
        c.phone AS phone,
        cv.source AS source,
        COALESCE(extracts.target_position, '') AS targetPosition,
        app.matched_position AS matchedPosition
      FROM job_post_application_status_history history
      INNER JOIN job_post_applications app ON app.id = history.application_id
      INNER JOIN job_posts jp ON jp.id = app.job_post_id
      INNER JOIN candidates c ON c.id = app.candidate_id
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      LEFT JOIN users owner_user ON owner_user.id = app.owner_user_id
      LEFT JOIN users interviewer_user ON interviewer_user.id = history.interviewer_user_id
      WHERE history.application_status IN ('hr_interview', 'department_interview')
        AND history.interview_scheduled_at IS NOT NULL
        ${userFilter}
      ORDER BY history.interview_scheduled_at ASC, history.id ASC`,
    params
  )
  return rows
}

const listScheduleInterviews = async (pool, req, res, url) => {
  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }
  await runTemporalInterviewStatusRefresh(pool)

  const requestedUserId = Number(url.searchParams.get('userId') || 0) || 0
  const currentUserId = Number(user.id)
  if (requestedUserId && requestedUserId !== currentUserId && !isAdminUser(user)) {
    sendJson(res, 403, { message: 'Only system administrators can view other users schedules' })
    return
  }
  const selectedUserId = requestedUserId || currentUserId
  const month = parseScheduleMonth(url.searchParams.get('month'))
  const rows = await listScheduledInterviewHistoryApplicationRows(pool, { currentUserId: selectedUserId })

  const statusHistories = await listJobPostApplicationStatusHistories(
    pool,
    rows.map((row) => row.applicationId)
  )
  const relatedApplications = rows.map((row) =>
    buildScheduleApplicationPayload(row, statusHistories.get(Number(row.applicationId)) || [])
  )
  const monthlyEvents = relatedApplications.filter((item) => {
    const scheduledAt = item.interview.scheduledAt
    return scheduledAt && scheduledAt >= month.startSql && scheduledAt < month.endSql
  })

  const tasksByDate = {}
  for (const item of monthlyEvents) {
    const dateKey = getInterviewDateKey(item.interview.scheduledAt)
    if (!dateKey) continue
    tasksByDate[dateKey] = [...(tasksByDate[dateKey] || []), item]
  }

  const scheduledApplications = relatedApplications.filter((item) => item.interview.scheduledAt)
  const stats = {
    total: relatedApplications.length,
    hrInterview: scheduledApplications.filter((item) => item.applicationStatus === 'hr_interview').length,
    hrNotStarted: scheduledApplications.filter(
      (item) => item.applicationStatus === 'hr_interview' && item.interview.status === 'not_started'
    ).length,
    hrInProgress: scheduledApplications.filter(
      (item) => item.applicationStatus === 'hr_interview' && item.interview.status === 'in_progress'
    ).length,
    hrEnded: scheduledApplications.filter(
      (item) => item.applicationStatus === 'hr_interview' && item.interview.status === 'ended'
    ).length,
    departmentInterview: scheduledApplications.filter((item) => item.applicationStatus === 'department_interview').length,
    departmentNotStarted: scheduledApplications.filter(
      (item) => item.applicationStatus === 'department_interview' && item.interview.status === 'not_started'
    ).length,
    departmentInProgress: scheduledApplications.filter(
      (item) => item.applicationStatus === 'department_interview' && item.interview.status === 'in_progress'
    ).length,
    departmentEnded: scheduledApplications.filter(
      (item) => item.applicationStatus === 'department_interview' && item.interview.status === 'ended'
    ).length,
    passed: scheduledApplications.filter((item) => item.interview.status === 'passed').length,
    failed: scheduledApplications.filter((item) => item.interview.status === 'failed').length,
  }

  sendJson(res, 200, {
    month: month.key,
    currentUser: buildUserPayload(user),
    selectedUserId,
    stats,
    relatedApplications,
    events: monthlyEvents,
    tasksByDate,
  })
}

const listArrangedInterviews = async (pool, req, res) => {
  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }
  await runTemporalInterviewStatusRefresh(pool)

  const rows = await listScheduledInterviewHistoryApplicationRows(pool)
  const getStatusHistoryCreatedTime = (row) => {
    const time = new Date(row?.statusUpdatedAt || row?.statusCreatedAt || row?.updatedAt || row?.createdAt || 0).getTime()
    return Number.isNaN(time) ? 0 : time
  }
  const latestRowsByCandidate = new Map()
  for (const row of rows) {
    const candidateId = Number(row.candidateId || 0)
    if (!candidateId) continue
    const current = latestRowsByCandidate.get(candidateId)
    const currentTime = current ? getStatusHistoryCreatedTime(current) : -1
    const nextTime = getStatusHistoryCreatedTime(row)
    if (
      !current ||
      nextTime > currentTime ||
      (nextTime === currentTime && Number(row.statusHistoryId || 0) > Number(current.statusHistoryId || 0))
    ) {
      latestRowsByCandidate.set(candidateId, row)
    }
  }
  const latestRows = [...latestRowsByCandidate.values()].sort((a, b) => {
    const aTime = new Date(a.interviewScheduledAt || a.statusUpdatedAt || a.statusCreatedAt || 0).getTime()
    const bTime = new Date(b.interviewScheduledAt || b.statusUpdatedAt || b.statusCreatedAt || 0).getTime()
    return aTime - bTime || Number(a.statusHistoryId || 0) - Number(b.statusHistoryId || 0)
  })

  const statusHistories = await listJobPostApplicationStatusHistories(
    pool,
    latestRows.map((row) => row.applicationId)
  )

  sendJson(res, 200, {
    interviews: latestRows.map((row) =>
      buildScheduleApplicationPayload(row, statusHistories.get(Number(row.applicationId)) || [])
    ),
  })
}

const updateTemporalInterviewHistoryStatuses = async (pool) => {
  const [rows] = await pool.query(
    `SELECT
        latest.id,
        latest.application_id AS applicationId,
        latest.interview_scheduled_at AS interviewScheduledAt,
        latest.interview_duration_minutes AS interviewDurationMinutes,
        latest.interview_status AS interviewStatus
      FROM job_post_applications app
      INNER JOIN job_post_application_status_history latest
        ON latest.id = (
          SELECT history.id
          FROM job_post_application_status_history history
          WHERE history.application_id = app.id
          ORDER BY history.updated_at DESC, history.id DESC
          LIMIT 1
        )
      WHERE latest.interview_scheduled_at IS NOT NULL
        AND (latest.interview_status IS NULL OR latest.interview_status NOT IN ('passed', 'failed'))`
  )

  const now = new Date()
  const groupedIds = new Map()
  const affectedApplicationIds = new Set()
  for (const row of rows) {
    const currentStatus = normalizeInterviewStatus(row.interviewStatus, '')
    const statusResult = resolveStoredInterviewStatus(currentStatus, row.interviewScheduledAt, row.interviewDurationMinutes, now)
    if (!statusResult.valid) continue
    const nextStatus = statusResult.status
    if (!nextStatus || nextStatus === currentStatus) continue
    groupedIds.set(nextStatus, [...(groupedIds.get(nextStatus) || []), Number(row.id)])
    const applicationId = Number(row.applicationId || 0)
    if (Number.isInteger(applicationId) && applicationId > 0) affectedApplicationIds.add(applicationId)
  }

  let updatedCount = 0
  const refreshUpdatedAt = formatDateTimeForPayload(new Date())
  for (const [status, ids] of groupedIds.entries()) {
    for (let index = 0; index < ids.length; index += 500) {
      const chunk = ids.slice(index, index + 500)
      const placeholders = chunk.map(() => '?').join(', ')
      const [result] = await pool.query(
        `UPDATE job_post_application_status_history
          SET interview_status = ?,
              updated_at = ?
         WHERE id IN (${placeholders})`,
        [status, refreshUpdatedAt, ...chunk]
      )
      updatedCount += Number(result?.affectedRows || 0)
    }
  }

  return { updatedCount, affectedApplicationIds: [...affectedApplicationIds] }
}

const listApplicationIdsWithLatestStatusHistoryMismatch = async (pool, applicationIds = []) => {
  const ids = [...new Set(applicationIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
  const params = []
  const applicationFilter = ids.length ? `AND app.id IN (${ids.map(() => '?').join(', ')})` : ''
  if (ids.length) params.push(...ids)

  const [rows] = await pool.query(
    `SELECT app.id AS applicationId
      FROM job_post_applications app
      INNER JOIN job_post_application_status_history latest
        ON latest.id = (
          SELECT history.id
          FROM job_post_application_status_history history
          WHERE history.application_id = app.id
          ORDER BY history.updated_at DESC, history.id DESC
          LIMIT 1
        )
      WHERE latest.interview_scheduled_at IS NOT NULL
        ${applicationFilter}
        AND (
          COALESCE(app.application_status, '') <> COALESCE(latest.application_status, '')
          OR COALESCE(app.first_interview_arrangement, '') <> COALESCE(latest.first_interview_arrangement, '')
          OR COALESCE(app.interview_status, '') <> COALESCE(latest.interview_status, '')
          OR COALESCE(app.interview_scheduled_at, '1000-01-01 00:00:00') <> COALESCE(latest.interview_scheduled_at, '1000-01-01 00:00:00')
          OR COALESCE(app.interview_duration_minutes, 0) <> COALESCE(latest.interview_duration_minutes, 0)
          OR COALESCE(app.interviewer_user_id, 0) <> COALESCE(latest.interviewer_user_id, 0)
          OR COALESCE(app.interview_location, '') <> COALESCE(latest.interview_location, '')
          OR COALESCE(app.remark, '') <> COALESCE(latest.remark, '')
        )`,
    params
  )
  return rows.map((row) => Number(row.applicationId || 0)).filter((id) => Number.isInteger(id) && id > 0)
}

const syncApplicationsFromLatestStatusHistories = async (pool, applicationIds = []) => {
  const ids = [...new Set(applicationIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
  let syncedCount = 0
  for (const applicationId of ids) {
    const latest = await syncApplicationFromLatestStatusHistory(pool, applicationId)
    if (latest) syncedCount += 1
  }
  return syncedCount
}

const refreshTemporalInterviewStatuses = async (pool) => {
  const { updatedCount: historyUpdated, affectedApplicationIds } = await updateTemporalInterviewHistoryStatuses(pool)
  const staleApplicationIds = await listApplicationIdsWithLatestStatusHistoryMismatch(pool)
  const applicationsSynced = await syncApplicationsFromLatestStatusHistories(pool, [
    ...affectedApplicationIds,
    ...staleApplicationIds,
  ])
  return { historyUpdated, applicationsSynced }
}

let temporalInterviewRefreshPromise = null
const runTemporalInterviewStatusRefresh = async (pool) => {
  if (temporalInterviewRefreshPromise) return temporalInterviewRefreshPromise
  temporalInterviewRefreshPromise = refreshTemporalInterviewStatuses(pool)
    .catch((error) => {
      console.error('Failed to refresh interview statuses:', error)
      return { historyUpdated: 0, applicationsSynced: 0, error }
    })
    .finally(() => {
      temporalInterviewRefreshPromise = null
    })
  return temporalInterviewRefreshPromise
}

const startInterviewStatusAutoCheck = (pool) => {
  if (INTERVIEW_STATUS_CHECK_INTERVAL_MS <= 0) return null

  const runCheck = async () => {
    await runTemporalInterviewStatusRefresh(pool)
  }

  runCheck()
  const timer = setInterval(runCheck, INTERVIEW_STATUS_CHECK_INTERVAL_MS)
  timer.unref?.()
  return timer
}

const updateJobPostApplicationInterviewStatus = async (pool, req, res, applicationId) => {
  const [rows] = await pool.query(
    `SELECT
        id,
        application_status AS applicationStatus,
        first_interview_arrangement AS firstInterviewArrangement,
        interview_scheduled_at AS interviewScheduledAt,
        interview_duration_minutes AS interviewDurationMinutes,
        interviewer_user_id AS interviewerUserId,
        interview_location AS interviewLocation,
        interview_status AS interviewStatus,
        remark
      FROM job_post_applications
      WHERE id = ?
      LIMIT 1`,
    [applicationId]
  )
  const existing = rows[0]
  if (!existing) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }

  const body = await parseBody(req)
  const statusHistoryId = Number(body?.statusHistoryId || 0) || 0
  if (statusHistoryId) {
    const [historyRows] = await pool.query(
      `SELECT
          id,
          application_id AS applicationId,
          application_status AS applicationStatus,
          first_interview_arrangement AS firstInterviewArrangement,
          interview_scheduled_at AS interviewScheduledAt,
          interview_duration_minutes AS interviewDurationMinutes,
          interviewer_user_id AS interviewerUserId,
          interview_location AS interviewLocation,
          interview_status AS interviewStatus,
          remark
        FROM job_post_application_status_history
        WHERE id = ? AND application_id = ?
        LIMIT 1`,
      [statusHistoryId, applicationId]
    )
    const history = historyRows[0]
    if (!history) {
      sendJson(res, 404, { message: 'Interview status history not found' })
      return
    }
    if (!history.interviewScheduledAt) {
      sendJson(res, 400, { message: 'Interview is not scheduled' })
      return
    }

    const requestedInterviewStatus = normalizeInterviewStatus(body?.status, '')
    if (!requestedInterviewStatus) {
      sendJson(res, 400, { message: 'Invalid interview status' })
      return
    }
    const statusResult = resolveStoredInterviewStatus(
      requestedInterviewStatus,
      history.interviewScheduledAt,
      history.interviewDurationMinutes
    )
    if (!statusResult.valid) {
      sendJson(res, 400, { message: statusResult.message || 'Invalid interview status' })
      return
    }
    const nextInterviewStatus = statusResult.status
    const hasRemark = body && Object.prototype.hasOwnProperty.call(body, 'remark')
    const nextRemark = hasRemark ? normalizeApplicationRemark(body.remark) : normalizeApplicationRemark(history.remark)
    const operatorUserId = await getRequestOperatorUserId(pool, req)
    const requestUpdatedAt = getRequestLocalDateTime(req)

    await pool.query(
      `UPDATE job_post_application_status_history
        SET interview_status = ?,
            remark = ?,
            operator_user_id = COALESCE(?, operator_user_id),
            updated_at = ?
       WHERE id = ? AND application_id = ?`,
      [nextInterviewStatus, nextRemark, operatorUserId, requestUpdatedAt, statusHistoryId, applicationId]
    )
    await syncApplicationFromLatestStatusHistory(pool, applicationId)

    sendJson(res, 200, {
      message: statusResult.message || 'Interview status updated',
      applicationId,
      statusHistoryId,
      remark: nextRemark,
      statusRule: {
        requestedStatus: statusResult.requestedStatus,
        appliedStatus: nextInterviewStatus,
        changed: statusResult.changed,
        message: statusResult.message,
      },
      interview: buildInterviewPayload({
        interviewScheduledAt: history.interviewScheduledAt,
        interviewDurationMinutes: history.interviewDurationMinutes,
        interviewerUserId: history.interviewerUserId,
        interviewLocation: history.interviewLocation,
        interviewStatus: nextInterviewStatus,
      }),
    })
    return
  }

  if (!existing.interviewScheduledAt) {
    sendJson(res, 400, { message: 'Interview is not scheduled' })
    return
  }

  const requestedInterviewStatus = normalizeInterviewStatus(body?.status, '')
  if (!requestedInterviewStatus) {
    sendJson(res, 400, { message: 'Invalid interview status' })
    return
  }
  const statusResult = resolveStoredInterviewStatus(
    requestedInterviewStatus,
    existing.interviewScheduledAt,
    existing.interviewDurationMinutes
  )
  if (!statusResult.valid) {
    sendJson(res, 400, { message: statusResult.message || 'Invalid interview status' })
    return
  }
  const nextInterviewStatus = statusResult.status
  const hasRemark = body && Object.prototype.hasOwnProperty.call(body, 'remark')
  const nextRemark = hasRemark ? normalizeApplicationRemark(body.remark) : normalizeApplicationRemark(existing.remark)
  const requestUpdatedAt = getRequestLocalDateTime(req)

  await pool.query(
    `UPDATE job_post_applications
      SET interview_status = ?,
          remark = ?,
          updated_at = ?
     WHERE id = ?`,
    [nextInterviewStatus, nextRemark, requestUpdatedAt, applicationId]
  )

  const operatorUserId = await getRequestOperatorUserId(pool, req)
  const nextInterview = {
    scheduledAt: existing.interviewScheduledAt,
    durationMinutes: existing.interviewDurationMinutes || DEFAULT_INTERVIEW_DURATION_MINUTES,
    interviewerUserId: existing.interviewerUserId || null,
    location: existing.interviewLocation || '',
    status: nextInterviewStatus,
  }
  await syncJobPostApplicationStatusHistory(
    pool,
    applicationId,
    {
      applicationStatus: existing.applicationStatus,
      firstInterviewArrangement: existing.firstInterviewArrangement,
      interview: nextInterview,
      remark: nextRemark,
    },
    { append: false, operatorUserId, updatedAtSql: requestUpdatedAt }
  )
  await syncApplicationFromLatestStatusHistory(pool, applicationId)

  sendJson(res, 200, {
    message: statusResult.message || 'Interview status updated',
    applicationId,
    remark: nextRemark,
    statusRule: {
      requestedStatus: statusResult.requestedStatus,
      appliedStatus: nextInterviewStatus,
      changed: statusResult.changed,
      message: statusResult.message,
    },
    interview: buildInterviewPayload({
      interviewScheduledAt: existing.interviewScheduledAt,
      interviewDurationMinutes: existing.interviewDurationMinutes,
      interviewerUserId: existing.interviewerUserId,
      interviewLocation: existing.interviewLocation,
      interviewStatus: nextInterviewStatus,
    }),
  })
}

const getInterviewerAvailability = async (pool, req, res, url) => {
  const user = await getAuthedUser(pool, req)
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized' })
    return
  }

  const interviewerUserId = Number(url.searchParams.get('interviewerUserId') || 0)
  const dateKey = parseScheduleDate(url.searchParams.get('date'))
  const durationMinutes = normalizeInterviewDurationMinutes(
    url.searchParams.get('durationMinutes'),
    DEFAULT_INTERVIEW_DURATION_MINUTES
  )
  const excludeStatusHistoryId = Number(url.searchParams.get('statusHistoryId') || 0) || 0

  if (!interviewerUserId || !dateKey) {
    sendJson(res, 400, { message: 'interviewerUserId and date are required' })
    return
  }

  const [userRows] = await pool.query('SELECT id, email, username, avatar_text AS avatarText, avatar_bg_color AS avatarBgColor FROM users WHERE id = ? LIMIT 1', [
    interviewerUserId,
  ])
  if (!userRows.length) {
    sendJson(res, 404, { message: 'Interviewer not found' })
    return
  }

  const { workdayStart, workdayEnd } = getScheduleDayBounds(dateKey)
  const booked = await listInterviewerInterviewHistorySlots(pool, interviewerUserId, dateKey)
  const blockingBooked = booked.filter(
    (item) => Number(item.payload.statusHistoryId || 0) !== excludeStatusHistoryId
  )

  const freeSlots = []
  let cursor = new Date(workdayStart)
  for (const item of blockingBooked) {
    const start = item.start < workdayStart ? workdayStart : item.start
    const end = item.end > workdayEnd ? workdayEnd : item.end
    if (start > cursor) {
      freeSlots.push(buildAvailabilityIntervalPayload(cursor, start, {
        canFitDuration: minutesBetween(cursor, start) >= durationMinutes,
      }))
    }
    if (end > cursor) cursor = new Date(end)
  }
  if (cursor < workdayEnd) {
    freeSlots.push(buildAvailabilityIntervalPayload(cursor, workdayEnd, {
      canFitDuration: minutesBetween(cursor, workdayEnd) >= durationMinutes,
    }))
  }

  sendJson(res, 200, {
    date: dateKey,
    interviewerUser: buildUserPayload(userRows[0]),
    durationMinutes,
    workday: buildAvailabilityIntervalPayload(workdayStart, workdayEnd),
    booked: booked.map((item) => buildAvailabilityIntervalPayload(item.start, item.end, item.payload)),
    freeSlots,
  })
}

const getCandidateCvPreview = async (pool, _req, res, candidateCvId, previewType) => {
  const type = previewType === 'extracted' ? 'extracted' : 'cv'
  if (type === 'cv') {
    sendJson(res, 404, { message: 'CV text preview is no longer available; use the stored CV file preview instead' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
        cv.source AS source,
        extracts.cv_text AS cvText,
        extracts.extracted_text AS extractedText
      FROM candidate_cvs cv
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      WHERE cv.id = ?
      LIMIT 1`,
    [candidateCvId]
  )

  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'CV not found' })
    return
  }

  const text = type === 'extracted' ? String(row.extractedText || '') : String(row.cvText || '')
  if (!text.trim()) {
    sendJson(res, 404, { message: 'Preview text not found' })
    return
  }

  sendJson(res, 200, {
    cvId: Number(row.cvId),
    previewType: type,
    fileName: type === 'extracted' ? `${row.cvFileName}.extracted.txt` : row.cvFileName,
    source: normalizeCvSource(row.source),
    text,
  })
}

const getCandidateCvJobMatches = async (pool, _req, res, candidateCvId) => {
  const [rows] = await pool.query('SELECT id FROM candidate_cvs WHERE id = ? LIMIT 1', [candidateCvId])
  if (!rows.length) {
    sendJson(res, 404, { message: 'CV not found' })
    return
  }

  const matches = await listCandidateCvJobMatches(pool, candidateCvId)
  sendJson(res, 200, { cvId: Number(candidateCvId), matches })
}

const updateCandidateCvExtractedField = async (pool, req, res, candidateCvId) => {
  const body = await parseBody(req)
  const fieldKey = normalizeText(body?.fieldKey)
  const value = body?.value

  if (!fieldKey) {
    sendJson(res, 400, { message: 'fieldKey is required' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
        cv.id AS cvId,
        cv.candidate_id AS candidateId,
        cv.source AS source,
        extracts.extracted_text AS extractedText
      FROM candidate_cvs cv
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      WHERE cv.id = ?
      LIMIT 1`,
    [candidateCvId]
  )

  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'CV not found' })
    return
  }

  const payload = parseJsonObject(row.extractedText) || {}
  payload.source = normalizeText(payload.source) || normalizeCvSource(row.source)
  const extracted = payload.extracted && typeof payload.extracted === 'object' ? payload.extracted : {}
  const updateResult = applyExtractedFieldUpdate(extracted, fieldKey, value)
  if (updateResult.error) {
    sendJson(res, 400, { message: updateResult.error })
    return
  }

  payload.extracted = updateResult.extracted
  payload.missingFields = computeMissingFields(payload.extracted)
  if (!normalizeText(payload.parser)) payload.parser = 'manual'

  const targetPosition = Array.isArray(payload.extracted?.profile?.targetPosition)
    ? payload.extracted.profile.targetPosition.join(', ')
    : ''

  const fullName = normalizeText(payload.extracted.fullName)
  const email = normalizeText(payload.extracted.email)
  const phone = normalizeText(payload.extracted.phone)
  await pool.query(
    'UPDATE candidates SET full_name = ?, email = ?, phone = ? WHERE id = ?',
    [fullName || 'x', email || null, phone || null, Number(row.candidateId)]
  )
  const applicationContext = await getApplicationContextByCandidateCvId(pool, candidateCvId)
  const match = applicationContext?.jobSnapshot
    ? await runJobPostApplicationMatching(pool, {
      applicationId: applicationContext.applicationId,
      candidateId: Number(row.candidateId),
      candidateCvId,
      extracted: payload.extracted,
      jobSnapshot: applicationContext.jobSnapshot,
    })
    : null
  const finalPayload = attachMatchReportToExtractedPayload(payload, match)
  const extractedText = JSON.stringify(finalPayload, null, 2)

  await pool.query(
    `INSERT INTO candidate_cv_extractions
      (candidate_id, candidate_cv_id, target_position, extracted_text)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      target_position = VALUES(target_position),
      extracted_text = VALUES(extracted_text)`,
    [Number(row.candidateId), candidateCvId, targetPosition || null, extractedText]
  )

  sendJson(res, 200, {
    message: 'Extracted field updated',
    cvId: Number(candidateCvId),
    fieldKey,
    text: extractedText,
    extracted: payload.extracted,
    missingFields: payload.missingFields,
    parser: payload.parser,
    source: payload.source || '',
    match,
  })
}

// 編輯 AI 提取欄位後同步候選人主資料，並重算相關匹配報告，避免列表與預覽使用不同版本。
const updateCandidateCvExtractedFields = async (pool, req, res, candidateCvId) => {
  const body = await parseBody(req)
  const updatesSource = body?.updates
  const entries = updatesSource && typeof updatesSource === 'object'
    ? Object.entries(updatesSource)
    : []

  if (!entries.length) {
    sendJson(res, 400, { message: 'updates is required' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
        cv.id AS cvId,
        cv.candidate_id AS candidateId,
        cv.source AS source,
        extracts.extracted_text AS extractedText
      FROM candidate_cvs cv
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      WHERE cv.id = ?
      LIMIT 1`,
    [candidateCvId]
  )

  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'CV not found' })
    return
  }

  const payload = parseJsonObject(row.extractedText) || {}
  payload.source = normalizeText(payload.source) || normalizeCvSource(row.source)
  let extracted = payload.extracted && typeof payload.extracted === 'object' ? payload.extracted : {}

  for (const [rawFieldKey, value] of entries) {
    const fieldKey = normalizeText(rawFieldKey)
    const updateResult = applyExtractedFieldUpdate(extracted, fieldKey, value)
    if (updateResult.error) {
      sendJson(res, 400, { message: `Invalid update for ${fieldKey}: ${updateResult.error}` })
      return
    }
    extracted = updateResult.extracted
  }

  payload.extracted = extracted
  payload.missingFields = computeMissingFields(payload.extracted)
  if (!normalizeText(payload.parser)) payload.parser = 'manual'

  const targetPosition = Array.isArray(payload.extracted?.profile?.targetPosition)
    ? payload.extracted.profile.targetPosition.join(', ')
    : ''

  const fullName = normalizeText(payload.extracted.fullName)
  const email = normalizeText(payload.extracted.email)
  const phone = normalizeText(payload.extracted.phone)
  await pool.query(
    'UPDATE candidates SET full_name = ?, email = ?, phone = ? WHERE id = ?',
    [fullName || 'x', email || null, phone || null, Number(row.candidateId)]
  )
  const applicationContext = await getApplicationContextByCandidateCvId(pool, candidateCvId)
  const match = applicationContext?.jobSnapshot
    ? await runJobPostApplicationMatching(pool, {
      applicationId: applicationContext.applicationId,
      candidateId: Number(row.candidateId),
      candidateCvId,
      extracted: payload.extracted,
      jobSnapshot: applicationContext.jobSnapshot,
    })
    : null
  const finalPayload = attachMatchReportToExtractedPayload(payload, match)
  const extractedText = JSON.stringify(finalPayload, null, 2)

  await pool.query(
    `INSERT INTO candidate_cv_extractions
      (candidate_id, candidate_cv_id, target_position, extracted_text)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      target_position = VALUES(target_position),
      extracted_text = VALUES(extracted_text)`,
    [Number(row.candidateId), candidateCvId, targetPosition || null, extractedText]
  )

  sendJson(res, 200, {
    message: 'Extracted fields updated',
    cvId: Number(candidateCvId),
    updatedFields: entries.map(([key]) => normalizeText(key)).filter(Boolean),
    text: extractedText,
    extracted: payload.extracted,
    missingFields: payload.missingFields,
    parser: payload.parser,
    source: payload.source || '',
    match,
  })
}

const parseByteRange = (rangeHeader, fileSize) => {
  const match = String(rangeHeader || '').match(/^bytes=(\d*)-(\d*)$/)
  if (!match || fileSize <= 0) return null

  const [, startText, endText] = match
  if (!startText && !endText) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1,
    }
  }

  const start = Number(startText)
  const end = endText ? Number(endText) : fileSize - 1
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  }
}

const streamCandidateCvFile = async (pool, req, res, candidateCvId, { disposition = 'attachment' } = {}) => {
  const [rows] = await pool.query(
    `SELECT id, storage_key AS storageKey, original_filename AS originalFileName, mime_type AS mimeType
     FROM candidate_cvs
     WHERE id = ?
     LIMIT 1`,
    [candidateCvId]
  )

  const row = rows[0]
  if (!row) {
    sendJson(res, 404, { message: 'CV not found' })
    return
  }

  const storagePath = resolveCandidateCvStoragePath(row.storageKey)
  if (!storagePath || !fs.existsSync(storagePath)) {
    sendJson(res, 404, { message: 'CV file not found on storage' })
    return
  }

  const safeDownloadName = sanitizeFileName(row.originalFileName || `candidate-cv-${candidateCvId}`)
  const encodedName = encodeURIComponent(safeDownloadName)
  const fileStat = fs.statSync(storagePath)
  const contentType = row.mimeType || 'application/octet-stream'
  const contentDisposition = `${disposition}; filename*=UTF-8''${encodedName}`
  const baseHeaders = {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition,
    'Accept-Ranges': 'bytes',
  }

  withCors(res)
  const range = parseByteRange(req?.headers?.range, fileStat.size)
  if (req?.headers?.range && !range) {
    res.writeHead(416, {
      ...baseHeaders,
      'Content-Range': `bytes */${fileStat.size}`,
    })
    res.end()
    return
  }

  const streamOptions = range ? { start: range.start, end: range.end } : undefined
  if (range) {
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`,
    })
  } else {
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': fileStat.size,
    })
  }

  const stream = fs.createReadStream(storagePath, streamOptions)
  stream.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 500, { message: 'Failed to read CV file' })
      return
    }
    res.destroy()
  })
  stream.pipe(res)
}

const previewCandidateCvFile = async (pool, req, res, candidateCvId) =>
  streamCandidateCvFile(pool, req, res, candidateCvId, { disposition: 'inline' })

const downloadCandidateCv = async (pool, req, res, candidateCvId) =>
  streamCandidateCvFile(pool, req, res, candidateCvId, { disposition: 'attachment' })

const deleteCandidate = async (pool, _req, res, candidateId) => {
  const [rows] = await pool.query('SELECT id FROM candidates WHERE id = ? LIMIT 1', [candidateId])
  if (!rows.length) {
    sendJson(res, 404, { message: 'Candidate not found' })
    return
  }

  await pool.query('DELETE FROM candidates WHERE id = ?', [candidateId])
  sendJson(res, 200, { message: 'Candidate deleted' })
}

const deleteCandidatesBatch = async (pool, req, res) => {
  const body = await parseBody(req)
  const ids = Array.isArray(body?.candidateIds)
    ? body.candidateIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : []

  if (!ids.length) {
    sendJson(res, 400, { message: 'candidateIds is required' })
    return
  }

  const uniqueIds = [...new Set(ids)]
  const placeholders = uniqueIds.map(() => '?').join(', ')
  const [result] = await pool.query(`DELETE FROM candidates WHERE id IN (${placeholders})`, uniqueIds)
  sendJson(res, 200, {
    message: 'Candidates deleted',
    deletedCount: Number(result?.affectedRows || 0),
  })
}

const listProjects = async (pool, _req, res, url) => {
  const keyword = normalizeText(url?.searchParams.get('keyword')).toLowerCase()
  const status = normalizeProjectStatus(url?.searchParams.get('status'), '')
  const rows = await listProjectRows(pool)
  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false
    if (!keyword) return true
    return [
      row.projectName,
      row.status,
      row.ownerName,
      row.remark,
    ].join(' ').toLowerCase().includes(keyword)
  })
  sendJson(res, 200, { projects: filtered })
}

const createProject = async (pool, req, res) => {
  const payload = normalizeProjectPayload(await parseBody(req))
  if (!payload.projectName) {
    sendJson(res, 400, { message: 'projectName is required' })
    return
  }
  assertDateRange(payload.startDate, payload.endDate, 'project')
  if (payload.ownerPersonnelId && !(await getPersonnelById(pool, payload.ownerPersonnelId))) {
    sendJson(res, 400, { message: 'Owner personnel not found' })
    return
  }

  const [result] = await pool.query(
    `INSERT INTO projects
      (project_name, status, owner_personnel_id, start_date, end_date, remark)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      payload.projectName,
      payload.status,
      payload.ownerPersonnelId,
      payload.startDate,
      payload.endDate,
      payload.remark || null,
    ]
  )
  const project = await getProjectById(pool, Number(result.insertId))
  sendJson(res, 201, { message: 'Project created', project })
}

const getProjectDetail = async (pool, _req, res, projectId) => {
  const project = await getProjectById(pool, projectId)
  if (!project) {
    sendJson(res, 404, { message: 'Project not found' })
    return
  }
  const assignments = await listProjectAssignments(pool, projectId)
  sendJson(res, 200, { project, assignments })
}

const updateProject = async (pool, req, res, projectId) => {
  const existing = await getProjectById(pool, projectId)
  if (!existing) {
    sendJson(res, 404, { message: 'Project not found' })
    return
  }

  const payload = normalizeProjectPayload(await parseBody(req))
  if (!payload.projectName) {
    sendJson(res, 400, { message: 'projectName is required' })
    return
  }
  assertDateRange(payload.startDate, payload.endDate, 'project')
  if (payload.ownerPersonnelId && !(await getPersonnelById(pool, payload.ownerPersonnelId))) {
    sendJson(res, 400, { message: 'Owner personnel not found' })
    return
  }

  await pool.query(
    `UPDATE projects
      SET project_name = ?, status = ?, owner_personnel_id = ?, start_date = ?, end_date = ?,
          remark = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.projectName,
      payload.status,
      payload.ownerPersonnelId,
      payload.startDate,
      payload.endDate,
      payload.remark || null,
      projectId,
    ]
  )

  const project = await getProjectById(pool, projectId)
  sendJson(res, 200, { message: 'Project updated', project })
}

const deleteProject = async (pool, _req, res, projectId) => {
  const existing = await getProjectById(pool, projectId)
  if (!existing) {
    sendJson(res, 404, { message: 'Project not found' })
    return
  }

  await pool.query('DELETE FROM projects WHERE id = ?', [projectId])
  sendJson(res, 200, { message: 'Project deleted', projectId })
}

const addProjectPersonnel = async (pool, req, res, projectId) => {
  const project = await getProjectById(pool, projectId)
  if (!project) {
    sendJson(res, 404, { message: 'Project not found' })
    return
  }

  const payload = normalizeProjectAssignmentPayload(await parseBody(req), 'manual')
  const personnel = await createOrUpdatePersonnelForProject(pool, payload)
  const { assignment, action } = await upsertProjectAssignment(pool, projectId, Number(personnel.id), payload, 'joined')
  sendJson(res, action === 'created' ? 201 : 200, {
    message: action === 'created' ? 'Project personnel added' : 'Project personnel updated',
    personnel,
    assignment,
  })
}

const updateProjectPersonnelAssignment = async (pool, req, res, assignmentId) => {
  const existing = await getProjectAssignmentById(pool, assignmentId)
  if (!existing) {
    sendJson(res, 404, { message: 'Project assignment not found' })
    return
  }

  const body = await parseBody(req)
  const payload = normalizeProjectAssignmentPayload({
    ...body,
    source: body?.source || existing.source,
    status: body?.status || existing.status,
    startDate: Object.prototype.hasOwnProperty.call(body || {}, 'startDate') ? body.startDate : existing.startDate,
    endDate: Object.prototype.hasOwnProperty.call(body || {}, 'endDate') ? body.endDate : existing.endDate,
    projectRole: Object.prototype.hasOwnProperty.call(body || {}, 'projectRole') ? body.projectRole : existing.projectRole,
    remark: Object.prototype.hasOwnProperty.call(body || {}, 'remark') ? body.remark : existing.remark,
  }, existing.source)
  assertDateRange(payload.startDate, payload.endDate, 'assignment')

  await pool.query(
    `UPDATE project_personnel_assignments
      SET project_role = ?, start_date = ?, end_date = ?, source = ?, status = ?, remark = ?,
          updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.projectRole || null,
      payload.startDate,
      payload.endDate,
      payload.source,
      payload.status,
      payload.remark || null,
      assignmentId,
    ]
  )

  const assignment = await getProjectAssignmentById(pool, assignmentId)
  await insertProjectMovement(pool, {
    assignmentId,
    personnelId: existing.personnelId,
    fromProjectId: existing.projectId,
    toProjectId: payload.status === 'removed' ? null : existing.projectId,
    movementType: payload.status === 'removed' ? 'removed' : 'updated',
    movementDate: payload.status === 'removed' ? payload.endDate : payload.startDate,
    projectRole: payload.projectRole,
    source: payload.source,
    remark: payload.remark,
  })

  sendJson(res, 200, { message: 'Project assignment updated', assignment })
}

const removeProjectPersonnelAssignment = async (pool, req, res, assignmentId) => {
  const existing = await getProjectAssignmentById(pool, assignmentId)
  if (!existing) {
    sendJson(res, 404, { message: 'Project assignment not found' })
    return
  }

  const body = await parseBody(req).catch(() => ({}))
  const endDate = normalizeDateInput(body?.endDate || existing.endDate || getTodayDateText(), 'endDate')
  const remark = normalizeRemark(body?.remark || existing.remark)
  await pool.query(
    `UPDATE project_personnel_assignments
      SET status = 'removed', end_date = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [endDate, remark || null, assignmentId]
  )
  const assignment = await getProjectAssignmentById(pool, assignmentId)
  await insertProjectMovement(pool, {
    assignmentId,
    personnelId: existing.personnelId,
    fromProjectId: existing.projectId,
    movementType: 'removed',
    movementDate: endDate,
    projectRole: existing.projectRole,
    source: existing.source,
    remark,
  })
  sendJson(res, 200, { message: 'Project personnel removed', assignment })
}

const transferProjectPersonnelAssignment = async (pool, req, res, assignmentId) => {
  const existing = await getProjectAssignmentById(pool, assignmentId)
  if (!existing) {
    sendJson(res, 404, { message: 'Project assignment not found' })
    return
  }

  const body = await parseBody(req)
  const targetProjectId = Number(body?.targetProjectId)
  if (!Number.isInteger(targetProjectId) || targetProjectId <= 0) {
    sendJson(res, 400, { message: 'targetProjectId is required' })
    return
  }
  if (targetProjectId === Number(existing.projectId)) {
    sendJson(res, 400, { message: 'targetProjectId must be different from current project' })
    return
  }
  const targetProject = await getProjectById(pool, targetProjectId)
  if (!targetProject) {
    sendJson(res, 404, { message: 'Target project not found' })
    return
  }

  const transferDate = normalizeDateInput(body?.transferDate || body?.startDate || getTodayDateText(), 'transferDate')
  const targetPayload = normalizeProjectAssignmentPayload({
    projectRole: body?.projectRole || existing.projectRole,
    startDate: body?.startDate || transferDate,
    endDate: body?.endDate || null,
    source: body?.source || 'manual',
    status: 'active',
    remark: body?.remark || '',
  }, 'manual')

  await pool.query(
    `UPDATE project_personnel_assignments
      SET status = 'transferred', end_date = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [transferDate, assignmentId]
  )

  const { assignment: targetAssignment } = await upsertProjectAssignment(
    pool,
    targetProjectId,
    existing.personnelId,
    targetPayload,
    'transferred',
    { recordMovement: false }
  )

  await insertProjectMovement(pool, {
    assignmentId,
    personnelId: existing.personnelId,
    fromProjectId: existing.projectId,
    toProjectId: targetProjectId,
    movementType: 'transferred',
    movementDate: transferDate,
    projectRole: targetPayload.projectRole,
    source: targetPayload.source,
    remark: targetPayload.remark,
  })

  const sourceAssignment = await getProjectAssignmentById(pool, assignmentId)
  sendJson(res, 200, {
    message: 'Project personnel transferred',
    sourceAssignment,
    targetAssignment,
  })
}

const resolveCsvManagerPersonnelId = (managerName, personnelRows) => {
  const text = normalizeText(managerName)
  if (!text) return null
  const managerById = personnelRows.find((row) => String(row.id) === text)
  if (managerById) return Number(managerById.id)
  const managerByName = personnelRows.find((row) => normalizeText(row.fullName) === text)
  if (managerByName) return Number(managerByName.id)
  throw new HttpError(400, `Manager not found: ${text}`)
}

const importProjectPersonnelCsv = async (pool, req, res, projectId) => {
  const project = await getProjectById(pool, projectId)
  if (!project) {
    sendJson(res, 404, { message: 'Project not found' })
    return
  }

  const body = await parseBody(req)
  const csvText = String(body?.csvText || '')
  if (!normalizeText(csvText)) {
    sendJson(res, 400, { message: 'csvText is required' })
    return
  }

  const csvRows = parseCsvRows(csvText)
  if (csvRows.length < 2) {
    sendJson(res, 400, { message: 'CSV must include header and at least one data row' })
    return
  }

  const headers = csvRows[0].map((header) => PROJECT_PERSONNEL_IMPORT_HEADERS[normalizeCsvHeader(header)] || '')
  if (!headers.includes('fullName')) {
    sendJson(res, 400, { message: 'CSV header must include fullName/name/姓名' })
    return
  }

  let personnelRows = await listPersonnelRows(pool)
  const summary = {
    total: 0,
    createdCount: 0,
    updatedCount: 0,
    errorCount: 0,
    errors: [],
  }

  for (let rowIndex = 1; rowIndex < csvRows.length; rowIndex += 1) {
    const rawRow = csvRows[rowIndex]
    if (!rawRow.some((value) => normalizeText(value))) continue
    summary.total += 1
    const record = {}
    headers.forEach((key, columnIndex) => {
      if (!key) return
      record[key] = normalizeText(rawRow[columnIndex])
    })

    try {
      if (!record.fullName) throw new HttpError(400, '姓名不可為空')
      if (!record.email && !record.phone) throw new HttpError(400, 'Email 或電話至少填一項')

      const managerPersonnelId = resolveCsvManagerPersonnelId(record.managerName, personnelRows)
      const payload = normalizeProjectAssignmentPayload({
        ...record,
        managerPersonnelId,
        source: 'csv',
        status: 'active',
      }, 'csv')
      const personnel = await createOrUpdatePersonnelForProject(pool, payload, { requireIdentity: true })
      const { action } = await upsertProjectAssignment(pool, projectId, Number(personnel.id), payload, 'joined')
      if (action === 'created') summary.createdCount += 1
      else summary.updatedCount += 1
      personnelRows = [
        buildPersonnelPayload({
          ...personnel,
          managerName: personnel.managerName || '',
        }),
        ...personnelRows.filter((row) => Number(row.id) !== Number(personnel.id)),
      ]
    } catch (error) {
      summary.errorCount += 1
      summary.errors.push({
        rowNumber: rowIndex + 1,
        message: error?.message || '匯入失敗',
      })
    }
  }

  const assignments = await listProjectAssignments(pool, projectId)
  sendJson(res, 200, {
    message: 'CSV import completed',
    summary,
    assignments,
  })
}

const addProjectPersonnelFromApplication = async (pool, req, res) => {
  const body = await parseBody(req)
  const applicationId = Number(body?.applicationId)
  const projectId = Number(body?.projectId)
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    sendJson(res, 400, { message: 'applicationId is required' })
    return
  }
  if (!Number.isInteger(projectId) || projectId <= 0) {
    sendJson(res, 400, { message: 'projectId is required' })
    return
  }

  const project = await getProjectById(pool, projectId)
  if (!project) {
    sendJson(res, 404, { message: 'Project not found' })
    return
  }

  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.application_status AS applicationStatus,
        app.matched_position AS matchedPosition,
        c.id AS candidateId,
        c.full_name AS fullName,
        c.email,
        c.phone,
        extracts.target_position AS targetPosition
      FROM job_post_applications app
      INNER JOIN candidates c ON c.id = app.candidate_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = app.candidate_cv_id
      WHERE app.id = ?
      LIMIT 1`,
    [applicationId]
  )
  const application = rows[0]
  if (!application) {
    sendJson(res, 404, { message: 'Application not found' })
    return
  }
  if (normalizeApplicationStatus(application.applicationStatus) !== 'onboarded') {
    sendJson(res, 400, { message: 'Only onboarded candidates can be added to project personnel' })
    return
  }

  const payload = normalizeProjectAssignmentPayload({
    fullName: application.fullName,
    email: application.email,
    phone: application.phone,
    title: application.matchedPosition || application.targetPosition || '',
    projectRole: body?.projectRole || application.matchedPosition || application.targetPosition || '',
    startDate: body?.startDate || getTodayDateText(),
    endDate: body?.endDate || null,
    source: 'candidate',
    status: 'active',
    remark: body?.remark || '',
  }, 'candidate')
  const personnel = await createOrUpdatePersonnelForProject(pool, payload)
  const { assignment, action } = await upsertProjectAssignment(pool, projectId, Number(personnel.id), payload, 'joined')
  sendJson(res, action === 'created' ? 201 : 200, {
    message: action === 'created' ? 'Candidate added to project personnel' : 'Project personnel updated from candidate',
    personnel,
    assignment,
  })
}

const listPersonnel = async (pool, _req, res, url) => {
  const keyword = normalizeText(url?.searchParams.get('keyword'))
  const status = normalizeDirectoryStatus(url?.searchParams.get('status'), '')
  const rows = await listPersonnelRows(pool)

  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false
    if (!keyword) return true
    const haystack = [
      row.fullName,
      row.department,
      row.team,
      row.title,
      row.email,
      row.phone,
      row.managerName,
      row.remark,
    ].join(' ').toLowerCase()
    return haystack.includes(keyword.toLowerCase())
  })

  sendJson(res, 200, { personnel: filtered })
}

const createPersonnel = async (pool, req, res) => {
  const payload = normalizePersonnelPayload(await parseBody(req))
  if (!payload.fullName) {
    sendJson(res, 400, { message: 'fullName is required' })
    return
  }

  await ensurePersonnelManagerIsValid(pool, null, payload.managerPersonnelId)
  const [result] = await pool.query(
    `INSERT INTO personnel
      (full_name, department, team, title, email, phone, manager_personnel_id, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.fullName,
      payload.department || null,
      payload.team || null,
      payload.title || null,
      payload.email || null,
      payload.phone || null,
      payload.managerPersonnelId,
      payload.status,
      payload.remark || null,
    ]
  )

  const rows = await listPersonnelRows(pool)
  const personnel = rows.find((row) => Number(row.id) === Number(result.insertId)) || null
  sendJson(res, 201, { message: 'Personnel created', personnel })
}

const updatePersonnel = async (pool, req, res, personnelId) => {
  const [existingRows] = await pool.query('SELECT id FROM personnel WHERE id = ? LIMIT 1', [personnelId])
  if (!existingRows.length) {
    sendJson(res, 404, { message: 'Personnel not found' })
    return
  }

  const payload = normalizePersonnelPayload(await parseBody(req))
  if (!payload.fullName) {
    sendJson(res, 400, { message: 'fullName is required' })
    return
  }

  await ensurePersonnelManagerIsValid(pool, personnelId, payload.managerPersonnelId)
  await pool.query(
    `UPDATE personnel
      SET full_name = ?, department = ?, team = ?, title = ?, email = ?, phone = ?,
          manager_personnel_id = ?, status = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.fullName,
      payload.department || null,
      payload.team || null,
      payload.title || null,
      payload.email || null,
      payload.phone || null,
      payload.managerPersonnelId,
      payload.status,
      payload.remark || null,
      personnelId,
    ]
  )

  const rows = await listPersonnelRows(pool)
  const personnel = rows.find((row) => Number(row.id) === Number(personnelId)) || null
  sendJson(res, 200, { message: 'Personnel updated', personnel })
}

const deletePersonnel = async (pool, _req, res, personnelId) => {
  const [existingRows] = await pool.query('SELECT id FROM personnel WHERE id = ? LIMIT 1', [personnelId])
  if (!existingRows.length) {
    sendJson(res, 404, { message: 'Personnel not found' })
    return
  }

  await pool.query('UPDATE personnel SET manager_personnel_id = NULL WHERE manager_personnel_id = ?', [personnelId])
  await pool.query('DELETE FROM personnel WHERE id = ?', [personnelId])
  sendJson(res, 200, { message: 'Personnel deleted', personnelId: Number(personnelId) })
}

const listCandidateBlacklist = async (pool, _req, res, url) => {
  const keyword = normalizeText(url?.searchParams.get('keyword'))
  const status = normalizeDirectoryStatus(url?.searchParams.get('status'), '')
  const rows = await listCandidateBlacklistRows(pool)

  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false
    if (!keyword) return true
    const haystack = [
      row.displayName,
      row.phone,
      row.email,
      row.reason,
      row.remark,
    ].join(' ').toLowerCase()
    return haystack.includes(keyword.toLowerCase())
  })

  sendJson(res, 200, { blacklist: filtered })
}

const createCandidateBlacklist = async (pool, req, res) => {
  const payload = normalizeBlacklistPayload(await parseBody(req))
  if (!payload.normalizedPhone && !payload.normalizedEmail) {
    sendJson(res, 400, { message: 'phone or email is required' })
    return
  }
  if (!payload.reason) {
    sendJson(res, 400, { message: 'reason is required' })
    return
  }

  await ensureCandidateBlacklistUniqueness(pool, payload)
  const [result] = await pool.query(
    `INSERT INTO candidate_blacklist
      (display_name, phone, normalized_phone, email, normalized_email, reason, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.displayName || null,
      payload.phone || null,
      payload.normalizedPhone || null,
      payload.email || null,
      payload.normalizedEmail || null,
      payload.reason,
      payload.status,
      payload.remark || null,
    ]
  )

  const rows = await listCandidateBlacklistRows(pool)
  const blacklistEntry = rows.find((row) => Number(row.id) === Number(result.insertId)) || null
  sendJson(res, 201, { message: 'Blacklist entry created', blacklistEntry })
}

const updateCandidateBlacklist = async (pool, req, res, blacklistId) => {
  const [existingRows] = await pool.query('SELECT id FROM candidate_blacklist WHERE id = ? LIMIT 1', [blacklistId])
  if (!existingRows.length) {
    sendJson(res, 404, { message: 'Blacklist entry not found' })
    return
  }

  const payload = normalizeBlacklistPayload(await parseBody(req))
  if (!payload.normalizedPhone && !payload.normalizedEmail) {
    sendJson(res, 400, { message: 'phone or email is required' })
    return
  }
  if (!payload.reason) {
    sendJson(res, 400, { message: 'reason is required' })
    return
  }

  await ensureCandidateBlacklistUniqueness(pool, payload, blacklistId)
  await pool.query(
    `UPDATE candidate_blacklist
      SET display_name = ?, phone = ?, normalized_phone = ?, email = ?, normalized_email = ?,
          reason = ?, status = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.displayName || null,
      payload.phone || null,
      payload.normalizedPhone || null,
      payload.email || null,
      payload.normalizedEmail || null,
      payload.reason,
      payload.status,
      payload.remark || null,
      blacklistId,
    ]
  )

  const rows = await listCandidateBlacklistRows(pool)
  const blacklistEntry = rows.find((row) => Number(row.id) === Number(blacklistId)) || null
  sendJson(res, 200, { message: 'Blacklist entry updated', blacklistEntry })
}

const deleteCandidateBlacklist = async (pool, _req, res, blacklistId) => {
  const [existingRows] = await pool.query('SELECT id FROM candidate_blacklist WHERE id = ? LIMIT 1', [blacklistId])
  if (!existingRows.length) {
    sendJson(res, 404, { message: 'Blacklist entry not found' })
    return
  }

  await pool.query('DELETE FROM candidate_blacklist WHERE id = ?', [blacklistId])
  sendJson(res, 200, { message: 'Blacklist entry deleted', blacklistId: Number(blacklistId) })
}

const start = async () => {
  loadJobDictionary()
  await ensureDatabaseExists()
  const pool = createDatabasePool()
  await ensureAuthTables(pool)
  await ensureCvTables(pool)
  startInterviewStatusAutoCheck(pool)

  const port = process.env.PORT || 3001
  // 目前 API 以明確順序分發路由；新增相近路徑時需留意較具體的 regex 分支不要被前面的平面路由吃掉。
  const server = http.createServer(async (req, res) => {
    withCors(res)
    if (!req.url) return sendJson(res, 404, { message: 'Not found' })
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, `http://${req.headers.host}`)
    const requestId = crypto.randomUUID()
    const requestStartedAt = Date.now()
    const databaseOperationType = resolveDatabaseOperationType(url.pathname, req.method)
    const logContextUser = await resolveRequestLogUser(pool, req, { includeParsedBody: false })
    let routeError = null

    try {
      return await runWithLogContext({ requestId, user: logContextUser, method: req.method, path: url.pathname }, async () => {
      try {
      if (!(await enforceRoleAccess(pool, req, res, url))) return
      if (url.pathname === '/api/auth/request-code' && req.method === 'POST') return await requestCode(req, res)
      if (url.pathname === '/api/auth/register' && req.method === 'POST') return await registerUser(pool, req, res)
      if (url.pathname === '/api/auth/login' && req.method === 'POST') return await loginUser(pool, req, res)
      if (url.pathname === '/api/auth/profile' && req.method === 'GET') return getMyProfile(pool, req, res)
      if (url.pathname === '/api/auth/profile' && req.method === 'POST') return updateMyProfile(pool, req, res)
      if (url.pathname === '/api/auth/change-password' && req.method === 'POST') return changeMyPassword(pool, req, res)
      if (url.pathname === '/api/users' && req.method === 'GET') return listUsersForManagement(pool, req, res)
      if (url.pathname === '/api/users/options' && req.method === 'GET') return listUserOptions(pool, req, res)
      if (url.pathname === '/api/schedule/interviews' && req.method === 'GET') return listScheduleInterviews(pool, req, res, url)
      if (url.pathname === '/api/schedule/interviewer-availability' && req.method === 'GET') {
        return getInterviewerAvailability(pool, req, res, url)
      }
      if (url.pathname === '/api/interviews/arranged' && req.method === 'GET') return listArrangedInterviews(pool, req, res)
      if (url.pathname === '/api/job-dictionary' && req.method === 'GET') return getJobDictionaryHandler(pool, req, res)
      if (url.pathname === '/api/job-dictionary' && req.method === 'PUT') return updateJobDictionaryHandler(pool, req, res)
      if (url.pathname === '/api/job-dictionary/rubric-suggestions' && req.method === 'POST') {
        return suggestJobDictionaryRubricsHandler(pool, req, res)
      }
      if (url.pathname === '/api/job-dictionary/job-suggestions' && req.method === 'POST') {
        return suggestJobDictionaryDefinitionHandler(pool, req, res)
      }
      if (url.pathname === '/api/job-posts' && req.method === 'GET') return listJobPosts(pool, req, res)
      if (url.pathname === '/api/job-posts' && req.method === 'POST') return createJobPost(pool, req, res)
      if (url.pathname === '/api/projects' && req.method === 'GET') return listProjects(pool, req, res, url)
      if (url.pathname === '/api/projects' && req.method === 'POST') return createProject(pool, req, res)
      if (url.pathname === '/api/project-personnel/from-application' && req.method === 'POST') {
        return addProjectPersonnelFromApplication(pool, req, res)
      }

      if (url.pathname === '/api/candidates' && req.method === 'POST') return createCandidate(pool, req, res)
      if (url.pathname === '/api/candidates' && req.method === 'GET') return listCandidates(pool, req, res)
      if (url.pathname === '/api/candidates/cv-table' && req.method === 'GET') return listCandidateCvTable(pool, req, res)
      if (url.pathname === '/api/personnel' && req.method === 'GET') return listPersonnel(pool, req, res, url)
      if (url.pathname === '/api/personnel' && req.method === 'POST') return createPersonnel(pool, req, res)
      if (url.pathname === '/api/candidate-blacklist' && req.method === 'GET') {
        return listCandidateBlacklist(pool, req, res, url)
      }
      if (url.pathname === '/api/candidate-blacklist' && req.method === 'POST') {
        return createCandidateBlacklist(pool, req, res)
      }
      if (url.pathname === '/api/job-post-applications/table' && req.method === 'GET') {
        return listAllJobPostApplicationsTable(pool, req, res)
      }
      if (url.pathname === '/api/candidates/batch-delete' && req.method === 'POST') return deleteCandidatesBatch(pool, req, res)
      if (url.pathname === '/api/cv/cache' && req.method === 'POST') return cacheCvUpload(pool, req, res)
      if (url.pathname === '/api/cv/parse' && req.method === 'POST') return await parseCvFromCache(pool, req, res)
      if (url.pathname === '/api/cv/intake' && req.method === 'POST') return await intakeCv(pool, req, res)

      const userRoleMatch = url.pathname.match(/^\/api\/users\/(\d+)\/role$/)
      if (userRoleMatch && req.method === 'PATCH') {
        return updateUserRole(pool, req, res, Number(userRoleMatch[1]))
      }

      const jobPostDetailMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)$/)
      if (jobPostDetailMatch && req.method === 'GET') return getJobPostDetail(pool, req, res, Number(jobPostDetailMatch[1]))
      if (jobPostDetailMatch && req.method === 'PUT') return updateJobPost(pool, req, res, Number(jobPostDetailMatch[1]))
      if (jobPostDetailMatch && req.method === 'DELETE') return deleteJobPost(pool, req, res, Number(jobPostDetailMatch[1]))

      const projectDetailMatch = url.pathname.match(/^\/api\/projects\/(\d+)$/)
      if (projectDetailMatch && req.method === 'GET') return getProjectDetail(pool, req, res, Number(projectDetailMatch[1]))
      if (projectDetailMatch && req.method === 'PATCH') return updateProject(pool, req, res, Number(projectDetailMatch[1]))
      if (projectDetailMatch && req.method === 'DELETE') return deleteProject(pool, req, res, Number(projectDetailMatch[1]))

      const projectPersonnelMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/personnel$/)
      if (projectPersonnelMatch && req.method === 'GET') {
        return getProjectDetail(pool, req, res, Number(projectPersonnelMatch[1]))
      }
      if (projectPersonnelMatch && req.method === 'POST') {
        return addProjectPersonnel(pool, req, res, Number(projectPersonnelMatch[1]))
      }

      const projectPersonnelImportMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/personnel\/import-csv$/)
      if (projectPersonnelImportMatch && req.method === 'POST') {
        return importProjectPersonnelCsv(pool, req, res, Number(projectPersonnelImportMatch[1]))
      }

      const projectAssignmentTransferMatch = url.pathname.match(/^\/api\/project-personnel-assignments\/(\d+)\/transfer$/)
      if (projectAssignmentTransferMatch && req.method === 'POST') {
        return transferProjectPersonnelAssignment(pool, req, res, Number(projectAssignmentTransferMatch[1]))
      }

      const projectAssignmentMatch = url.pathname.match(/^\/api\/project-personnel-assignments\/(\d+)$/)
      if (projectAssignmentMatch && req.method === 'PATCH') {
        return updateProjectPersonnelAssignment(pool, req, res, Number(projectAssignmentMatch[1]))
      }
      if (projectAssignmentMatch && req.method === 'DELETE') {
        return removeProjectPersonnelAssignment(pool, req, res, Number(projectAssignmentMatch[1]))
      }

      const jobPostApplicationsMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)\/applications$/)
      if (jobPostApplicationsMatch && req.method === 'GET') {
        return listJobPostApplications(pool, req, res, Number(jobPostApplicationsMatch[1]))
      }

      const jobPostCacheMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)\/cv\/cache$/)
      if (jobPostCacheMatch && req.method === 'POST') {
        return cacheCvUpload(pool, req, res, Number(jobPostCacheMatch[1]))
      }

      const jobPostParseMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)\/cv\/parse$/)
      if (jobPostParseMatch && req.method === 'POST') {
        return await parseCvFromCache(pool, req, res, Number(jobPostParseMatch[1]))
      }

      const jobPostIntakeMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)\/cv\/intake$/)
      if (jobPostIntakeMatch && req.method === 'POST') {
        return await intakeCv(pool, req, res, Number(jobPostIntakeMatch[1]))
      }

      const applicationMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)$/)
      if (applicationMatch && req.method === 'GET') {
        return await getJobPostApplication(pool, req, res, Number(applicationMatch[1]))
      }
      if (applicationMatch && req.method === 'PATCH') {
        return await updateJobPostApplicationStatus(pool, req, res, Number(applicationMatch[1]))
      }

      const applicationStatusMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)\/status$/)
      if (applicationStatusMatch && req.method === 'PATCH') {
        return await updateJobPostApplicationStatus(pool, req, res, Number(applicationStatusMatch[1]))
      }

      const applicationInterviewStatusMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)\/interview-status$/)
      if (applicationInterviewStatusMatch && req.method === 'PATCH') {
        return await updateJobPostApplicationInterviewStatus(pool, req, res, Number(applicationInterviewStatusMatch[1]))
      }

      const applicationStatusHistoryMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)\/status-history$/)
      if (applicationStatusHistoryMatch && req.method === 'POST') {
        return await createJobPostApplicationStatusHistory(pool, req, res, Number(applicationStatusHistoryMatch[1]))
      }

      const applicationStatusHistoryItemMatch = url.pathname.match(
        /^\/api\/job-post-applications\/(\d+)\/status-history\/(\d+)$/
      )
      if (applicationStatusHistoryItemMatch && req.method === 'PATCH') {
        return await updateJobPostApplicationStatusHistory(
          pool,
          req,
          res,
          Number(applicationStatusHistoryItemMatch[1]),
          Number(applicationStatusHistoryItemMatch[2])
        )
      }
      if (applicationStatusHistoryItemMatch && req.method === 'DELETE') {
        return await deleteJobPostApplicationStatusHistory(
          pool,
          req,
          res,
          Number(applicationStatusHistoryItemMatch[1]),
          Number(applicationStatusHistoryItemMatch[2])
        )
      }

      const applicationResultMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)\/match$/)
      if (applicationResultMatch && req.method === 'GET') {
        return getJobPostApplicationMatch(pool, req, res, Number(applicationResultMatch[1]))
      }

      const applicationDeleteMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)$/)
      if (applicationDeleteMatch && req.method === 'DELETE') {
        return deleteJobPostApplication(pool, req, res, Number(applicationDeleteMatch[1]))
      }
      if (url.pathname === '/api/job-post-applications/batch-delete' && req.method === 'POST') {
        return deleteJobPostApplicationsBatch(pool, req, res)
      }

      const uploadMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/cvs$/)
      if (uploadMatch && req.method === 'POST') return uploadCandidateCv(pool, req, res, Number(uploadMatch[1]))
      if (uploadMatch && req.method === 'GET') return listCandidateCvs(pool, req, res, Number(uploadMatch[1]))

      const candidateJobPostIntakeMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/job-posts\/(\d+)\/intake$/)
      if (candidateJobPostIntakeMatch && req.method === 'POST') {
        return await intakeCandidateCvToJobPost(
          pool,
          req,
          res,
          Number(candidateJobPostIntakeMatch[1]),
          Number(candidateJobPostIntakeMatch[2])
        )
      }

      const previewMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/preview$/)
      if (previewMatch && req.method === 'GET') {
        const previewType = String(url.searchParams.get('type') || 'cv').trim().toLowerCase()
        return getCandidateCvPreview(pool, req, res, Number(previewMatch[1]), previewType)
      }

      const jobMatchesMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/job-matches$/)
      if (jobMatchesMatch && req.method === 'GET') {
        return getCandidateCvJobMatches(pool, req, res, Number(jobMatchesMatch[1]))
      }

      const filePreviewMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/file-preview$/)
      if (filePreviewMatch && req.method === 'GET') {
        return previewCandidateCvFile(pool, req, res, Number(filePreviewMatch[1]))
      }

      const updateExtractedMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/extracted-field$/)
      if (updateExtractedMatch && req.method === 'POST') {
        return await updateCandidateCvExtractedField(pool, req, res, Number(updateExtractedMatch[1]))
      }

      const updateExtractedBatchMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/extracted-fields$/)
      if (updateExtractedBatchMatch && req.method === 'POST') {
        return await updateCandidateCvExtractedFields(pool, req, res, Number(updateExtractedBatchMatch[1]))
      }

      const downloadMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/download$/)
      if (downloadMatch && req.method === 'GET') {
        return downloadCandidateCv(pool, req, res, Number(downloadMatch[1]))
      }

      const completeProfileMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/complete-profile$/)
      if (completeProfileMatch && req.method === 'POST') return await completeCandidateProfile(pool, req, res, Number(completeProfileMatch[1]))

      const candidateMatch = url.pathname.match(/^\/api\/candidates\/(\d+)$/)
      if (candidateMatch && req.method === 'DELETE') return deleteCandidate(pool, req, res, Number(candidateMatch[1]))

      const personnelMatch = url.pathname.match(/^\/api\/personnel\/(\d+)$/)
      if (personnelMatch && req.method === 'PATCH') return updatePersonnel(pool, req, res, Number(personnelMatch[1]))
      if (personnelMatch && req.method === 'DELETE') return deletePersonnel(pool, req, res, Number(personnelMatch[1]))

      const blacklistMatch = url.pathname.match(/^\/api\/candidate-blacklist\/(\d+)$/)
      if (blacklistMatch && req.method === 'PATCH') {
        return updateCandidateBlacklist(pool, req, res, Number(blacklistMatch[1]))
      }
      if (blacklistMatch && req.method === 'DELETE') {
        return deleteCandidateBlacklist(pool, req, res, Number(blacklistMatch[1]))
      }

      return sendJson(res, 404, { message: 'Not found' })
      } catch (error) {
        routeError = error
      console.error(error)
      const statusCode = getErrorStatusCode(error)
      const message = error instanceof HttpError
        ? error.message
        : String(error?.message || 'Internal server error')
      return sendJson(res, statusCode, { message })
      } finally {
        await writeDatabaseOperationLog(pool, req, res, databaseOperationType, requestStartedAt, routeError, url)
      }
      })
    } catch (error) {
      routeError = error
      console.error(error)
      if (!res.headersSent) {
        const statusCode = getErrorStatusCode(error)
        const message = error instanceof HttpError
          ? error.message
          : String(error?.message || 'Internal server error')
        sendJson(res, statusCode, { message })
      } else if (!res.writableEnded) {
        res.end()
      }
      await writeDatabaseOperationLog(pool, req, res, databaseOperationType, requestStartedAt, routeError, url)
    }
  })

  server.listen(port, () => {
    console.log(`Server listening on ${port}, database: ${DB_NAME}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
