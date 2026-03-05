import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const runPythonScript = (script, buffer) =>
  new Promise((resolve) => {
    const interpreters = ['python3', 'python']
    const execute = (index) => {
      if (index >= interpreters.length) {
        resolve('')
        return
      }

      const proc = spawn(interpreters[index], ['-X', 'utf8', '-c', script], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      })
      let output = ''
      proc.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8')
      })
      proc.on('error', () => execute(index + 1))
      proc.on('close', () => {
        if (output.trim()) {
          resolve(output.trim())
          return
        }
        execute(index + 1)
      })
      proc.stdin.end(buffer)
    }

    execute(0)
  })

const runUnzipDocxExtract = (buffer) =>
  new Promise((resolve) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrai-docx-'))
    const filePath = path.join(tempDir, 'uploaded.docx')
    fs.writeFileSync(filePath, buffer)

    const proc = spawn('unzip', ['-p', filePath, 'word/document.xml'])
    let xmlOutput = ''
    proc.stdout.on('data', (chunk) => {
      xmlOutput += chunk.toString('utf8')
    })
    proc.on('error', () => {
      fs.rmSync(tempDir, { recursive: true, force: true })
      resolve('')
    })
    proc.on('close', () => {
      fs.rmSync(tempDir, { recursive: true, force: true })
      const source = xmlOutput
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<w:cr\b[^>]*\/>/g, '\n')
      const text = [...source.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((match) => match[1])
        .join('')
        .replace(/\s{3,}/g, ' ')
        .trim()
      resolve(text)
    })
  })

const looksLikeZip = (buffer) => buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b

const looksLikeDocx = (buffer, fileName = '', mimeType = '') => {
  const normalizedName = String(fileName || '').toLowerCase()
  const normalizedType = String(mimeType || '').toLowerCase()
  if (normalizedName.endsWith('.docx') || normalizedType.includes('wordprocessingml')) return true
  if (!looksLikeZip(buffer)) return false
  return buffer.toString('latin1').includes('word/document.xml')
}

const isLikelyTextBuffer = (buffer) => {
  if (!buffer.length) return false
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let suspiciousCount = 0
  for (const byte of sample) {
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13
    if (isControl || byte === 0) suspiciousCount += 1
  }
  return suspiciousCount / sample.length < 0.2
}

export const extractTextFromDocxBuffer = async (buffer) => {
  const pythonScript = [
    'import io, re, sys, zipfile',
    'from xml.etree import ElementTree as ET',
    'data = sys.stdin.buffer.read()',
    'try:',
    '    z = zipfile.ZipFile(io.BytesIO(data))',
    "    names = z.namelist()",
    "    targets = ['word/document.xml']",
    "    targets += sorted([n for n in names if n.startswith('word/header') and n.endswith('.xml')])",
    "    targets += sorted([n for n in names if n.startswith('word/footer') and n.endswith('.xml')])",
    '    paragraphs = []',
    '    for name in targets:',
    '        if name not in names: continue',
    '        try:',
    '            root = ET.fromstring(z.read(name))',
    '        except Exception:',
    '            continue',
    "        for p in root.findall('.//{*}p'):",
    '            chunks = []',
    '            for node in p.iter():',
    "                tag = str(getattr(node, 'tag', ''))",
    "                if tag.endswith('}t') and node.text:",
    '                    chunks.append(node.text)',
    "                elif tag.endswith('}tab'):",
    "                    chunks.append('\\t')",
    "                elif tag.endswith('}br') or tag.endswith('}cr'):",
    "                    chunks.append('\\n')",
    "            text = ''.join(chunks).strip()",
    '            if text:',
    '                paragraphs.append(text)',
    "    out = '\\n'.join(paragraphs)",
    "    out = re.sub(r'\\n{3,}', '\\n\\n', out)",
    '    sys.stdout.write(out)',
    'except Exception:',
    "    sys.stdout.write('')",
  ].join('\n')

  const pythonText = await runPythonScript(pythonScript, buffer)
  if (pythonText) return pythonText
  return runUnzipDocxExtract(buffer)
}

