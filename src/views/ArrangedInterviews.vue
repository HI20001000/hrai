<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import { handleUnauthorizedResponse, requireAuthToken, withAuthHeaders } from '../scripts/authState.js'
import { normalizeSearchText } from '../scripts/searchNormalize.js'
import AppSelect from '../components/AppSelect.vue'
import CandidateColumnFilter from '../components/candidate/CandidateColumnFilter.vue'
import CandidateApplicationStatusModal from '../components/candidate/CandidateApplicationStatusModal.vue'
import { CV_SOURCE_OPTIONS, normalizeCvSource } from '../scripts/cvSource.js'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  INTERVIEW_DURATION_PRESET_OPTIONS,
  INTERVIEW_LOCATION_OPTIONS,
  INTERVIEW_STATUS_OPTIONS,
  getCandidateApplicationStatusLabel,
  getInterviewDurationLabel,
  getInterviewLocationLabel,
  getInterviewStatusLabel,
  normalizeCandidateApplicationStatus,
  normalizeInterviewDurationMinutes,
  normalizeInterviewLocation,
  normalizeInterviewStatus,
} from '../scripts/candidateApplicationStatus.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const interviews = ref([])
const isLoading = ref(false)
const message = ref('')
const searchKeyword = ref('')
const jobFilter = ref('')
const sourceFilter = ref('')
const interviewDateFilter = ref('')
const interviewTimeSort = ref('')
const interviewerFilter = ref('')
const ownerFilter = ref('')
const applicationStatusFilter = ref('')
const interviewResultFilter = ref('')
const savingIds = ref([])
const isStatusModalOpen = ref(false)
const isStatusDetailLoading = ref(false)
const isSavingStatusModal = ref(false)
const statusModalError = ref('')
const activeApplication = ref(null)
const interviewStatusDraft = ref('not_started')
const remarkDraft = ref('')
const isApplicationStatusModalOpen = ref(false)
const isApplicationStatusSaving = ref(false)
const applicationStatusModalError = ref('')
const activeStatusApplication = ref(null)
const editingStatusHistoryId = ref(0)
const applicationStatusDraft = ref('screening')
const statusRemarkDraft = ref('')
const interviewScheduledAtDraft = ref('')
const interviewDurationModeDraft = ref('30')
const interviewDurationMinutesDraft = ref('30')
const interviewerUserIdDraft = ref('')
const interviewLocationDraft = ref('')
const applicationInterviewStatusDraft = ref('not_started')
const userOptions = ref([])
const activeStatusPopoverKey = ref('')
const activeStatusPopoverRow = ref(null)
const statusPopoverStyle = ref({})
let statusPopoverCloseTimer = null
let interviewRefreshTimer = null

const API_CONNECTION_ERROR_MESSAGE = '後端服務無法連線，請確認 API 位址或服務是否啟動'
const INTERVIEW_STATUS_REFRESH_INTERVAL_MS = Math.max(
  60 * 1000,
  Math.floor(Number(import.meta.env.VITE_INTERVIEW_STATUS_CHECK_INTERVAL_MINUTES || 1) * 60 * 1000)
)

const getRequestErrorMessage = (error, fallback) => {
  const message = String(error?.message || '')
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(message)
  ) {
    return API_CONNECTION_ERROR_MESSAGE
  }
  return message || fallback
}

const pad = (number) => String(number).padStart(2, '0')

