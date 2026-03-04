import { apiBaseUrl } from './apiBaseUrl.js'

const parseJsonSafe = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export const fetchTaskSubmissions = async (token) => {
  const response = await fetch(`${apiBaseUrl}/api/task-submissions`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await parseJsonSafe(response)
  return { response, data }
}

export const fetchTagOptions = async () => {
  const response = await fetch(`${apiBaseUrl}/api/options/tag`)
  if (!response.ok) {
    return []
  }
  const data = await parseJsonSafe(response)
  return Array.isArray(data) ? data : []
}

export const fetchUsers = async (token) => {
  const response = await fetch(`${apiBaseUrl}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await parseJsonSafe(response)
  if (!response.ok || !data?.success) {
    return { success: false, data: [] }
  }
  return { success: true, data: data.data || [] }
}

export const updateTaskSubmission = async (id, token, payload) => {
  const response = await fetch(`${apiBaseUrl}/api/task-submissions/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJsonSafe(response)
  return { response, data }
}

export const deleteTaskSubmission = async (id, token) => {
  const response = await fetch(`${apiBaseUrl}/api/task-submissions/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await parseJsonSafe(response)
  return { response, data }
}