const decodePdfLiteralBytes = (value) => {
  const bytes = []
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch !== '\\') {
      bytes.push(ch.charCodeAt(0) & 0xff)
      continue
    }

    const next = value[i + 1]
    if (!next) break

    if (next === '\r' || next === '\n') {
      i += 1
      if (next === '\r' && value[i + 1] === '\n') i += 1
      continue
    }
    if (next === 'n') {
      bytes.push(10)
      i += 1
      continue
    }
    if (next === 'r') {
      bytes.push(13)
      i += 1
      continue
    }
    if (next === 't') {
      bytes.push(9)
      i += 1
      continue
    }
    if (next === 'b') {
      bytes.push(8)
      i += 1
      continue
    }
    if (next === 'f') {
      bytes.push(12)
      i += 1
      continue
    }
    if (next === '(' || next === ')' || next === '\\') {
      bytes.push(next.charCodeAt(0))
      i += 1
      continue
    }
    if (/[0-7]/.test(next)) {
      const oct = (value.slice(i + 1, i + 4).match(/^[0-7]{1,3}/) || [''])[0]
      if (oct) {
        bytes.push(parseInt(oct, 8) & 0xff)
        i += oct.length
        continue
      }
    }

    bytes.push(next.charCodeAt(0) & 0xff)
    i += 1
  }
  return Buffer.from(bytes)
}

const decodePdfHexBytes = (hexValue) => {
  const normalized = String(hexValue || '').replace(/\s+/g, '').replace(/>$/g, '')
  if (!normalized) return Buffer.alloc(0)
  const evenHex = normalized.length % 2 === 0 ? normalized : `${normalized}0`
  return Buffer.from(evenHex, 'hex')
}

const decodeUtf16 = (bytes, littleEndian = false) => {
  let result = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? (bytes[i + 1] << 8) | bytes[i]
      : (bytes[i] << 8) | bytes[i + 1]
    result += String.fromCharCode(code)
  }
  return result
}

const decodePdfTextBytes = (bytes) => {
  if (!bytes.length) return ''

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16(bytes.subarray(2), false)
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16(bytes.subarray(2), true)
  }

  const nullRatio = bytes.reduce((count, b) => count + (b === 0 ? 1 : 0), 0) / bytes.length
  const highRatio = bytes.reduce((count, b) => count + (b > 0x7f ? 1 : 0), 0) / bytes.length
  if (bytes.length % 2 === 0 && (nullRatio > 0.1 || highRatio > 0.3)) {
    return decodeUtf16(bytes, false)
  }

  const utf8 = bytes.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  return bytes.toString('latin1')
}

const decodeAscii85Buffer = (buffer) => {
  let source = buffer.toString('latin1').replace(/\s+/g, '')
  source = source.replace(/^<~/, '')
  const end = source.indexOf('~>')
  if (end >= 0) source = source.slice(0, end)
  if (!source) return Buffer.alloc(0)

  const out = []
  let tuple = []

  for (const ch of source) {
    if (ch === 'z' && tuple.length === 0) {
      out.push(0, 0, 0, 0)
      continue
    }

    const code = ch.charCodeAt(0)
    if (code < 33 || code > 117) continue
    tuple.push(code - 33)

    if (tuple.length === 5) {
      let value = 0
      for (const digit of tuple) value = value * 85 + digit
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
      tuple = []
    }
  }

  if (tuple.length > 0) {
    const pad = 5 - tuple.length
    while (tuple.length < 5) tuple.push(84)
    let value = 0
    for (const digit of tuple) value = value * 85 + digit
    const tail = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
    out.push(...tail.slice(0, 4 - pad))
  }

  return Buffer.from(out)
}

const decodeAsciiHexBuffer = (buffer) => {
  const source = buffer.toString('latin1').replace(/\s+/g, '')
  const end = source.indexOf('>')
  const hex = end >= 0 ? source.slice(0, end) : source
  if (!hex) return Buffer.alloc(0)
  const evenHex = hex.length % 2 === 0 ? hex : `${hex}0`
  return Buffer.from(evenHex, 'hex')
}

const parsePdfFilters = (dictSource) => {
  const dict = String(dictSource || '')
  const match = dict.match(/\/Filter\s*(\[[^\]]+\]|\/[A-Za-z0-9]+)/)
  if (!match) return []
  const raw = match[1]
  return [...raw.matchAll(/\/([A-Za-z0-9]+)/g)].map((item) => item[1])
}

const applyPdfFilters = (buffer, filters) => {
  let output = buffer
  for (const filter of filters) {
    try {
      if (filter === 'ASCII85Decode') {
        output = decodeAscii85Buffer(output)
        continue
      }
      if (filter === 'ASCIIHexDecode') {
        output = decodeAsciiHexBuffer(output)
        continue
      }
      if (filter === 'FlateDecode') {
        output = zlib.inflateSync(output)
        continue
      }
      return null
    } catch {
      return null
    }
  }
  return output
}

