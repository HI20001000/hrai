const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

const pad = (value) => String(value).padStart(2, '0')

const toTaipeiDate = (date) => new Date(date.getTime() + TAIPEI_OFFSET_MS)

export const formatDateTimeDisplay = (value) => {
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmed = value.replace('T', ' ').replace('Z', '')
    if (!value.endsWith('Z')) {
      return trimmed.includes('.') ? trimmed.split('.')[0] : trimmed.slice(0, 19)
    }
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return trimmed.includes('.') ? trimmed.split('.')[0] : trimmed.slice(0, 19)
    }
    return toTaipeiDate(parsed).toISOString().replace('T', ' ').slice(0, 19)
  }
  return toTaipeiDate(new Date(value)).toISOString().replace('T', ' ').slice(0, 19)
}

export const formatDateTimeInput = (value) => {
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmed = value.replace('Z', '')
    if (!value.endsWith('Z')) {
      const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
      return normalized.split('.')[0].slice(0, 16)
    }
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
      return normalized.split('.')[0].slice(0, 16)
    }
    return toTaipeiDate(parsed).toISOString().slice(0, 16)
  }
  return toTaipeiDate(new Date(value)).toISOString().slice(0, 16)
}

export const getTaipeiNowInput = () => {
  const now = new Date()
  return toTaipeiDate(now).toISOString().slice(0, 16)
}

export const formatTaipeiDateTime = (date) => {
  const taipei = toTaipeiDate(date)
  return `${taipei.getUTCFullYear()}-${pad(taipei.getUTCMonth() + 1)}-${pad(
    taipei.getUTCDate()
  )} ${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}:${pad(
    taipei.getUTCSeconds()
  )}`
}

export const toDateKey = (value) => {
  if (!value) return null
  if (typeof value === 'string') {
    if (value.endsWith('Z')) {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return null
      return toTaipeiDate(parsed).toISOString().slice(0, 10)
    }
    const normalized = value.replace('T', ' ').split('.')[0]
    return normalized.split(' ')[0]
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return toTaipeiDate(parsed).toISOString().slice(0, 10)
}

export const getTaipeiTodayKey = () => toDateKey(new Date())
