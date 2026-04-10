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
import { extractTextFromBuffer } from './scripts/llm/text-extractors.js'
import { getJobDictionary, loadJobDictionary, saveJobDictionary } from './scripts/jobs/dictionary.js'
import { matchCandidateToJobPost, matchCandidateToJobs } from './scripts/llm/job-matcher.js'

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

const resolveTokenTtlMs = () => {
  const asMs = Number(process.env.AUTH_AUTO_LOGIN_TTL_MS || '')
  if (Number.isFinite(asMs) && asMs > 0) return asMs

  const asMinutes = Number(process.env.AUTH_AUTO_LOGIN_TTL_MINUTES || '')
  if (Number.isFinite(asMinutes) && asMinutes > 0) return Math.floor(asMinutes * 60 * 1000)

  return 60 * 60 * 1000
}

const TOKEN_TTL_MS = resolveTokenTtlMs()
const CODE_TTL_MS = 60 * 1000
const verificationCodes = new Map()
const CV_CACHE_TTL_MS = 10 * 60 * 1000
const cvUploadCache = new Map()

const DB_NAME = getDatabaseName()
const withCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
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
  const avatarText = normalizeAvatarText(row.avatarText, username.slice(0, 1).toUpperCase())
  const avatarBgColor = normalizeHexColor(row.avatarBgColor, DEFAULT_AVATAR_BG_COLOR)

  return {
    id: Number(row.id || 0) || null,
    mail,
    username,
    role: 'normal',
    avatarText,
    avatarBgColor,
  }
}

const readBearerToken = (req) => {
  const raw = String(req.headers.authorization || '').trim()
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ? match[1].trim() : ''
}

