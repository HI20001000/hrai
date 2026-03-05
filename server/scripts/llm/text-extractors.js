import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const runPythonScript = (script, buffer) =>
  new Promise((resolve) => {
    const interpreters = ['python3', 'python']
    const execute = (index) => {
      if (index >= interpreters.length) {
        resolve('')
        return
      }

      const proc = spawn(interpreters[index], ['-c', script])
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

const decodePdfLiteralText = (value) => {
  let output = ''
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch !== '\\') {
      output += ch
      continue
    }
    const next = value[i + 1]
    if (!next) break
    if (next === 'n') {
      output += '\n'
      i += 1
      continue
    }
    if (next === 'r') {
      output += ' '
      i += 1
      continue
    }
    if (next === 't') {
      output += '\t'
      i += 1
      continue
    }
    if (next === 'b') {
      output += '\b'
      i += 1
      continue
    }
    if (next === 'f') {
      output += '\f'
      i += 1
      continue
    }
    if (next === '(' || next === ')' || next === '\\') {
      output += next
      i += 1
      continue
    }
    if (/[0-7]/.test(next)) {
      const oct = (value.slice(i + 1, i + 4).match(/^[0-7]{1,3}/) || [''])[0]
      if (oct) {
        output += String.fromCharCode(parseInt(oct, 8))
        i += oct.length
        continue
      }
    }
    output += next
    i += 1
  }
  return output
}

const decodePdfHexText = (hexValue) => {
  const normalized = String(hexValue || '').replace(/\s+/g, '')
  if (!normalized) return ''
  const evenHex = normalized.length % 2 === 0 ? normalized : `${normalized}0`
  const bytes = Buffer.from(evenHex, 'hex')

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = ''
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1]
      result += String.fromCharCode(code)
    }
    return result
  }

  const utf8 = bytes.toString('utf8')
  if (utf8.includes('�')) return bytes.toString('latin1')
  return utf8
}

const collectPdfPieces = (source) => {
  const pieces = []

  for (const match of source.matchAll(/\(([^()]*)\)\s*Tj/g)) {
    if (match[1]) pieces.push(decodePdfLiteralText(match[1]))
  }

  for (const match of source.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    if (match[1]) pieces.push(decodePdfHexText(match[1]))
  }

  for (const match of source.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const segment = match[1] || ''
    const literalParts = [...segment.matchAll(/\(([^()]*)\)/g)].map((part) => decodePdfLiteralText(part[1]))
    const hexParts = [...segment.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((part) => decodePdfHexText(part[1]))
    const merged = [...literalParts, ...hexParts].filter(Boolean).join('')
    if (merged) pieces.push(merged)
  }

  return pieces
}

export const extractTextFromPdfBuffer = (buffer) => {
  const source = buffer.toString('latin1')
  const pieces = collectPdfPieces(source)
  return pieces.join('\n').replace(/\s{2,}/g, ' ').trim()
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
  }

  if (!isLikelyTextBuffer(buffer)) return ''
  return buffer.toString('utf8')
}
