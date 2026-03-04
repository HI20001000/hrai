import { toDateKey } from './time.js'

const COMPLETED_STATUS = '已完成'

export const buildStatusNameById = (statuses = []) =>
  new Map(statuses.map((status) => [status.id, status.name]))

export const resolveFollowUpStatus = (followUp, statusNameById) => {
  if (!followUp) return ''
  const statusId = followUp.status_id
  if (statusNameById && statusId != null && statusNameById.has(statusId)) {
    return String(statusNameById.get(statusId)).trim()
  }
  return String(followUp.status_name || '進行中').trim()
}

export const getUserSubmissions = (submissions = [], userMail) => {
  if (!userMail) return []
  return submissions.filter((submission) =>
    (submission.related_users || []).some((user) => user.mail === userMail)
  )
}

export const getClientSubmissions = (submissions = [], clientName) => {
  if (!clientName) return []
  return submissions.filter((submission) => submission.client_name === clientName)
}

export const getSubmissionsByMode = (submissions = [], viewMode, options = {}) => {
  if (viewMode === 'user') return getUserSubmissions(submissions, options.userMail)
  if (viewMode === 'client') return getClientSubmissions(submissions, options.clientName)
  return submissions
}

export const buildFollowUpItems = (submissions = [], statusNameById) =>
  submissions.flatMap((submission) => {
    const followUps = Array.isArray(submission.follow_ups) ? submission.follow_ups : []
    return followUps.map((followUp) => ({
      id: `${submission.id}-${followUp.id}`,
      status: resolveFollowUpStatus(followUp, statusNameById),
      assignees: Array.isArray(followUp.assignees) ? followUp.assignees : [],
      endAt: submission.end_at,
    }))
  })

export const isOverdueFollowUp = (followUpItem, referenceDate) => {
  if (!followUpItem?.endAt) return false
  const endDateKey = toDateKey(followUpItem.endAt)
  if (!endDateKey) return false
  const refKey = toDateKey(referenceDate instanceof Date ? referenceDate : new Date(referenceDate))
  if (!refKey) return false
  return endDateKey < refKey
}

export const buildSummaryCounts = (followUpItems = [], referenceDate = new Date()) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  const totalCount = followUpItems.length
  const completedCount = followUpItems.filter((item) => item.status === COMPLETED_STATUS).length
  const incompleteCount = followUpItems.filter((item) => {
    if (item.status === COMPLETED_STATUS) return false
    return isOverdueFollowUp(item, now)
  }).length
  const inProgressCount = followUpItems.filter((item) => {
    if (item.status === COMPLETED_STATUS) return false
    if (isOverdueFollowUp(item, now)) return false
    return true
  }).length
  const unassignedCount = followUpItems.filter((item) => (item.assignees || []).length === 0).length
  return {
    totalCount,
    completedCount,
    incompleteCount,
    inProgressCount,
    unassignedCount,
  }
}
