export const parseJsonObject = (value) => {
  if (!value) return null
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

