export const buildMeetingReportFilename = (meetingTime) => {
  if (!meetingTime) return 'meeting-report.txt'
  const safe = String(meetingTime).replace(/[:\s]/g, '-')
  return `meeting-report-${safe}.txt`
}

export const downloadMeetingReport = (content, filename) => {
  const blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'meeting-report.txt'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
