import { spawn } from 'node:child_process'

export const extractTextFromDocxBuffer = (buffer) =>
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

export const extractTextFromPdfBuffer = (buffer) => {
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

export const extractTextFromBuffer = async (buffer, fileName = '', mimeType = '') => {
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