const getPdfTextSources = (buffer) => {
  const source = buffer.toString('latin1')
  const sources = []
  const streamRegex = /(<<[\s\S]*?>>)\s*stream\r?\n([\s\S]*?)endstream/g

  for (const match of source.matchAll(streamRegex)) {
    const dict = match[1]
    const rawStream = match[2] || ''
    const streamBuffer = Buffer.from(rawStream, 'latin1')
    const filters = parsePdfFilters(dict)
    const decoded = applyPdfFilters(streamBuffer, filters)
    if (decoded && decoded.length) sources.push(decoded.toString('latin1'))
  }

  if (!sources.length) sources.push(source)
  return sources
}

const decodePdfLiteralText = (value) => decodePdfTextBytes(decodePdfLiteralBytes(value))
const decodePdfHexText = (hexValue) => decodePdfTextBytes(decodePdfHexBytes(hexValue))

const extractPdfTextFromTjArray = (segment) => {
  const parts = []
  const tokenRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g
  for (const token of segment.matchAll(tokenRegex)) {
    if (token[1]) {
      const text = decodePdfLiteralText(token[1])
      if (text) parts.push(text)
      continue
    }
    if (token[2]) {
      const text = decodePdfHexText(token[2])
      if (text) parts.push(text)
    }
  }
  return parts.join('')
}

const isLikelyReadablePdfPiece = (text) => {
  const line = String(text || '').replace(/\u0000/g, '').trim()
  if (!line) return false

  const chars = [...line]
  const length = chars.length || 1
  const lettersOrDigits = (line.match(/[\p{L}\p{N}]/gu) || []).length
  const weirdChars = (line.match(/[^\p{L}\p{N}\p{P}\p{Z}\t]/gu) || []).length
  const controls = (line.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) || []).length

  if (!lettersOrDigits) return false
  if (controls / length > 0.03) return false
  if (weirdChars / length > 0.22) return false
  return true
}

const collectPdfPieces = (source) => {
  const pieces = []
  const literalRegex = /\(((?:\\.|[^\\()])*)\)\s*(Tj|')/g
  const hexRegex = /<([0-9A-Fa-f\s]+)>\s*Tj/g
  const tjArrayRegex = /\[(.*?)\]\s*TJ/gs

  for (const match of source.matchAll(literalRegex)) {
    if (!match[1]) continue
    const text = decodePdfLiteralText(match[1]).replace(/\s+/g, ' ').trim()
    if (isLikelyReadablePdfPiece(text)) pieces.push(text)
  }

  for (const match of source.matchAll(hexRegex)) {
    if (!match[1]) continue
    const text = decodePdfHexText(match[1]).replace(/\s+/g, ' ').trim()
    if (isLikelyReadablePdfPiece(text)) pieces.push(text)
  }

  for (const match of source.matchAll(tjArrayRegex)) {
    const merged = extractPdfTextFromTjArray(match[1] || '').replace(/\s+/g, ' ').trim()
    if (isLikelyReadablePdfPiece(merged)) pieces.push(merged)
  }

  return pieces
}

export const extractTextFromPdfBuffer = (buffer) => {
  const textSources = getPdfTextSources(buffer)
  const pieces = textSources.flatMap((source) => collectPdfPieces(source))
  if (!pieces.length) return ''
  const deduped = []
  const seen = new Set()
  for (const piece of pieces) {
    if (seen.has(piece)) continue
    seen.add(piece)
    deduped.push(piece)
  }
  return deduped
    .join('\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export const extractTextFromBuffer = async (buffer, fileName = '', mimeType = '') => {
  const normalizedName = String(fileName || '').toLowerCase()
  const normalizedType = String(mimeType || '').toLowerCase()

  if (looksLikeDocx(buffer, normalizedName, normalizedType)) {
    const text = await extractTextFromDocxBuffer(buffer)
    if (text) return text
    return ''
  }

  if (normalizedName.endsWith('.pdf') || normalizedType.includes('pdf')) {
    const text = extractTextFromPdfBuffer(buffer)
    if (text) return text
    return ''
  }

  if (!isLikelyTextBuffer(buffer)) return ''
  return buffer.toString('utf8')
}
