export const CANDIDATE_APPLICATION_STATUS_OPTIONS = [
  { value: 'screening', label: '簡歷篩選中' },
  { value: 'screening_hr_approved', label: '簡歷篩選 - HR通過' },
  { value: 'screening_hr_rejected', label: '簡歷篩選 - HR不通過' },
  { value: 'screening_department_approved', label: '簡歷篩選 - 部門通過' },
  { value: 'screening_department_rejected', label: '簡歷篩選 - 部門不通過' },
  { value: 'screening_rejected', label: '簡歷篩選不通過' },
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

export const FIRST_INTERVIEW_ARRANGEMENT_OPTIONS = [
  { value: 'can_invite', label: '可邀約' },
  { value: 'unsuitable', label: '不合適' },
]

const STATUS_LABEL_MAP = Object.fromEntries(
  CANDIDATE_APPLICATION_STATUS_OPTIONS.map((item) => [item.value, item.label])
)

const FIRST_INTERVIEW_ARRANGEMENT_LABEL_MAP = Object.fromEntries(
  FIRST_INTERVIEW_ARRANGEMENT_OPTIONS.map((item) => [item.value, item.label])
)

export const normalizeCandidateApplicationStatus = (value, fallback = 'screening') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'submitted') return 'screening'
  if (normalized === 'rejected') return 'screening_rejected'
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
