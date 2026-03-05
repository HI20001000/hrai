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
import { extractCandidateInfoFromCv } from './scripts/llm/cv-extractor.js'
import { extractTextFromBuffer } from './scripts/llm/text-extractors.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

const TOKEN_TTL_MS = 60 * 60 * 1000
const CODE_TTL_MS = 60 * 1000
const verificationCodes = new Map()
const CV_CACHE_TTL_MS = 10 * 60 * 1000
const cvUploadCache = new Map()

const DB_NAME = getDatabaseName()
const withCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

const sendJson = (res, status, payload) => {
  withCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
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

const sanitizeFileName = (name) => String(name || 'cv-upload').replace(/[^a-zA-Z0-9._-]/g, '_')
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
  cvUploadCache.set(cacheId, { fileName, mimeType, buffer, expiresAt })
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
  await pool.query('INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)', [
    email,
    passwordHash,
    salt,
  ])
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

  const [rows] = await pool.query('SELECT id, email, password_hash, password_salt FROM users WHERE email = ? LIMIT 1', [email])
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
    user: { mail: user.email, username: user.email.split('@')[0] || 'user', role: 'normal' },
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

const insertCandidateCv = async (pool, candidateId, fileName, mimeType, buffer) => {
  const safeFileName = sanitizeFileName(fileName)
  const [versionRows] = await pool.query(
    'SELECT COALESCE(MAX(version_no), 0) AS maxVersion FROM candidate_cvs WHERE candidate_id = ?',
    [candidateId]
  )
  const nextVersion = Number(versionRows[0]?.maxVersion || 0) + 1
  const fileHash = sha256Buffer(buffer)
  const virtualStorageKey = `frontend-only/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeFileName}`

  const [result] = await pool.query(
    `INSERT INTO candidate_cvs
      (candidate_id, version_no, storage_provider, storage_key, original_filename, mime_type, file_size, sha256)
     VALUES (?, ?, 'frontend', ?, ?, ?, ?, ?)`,
    [candidateId, nextVersion, virtualStorageKey, fileName, mimeType || 'application/octet-stream', buffer.length, fileHash]
  )

  return {
    id: result.insertId,
    candidateId,
    versionNo: nextVersion,
    originalFileName: fileName,
    size: buffer.length,
    storagePath: null,
  }
}

const cacheCvUpload = async (req, res) => {
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


const intakeCv = async (pool, req, res) => {
  const body = await parseBody(req)
  const cacheId = String(body?.cacheId || '').trim()
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
  const cvText = await extractTextFromBuffer(buffer, fileName, mimeType)
  console.log('[CV] Cached extraction debug:', { cacheId, fileName, mimeType, size: buffer.length, extractedLength: cvText.length })
  console.log('[CV] Cached CV extracted text:')
  console.log(cvText || '(empty)')

  const extraction = await extractCandidateInfoFromCv(buffer, fileName, mimeType)
  const derivedName = extraction.extracted.fullName || '待補候選人姓名'
  const derivedEmail = extraction.extracted.email || null
  const derivedPhone = extraction.extracted.phone || null

  const [candidateResult] = await pool.query(
    'INSERT INTO candidates (full_name, email, phone) VALUES (?, ?, ?)',
    [derivedName, derivedEmail, derivedPhone]
  )

  const candidateId = Number(candidateResult.insertId)
  const cv = await insertCandidateCv(pool, candidateId, fileName, mimeType, buffer)

  sendJson(res, 201, {
    message: 'CV uploaded and parsed',
    candidate: {
      id: candidateId,
      fullName: derivedName,
      email: derivedEmail,
      phone: derivedPhone,
      extracted: extraction.extracted,
      missingFields: extraction.missingFields,
      llmJson: extraction.llmJson,
      keywords: extraction.keywords,
      parser: extraction.llmJson ? 'llm' : 'regex',
    },
    cv,
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

  const [candidateRows] = await pool.query('SELECT id FROM candidates WHERE id = ? LIMIT 1', [candidateId])
  if (!candidateRows.length) {
    sendJson(res, 404, { message: 'Candidate not found' })
    return
  }

  const buffer = Buffer.from(contentBase64, 'base64')
  if (!buffer.length) {
    sendJson(res, 400, { message: 'Invalid file content' })
    return
  }

  const cv = await insertCandidateCv(pool, candidateId, fileName, mimeType, buffer)
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

const start = async () => {
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

      if (url.pathname === '/api/candidates' && req.method === 'POST') return createCandidate(pool, req, res)
      if (url.pathname === '/api/candidates' && req.method === 'GET') return listCandidates(pool, req, res)
      if (url.pathname === '/api/cv/cache' && req.method === 'POST') return cacheCvUpload(req, res)
      if (url.pathname === '/api/cv/intake' && req.method === 'POST') return intakeCv(pool, req, res)

      const uploadMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/cvs$/)
      if (uploadMatch && req.method === 'POST') return uploadCandidateCv(pool, req, res, Number(uploadMatch[1]))
      if (uploadMatch && req.method === 'GET') return listCandidateCvs(pool, req, res, Number(uploadMatch[1]))

      const completeProfileMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/complete-profile$/)
      if (completeProfileMatch && req.method === 'POST') return completeCandidateProfile(pool, req, res, Number(completeProfileMatch[1]))

      return sendJson(res, 404, { message: 'Not found' })
    } catch (error) {
      console.error(error)
      return sendJson(res, 500, { message: 'Internal server error' })
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
