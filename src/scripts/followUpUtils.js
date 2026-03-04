export const normalizeFollowUpContent = (value) => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object') {
    if (typeof value.content === 'string') return value.content
    if (typeof value.text === 'string') return value.text
    if (typeof value.title === 'string') return value.title
  }
  return ''
}
