const CANDIDATE_APPLICATION_STATUS_LABEL_OPTIONS = [
  { value: 'screening', label: '簡歷篩選中' },
  { value: 'screening_rejected', label: '簡歷不通過' },
  { value: 'screening_hr_approved', label: '簡歷篩選 - HR通過' },
  { value: 'screening_hr_rejected', label: '簡歷篩選 - HR不通過' },
  { value: 'screening_department_approved', label: '簡歷篩選 - 部門通過' },
  { value: 'screening_department_rejected', label: '簡歷篩選 - 部門不通過' },
  { value: 'hr_interview', label: 'HR面試' },
  { value: 'hr_interview_rejected', label: 'HR面試不通過' },
  { value: 'department_interview', label: '部門面試' },
  { value: 'department_interview_rejected', label: '部門面試不通過' },
  { value: 'salary_review', label: '薪資評估' },
  { value: 'offer_sent', label: '發出Offer' },
  { value: 'onboarded', label: '已入職' },
  { value: 'transferred', label: '轉職位' },
  { value: 'no_show_or_unreachable', label: '面試不出現/聯繫不上' },
  { value: 'offer_rejected', label: '拒絕Offer' },
  { value: 'hr_withdrew_onboarding', label: 'HR撤銷入職' },
]

const REMOVED_SELECTABLE_STATUS_VALUES = new Set([
  'screening_hr_approved',
  'screening_hr_rejected',
  'screening_department_approved',
  'screening_department_rejected',
])

export const CANDIDATE_APPLICATION_STATUS_OPTIONS = CANDIDATE_APPLICATION_STATUS_LABEL_OPTIONS.filter(
  (item) => !REMOVED_SELECTABLE_STATUS_VALUES.has(item.value)
)

export const FIRST_INTERVIEW_ARRANGEMENT_OPTIONS = [
  { value: 'can_invite', label: '可邀約' },
  { value: 'unsuitable', label: '不合適' },
]

export const INTERVIEW_LOCATION_OPTIONS = [
  { value: 'zhuhai', label: '珠海' },
  { value: 'macau', label: '澳門' },
  { value: 'online', label: '線上' },
]

export const INTERVIEW_STATUS_OPTIONS = [
  { value: 'not_started', label: '未開始' },
  { value: 'in_progress', label: '進行中' },
  { value: 'ended', label: '已結束' },
  { value: 'passed', label: '通過' },
  { value: 'failed', label: '不通過' },
]

export const TEMPORAL_INTERVIEW_STATUS_VALUES = new Set(['not_started', 'in_progress', 'ended'])
export const TERMINAL_INTERVIEW_STATUS_VALUES = new Set(['passed', 'failed'])

export const INTERVIEW_DURATION_PRESET_OPTIONS = [
  { value: '10', label: '10分鐘' },
  { value: '30', label: '30分鐘' },
  { value: '60', label: '60分鐘' },
  { value: 'custom', label: '自填' },
]

const STATUS_LABEL_MAP = Object.fromEntries(
  CANDIDATE_APPLICATION_STATUS_LABEL_OPTIONS.map((item) => [item.value, item.label])
)

const LEGACY_STATUS_MAP = {
  submitted: 'screening',
  rejected: 'screening_rejected',
}

const FIRST_INTERVIEW_ARRANGEMENT_LABEL_MAP = Object.fromEntries(
  FIRST_INTERVIEW_ARRANGEMENT_OPTIONS.map((item) => [item.value, item.label])
)

const INTERVIEW_LOCATION_LABEL_MAP = Object.fromEntries(
  INTERVIEW_LOCATION_OPTIONS.map((item) => [item.value, item.label])
)

const INTERVIEW_STATUS_LABEL_MAP = Object.fromEntries(
  INTERVIEW_STATUS_OPTIONS.map((item) => [item.value, item.label])
)

export const normalizeCandidateApplicationStatus = (value, fallback = 'screening') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (LEGACY_STATUS_MAP[normalized]) return LEGACY_STATUS_MAP[normalized]
  return STATUS_LABEL_MAP[normalized] ? normalized : fallback
}

