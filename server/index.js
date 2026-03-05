import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  createDatabasePool,
  ensureAuthTables,
  ensureCvTables,
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
const cvPromptPath = path.resolve(__dirname, './prompts/cv-feature-extraction.prompt.txt')

const llmApiUrl = process.env.CV_LLM_API_URL || process.env.LLM_BASE_URL || process.env.LLM_API_URL || ''
const llmApiKey = process.env.CV_LLM_API_KEY || process.env.LLM_API_KEY || ''
const llmModel = process.env.CV_LLM_MODEL || process.env.LLM_MODEL || ''
const cvLlmPrompt =
  process.env.CV_LLM_PROMPT ||
  (fs.existsSync(cvPromptPath)
    ? fs.readFileSync(cvPromptPath, 'utf8').trim()
    : '你是資深 HR 履歷解析助理。請從履歷文字中提取 fullName、email、phone、keywords，並只輸出 JSON 物件。')

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
const sha256Buffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

const safeJsonParse = (value) => {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const parseLlmContentToJson = (content) => {
  if (!content) return null
  if (typeof content === 'object') return content
  const direct = safeJsonParse(content)
  if (direct) return direct

  const fenced = String(content).match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const parsed = safeJsonParse(fenced[1].trim())
    if (parsed) return parsed
  }
  return null
}

const extractKeywordsFromLlmJson = (llmJson) => {
  if (!llmJson || typeof llmJson !== 'object') return []
  const candidates = [llmJson.keywords, llmJson.skills, llmJson.tags]
  const flattened = candidates
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  return [...new Set(flattened)].slice(0, 20)
}

const normalizeExtractedFields = (raw = {}) => {
  const extracted = {
    fullName: String(raw.fullName || '').trim(),
    email: String(raw.email || '').trim().toLowerCase(),
    phone: String(raw.phone || '').trim(),
  }
  const missingFields = []
  if (!extracted.fullName) missingFields.push('fullName')
  if (!extracted.email) missingFields.push('email')
  if (!extracted.phone) missingFields.push('phone')
  return { extracted, missingFields, llmJson: null, keywords: [] }
}

const extractCandidateInfoByRegex = (buffer) => {
  const text = buffer.toString('utf8')
  const normalized = text.replace(/\r/g, '\n')

  const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const phoneMatch = normalized.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/)
  const nameMatch =
    normalized.match(/(?:姓名|Name)\s*[:：]\s*([^\n]+)/i) ||
    normalized.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s]{1,30})$/mu)

  return normalizeExtractedFields({
    fullName: nameMatch?.[1] || '',
    email: emailMatch?.[0] || '',
    phone: phoneMatch?.[0] || '',
  })
}

const extractTextFromDocxBuffer = (buffer) =>
  new Promise((resolve) => {
    const pythonScript = [
      'import sys, zipfile, io, re',
      'from xml.etree import ElementTree as ET',
      'data = sys.stdin.buffer.read()',
      'try:',
      '    z = zipfile.ZipFile(io.BytesIO(data))',
      "    names = [n for n in z.namelist() if n.startswith('word/') and n.endswith('.xml')]",
      '    texts = []',
      '    for name in names:',
      "        if 'rels' in name: continue",
      '        try:',
      '            root = ET.fromstring(z.read(name))',
      "            for node in root.findall('.//{*}t'):",
      "                if node.text: texts.append(node.text)",
      '        except Exception:',
      '            continue',
      "    result = '\\n'.join(texts)",
      '    sys.stdout.write(result)',
      'except Exception:',
      "    sys.stdout.write('')",
    ].join('\n')

    const proc = spawn('python', ['-c', pythonScript])
    let output = ''
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    proc.on('error', () => resolve(''))
    proc.on('close', () => resolve(output.trim()))
    proc.stdin.end(buffer)
  })

const decodePdfTextLiteral = (value) =>
  value
    .replace(/\\\\/g, '\\\\')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')

