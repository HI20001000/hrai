import { apiBaseUrl } from '../apiBaseUrl.js'

export const fetchMeetingTree = async () => {
  const response = await fetch(`${apiBaseUrl}/api/meetings/tree`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Failed to load meeting tree')
  }
  return response.json()
}

export const createMeetingDay = async ({ productId, meetingDate, createdBy }) => {
  return requestJson(`${apiBaseUrl}/api/meetings/day`, {
    productId,
    meetingDate,
    created_by: createdBy,
  })
}

export const renameMeetingDay = async ({ meetingDayId, meetingDate }) => {
  return requestJson(`${apiBaseUrl}/api/meetings/day`, {
    meetingDayId,
    meetingDate,
  }, 'PATCH')
}

export const fetchMeetingFiles = async ({ meetingDayId }) => {
  const response = await fetch(
    `${apiBaseUrl}/api/meetings/files?meetingDayId=${encodeURIComponent(meetingDayId)}`
  )
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Failed to load meeting files')
  }
  return response.json()
}

export const uploadMeetingFiles = async ({ meetingDayId, files, uploadedBy }) => {
  const encodedFiles = await Promise.all(
    Array.from(files || []).map(async (file) => ({
      name: file.name,
      type: file.type,
      content: await fileToBase64(file),
    }))
  )
  return requestJson(`${apiBaseUrl}/api/meetings/upload`, {
    meetingDayId,
    uploadedBy,
    files: encodedFiles,
  })
}

export const buildMeetingDownloadUrl = ({ meetingDayId, filename }) =>
  `${apiBaseUrl}/api/meetings/download?meetingDayId=${encodeURIComponent(
    meetingDayId
  )}&filename=${encodeURIComponent(filename)}`

export const deleteMeetingDay = async ({ meetingDayId }) => {
  return requestJson(`${apiBaseUrl}/api/meetings/day`, { meetingDayId }, 'DELETE')
}

export const deleteMeetingFile = async ({ meetingDayId, filename }) => {
  return requestJson(
    `${apiBaseUrl}/api/meetings/file`,
    { meetingDayId, filename },
    'DELETE'
  )
}

const requestJson = async (url, body, method = 'POST') => {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Request failed')
  }
  return response.json()
}

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