const getAuthedUser = async (pool, req) => {
  const token = readBearerToken(req)
  if (!token) return null

  const [rows] = await pool.query(
    `SELECT
        u.id,
        u.email,
        u.username,
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

  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(password, salt)
  const username = deriveUserNameFromEmail(email)
  const avatarText = username.slice(0, 1).toUpperCase() || 'U'
  await pool.query(
    'INSERT INTO users (email, username, avatar_text, avatar_bg_color, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)',
    [
    email,
    username,
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
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await pool.query('DELETE FROM auth_tokens WHERE user_id = ? OR expires_at <= NOW()', [user.id])
  await pool.query('INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [
    user.id,
    tokenDigest(token),
    expiresAt,
  ])

  sendJson(res, 200, {
    token,
    expiresAt: expiresAt.toISOString(),
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
    'SELECT id, email, username, avatar_text AS avatarText, avatar_bg_color AS avatarBgColor FROM users WHERE id = ? LIMIT 1',
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
    sendJson(res, 400, { message: 'dictionary is required' })
    return
  }

  try {
    const saved = saveJobDictionary(dictionary)
    sendJson(res, 200, { message: 'Job dictionary updated', dictionary: saved })
  } catch (error) {
    sendJson(res, 400, { message: error?.message || 'Invalid job dictionary' })
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
  const status = normalizeJobPostStatus(body?.status)
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
  const status = normalizeJobPostStatus(body?.status || existing.status)
  if (!title) {
    sendJson(res, 400, { message: 'title is required' })
    return
  }

  await pool.query('UPDATE job_posts SET title = ?, status = ? WHERE id = ?', [title, status, jobPostId])
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

  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.application_status AS applicationStatus,
        app.matched_score AS matchedScore,
        app.matched_level AS matchedLevel,
        app.matched_position AS matchedPosition,
        app.created_at AS createdAt,
        c.id AS candidateId,
        c.full_name AS fullName,
        c.phone AS phone,
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
        extracts.target_position AS targetPosition
      FROM job_post_applications app
      INNER JOIN candidates c ON c.id = app.candidate_id
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
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
    applications: rows.map((row) => ({
      applicationId: Number(row.applicationId),
      applicationStatus: normalizeText(row.applicationStatus) || 'submitted',
      candidateId: Number(row.candidateId),
      fullName: normalizeText(row.fullName),
      targetPosition: normalizeText(row.targetPosition),
      matchedPosition: normalizeText(row.matchedPosition),
      matchedScore: Number(row.matchedScore || 0),
      matchedLevel: normalizeText(row.matchedLevel) || '',
      phone: normalizeText(row.phone),
      cvId: Number(row.cvId),
      cvFileName: normalizeText(row.cvFileName),
      extractedFileName: row.cvFileName ? `${row.cvFileName}.extracted.txt` : '',
      createdAt: row.createdAt,
    })),
  })
}

const getJobPostApplication = async (pool, _req, res, applicationId) => {
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.job_post_id AS jobPostId,
        app.candidate_id AS candidateId,
        app.candidate_cv_id AS candidateCvId,
        app.application_status AS applicationStatus,
        app.matched_score AS matchedScore,
        app.matched_level AS matchedLevel,
        app.matched_position AS matchedPosition,
        app.created_at AS createdAt,
        c.full_name AS fullName,
        c.email AS email,
        c.phone AS phone,
        cv.original_filename AS cvFileName
      FROM job_post_applications app
      INNER JOIN candidates c ON c.id = app.candidate_id
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

  sendJson(res, 200, {
    application: {
      applicationId: Number(row.applicationId),
      jobPostId: Number(row.jobPostId),
      candidateId: Number(row.candidateId),
      candidateCvId: Number(row.candidateCvId),
      applicationStatus: normalizeText(row.applicationStatus) || 'submitted',
      matchedScore: Number(row.matchedScore || 0),
      matchedLevel: normalizeText(row.matchedLevel),
      matchedPosition: normalizeText(row.matchedPosition),
      fullName: normalizeText(row.fullName),
      email: normalizeText(row.email),
      phone: normalizeText(row.phone),
      cvFileName: normalizeText(row.cvFileName),
      createdAt: row.createdAt,
    },
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

const insertCandidateCv = async (
  pool,
  candidateId,
  fileName,
  mimeType,
  buffer,
  { fullName = '', createdAt = '' } = {}
) => {
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
      (candidate_id, version_no, storage_provider, storage_key, original_filename, mime_type, file_size, sha256)
     VALUES (?, ?, 'local', ?, ?, ?, ?, ?)`,
    [candidateId, nextVersion, storageFileName, renamedFileName, mimeType || 'application/octet-stream', buffer.length, fileHash]
  )

  return {
    id: result.insertId,
    candidateId,
    versionNo: nextVersion,
    originalFileName: renamedFileName,
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

const normalizeJobPostStatus = (value) => {
  const status = normalizeText(value).toLowerCase()
  if (status === 'open' || status === 'draft' || status === 'closed') return status
  return 'open'
}

const parseJobSnapshot = (value) => {
  if (!value) return null
  const parsed = typeof value === 'string' ? parseJsonObject(value) : value
  return parsed && typeof parsed === 'object' ? parsed : null
}

const buildJobSnapshot = (jobKey, dictionaryJob = {}) => ({
  jobKey: normalizeText(jobKey),
  title: normalizeText(dictionaryJob?.title),
  description: normalizeText(dictionaryJob?.description),
  industry: normalizeList(dictionaryJob?.industry, 20),
  roleKeywords: normalizeList(dictionaryJob?.roleKeywords, 20),
  coreResponsibilities: normalizeList(dictionaryJob?.coreResponsibilities, 20),
  requiredSkills: normalizeList(dictionaryJob?.requiredSkills, 20),
  preferredSkills: normalizeList(dictionaryJob?.preferredSkills, 20),
  certifications: normalizeList(dictionaryJob?.certifications, 20),
  minWorkYears: Number(dictionaryJob?.minWorkYears || 0),
  salaryRange: {
    min: Number(dictionaryJob?.salaryRange?.min || 0),
    max: Number(dictionaryJob?.salaryRange?.max || 0),
  },
  weights: dictionaryJob?.weights && typeof dictionaryJob.weights === 'object' ? dictionaryJob.weights : {},
})

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

const createJobPostApplication = async (pool, jobPostId, candidateId, candidateCvId, match = null) => {
  const [result] = await pool.query(
    `INSERT INTO job_post_applications
      (job_post_id, candidate_id, candidate_cv_id, application_status, matched_score, matched_level, matched_position)
     VALUES (?, ?, ?, 'submitted', ?, ?, ?)`,
    [
      jobPostId,
      candidateId,
      candidateCvId,
      match ? Number(match.matchScore || 0) : null,
      match ? normalizeText(match.matchLevel) || null : null,
      match ? normalizeText(match.matchedPosition || match.jobTitle) || null : null,
    ]
  )
  return Number(result.insertId)
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

const listCandidateCvJobMatches = async (pool, candidateCvId) => {
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
        created_at AS createdAt
      FROM candidate_cv_job_matches
      WHERE candidate_cv_id = ?
      ORDER BY rank_no ASC, id ASC`,
    [candidateCvId]
  )

  return rows.map((row) => ({
    jobKey: normalizeText(row.jobKey),
    jobTitle: normalizeText(row.jobTitle),
    rankNo: Number(row.rankNo || 0),
    matchScore: Number(row.matchScore || 0),
    matchLevel: normalizeText(row.matchLevel) || 'medium',
    reasonSummary: normalizeText(row.reasonSummary),
    strengths: normalizeList(parseJsonObject(row.strengthsJson), 10),
    gaps: normalizeList(parseJsonObject(row.gapsJson), 10),
    createdAt: row.createdAt,
  }))
}

const runCandidateCvMatching = async (pool, candidateId, candidateCvId, extracted) => {
  const matches = await matchCandidateToJobs(extracted, getJobDictionary())
  await replaceCandidateCvJobMatches(pool, candidateId, candidateCvId, matches)
  return matches
}

const runJobPostApplicationMatching = async (pool, { applicationId = null, candidateId, candidateCvId, extracted, jobSnapshot }) => {
  const match = await matchCandidateToJobPost(extracted, jobSnapshot)
  const matches = match ? [{ ...match, rankNo: 1 }] : []
  await replaceCandidateCvJobMatches(pool, candidateId, candidateCvId, matches)
  if (applicationId) {
    await updateJobPostApplicationMatch(pool, applicationId, match)
  }
  return match
}

const computeMissingFields = (extracted = {}) => {
  const profile = extracted?.profile && typeof extracted.profile === 'object' ? extracted.profile : {}

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
    { key: 'languages', value: profile.languages },
    { key: 'technicalLanguages', value: profile.technicalLanguages },
    { key: 'technicalCertificates', value: profile.technicalCertificates },
    { key: 'industry', value: profile.industry },
    { key: 'projectExperience', value: profile.projectExperience },
    { key: 'targetPosition', value: profile.targetPosition },
    { key: 'expectedSalary', value: profile.expectedSalary },
    { key: 'onboardingPreference', value: profile.onboardingPreference },
  ]

  return requiredFieldDefs
    .filter((field) => isMissingValue(field.value))
    .map((field) => field.key)
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
    languages: { kind: 'list', target: 'profile', limit: 20 },
    technicalLanguages: { kind: 'list', target: 'profile', limit: 30 },
    technicalCertificates: { kind: 'list', target: 'profile', limit: 20 },
    industry: { kind: 'text', target: 'profile' },
    projectExperience: { kind: 'text', target: 'profile' },
    targetPosition: { kind: 'list', target: 'profile', limit: 10 },
    expectedSalary: { kind: 'text', target: 'profile' },
    onboardingPreference: { kind: 'text', target: 'profile' },
  }

  const config = map[fieldKey]
  if (!config) return { error: 'fieldKey is not editable' }

  if (config.kind === 'list') {
    const list = normalizeList(inputValue, config.limit || 20)
    if (config.target === 'profile') root.profile[fieldKey] = list
    else root[fieldKey] = list
    return { extracted: root }
  }

  let text = normalizeText(inputValue)
  if (config.lower) text = text.toLowerCase()
  if (config.required && !text) return { error: `${fieldKey} cannot be empty` }

  if (config.target === 'profile') root.profile[fieldKey] = text
  else root[fieldKey] = text

  return { extracted: root }
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
    ['projectExperience', sourceProfile.projectExperience],
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

  return { extracted: next }
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

  const { fileName, mimeType, buffer } = cached
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
  })
  const targetPosition = Array.isArray(finalExtracted?.profile?.targetPosition)
    ? finalExtracted.profile.targetPosition.join(', ')
    : ''
  const extractedText = JSON.stringify(
    {
      extracted: finalExtracted,
      missingFields: finalMissingFields,
      parser,
    },
    null,
    2
  )
  await insertCandidateCvExtraction(pool, candidateId, cv.id, {
    targetPosition,
    cvText,
    extractedText,
  })
  const applicationId = await createJobPostApplication(pool, jobPostId, candidateId, cv.id, null)
  const match = await runJobPostApplicationMatching(pool, {
    applicationId,
    candidateId,
    candidateCvId: cv.id,
    extracted: finalExtracted,
    jobSnapshot: jobPost.jobSnapshot,
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
  })
  const cvText = await extractTextFromBuffer(buffer, fileName, mimeType)
  await insertCandidateCvExtraction(pool, candidateId, cv.id, {
    cvText,
    extractedText: '',
  })
  sendJson(res, 201, { message: 'CV uploaded', cv })
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
    extractedFileName: row.cvFileName ? `${row.cvFileName}.extracted.txt` : '',
    hasDownload: !!row.cvId,
    hasCvPreview: Number(row.hasCvPreview || 0) === 1,
    hasExtractedPreview: Number(row.hasExtractedPreview || 0) === 1,
    createdAt: row.createdAt,
  }))

  sendJson(res, 200, { candidates: tableRows })
}

const listAllJobPostApplicationsTable = async (pool, _req, res) => {
  const [rows] = await pool.query(
    `SELECT
        app.id AS applicationId,
        app.application_status AS applicationStatus,
        app.matched_score AS matchedScore,
        app.matched_level AS matchedLevel,
        app.matched_position AS matchedPosition,
        app.created_at AS createdAt,
        jp.id AS jobPostId,
        jp.title AS jobPostTitle,
        c.id AS candidateId,
        c.full_name AS fullName,
        c.phone AS phone,
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
        COALESCE(extracts.target_position, '') AS targetPosition,
        CASE WHEN extracts.cv_text IS NOT NULL AND extracts.cv_text <> '' THEN 1 ELSE 0 END AS hasCvPreview,
        CASE WHEN extracts.extracted_text IS NOT NULL AND extracts.extracted_text <> '' THEN 1 ELSE 0 END AS hasExtractedPreview
      FROM job_post_applications app
      INNER JOIN job_posts jp ON jp.id = app.job_post_id
      INNER JOIN candidates c ON c.id = app.candidate_id
      INNER JOIN candidate_cvs cv ON cv.id = app.candidate_cv_id
      LEFT JOIN candidate_cv_extractions extracts ON extracts.candidate_cv_id = cv.id
      ORDER BY app.created_at DESC, app.id DESC`
  )

  sendJson(res, 200, {
    applications: rows.map((row) => ({
      applicationId: Number(row.applicationId),
      applicationStatus: normalizeText(row.applicationStatus) || 'submitted',
      matchedScore: Number(row.matchedScore || 0),
      matchedLevel: normalizeText(row.matchedLevel),
      matchedPosition: normalizeText(row.matchedPosition),
      createdAt: row.createdAt,
      jobPostId: Number(row.jobPostId),
      jobPostTitle: normalizeText(row.jobPostTitle),
      candidateId: Number(row.candidateId),
      fullName: normalizeText(row.fullName),
      phone: normalizeText(row.phone),
      cvId: Number(row.cvId),
      cvFileName: normalizeText(row.cvFileName),
      extractedFileName: row.cvFileName ? `${row.cvFileName}.extracted.txt` : '',
      targetPosition: normalizeText(row.targetPosition),
      hasCvPreview: Number(row.hasCvPreview || 0) === 1,
      hasExtractedPreview: Number(row.hasExtractedPreview || 0) === 1,
    })),
  })
}

const getCandidateCvPreview = async (pool, _req, res, candidateCvId, previewType) => {
  const type = previewType === 'extracted' ? 'extracted' : 'cv'
  const [rows] = await pool.query(
    `SELECT
        cv.id AS cvId,
        cv.original_filename AS cvFileName,
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
  const extractedText = JSON.stringify(payload, null, 2)

  await pool.query(
    `INSERT INTO candidate_cv_extractions
      (candidate_id, candidate_cv_id, target_position, extracted_text)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      target_position = VALUES(target_position),
      extracted_text = VALUES(extracted_text)`,
    [Number(row.candidateId), candidateCvId, targetPosition || null, extractedText]
  )

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

  sendJson(res, 200, {
    message: 'Extracted field updated',
    cvId: Number(candidateCvId),
    fieldKey,
    text: extractedText,
    extracted: payload.extracted,
    missingFields: payload.missingFields,
    parser: payload.parser,
    match,
  })
}

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
  const extractedText = JSON.stringify(payload, null, 2)

  await pool.query(
    `INSERT INTO candidate_cv_extractions
      (candidate_id, candidate_cv_id, target_position, extracted_text)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      target_position = VALUES(target_position),
      extracted_text = VALUES(extracted_text)`,
    [Number(row.candidateId), candidateCvId, targetPosition || null, extractedText]
  )

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

  sendJson(res, 200, {
    message: 'Extracted fields updated',
    cvId: Number(candidateCvId),
    updatedFields: entries.map(([key]) => normalizeText(key)).filter(Boolean),
    text: extractedText,
    extracted: payload.extracted,
    missingFields: payload.missingFields,
    parser: payload.parser,
    match,
  })
}

const downloadCandidateCv = async (pool, _req, res, candidateCvId) => {
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

  withCors(res)
  res.writeHead(200, {
    'Content-Type': row.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
  })

  const stream = fs.createReadStream(storagePath)
  stream.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 500, { message: 'Failed to read CV file' })
      return
    }
    res.destroy()
  })
  stream.pipe(res)
}

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