const extractTextFromPdfBuffer = (buffer) => {
  const source = buffer.toString('latin1')
  const pieces = []

  for (const match of source.matchAll(/\(([^()]*)\)\s*Tj/g)) {
    if (match[1]) pieces.push(decodePdfTextLiteral(match[1]))
  }

  for (const match of source.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const segment = match[1] || ''
    const textParts = [...segment.matchAll(/\(([^()]*)\)/g)].map((part) => decodePdfTextLiteral(part[1]))
    if (textParts.length) pieces.push(textParts.join(''))
  }

  return pieces.join('\n').replace(/\s{2,}/g, ' ').trim()
}

const extractTextFromBuffer = async (buffer, fileName = '', mimeType = '') => {
  const normalizedName = String(fileName || '').toLowerCase()
  const normalizedType = String(mimeType || '').toLowerCase()

  if (normalizedName.endsWith('.docx') || normalizedType.includes('wordprocessingml')) {
    const text = await extractTextFromDocxBuffer(buffer)
    if (text) return text
  }

  if (normalizedName.endsWith('.pdf') || normalizedType.includes('pdf')) {
    const text = extractTextFromPdfBuffer(buffer)
    if (text) return text
  }

  return buffer.toString('utf8')
}

const extractCandidateInfoByLlm = async (cvText) => {
  if (!llmApiUrl || !llmModel) return null
  const response = await fetch(llmApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : {}),
    },
    body: JSON.stringify({
      model: llmModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: cvLlmPrompt },
        { role: 'user', content: `履歷文字內容：\n${cvText}` },
      ],
      temperature: 0,
    }),
  })
  if (!response.ok) return null
  const data = await response.json()
  return data?.choices?.[0]?.message?.content || null
}

const extractCandidateInfoFromCv = async (buffer, fileName = '', mimeType = '') => {
  const cvText = (await extractTextFromBuffer(buffer, fileName, mimeType)).slice(0, 12000)
  if (!cvText.trim()) return extractCandidateInfoByRegex(buffer)

  try {
    const content = await extractCandidateInfoByLlm(cvText)
    if (!content) return extractCandidateInfoByRegex(buffer)

    const parsed = parseLlmContentToJson(content)
    if (!parsed) return extractCandidateInfoByRegex(buffer)

    const normalized = normalizeExtractedFields(parsed)
    return {
      ...normalized,
      llmJson: parsed,
      keywords: extractKeywordsFromLlmJson(parsed),
    }
  } catch (error) {
    console.warn('[CV] LLM parse failed, fallback to regex:', error?.message || error)
    return extractCandidateInfoByRegex(buffer)
  }
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
  ensureCvStorageDir()
  const savedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${sanitizeFileName(fileName)}`
  const savePath = path.join(cvStorageDir, savedName)
  fs.writeFileSync(savePath, buffer)

  const [versionRows] = await pool.query(
    'SELECT COALESCE(MAX(version_no), 0) AS maxVersion FROM candidate_cvs WHERE candidate_id = ?',
    [candidateId]
  )
  const nextVersion = Number(versionRows[0]?.maxVersion || 0) + 1
  const fileHash = sha256Buffer(buffer)

  const [result] = await pool.query(
    `INSERT INTO candidate_cvs
      (candidate_id, version_no, storage_provider, storage_key, original_filename, mime_type, file_size, sha256)
     VALUES (?, ?, 'local', ?, ?, ?, ?, ?)`,
    [candidateId, nextVersion, savedName, fileName, mimeType || 'application/octet-stream', buffer.length, fileHash]
  )

  return {
    id: result.insertId,
    candidateId,
    versionNo: nextVersion,
    originalFileName: fileName,
    size: buffer.length,
    storagePath: `server/storage/cv/${savedName}`,
  }
}

const intakeCv = async (pool, req, res) => {
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
