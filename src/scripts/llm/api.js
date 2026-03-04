import { apiBaseUrl } from '../apiBaseUrl.js'

export const summarizeMeetingRecords = async ({ meetingDayId, meetingDate, productName, records, user }) => {
  const response = await fetch(`${apiBaseUrl}/api/llm/meeting-summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meetingDayId,
      meetingDate,
      productName,
      records,
      user,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'LLM 總結失敗')
  }

  return response.json()
}
