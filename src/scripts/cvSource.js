export const CV_SOURCE_OPTIONS = [
  { value: 'BOSS', label: 'BOSS' },
  { value: '智聯', label: '智聯' },
  { value: '內推', label: '內推' },
]

export const normalizeCvSource = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (/^boss$/i.test(text)) return 'BOSS'
  if (text === '智联' || text === '智聯') return '智聯'
  if (text === '内推' || text === '內推') return '內推'
  return CV_SOURCE_OPTIONS.some((option) => option.value === text) ? text : ''
}

export const detectCvSourceFromFileName = (fileName = '') => {
  const text = String(fileName ?? '').trim()
  if (!text) return ''
  if (/(智联简历|智聯簡歷)/.test(text)) return '智聯'
  if (/(内推|內推)/.test(text)) return '內推'
  if (/^【[^】]+_[^】]+\s+[^】]+】.+\s+\S+/.test(text)) return 'BOSS'
  return ''
}