export const getCandidateApplicationStatusLabel = (value) =>
  STATUS_LABEL_MAP[normalizeCandidateApplicationStatus(value)] || STATUS_LABEL_MAP.screening

export const normalizeFirstInterviewArrangement = (value, fallback = '') => {
  const normalized = String(value || '').trim().toLowerCase()
  return FIRST_INTERVIEW_ARRANGEMENT_LABEL_MAP[normalized] ? normalized : fallback
}

export const getFirstInterviewArrangementLabel = (value) =>
  FIRST_INTERVIEW_ARRANGEMENT_LABEL_MAP[normalizeFirstInterviewArrangement(value)] || ''

export const normalizeInterviewLocation = (value, fallback = '') => {
  const normalized = String(value || '').trim().toLowerCase()
  return INTERVIEW_LOCATION_LABEL_MAP[normalized] ? normalized : fallback
}

export const getInterviewLocationLabel = (value) =>
  INTERVIEW_LOCATION_LABEL_MAP[normalizeInterviewLocation(value)] || ''

export const normalizeInterviewStatus = (value, fallback = 'not_started') => {
  const normalized = String(value || '').trim().toLowerCase()
  return INTERVIEW_STATUS_LABEL_MAP[normalized] ? normalized : fallback
}

export const getInterviewStatusLabel = (value) =>
  INTERVIEW_STATUS_LABEL_MAP[normalizeInterviewStatus(value)] || INTERVIEW_STATUS_LABEL_MAP.not_started

export const normalizeInterviewDurationMinutes = (value, fallback = 30) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const minutes = Math.round(number)
  return minutes >= 1 && minutes <= 480 ? minutes : fallback
}

export const getInterviewDurationLabel = (value) => `${normalizeInterviewDurationMinutes(value)}分鐘`

export const isTerminalInterviewStatus = (value) =>
  TERMINAL_INTERVIEW_STATUS_VALUES.has(normalizeInterviewStatus(value, ''))

const parseInterviewDateTime = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const formatLocalDateTime = (date) => {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const getInterviewTemporalStatus = (
  scheduledAt,
  durationMinutes = 30,
  now = new Date()
) => {
  const start = parseInterviewDateTime(scheduledAt)
  if (!start) return 'not_started'
  const minutes = normalizeInterviewDurationMinutes(durationMinutes, 30)
  const end = new Date(start.getTime() + minutes * 60 * 1000)
  if (now < start) return 'not_started'
  if (now <= end) return 'in_progress'
  return 'ended'
}

export const validateInterviewStatusAgainstTime = (status, interview = {}, now = new Date()) => {
  const nextStatus = normalizeInterviewStatus(status, '')
  if (!nextStatus) {
    return { valid: false, message: '請選擇有效的面試結果' }
  }
  if (isTerminalInterviewStatus(nextStatus)) {
    return { valid: true, expectedStatus: nextStatus, status: nextStatus }
  }

  const start = parseInterviewDateTime(interview?.scheduledAt)
  if (!start) {
    return {
      valid: false,
      status: nextStatus,
      message: '請先安排面試時間後，再更新為「未開始」、「進行中」或「已結束」。',
    }
  }

  const minutes = normalizeInterviewDurationMinutes(interview?.durationMinutes, 30)
  const end = new Date(start.getTime() + minutes * 60 * 1000)
  const expectedStatus = getInterviewTemporalStatus(start, minutes, now)
  if (nextStatus === expectedStatus) {
    return { valid: true, expectedStatus, status: nextStatus }
  }

  const expectedLabel = getInterviewStatusLabel(expectedStatus)
  const selectedLabel = getInterviewStatusLabel(nextStatus)
  return {
    valid: false,
    expectedStatus,
    status: nextStatus,
    message: `目前本機時間為 ${formatLocalDateTime(now)}，面試時段為 ${formatLocalDateTime(start)}-${formatLocalDateTime(end)}，不可更新為「${selectedLabel}」。請改選「${expectedLabel}」，或選擇「通過 / 不通過」。`,
  }
}