const start = async () => {
  loadJobDictionary()
  await ensureDatabaseExists()
  const pool = createDatabasePool()
  await ensureAuthTables(pool)
  await ensureCvTables(pool)

  const port = process.env.PORT || 3001
  const server = http.createServer(async (req, res) => {
    withCors(res)
    if (!req.url) return sendJson(res, 404, { message: 'Not found' })
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, `http://${req.headers.host}`)
    try {
      if (url.pathname === '/api/auth/request-code' && req.method === 'POST') return requestCode(req, res)
      if (url.pathname === '/api/auth/register' && req.method === 'POST') return registerUser(pool, req, res)
      if (url.pathname === '/api/auth/login' && req.method === 'POST') return loginUser(pool, req, res)
      if (url.pathname === '/api/auth/profile' && req.method === 'GET') return getMyProfile(pool, req, res)
      if (url.pathname === '/api/auth/profile' && req.method === 'POST') return updateMyProfile(pool, req, res)
      if (url.pathname === '/api/auth/change-password' && req.method === 'POST') return changeMyPassword(pool, req, res)
      if (url.pathname === '/api/job-dictionary' && req.method === 'GET') return getJobDictionaryHandler(pool, req, res)
      if (url.pathname === '/api/job-dictionary' && req.method === 'PUT') return updateJobDictionaryHandler(pool, req, res)
      if (url.pathname === '/api/job-posts' && req.method === 'GET') return listJobPosts(pool, req, res)
      if (url.pathname === '/api/job-posts' && req.method === 'POST') return createJobPost(pool, req, res)

      if (url.pathname === '/api/candidates' && req.method === 'POST') return createCandidate(pool, req, res)
      if (url.pathname === '/api/candidates' && req.method === 'GET') return listCandidates(pool, req, res)
      if (url.pathname === '/api/candidates/cv-table' && req.method === 'GET') return listCandidateCvTable(pool, req, res)
      if (url.pathname === '/api/job-post-applications/table' && req.method === 'GET') {
        return listAllJobPostApplicationsTable(pool, req, res)
      }
      if (url.pathname === '/api/candidates/batch-delete' && req.method === 'POST') return deleteCandidatesBatch(pool, req, res)
      if (url.pathname === '/api/cv/cache' && req.method === 'POST') return cacheCvUpload(pool, req, res)
      if (url.pathname === '/api/cv/parse' && req.method === 'POST') return parseCvFromCache(pool, req, res)
      if (url.pathname === '/api/cv/intake' && req.method === 'POST') return intakeCv(pool, req, res)

      const jobPostDetailMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)$/)
      if (jobPostDetailMatch && req.method === 'GET') return getJobPostDetail(pool, req, res, Number(jobPostDetailMatch[1]))
      if (jobPostDetailMatch && req.method === 'PUT') return updateJobPost(pool, req, res, Number(jobPostDetailMatch[1]))
      if (jobPostDetailMatch && req.method === 'DELETE') return deleteJobPost(pool, req, res, Number(jobPostDetailMatch[1]))

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
        return parseCvFromCache(pool, req, res, Number(jobPostParseMatch[1]))
      }

      const jobPostIntakeMatch = url.pathname.match(/^\/api\/job-posts\/(\d+)\/cv\/intake$/)
      if (jobPostIntakeMatch && req.method === 'POST') {
        return intakeCv(pool, req, res, Number(jobPostIntakeMatch[1]))
      }

      const applicationMatch = url.pathname.match(/^\/api\/job-post-applications\/(\d+)$/)
      if (applicationMatch && req.method === 'GET') {
        return getJobPostApplication(pool, req, res, Number(applicationMatch[1]))
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

      const previewMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/preview$/)
      if (previewMatch && req.method === 'GET') {
        const previewType = String(url.searchParams.get('type') || 'cv').trim().toLowerCase()
        return getCandidateCvPreview(pool, req, res, Number(previewMatch[1]), previewType)
      }

      const jobMatchesMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/job-matches$/)
      if (jobMatchesMatch && req.method === 'GET') {
        return getCandidateCvJobMatches(pool, req, res, Number(jobMatchesMatch[1]))
      }

      const updateExtractedMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/extracted-field$/)
      if (updateExtractedMatch && req.method === 'POST') {
        return updateCandidateCvExtractedField(pool, req, res, Number(updateExtractedMatch[1]))
      }

      const updateExtractedBatchMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/extracted-fields$/)
      if (updateExtractedBatchMatch && req.method === 'POST') {
        return updateCandidateCvExtractedFields(pool, req, res, Number(updateExtractedBatchMatch[1]))
      }

      const downloadMatch = url.pathname.match(/^\/api\/candidate-cvs\/(\d+)\/download$/)
      if (downloadMatch && req.method === 'GET') {
        return downloadCandidateCv(pool, req, res, Number(downloadMatch[1]))
      }

      const completeProfileMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/complete-profile$/)
      if (completeProfileMatch && req.method === 'POST') return completeCandidateProfile(pool, req, res, Number(completeProfileMatch[1]))

      const candidateMatch = url.pathname.match(/^\/api\/candidates\/(\d+)$/)
      if (candidateMatch && req.method === 'DELETE') return deleteCandidate(pool, req, res, Number(candidateMatch[1]))

      return sendJson(res, 404, { message: 'Not found' })
    } catch (error) {
      console.error(error)
      const statusCode = getErrorStatusCode(error)
      const message = error instanceof HttpError
        ? error.message
        : String(error?.message || 'Internal server error')
      return sendJson(res, statusCode, { message })
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
