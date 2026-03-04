import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const TOKEN_TTL_MS = 60 * 60 * 1000

const withCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

const sendJson = (res, status, payload) => {
  withCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const parseBody = async (req) => {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

const createAuthToken = () => crypto.randomBytes(32).toString('hex')

const loginUser = async (req, res) => {
  const body = await parseBody(req)
  const email = body?.email?.trim()
  const password = body?.password
  if (!email || !password) {
    sendJson(res, 400, { message: 'Email and password are required' })
    return
  }
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  sendJson(res, 200, {
    token: createAuthToken(),
    expiresAt,
    user: {
      mail: email,
      username: email.split('@')[0] || 'user',
      role: 'normal',
    },
  })
}

const start = async () => {
  const port = process.env.PORT || 3001
  const server = http.createServer(async (req, res) => {
    withCors(res)
    if (!req.url) {
      sendJson(res, 404, { message: 'Not found' })
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      await loginUser(req, res)
      return
    }
    sendJson(res, 404, { message: 'Not found' })
  })
  server.listen(port, () => {
    console.log(`Server listening on ${port}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