const parseDateTime = (value) => {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDateTime = (value) => {
  const date = parseDateTime(value)
  if (!date) return value || '--'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toDateTimeLocalValue = (value) => {
  const date = parseDateTime(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getCurrentInterviewDateTimeMin = () => {
  const currentMinute = new Date()
  currentMinute.setSeconds(0, 0)
  return toDateTimeLocalValue(currentMinute)
}

const toDateKey = (value) => {
  const date = value instanceof Date ? value : parseDateTime(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const normalizeFilterText = (value) => String(value ?? '').trim()

const formatTimeRange = (interview) => {
  const start = parseDateTime(interview?.scheduledAt)
  if (!start) return '--'
  const minutes = Number(interview?.durationMinutes || 30) || 30
  const end = new Date(start.getTime() + minutes * 60000)
  return `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`
}

const getUserName = (user) => String(user?.username || user?.email || user?.mail || '').trim() || '--'

const isSaving = (applicationId) => savingIds.value.includes(Number(applicationId))

const getInterviewRowKey = (row) =>
  row?.rowId || (row?.statusHistoryId ? `history-${Number(row.statusHistoryId)}` : Number(row?.applicationId || 0))

const canEditInterviewStatus = computed(() => String(props.currentUser?.role || '').trim() !== 'viewer')

const activeApplicationStatusHistory = computed(() => {
  const history = Array.isArray(activeStatusApplication.value?.statusHistory)
    ? activeStatusApplication.value.statusHistory
    : []
  if (history.length) return history
  if (!activeStatusApplication.value) return []
  return [buildFallbackStatusHistory(activeStatusApplication.value)]
})

const isApplicationInterviewStatusDraft = computed(() =>
  ['hr_interview', 'department_interview'].includes(normalizeCandidateApplicationStatus(applicationStatusDraft.value, ''))
)

const selectedInterviewDurationMinutes = computed(() =>
  normalizeInterviewDurationMinutes(interviewDurationMinutesDraft.value)
)

const interviewerOptions = computed(() => [
  { value: '', label: '未指定' },
  ...userOptions.value.map((user) => ({
    value: String(user.id),
    label: user.username || user.email || `用戶 #${user.id}`,
    avatarText: user.avatarText || String(user.username || user.email || 'U').slice(0, 1).toUpperCase(),
    avatarBgColor: user.avatarBgColor || '#64748b',
  })),
])

const jobFilterOptions = computed(() => {
  const seen = new Set()
  const options = []
  for (const row of interviews.value) {
    const title = normalizeFilterText(row.jobPostTitle)
    if (!title || seen.has(title)) continue
    seen.add(title)
    options.push({ value: title, label: title })
  }
  return [{ value: '', label: '全部' }, ...options]
})

const sourceFilterOptions = computed(() => [{ value: '', label: '全部' }, ...CV_SOURCE_OPTIONS])

const applicationStatusFilterOptions = computed(() => [
  { value: '', label: '全部' },
  ...CANDIDATE_APPLICATION_STATUS_OPTIONS.filter((option) =>
    ['hr_interview', 'department_interview'].includes(option.value)
  ),
])

const interviewResultFilterOptions = computed(() => [{ value: '', label: '全部' }, ...INTERVIEW_STATUS_OPTIONS])

const interviewTimeSortOptions = [
  { value: 'asc', label: '面試時間升序' },
  { value: 'desc', label: '面試時間降序' },
]

const interviewerFilterOptions = computed(() => {
  const seen = new Set()
  const options = []
  for (const row of interviews.value) {
    const interviewerName = getInterviewUserName(row.interview)
    if (!interviewerName || interviewerName === '--' || seen.has(interviewerName)) continue
    seen.add(interviewerName)
    options.push({ value: interviewerName, label: interviewerName })
  }
  return [{ value: '', label: '全部' }, ...options]
})

const ownerFilterOptions = computed(() => {
  const seen = new Set()
  const options = []
  for (const row of interviews.value) {
    const ownerName = getUserName(row.ownerUser)
    if (!ownerName || ownerName === '--' || seen.has(ownerName)) continue
    seen.add(ownerName)
    options.push({ value: ownerName, label: ownerName })
  }
  return [{ value: '', label: '全部' }, ...options]
})

const activeStatusHistory = computed(() => {
  const history = Array.isArray(activeApplication.value?.statusHistory)
    ? activeApplication.value.statusHistory
    : []
  if (history.length) return history
  if (!activeApplication.value) return []
  return [buildFallbackStatusHistory(activeApplication.value)]
})

const getStatusToneClass = (status) =>
  `status-tone-${normalizeCandidateApplicationStatus(status, 'screening')}`

const getInterviewUserName = (interview) => getUserName(interview?.interviewerUser)

const getInterviewSummaryParts = (item) => {
  const interview = item?.interview || {}
  const interviewerName = getInterviewUserName(interview)
  const hasInterviewInfo =
    Boolean(interview.scheduledAt || interview.location || interviewerName) ||
    String(interview.status || '').trim() === 'passed' ||
    String(interview.status || '').trim() === 'failed'
  const parts = []
  if (interview.scheduledAt) parts.push(formatDateTime(interview.scheduledAt))
  if (hasInterviewInfo && interview.durationMinutes) parts.push(getInterviewDurationLabel(interview.durationMinutes))
  if (interview.location) parts.push(getInterviewLocationLabel(interview.location))
  if (interviewerName && interviewerName !== '--') parts.push(`面試官：${interviewerName}`)
  if (hasInterviewInfo && interview.status) parts.push(getInterviewStatusLabel(interview.status))
  return parts.filter(Boolean)
}

const getInterviewSummaryText = (item) => {
  const parts = getInterviewSummaryParts(item)
  return parts.length ? parts.join('｜') : '--'
}

const buildFallbackStatusHistory = (row) => ({
  id: 0,
  applicationStatus: row?.applicationStatus,
  interview: row?.interview,
  remark: row?.remark,
  createdAt: row?.createdAt,
  updatedAt: row?.createdAt,
})

const getRowStatusHistory = (row) => {
  const history = Array.isArray(row?.statusHistory) ? row.statusHistory : []
  return history.length ? history : [buildFallbackStatusHistory(row)]
}

const getStatusHistoryKey = (history, index) =>
  history?.id || `${history?.applicationStatus || 'status'}-${history?.createdAt || index}`

const getStatusHistoryOperator = (history) => history?.operatorUser || history?.operator || null

const getStatusHistoryOperatorName = (history) => {
  const operator = getStatusHistoryOperator(history)
  return String(operator?.username || operator?.mail || '').trim() || '系統'
}

const getStatusHistoryOperatorAvatarText = (history) => {
  const operator = getStatusHistoryOperator(history)
  const fallback = getStatusHistoryOperatorName(history).slice(0, 1).toUpperCase() || 'U'
  return String(operator?.avatarText || '').trim() || fallback
}

const getStatusHistoryOperatorAvatarStyle = (history) => {
  const operator = getStatusHistoryOperator(history)
  const color = String(operator?.avatarBgColor || '').trim()
  return { background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#64748b' }
}

const getStatusPopoverKey = (row) => `status-${getInterviewRowKey(row)}`

const clearStatusPopoverTimer = () => {
  if (statusPopoverCloseTimer) {
    window.clearTimeout(statusPopoverCloseTimer)
    statusPopoverCloseTimer = null
  }
}

const buildStatusPopoverStyle = (target) => {
  if (!target || typeof target.getBoundingClientRect !== 'function') return {}
  const rect = target.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768
  const gap = 8
  const margin = 16
  const width = Math.min(520, Math.max(300, viewportWidth - margin * 2))
  const left = Math.min(Math.max(rect.left, margin), Math.max(margin, viewportWidth - width - margin))
  const spaceBelow = viewportHeight - rect.bottom - gap - margin
  const spaceAbove = rect.top - gap - margin
  const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow
  const maxHeight = Math.max(180, Math.min(360, openAbove ? spaceAbove : spaceBelow))

  return openAbove
    ? {
        left: `${left}px`,
        bottom: `${Math.max(margin, viewportHeight - rect.top + gap)}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
      }
    : {
        left: `${left}px`,
        top: `${Math.min(rect.bottom + gap, viewportHeight - margin)}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
      }
}

const closeStatusPopover = () => {
  activeStatusPopoverKey.value = ''
  activeStatusPopoverRow.value = null
  statusPopoverStyle.value = {}
}

const openStatusPopover = (row, event = null) => {
  clearStatusPopoverTimer()
  activeStatusPopoverKey.value = getStatusPopoverKey(row)
  activeStatusPopoverRow.value = row
  statusPopoverStyle.value = buildStatusPopoverStyle(event?.currentTarget)
}

const scheduleStatusPopoverClose = () => {
  clearStatusPopoverTimer()
  statusPopoverCloseTimer = window.setTimeout(() => {
    closeStatusPopover()
    statusPopoverCloseTimer = null
  }, 420)
}

const isStatusPopoverActive = (row) => activeStatusPopoverKey.value === getStatusPopoverKey(row)

const filteredInterviews = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  const selectedJob = normalizeFilterText(jobFilter.value)
  const selectedSource = normalizeCvSource(sourceFilter.value)
  const selectedDate = normalizeFilterText(interviewDateFilter.value)
  const selectedInterviewer = normalizeFilterText(interviewerFilter.value)
  const selectedOwner = normalizeFilterText(ownerFilter.value)
  const selectedApplicationStatus = normalizeCandidateApplicationStatus(applicationStatusFilter.value, '')
  const selectedInterviewResult = normalizeInterviewStatus(interviewResultFilter.value, '')
  const selectedTimeSort = normalizeFilterText(interviewTimeSort.value)
  const rows = interviews.value.filter((row) => {
    const interview = row.interview || {}
    if (selectedJob && normalizeFilterText(row.jobPostTitle) !== selectedJob) return false
    if (selectedSource && normalizeCvSource(row.source) !== selectedSource) return false
    if (selectedDate && toDateKey(interview.scheduledAt) !== selectedDate) return false
    if (selectedInterviewer && normalizeFilterText(getInterviewUserName(interview)) !== selectedInterviewer) return false
    if (selectedOwner && normalizeFilterText(getUserName(row.ownerUser)) !== selectedOwner) return false
    if (
      selectedApplicationStatus &&
      normalizeCandidateApplicationStatus(row.applicationStatus, '') !== selectedApplicationStatus
    ) {
      return false
    }
    if (selectedInterviewResult && normalizeInterviewStatus(interview.status, '') !== selectedInterviewResult) {
      return false
    }
    if (!keyword) return true

    const haystack = normalizeSearchText([
      row.fullName,
      row.jobPostTitle,
      row.source,
      row.applicationStatus,
      getCandidateApplicationStatusLabel(row.applicationStatus),
      getInterviewStatusLabel(interview.status),
      getInterviewLocationLabel(interview.location),
      getUserName(interview.interviewerUser),
      getUserName(row.ownerUser),
      formatDateTime(interview.scheduledAt),
      formatTimeRange(interview),
    ].join(' '))
    return haystack.includes(keyword)
  })
  if (!selectedTimeSort) return rows

  return [...rows].sort((a, b) => {
    const aTime = parseDateTime(a.interview?.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bTime = parseDateTime(b.interview?.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const result = aTime - bTime || Number(a.statusHistoryId || 0) - Number(b.statusHistoryId || 0)
    return selectedTimeSort === 'desc' ? -result : result
  })
})

const loadInterviews = async ({ silent = false } = {}) => {
  if (isLoading.value) return
  isLoading.value = true
  if (!silent) message.value = ''
  try {
    if (!requireAuthToken()) throw new Error('登入已失效，請重新登入')
    const response = await fetch(`${apiBaseUrl}/api/interviews/arranged`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取安排面試失敗')
    interviews.value = Array.isArray(data.interviews) ? data.interviews : []
  } catch (error) {
    if (!silent) message.value = getRequestErrorMessage(error, '讀取安排面試失敗')
  } finally {
    isLoading.value = false
  }
}

const scheduleInterviewStatusRefresh = () => {
  if (interviewRefreshTimer) window.clearInterval(interviewRefreshTimer)
  interviewRefreshTimer = window.setInterval(() => {
    if (
      isStatusModalOpen.value ||
      isApplicationStatusModalOpen.value ||
      isSavingStatusModal.value ||
      isApplicationStatusSaving.value
    ) {
      return
    }
    loadInterviews({ silent: true })
  }, INTERVIEW_STATUS_REFRESH_INTERVAL_MS)
}

const loadUserOptions = async () => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/users/options`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取用戶清單失敗')
    userOptions.value = Array.isArray(data.users) ? data.users : []
  } catch {
    userOptions.value = []
  }
}

const openInterviewStatusModal = async (row) => {
  const applicationId = Number(row?.applicationId || 0)
  if (!applicationId || isSaving(applicationId)) return

  closeStatusPopover()
  isStatusModalOpen.value = true
  isStatusDetailLoading.value = true
  statusModalError.value = ''
  activeApplication.value = null
  interviewStatusDraft.value = normalizeInterviewStatus(row?.interview?.status)
  remarkDraft.value = String(row?.remark || '')

  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取候選人狀態失敗')
    const detail = data.application || {}
    activeApplication.value = {
      ...detail,
      ...row,
      statusHistory: Array.isArray(detail.statusHistory) ? detail.statusHistory : row?.statusHistory,
    }
    interviewStatusDraft.value = normalizeInterviewStatus(row?.interview?.status)
    remarkDraft.value = String(row?.remark || '')
  } catch (error) {
    statusModalError.value = getRequestErrorMessage(error, '讀取候選人狀態失敗')
    activeApplication.value = row
  } finally {
    isStatusDetailLoading.value = false
  }
}

const closeInterviewStatusModal = () => {
  if (isSavingStatusModal.value) return
  isStatusModalOpen.value = false
  isStatusDetailLoading.value = false
  statusModalError.value = ''
  activeApplication.value = null
  interviewStatusDraft.value = 'not_started'
  remarkDraft.value = ''
}

const applyInterviewDurationDraft = (minutes) => {
  const normalized = normalizeInterviewDurationMinutes(minutes)
  interviewDurationMinutesDraft.value = String(normalized)
  interviewDurationModeDraft.value = ['10', '30', '60'].includes(String(normalized)) ? String(normalized) : 'custom'
}

const fillApplicationStatusDraft = (source = {}) => {
  const interview = source?.interview || {}
  applicationStatusDraft.value = normalizeCandidateApplicationStatus(source?.applicationStatus)
  statusRemarkDraft.value = String(source?.remark || '')
  interviewScheduledAtDraft.value = toDateTimeLocalValue(interview.scheduledAt) || getCurrentInterviewDateTimeMin()
  applyInterviewDurationDraft(interview.durationMinutes || 30)
  interviewerUserIdDraft.value = String(interview.interviewerUser?.id || '')
  interviewLocationDraft.value = normalizeInterviewLocation(interview.location, '')
  applicationInterviewStatusDraft.value = normalizeInterviewStatus(interview.status)
}

const startNewApplicationStatusDraft = () => {
  editingStatusHistoryId.value = 0
  fillApplicationStatusDraft({
    applicationStatus: 'screening',
    interview: { scheduledAt: getCurrentInterviewDateTimeMin(), durationMinutes: 30, status: 'not_started' },
    remark: '',
  })
}

const editApplicationStatusHistoryDraft = (history) => {
  const historyId = Number(history?.id || 0)
  if (!historyId || isApplicationStatusSaving.value) return
  editingStatusHistoryId.value = historyId
  fillApplicationStatusDraft(history)
}

const editCurrentApplicationStatusDraft = (row) => {
  const history = Array.isArray(row?.statusHistory) ? row.statusHistory : []
  const currentStatusHistoryId = Number(row?.statusHistoryId || 0) || 0
  const currentHistory = currentStatusHistoryId
    ? history.find((item) => Number(item?.id || 0) === currentStatusHistoryId)
    : null
  const fallbackHistory = history[0] || null
  if (currentHistory || fallbackHistory) {
    editApplicationStatusHistoryDraft(currentHistory || fallbackHistory)
    return
  }
  editingStatusHistoryId.value = 0
  fillApplicationStatusDraft(row)
}

const openApplicationStatusModal = async (row) => {
  const applicationId = Number(row?.applicationId || 0)
  if (!applicationId || !canEditInterviewStatus.value) return

  closeStatusPopover()
  isApplicationStatusModalOpen.value = true
  applicationStatusModalError.value = ''
  activeStatusApplication.value = row
  editCurrentApplicationStatusDraft(row)

  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取候選人狀態失敗')
    activeStatusApplication.value = {
      ...row,
      ...(data.application || {}),
      statusHistory: Array.isArray(data.application?.statusHistory) ? data.application.statusHistory : row.statusHistory,
    }
    editCurrentApplicationStatusDraft(activeStatusApplication.value)
  } catch (error) {
    applicationStatusModalError.value = getRequestErrorMessage(error, '讀取候選人狀態失敗')
  }
}

const closeApplicationStatusModal = () => {
  if (isApplicationStatusSaving.value) return
  isApplicationStatusModalOpen.value = false
  applicationStatusModalError.value = ''
  activeStatusApplication.value = null
  editingStatusHistoryId.value = 0
}

const handleApplicationStatusSaved = async (payload = {}) => {
  await loadInterviews()
  window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  window.dispatchEvent(new CustomEvent('hrai-interviews-updated'))
  message.value = payload?.message || '已更新候選人狀態'
}

const handleDurationModeChange = (value) => {
  const mode = String(value || '').trim()
  interviewDurationModeDraft.value = mode
  if (mode !== 'custom') {
    interviewDurationMinutesDraft.value = String(normalizeInterviewDurationMinutes(mode))
  }
}

const saveApplicationStatusHistory = async () => {
  const applicationId = Number(activeStatusApplication.value?.applicationId || 0)
  const historyId = Number(editingStatusHistoryId.value || 0)
  const nextStatus = normalizeCandidateApplicationStatus(applicationStatusDraft.value, '')
  if (!applicationId || !nextStatus) return

  if (isApplicationInterviewStatusDraft.value) {
    const missing = []
    if (!interviewScheduledAtDraft.value) missing.push('面試時間')
    if (!interviewerUserIdDraft.value) missing.push('面試官')
    if (!interviewLocationDraft.value) missing.push('面試地點')
    if (missing.length) {
      applicationStatusModalError.value = `請先填寫：${missing.join('、')}`
      window.alert(applicationStatusModalError.value)
      return
    }
  }

  const interviewPayload = isApplicationInterviewStatusDraft.value
    ? {
        scheduledAt: interviewScheduledAtDraft.value || '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: interviewerUserIdDraft.value || '',
        location: interviewLocationDraft.value || '',
        status: normalizeInterviewStatus(applicationInterviewStatusDraft.value),
      }
    : {
        scheduledAt: '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: '',
        location: '',
        status: 'not_started',
      }

  isApplicationStatusSaving.value = true
  try {
    const response = await fetch(
      historyId
        ? `${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history/${historyId}`
        : `${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history`,
      {
        method: historyId ? 'PATCH' : 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          applicationStatus: nextStatus,
          firstInterviewArrangement: '',
          interview: interviewPayload,
          remark: String(statusRemarkDraft.value || '').trim(),
        }),
      }
    )
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '保存狀態記錄失敗')
    await loadInterviews()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    window.dispatchEvent(new CustomEvent('hrai-interviews-updated'))
    message.value = data.statusRule?.message || (historyId ? '已更新狀態記錄' : '已新增狀態記錄')
    closeApplicationStatusModal()
  } catch (error) {
    applicationStatusModalError.value = getRequestErrorMessage(error, '保存狀態記錄失敗')
  } finally {
    isApplicationStatusSaving.value = false
  }
}

const saveInterviewStatusModal = async () => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const statusHistoryId = Number(activeApplication.value?.statusHistoryId || 0) || 0
  const nextStatus = normalizeInterviewStatus(interviewStatusDraft.value, '')
  if (!applicationId || !nextStatus || isSaving(applicationId)) return

  savingIds.value = [...savingIds.value, applicationId]
  isSavingStatusModal.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/interview-status`, {
      method: 'PATCH',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        status: nextStatus,
        remark: String(remarkDraft.value || '').trim(),
        statusHistoryId: statusHistoryId || undefined,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '更新面試結果失敗')

    await loadInterviews()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    window.dispatchEvent(new CustomEvent('hrai-interviews-updated'))
    message.value = data.statusRule?.message || `已更新 ${activeApplication.value?.fullName || '候選人'} 的面試結果`
    closeInterviewStatusModal()
  } catch (error) {
    statusModalError.value = getRequestErrorMessage(error, '更新面試結果失敗')
    message.value = statusModalError.value
  } finally {
    isSavingStatusModal.value = false
    savingIds.value = savingIds.value.filter((id) => id !== applicationId)
  }
}

onMounted(() => {
  loadInterviews()
  loadUserOptions()
  scheduleInterviewStatusRefresh()
})
onBeforeUnmount(() => {
  clearStatusPopoverTimer()
  if (interviewRefreshTimer) {
    window.clearInterval(interviewRefreshTimer)
    interviewRefreshTimer = null
  }
})
</script>

<template>
  <section class="arranged-page">
    <header class="page-header">
      <div>
        <h2>面試管理</h2>
        <p>集中查看全系統已安排面試，並直接更新面試結果。</p>
      </div>
      <button type="button" class="secondary-btn" :disabled="isLoading" @click="loadInterviews">
        {{ isLoading ? '刷新中...' : '刷新' }}
      </button>
    </header>

    <p v-if="message" class="message">{{ message }}</p>

    <section class="interview-card">
      <header class="table-tools">
        <div>
          <h3>面試安排表格</h3>
          <p>目前顯示 {{ filteredInterviews.length }} / {{ interviews.length }} 場面試</p>
        </div>
        <div class="tool-controls">
          <input
            v-model.trim="searchKeyword"
            type="search"
            placeholder="搜尋候選人 / 職位 / 來源 / 面試官 / 對接人"
            autocomplete="off"
          />
        </div>
      </header>

      <div class="table-wrap">
        <table class="interview-table">
          <thead>
            <tr>
              <th>候選人</th>
              <th>
                <div class="column-header">
                  <span class="column-title">職位</span>
                  <CandidateColumnFilter
                    v-model="jobFilter"
                    filter-key="job"
                    label="職位"
                    :options="jobFilterOptions"
                  />
                </div>
              </th>
              <th>
                <div class="column-header">
                  <span class="column-title">招聘來源</span>
                  <CandidateColumnFilter
                    v-model="sourceFilter"
                    filter-key="source"
                    label="來源"
                    :options="sourceFilterOptions"
                  />
                </div>
              </th>
              <th>
                <div class="column-header">
                  <span class="column-title">面試時間</span>
                  <CandidateColumnFilter
                    v-model="interviewDateFilter"
                    filter-key="interview-date"
                    label="面試日期"
                    mode="date"
                  />
                  <CandidateColumnFilter
                    v-model="interviewTimeSort"
                    filter-key="interview-time-sort"
                    label="面試時間排序"
                    :options="interviewTimeSortOptions"
                  />
                </div>
              </th>
              <th>區間</th>
              <th>時長</th>
              <th>
                <div class="column-header">
                  <span class="column-title">面試官</span>
                  <CandidateColumnFilter
                    v-model="interviewerFilter"
                    filter-key="interviewer"
                    label="面試官"
                    :options="interviewerFilterOptions"
                  />
                </div>
              </th>
              <th>地點</th>
              <th>
                <div class="column-header">
                  <span class="column-title">對接人</span>
                  <CandidateColumnFilter
                    v-model="ownerFilter"
                    filter-key="owner"
                    label="對接人"
                    :options="ownerFilterOptions"
                  />
                </div>
              </th>
              <th>
                <div class="column-header">
                  <span class="column-title">候選人狀態</span>
                  <CandidateColumnFilter
                    v-model="applicationStatusFilter"
                    filter-key="application-status"
                    label="候選人狀態"
                    :options="applicationStatusFilterOptions"
                  />
                </div>
              </th>
              <th>
                <div class="column-header">
                  <span class="column-title">面試結果</span>
                  <CandidateColumnFilter
                    v-model="interviewResultFilter"
                    filter-key="interview-result"
                    label="面試結果"
                    :options="interviewResultFilterOptions"
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredInterviews" :key="getInterviewRowKey(row)">
              <td>{{ row.fullName || '--' }}</td>
              <td>{{ row.jobPostTitle || '--' }}</td>
              <td>{{ row.source || '--' }}</td>
              <td>{{ formatDateTime(row.interview?.scheduledAt) }}</td>
              <td>{{ formatTimeRange(row.interview) }}</td>
              <td>{{ getInterviewDurationLabel(row.interview?.durationMinutes) }}</td>
              <td>{{ getUserName(row.interview?.interviewerUser) }}</td>
              <td>{{ getInterviewLocationLabel(row.interview?.location) || '--' }}</td>
              <td>{{ getUserName(row.ownerUser) }}</td>
              <td>
                <span
                  class="status-cell-wrap"
                  :class="{ 'popover-active': isStatusPopoverActive(row) }"
                  @mouseenter="openStatusPopover(row, $event)"
                  @mouseleave="scheduleStatusPopoverClose"
                  @focusin="openStatusPopover(row, $event)"
                  @focusout="scheduleStatusPopoverClose"
                >
                  <button
                    type="button"
                    class="status-chip"
                    :class="getStatusToneClass(row.applicationStatus)"
                    :disabled="!canEditInterviewStatus"
                    @click.stop="openApplicationStatusModal(row)"
                  >
                    {{ getCandidateApplicationStatusLabel(row.applicationStatus) }}
                  </button>
                </span>
              </td>
              <td class="result-cell">
                <button
                  type="button"
                  class="result-chip"
                  :class="`interview-${normalizeInterviewStatus(row.interview?.status)}`"
                  :disabled="!canEditInterviewStatus || isSaving(row.applicationId)"
                  @click="openInterviewStatusModal(row)"
                >
                  {{ isSaving(row.applicationId) ? '保存中...' : getInterviewStatusLabel(row.interview?.status) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!isLoading && !filteredInterviews.length" class="empty-state">
        暫無符合條件的安排面試。
      </p>
    </section>

    <Teleport to="body">
      <div
        v-if="activeStatusPopoverRow"
        class="status-history-popover"
        role="tooltip"
        :style="statusPopoverStyle"
        @mouseenter="clearStatusPopoverTimer"
        @mouseleave="scheduleStatusPopoverClose"
      >
        <p class="status-history-title">狀態記錄</p>
        <ol class="status-history-list">
          <li
            v-for="(history, index) in getRowStatusHistory(activeStatusPopoverRow)"
            :key="getStatusHistoryKey(history, index)"
            :class="{ current: index === 0 }"
          >
            <span class="history-dot" aria-hidden="true"></span>
            <span class="history-main">
              <strong>{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</strong>
              <em v-if="getInterviewSummaryParts(history).length">
                面試資訊：{{ getInterviewSummaryText(history) }}
              </em>
              <span v-if="String(history.remark || '').trim()" class="history-remark">{{ history.remark }}</span>
              <span class="history-meta-row">
                <small>{{ formatDateTime(history.updatedAt || history.createdAt) }}</small>
                <span class="history-operator">
                  <span
                    class="history-operator-avatar"
                    :style="getStatusHistoryOperatorAvatarStyle(history)"
                  >
                    {{ getStatusHistoryOperatorAvatarText(history) }}
                  </span>
                  <span>{{ getStatusHistoryOperatorName(history) }}</span>
                </span>
              </span>
            </span>
          </li>
        </ol>
      </div>
    </Teleport>

    <CandidateApplicationStatusModal
      v-model="isApplicationStatusModalOpen"
      :application="activeStatusApplication"
      :user-options="userOptions"
      initial-edit-mode="current"
      @saved="handleApplicationStatusSaved"
      @notify="message = $event"
    />

    <div v-if="false && isApplicationStatusModalOpen" class="modal-backdrop" @click.self="closeApplicationStatusModal">
      <section class="modal-panel interview-status-modal">
        <header class="modal-header">
          <div>
            <h3>候選人狀態</h3>
            <p class="subtle">
              {{ activeStatusApplication?.fullName || '候選人' }}
              <template v-if="activeStatusApplication?.jobPostTitle">｜{{ activeStatusApplication.jobPostTitle }}</template>
            </p>
          </div>
          <button type="button" class="ghost-btn" :disabled="isApplicationStatusSaving" @click="closeApplicationStatusModal">關閉</button>
        </header>

        <p v-if="applicationStatusModalError" class="message">{{ applicationStatusModalError }}</p>

        <template v-if="activeStatusApplication">
          <div class="status-modal-grid">
            <section class="status-form-panel">
              <div class="status-field-grid">
                <label class="field">
                  <span>候選人狀態</span>
                  <AppSelect
                    v-model="applicationStatusDraft"
                    :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                    :disabled="isApplicationStatusSaving"
                    placeholder="請選擇狀態"
                  />
                </label>

                <template v-if="isApplicationInterviewStatusDraft">
                  <label class="field">
                    <span>面試時間</span>
                    <input v-model="interviewScheduledAtDraft" type="datetime-local" :disabled="isApplicationStatusSaving" />
                  </label>
                  <label class="field">
                    <span>面試時長</span>
                    <AppSelect
                      :model-value="interviewDurationModeDraft"
                      :options="INTERVIEW_DURATION_PRESET_OPTIONS"
                      :disabled="isApplicationStatusSaving"
                      @update:model-value="handleDurationModeChange"
                    />
                  </label>
                  <label v-if="interviewDurationModeDraft === 'custom'" class="field">
                    <span>自定義分鐘</span>
                    <input v-model="interviewDurationMinutesDraft" type="number" min="1" max="480" :disabled="isApplicationStatusSaving" />
                  </label>
                  <label class="field">
                    <span>面試官</span>
                    <AppSelect
                      v-model="interviewerUserIdDraft"
                      :options="interviewerOptions"
                      :disabled="isApplicationStatusSaving"
                      placeholder="請選擇面試官"
                    />
                  </label>
                  <label class="field">
                    <span>面試地點</span>
                    <AppSelect
                      v-model="interviewLocationDraft"
                      :options="INTERVIEW_LOCATION_OPTIONS"
                      :disabled="isApplicationStatusSaving"
                      placeholder="請選擇地點"
                    />
                  </label>
                  <label class="field">
                    <span>面試結果</span>
                    <AppSelect
                      v-model="applicationInterviewStatusDraft"
                      :options="INTERVIEW_STATUS_OPTIONS"
                      :disabled="isApplicationStatusSaving"
                      placeholder="請選擇面試結果"
                    />
                  </label>
                </template>

                <label class="field full-span">
                  <span>備註</span>
                  <textarea
                    v-model.trim="statusRemarkDraft"
                    rows="4"
                    :disabled="isApplicationStatusSaving"
                    placeholder="輸入原因或跟進記錄"
                  ></textarea>
                </label>
              </div>
            </section>

            <section class="status-history-section">
              <div class="status-history-heading">
                <h4>狀態記錄</h4>
                <button type="button" class="secondary-btn compact-btn" :disabled="isApplicationStatusSaving" @click="startNewApplicationStatusDraft">
                  新增
                </button>
              </div>
              <ol class="modal-status-history">
                <li
                  v-for="(history, index) in activeApplicationStatusHistory"
                  :key="getStatusHistoryKey(history, index)"
                  :class="{ current: index === 0, selected: Number(editingStatusHistoryId) === Number(history.id) }"
                  role="button"
                  tabindex="0"
                  @click="editApplicationStatusHistoryDraft(history)"
                  @keydown.enter.prevent="editApplicationStatusHistoryDraft(history)"
                >
                  <span class="history-dot" aria-hidden="true"></span>
                  <span class="history-main">
                    <strong>{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</strong>
                    <em v-if="getInterviewSummaryParts(history).length">
                      面試資訊：{{ getInterviewSummaryText(history) }}
                    </em>
                    <span v-if="String(history.remark || '').trim()" class="history-remark">{{ history.remark }}</span>
                    <small>{{ formatDateTime(history.updatedAt || history.createdAt) }}</small>
                  </span>
                </li>
              </ol>
            </section>
          </div>

          <div class="modal-actions">
            <button type="button" class="secondary-btn" :disabled="isApplicationStatusSaving" @click="closeApplicationStatusModal">取消</button>
            <button type="button" class="primary-btn" :disabled="isApplicationStatusSaving" @click="saveApplicationStatusHistory">
              {{ isApplicationStatusSaving ? '保存中...' : (editingStatusHistoryId ? '更新狀態記錄' : '新增狀態記錄') }}
            </button>
          </div>
        </template>
      </section>
    </div>

    <div v-if="isStatusModalOpen" class="modal-backdrop" @click.self="closeInterviewStatusModal">
      <section class="modal-panel interview-status-modal">
        <header class="modal-header">
          <div>
            <h3>候選人狀態</h3>
            <p class="subtle">
              {{ activeApplication?.fullName || '候選人' }}
              <template v-if="activeApplication?.jobPostTitle">｜{{ activeApplication.jobPostTitle }}</template>
            </p>
          </div>
          <button type="button" class="ghost-btn" :disabled="isSavingStatusModal" @click="closeInterviewStatusModal">關閉</button>
        </header>

        <p v-if="isStatusDetailLoading" class="hint">讀取中...</p>
        <p v-if="statusModalError" class="message">{{ statusModalError }}</p>

        <template v-if="activeApplication">
          <div class="status-modal-grid">
            <section class="status-form-panel">
              <div class="status-field-grid">
                <label class="field">
                  <span>候選人狀態</span>
                  <AppSelect
                    :model-value="activeApplication.applicationStatus"
                    :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                    disabled
                  />
                </label>
                <label class="field">
                  <span>面試時間</span>
                  <input :value="formatDateTime(activeApplication.interview?.scheduledAt)" disabled />
                </label>
                <label class="field">
                  <span>面試時長</span>
                  <input :value="getInterviewDurationLabel(activeApplication.interview?.durationMinutes)" disabled />
                </label>
                <label class="field">
                  <span>面試官</span>
                  <input :value="getUserName(activeApplication.interview?.interviewerUser)" disabled />
                </label>
                <label class="field">
                  <span>面試地點</span>
                  <input :value="getInterviewLocationLabel(activeApplication.interview?.location) || '--'" disabled />
                </label>
                <label class="field">
                  <span>面試結果</span>
                  <AppSelect
                    v-model="interviewStatusDraft"
                    :options="INTERVIEW_STATUS_OPTIONS"
                    :disabled="isSavingStatusModal"
                    placeholder="請選擇面試結果"
                  />
                </label>
                <label class="field full-span">
                  <span>備註</span>
                  <textarea
                    v-model.trim="remarkDraft"
                    rows="4"
                    :disabled="isSavingStatusModal"
                    placeholder="輸入面試結果備註或跟進記錄"
                  ></textarea>
                </label>
              </div>
            </section>

            <section class="status-history-section">
              <h4>狀態記錄</h4>
              <ol class="modal-status-history">
                <li
                  v-for="(history, index) in activeStatusHistory"
                  :key="getStatusHistoryKey(history, index)"
                  :class="{ current: index === 0 }"
                >
                  <span class="history-dot" aria-hidden="true"></span>
                  <span class="history-main">
                    <strong>{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</strong>
                    <em v-if="getInterviewSummaryParts(history).length">
                      面試資訊：{{ getInterviewSummaryText(history) }}
                    </em>
                    <span v-if="String(history.remark || '').trim()" class="history-remark">{{ history.remark }}</span>
                    <span class="history-meta-row">
                      <small>{{ formatDateTime(history.updatedAt || history.createdAt) }}</small>
                      <span class="history-operator">
                        <span
                          class="history-operator-avatar"
                          :style="getStatusHistoryOperatorAvatarStyle(history)"
                        >
                          {{ getStatusHistoryOperatorAvatarText(history) }}
                        </span>
                        <span>{{ getStatusHistoryOperatorName(history) }}</span>
                      </span>
                    </span>
                  </span>
                </li>
              </ol>
            </section>
          </div>

          <div class="modal-actions">
            <button type="button" class="secondary-btn" :disabled="isSavingStatusModal" @click="closeInterviewStatusModal">取消</button>
            <button type="button" class="primary-btn" :disabled="isSavingStatusModal" @click="saveInterviewStatusModal">
              {{ isSavingStatusModal ? '保存中...' : '更新面試結果' }}
            </button>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.arranged-page {
  display: grid;
  gap: 1rem;
}

.page-header,
.table-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.page-header h2,
.table-tools h3 {
  margin: 0;
  color: var(--text-strong);
}

.page-header p,
.table-tools p,
.empty-state {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
}

.message {
  margin: 0;
  color: #b45309;
  font-weight: 700;
}

.interview-card {
  display: grid;
  gap: 1rem;
  min-width: 0;
  padding: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-sm);
}

.tool-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.tool-controls input {
  width: min(360px, 42vw);
  min-height: 42px;
  padding: 0.65rem 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  color: var(--text-base);
  font: inherit;
}

.status-filter {
  width: 150px;
}

.table-wrap {
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
}

.interview-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  background: #fff;
}

.interview-table th,
.interview-table td {
  padding: 0.78rem 0.85rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  color: var(--text-base);
  font-size: 0.86rem;
  text-align: left;
  white-space: nowrap;
}

.interview-table th {
  background: #f8fafc;
  color: var(--text-muted);
  font-weight: 800;
}

.column-header {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.column-title {
  min-width: 0;
}

.result-cell {
  min-width: 148px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  min-height: 26px;
  padding: 0.18rem 0.55rem;
  border: 0;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.12);
  color: #2f6fed;
  font: inherit;
  font-weight: 800;
  outline: none;
  cursor: pointer;
}

.status-chip:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.status-chip::before {
  content: '';
  width: 0.46rem;
  height: 0.46rem;
  border-radius: 999px;
  background: currentColor;
}

.status-cell-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.status-cell-wrap.popover-active .status-chip,
.status-chip:hover,
.status-chip:focus-visible {
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.12);
}

.status-tone-screening,
.status-tone-screening_rejected,
.status-tone-screening_hr_approved,
.status-tone-screening_hr_rejected,
.status-tone-screening_department_approved,
.status-tone-screening_department_rejected,
.status-tone-hr_interview,
.status-tone-hr_interview_rejected,
.status-tone-department_interview,
.status-tone-department_interview_rejected,
.status-tone-salary_review,
.status-tone-offer_sent,
.status-tone-onboarded,
.status-tone-no_show_or_unreachable,
.status-tone-offer_rejected,
.status-tone-hr_withdrew_onboarding,
.status-tone-transferred {
  background: rgba(47, 111, 237, 0.12);
  color: #2f6fed;
}

.result-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 112px;
  min-height: 34px;
  padding: 0.36rem 0.78rem;
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 850;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.result-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
}

.result-chip:disabled {
  opacity: 0.58;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.interview-passed {
  color: #166534;
  background: #dcfce7;
}

.interview-not_started {
  color: #475569;
  background: #e2e8f0;
}

.interview-in_progress {
  color: #92400e;
  background: #fef3c7;
}

.interview-ended {
  color: #1d4ed8;
  background: #dbeafe;
}

.interview-failed {
  color: #b91c1c;
  background: #fee2e2;
}

.status-history-popover {
  position: fixed;
  z-index: 20000;
  display: block;
  overflow: auto;
  padding: 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 24px 54px rgba(15, 23, 42, 0.14),
    0 8px 20px rgba(47, 111, 237, 0.08);
  white-space: normal;
}

.status-history-title,
.status-history-section h4 {
  margin: 0 0 0.6rem;
  color: var(--text-strong);
  font-size: 0.9rem;
  font-weight: 850;
}

.status-history-list,
.modal-status-history {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.status-history-list li,
.modal-status-history li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.5rem;
  color: var(--text-base);
  font-size: 0.82rem;
  font-weight: 650;
}

.status-history-list li.current,
.modal-status-history li.current {
  color: var(--accent);
}

.history-dot {
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.32rem;
  border: 2px solid currentColor;
  border-radius: 999px;
  opacity: 0.52;
}

li.current .history-dot {
  background: currentColor;
  opacity: 1;
}

.history-main {
  display: grid;
  gap: 0.28rem;
  min-width: 0;
}

.history-main strong {
  color: var(--text-strong);
  line-height: 1.35;
}

li.current .history-main strong {
  color: var(--accent);
}

.history-main small,
.history-main em,
.history-operator {
  color: var(--text-soft);
  font-size: 0.76rem;
  font-style: normal;
  font-weight: 400;
  line-height: 1.35;
}

.history-remark {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--text-base);
  font-size: 0.8rem;
  font-weight: 650;
}

.history-meta-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.32rem 0.55rem;
  min-width: 0;
  padding-top: 0.18rem;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  text-align: right;
}

.history-operator {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
}

.history-operator-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.28rem;
  height: 1.28rem;
  border-radius: 999px;
  color: #ffffff;
  font-size: 0.68rem;
  font-weight: 800;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.42);
}

.modal-panel {
  width: min(1040px, 96vw);
  max-height: 90vh;
  overflow: auto;
  padding: 1rem;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: var(--shadow-lg);
}

.modal-header,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.modal-header h3 {
  margin: 0;
  color: var(--text-strong);
}

.subtle,
.hint {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
}

.interview-status-modal {
  display: grid;
  gap: 1rem;
}

.status-modal-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
  gap: 1rem;
  align-items: start;
}

.status-form-panel,
.status-history-section {
  min-width: 0;
  padding: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  background: #f8fafc;
}

.status-history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.modal-status-history li.selected {
  border-color: rgba(47, 111, 237, 0.38);
  background: rgba(47, 111, 237, 0.08);
}

.compact-btn {
  padding: 0.42rem 0.7rem;
  font-size: 0.82rem;
}

.status-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.status-field-grid .field {
  display: grid;
  gap: 0.42rem;
  min-width: 0;
}

.status-field-grid .field span {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.status-field-grid input,
.status-field-grid textarea {
  width: 100%;
  min-height: 42px;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.36);
  border-radius: 12px;
  color: var(--text-base);
  background: #ffffff;
  font: inherit;
}

.status-field-grid input:disabled {
  color: var(--text-muted);
  background: rgba(241, 245, 249, 0.86);
}

.status-field-grid textarea {
  resize: vertical;
}

.full-span {
  grid-column: 1 / -1;
}

.modal-actions {
  justify-content: flex-end;
}

.empty-state {
  padding: 1rem;
  text-align: center;
}

@media (max-width: 900px) {
  .page-header,
  .table-tools,
  .tool-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .tool-controls input,
  .status-filter {
    width: 100%;
  }

  .status-modal-grid,
  .status-field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
