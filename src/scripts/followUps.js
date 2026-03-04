const COMPLETED_STATUS_NAME = '已完成'

export const countPendingForFollowUps = (followUps = []) =>
  followUps.filter((followUp) => {
    const statusName = String(followUp?.status_name || '').trim()
    return statusName !== COMPLETED_STATUS_NAME
  }).length

export const countPendingFollowUps = (items = []) =>
  items.reduce((total, item) => {
    const followUps = Array.isArray(item?.follow_ups) ? item.follow_ups : []
    return total + countPendingForFollowUps(followUps)
  }, 0)

export const buildFollowUpStatusByDate = (submissions = [], mail, toDateKey) => {
  if (!mail) return {}
  const summary = {}
  for (const item of submissions) {
    const related = item.related_users || []
    const dateKey = toDateKey(item.end_at)
    if (!dateKey) continue
    const followUps = Array.isArray(item?.follow_ups) ? item.follow_ups : []
    if (followUps.length === 0) continue
    const hasRelatedUser = related.some((user) => user.mail === mail)
    const hasAssignedFollowUp = followUps.some((followUp) =>
      (followUp?.assignees || []).some((assignee) => assignee?.mail === mail)
    )
    const hasUnassignedFollowUp = followUps.some(
      (followUp) => (followUp?.assignees || []).length === 0
    )
    if (!hasRelatedUser && !hasAssignedFollowUp && !hasUnassignedFollowUp) continue
    const pendingCount = countPendingForFollowUps(followUps)
    if (!summary[dateKey]) {
      summary[dateKey] = { total: 0, pending: 0 }
    }
    summary[dateKey].total += followUps.length
    summary[dateKey].pending += pendingCount
  }
  return summary
}
