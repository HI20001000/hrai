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
  { value: 'passed', label: '通過' },
  { value: 'in_progress', label: '進行中' },
  { value: 'failed', label: '不通過' },
]

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

export const normalizeInterviewStatus = (value, fallback = 'in_progress') => {
  const normalized = String(value || '').trim().toLowerCase()
  return INTERVIEW_STATUS_LABEL_MAP[normalized] ? normalized : fallback
}

export const getInterviewStatusLabel = (value) =>
  INTERVIEW_STATUS_LABEL_MAP[normalizeInterviewStatus(value)] || INTERVIEW_STATUS_LABEL_MAP.in_progress

export const normalizeInterviewDurationMinutes = (value, fallback = 30) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const minutes = Math.round(number)
  return minutes >= 1 && minutes <= 480 ? minutes : fallback
}

export const getInterviewDurationLabel = (value) => `${normalizeInterviewDurationMinutes(value)}分鐘`
