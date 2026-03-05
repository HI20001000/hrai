import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDatabasePool,
  ensureAuthTables,
  ensureDatabaseExists,
  getDatabaseName,
} from './scripts/database/index.js'

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

const DB_NAME = getDatabaseName()
const cvStorageDir = path.resolve(__dirname, './storage/cv')

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



const ensureCvStorageDir = () => {
  if (!fs.existsSync(cvStorageDir)) {
    fs.mkdirSync(cvStorageDir, { recursive: true })
  }
}

const sanitizeFileName = (name) => String(name || 'cv-upload').replace(/[^a-zA-Z0-9._-]/g, '_')

const uploadCv = async (req, res) => {
  const body = await parseBody(req)
  const fileName = sanitizeFileName(body?.fileName)
  const contentBase64 = body?.contentBase64
  if (!fileName || !contentBase64) {
    sendJson(res, 400, { message: 'fileName and contentBase64 are required' })
    return
  }

  const buffer = Buffer.from(contentBase64, 'base64')
  if (!buffer.length) {
    sendJson(res, 400, { message: 'Invalid file content' })
    return
  }

  ensureCvStorageDir()
  const savedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`
  const savePath = path.join(cvStorageDir, savedName)
  fs.writeFileSync(savePath, buffer)

  sendJson(res, 201, {
    message: 'CV uploaded',
    file: {
      name: savedName,
      originalName: fileName,
      size: buffer.length,
      path: `server/storage/cv/${savedName}`,
    },
  })
}

const listCvFiles = async (_req, res) => {
  ensureCvStorageDir()
  const files = fs.readdirSync(cvStorageDir).filter((name) => !name.startsWith('.')).map((name) => {
    const fullPath = path.join(cvStorageDir, name)
    const stat = fs.statSync(fullPath)
    return {
      name,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }
  })

  files.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  sendJson(res, 200, { files })
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

const start = async () => {
  await ensureDatabaseExists()
  const pool = createDatabasePool()
  await ensureAuthTables(pool)

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
      if (url.pathname === '/api/cv/upload' && req.method === 'POST') return uploadCv(req, res)
      if (url.pathname === '/api/cv/files' && req.method === 'GET') return listCvFiles(req, res)
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
