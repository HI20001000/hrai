const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

export const clearAuthState = () => {
  window.localStorage.removeItem('innerai_auth')
  window.localStorage.removeItem('innerai_user')
}

export const getStoredAuth = () => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  const expiresAtMs = Date.parse(String(auth?.expiresAt || ''))
  if (!token || !Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    clearAuthState()
    return null
  }
  return { token, expiresAt: auth.expiresAt }
}

export const getAuthToken = () => getStoredAuth()?.token || ''

export const withAuthHeaders = (headers = {}) => {
  const token = getAuthToken()
  return token
    ? { ...headers, Authorization: `Bearer ${token}`, 'X-InnerAI-Auth-Token': token }
    : { ...headers }
}

export const redirectToLogin = () => {
  clearAuthState()
  if (window.location.pathname !== '/') {
    window.location.assign('/')
  }
}

export const requireAuthToken = () => {
  const token = getAuthToken()
  if (!token) redirectToLogin()
  return token
}

export const handleUnauthorizedResponse = (response) => {
  if (Number(response?.status || 0) !== 401) return false
  redirectToLogin()
  return true
}
