<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'
import MatchDimensionBreakdown from '../components/MatchDimensionBreakdown.vue'
import CandidateApplicationsTable from '../components/candidate/CandidateApplicationsTable.vue'
import CandidateCvUploadModal from '../components/candidate/CandidateCvUploadModal.vue'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  FIRST_INTERVIEW_ARRANGEMENT_OPTIONS,
  INTERVIEW_DURATION_PRESET_OPTIONS,
  INTERVIEW_LOCATION_OPTIONS,
  INTERVIEW_STATUS_OPTIONS,
  getCandidateApplicationStatusLabel,
  getFirstInterviewArrangementLabel,
  getInterviewDurationLabel,
  getInterviewLocationLabel,
  getInterviewStatusLabel,
  normalizeCandidateApplicationStatus,
  normalizeFirstInterviewArrangement,
  normalizeInterviewDurationMinutes,
  normalizeInterviewLocation,
  normalizeInterviewStatus,
} from '../scripts/candidateApplicationStatus.js'

const message = ref('')
const applicationRows = ref([])
const selectedApplicationIds = ref([])
const isLoading = ref(false)
const tableLoadStatus = ref('')
const tableLoadMessage = ref('')
const isBulkDeleting = ref(false)
const isBulkBlacklisting = ref(false)
const isBulkUnblacklisting = ref(false)
const isBulkBlacklistModalOpen = ref(false)
const bulkBlacklistReasonDraft = ref('')
const isUploadModalOpen = ref(false)
const isStatusModalOpen = ref(false)
const isSavingStatusModal = ref(false)
const deletingStatusHistoryIds = ref([])
const editingStatusHistoryId = ref(null)
const isProjectTransferModalOpen = ref(false)
const isProjectTransferSaving = ref(false)
const projectRows = ref([])
const projectTransferCandidate = ref(null)
const projectTransferForm = ref(createEmptyProjectTransferForm())
let tableLoadStatusTimer = null
let availabilityLoadTimer = null

const pageMode = ref('list')
const activeApplicationId = ref(null)
const activeApplication = ref(null)
const isDetailLoading = ref(false)
const detailError = ref('')
const isRemarkEditorOpen = ref(false)
const isBlacklistEditorOpen = ref(false)
const statusDraft = ref('')
const remarkDraft = ref('')
const firstInterviewDraft = ref('')
const interviewScheduledAtDraft = ref('')
const interviewDurationModeDraft = ref('30')
const interviewDurationMinutesDraft = ref('30')
const interviewerUserIdDraft = ref('')
const interviewLocationDraft = ref('')
const interviewStatusDraft = ref('in_progress')
const userOptions = ref([])
const interviewerAvailability = ref(null)
const interviewerAvailabilityStatus = ref('')
const interviewerAvailabilityMessage = ref('')
const blacklistReasonDraft = ref('')
const isSavingStatus = ref(false)
const isSavingRemark = ref(false)
const isSavingFirstInterview = ref(false)
const isSavingBlacklist = ref(false)

function createEmptyProjectTransferForm() {
  return {
    projectId: '',
    projectRole: '',
    startDate: new Date().toISOString().slice(0, 10),
    remark: '',
  }
}

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toDateTimeLocalValue = (value) => {
  if (!value) return ''
  const text = String(value).trim()
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return normalized.slice(0, 16)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getDateKeyFromDateTimeLocal = (value) => String(value || '').slice(0, 10)

const parseLocalDateTime = (value) => {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const minutesBetween = (startValue, endValue) => {
  const start = parseLocalDateTime(startValue)
  const end = parseLocalDateTime(endValue)
  if (!start || !end) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

const toDateTimeLocalFromSql = (value) => {
  const date = value instanceof Date ? value : parseLocalDateTime(value)
  if (!date) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getDurationMode = (minutes) => {
  const normalized = normalizeInterviewDurationMinutes(minutes)
  return ['10', '30', '60'].includes(String(normalized)) ? String(normalized) : 'custom'
}

const INTERVIEW_APPLICATION_STATUS_VALUES = new Set(['hr_interview', 'department_interview'])

const isInterviewApplicationStatus = (value) =>
  INTERVIEW_APPLICATION_STATUS_VALUES.has(normalizeCandidateApplicationStatus(value, ''))

const applyInterviewDurationDraft = (minutes) => {
  const normalized = normalizeInterviewDurationMinutes(minutes)
  interviewDurationMinutesDraft.value = String(normalized)
  interviewDurationModeDraft.value = getDurationMode(normalized)
}

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const withAuthHeaders = (headers = {}) => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  return token ? { ...headers, Authorization: `Bearer ${token}` } : { ...headers }
}

const withAuthOptions = (options = {}) => ({
  ...options,
  headers: withAuthHeaders(options.headers || {}),
})

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

const getInterviewUserName = (interview) => {
  const user = interview?.interviewerUser || null
  return String(user?.username || user?.email || user?.mail || '').trim()
}

const getInterviewSummaryParts = (interview) => {
  const interviewerName = getInterviewUserName(interview)
  const hasInterviewInfo =
    Boolean(interview?.scheduledAt || interview?.location || interviewerName) ||
    String(interview?.status || '').trim() === 'passed' ||
    String(interview?.status || '').trim() === 'failed'
  const parts = []
  if (interview?.scheduledAt) parts.push(formatDateTime(interview.scheduledAt))
  if (hasInterviewInfo && interview?.durationMinutes) parts.push(getInterviewDurationLabel(interview.durationMinutes))
  if (interview?.location) parts.push(getInterviewLocationLabel(interview.location))
  if (interviewerName) parts.push(`面試官：${interviewerName}`)
  if (hasInterviewInfo && interview?.status) parts.push(getInterviewStatusLabel(interview.status))
  return parts.filter(Boolean)
}

const getInterviewSummaryText = (interview) => getInterviewSummaryParts(interview).join('｜')

const interviewerOptions = computed(() => [
  { value: '', label: '未指定' },
  ...userOptions.value.map((user) => ({
    value: String(user.id),
    label: user.username || user.email || `用戶 #${user.id}`,
  })),
])

const selectedInterviewDurationMinutes = computed(() =>
  normalizeInterviewDurationMinutes(interviewDurationMinutesDraft.value)
)

const isInterviewStatusDraft = computed(() => isInterviewApplicationStatus(statusDraft.value))

const isInterviewArrangementDraft = computed(
  () => normalizeFirstInterviewArrangement(firstInterviewDraft.value, '') === 'can_invite'
)

const shouldShowInterviewFields = computed(
  () => isInterviewStatusDraft.value && isInterviewArrangementDraft.value
)

const availabilityDateLabel = computed(() => {
  const dateKey = getDateKeyFromDateTimeLocal(interviewScheduledAtDraft.value)
  if (!dateKey) return ''
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateKey
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
})

const selectedInterviewEndTime = computed(() => {
  const start = parseLocalDateTime(interviewScheduledAtDraft.value)
  if (!start) return ''
  const end = new Date(start.getTime() + selectedInterviewDurationMinutes.value * 60000)
  return toDateTimeLocalFromSql(end)
})

const currentInterviewPreviewItem = computed(() => {
  if (!shouldShowInterviewFields.value || !interviewScheduledAtDraft.value || !selectedInterviewEndTime.value) return null
  return {
    type: 'preview',
    applicationId: activeApplication.value?.applicationId || 'current',
    start: interviewScheduledAtDraft.value.replace('T', ' '),
    end: selectedInterviewEndTime.value.replace('T', ' '),
    durationMinutes: selectedInterviewDurationMinutes.value,
    fullName: activeApplication.value?.fullName || '當前候選人',
    jobPostTitle: activeApplication.value?.jobPostTitle || '',
  }
})

const availabilityTimelineItems = computed(() => {
  const freeSlots = Array.isArray(interviewerAvailability.value?.freeSlots)
    ? interviewerAvailability.value.freeSlots.map((slot) => ({ ...slot, type: 'free' }))
    : []
  const booked = Array.isArray(interviewerAvailability.value?.booked)
    ? interviewerAvailability.value.booked.map((slot) => ({ ...slot, type: 'booked' }))
    : []
  const preview = currentInterviewPreviewItem.value ? [currentInterviewPreviewItem.value] : []
  return [...freeSlots, ...booked, ...preview].sort((a, b) => {
    const aTime = parseLocalDateTime(a.start)?.getTime() || 0
    const bTime = parseLocalDateTime(b.start)?.getTime() || 0
    return aTime - bTime
  })
})

const hasBlacklistIdentity = (row) =>
  Boolean(String(row?.phone || '').trim() || String(row?.email || '').trim())

const canBulkAddBlacklist = (row) => !row?.isBlacklisted && hasBlacklistIdentity(row)

const canBulkRemoveBlacklist = (row) =>
  Boolean(row?.isBlacklisted && Number(row?.blacklistEntryId || 0) > 0)

const getBlacklistIdentityKey = (row) => {
  const phone = String(row?.phone || '').trim()
  const email = String(row?.email || '').trim().toLowerCase()
  return `${phone || 'no-phone'}::${email || 'no-email'}`
}

const buildBlacklistPayloadFromRow = (row, reason) => ({
  displayName: String(row?.fullName || '').trim(),
  phone: String(row?.phone || '').trim(),
  email: String(row?.email || '').trim(),
  reason: String(reason || '').trim(),
  status: 'active',
  remark: '',
})

const selectedRows = computed(() => {
  const selectedSet = new Set(selectedApplicationIds.value.map((id) => Number(id)))
  return applicationRows.value.filter((row) => selectedSet.has(Number(row.applicationId)))
})

const selectedBlacklistAddRows = computed(() => selectedRows.value.filter(canBulkAddBlacklist))

const selectedBlacklistAddUniqueRows = computed(() => {
  const seenIdentities = new Set()
  const rows = []
  for (const row of selectedBlacklistAddRows.value) {
    const identityKey = getBlacklistIdentityKey(row)
    if (seenIdentities.has(identityKey)) continue
    seenIdentities.add(identityKey)
    rows.push(row)
  }
  return rows
})

const selectedBlacklistRemoveRows = computed(() => selectedRows.value.filter(canBulkRemoveBlacklist))

const bulkUploadDisabled = computed(() => false)

const bulkBlacklistDisabled = computed(() => !selectedBlacklistAddRows.value.length)

const bulkUnblacklistDisabled = computed(() => !selectedBlacklistRemoveRows.value.length)

const bulkBlacklistSkippedCount = computed(() =>
  Math.max(0, selectedRows.value.length - selectedBlacklistAddUniqueRows.value.length)
)

const projectOptions = computed(() =>
  projectRows.value.map((project) => ({
    value: String(project.id),
    label: project.projectName || `項目 #${project.id}`,
  }))
)

const pageTitle = computed(() => {
  if (pageMode.value === 'detail') return '候選人詳情'
  if (pageMode.value === 'edit') return '詳情修改'
  return '候選人管理'
})

const pageDescription = computed(() => {
  if (pageMode.value === 'detail') return '查看候選人投遞資料、Blacklist 命中結果與狀態歷史。'
  if (pageMode.value === 'edit') return '集中更新候選人狀態、備註、面試安排與 Blacklist 原因。'
  return '這裡集中查看所有職位下的候選人投遞與匹配結果；狀態與備註請進入修改頁處理。'
})

const activeStatusHistory = computed(() => {
  const history = Array.isArray(activeApplication.value?.statusHistory)
    ? activeApplication.value.statusHistory
    : []
  if (history.length) return history

  if (!activeApplication.value) return []
  if (isStatusModalOpen.value) return []
  return [
    {
      id: 0,
      applicationStatus: activeApplication.value.applicationStatus,
      firstInterviewArrangement: activeApplication.value.firstInterviewArrangement,
      interview: activeApplication.value.interview,
      remark: activeApplication.value.remark,
      createdAt: activeApplication.value.createdAt,
      updatedAt: activeApplication.value.createdAt,
    },
  ]
})

const isStatusModalBusy = computed(
  () => isDetailLoading.value || isSavingStatusModal.value || deletingStatusHistoryIds.value.length > 0
)

const isEditingStatusHistory = computed(() => Number(editingStatusHistoryId.value || 0) > 0)

const selectedStatusHistory = computed(() =>
  activeStatusHistory.value.find((history) => Number(history.id) === Number(editingStatusHistoryId.value)) || null
)

const statusModalEditorTitle = computed(() =>
  isEditingStatusHistory.value ? '編輯狀態記錄' : '新增狀態記錄'
)

const isStatusDraftChanged = computed(
  () =>
    normalizeCandidateApplicationStatus(statusDraft.value, '') !==
    normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus, '')
)

const activeDownloadUrl = computed(() =>
  activeApplication.value?.hasDownload && activeApplication.value?.cvId
    ? `${apiBaseUrl}/api/candidate-cvs/${activeApplication.value.cvId}/download`
    : ''
)

const isBlacklistReasonChanged = computed(() => {
  const currentReason = String(activeApplication.value?.blacklistEntry?.reason || activeApplication.value?.blacklistReason || '').trim()
  return String(blacklistReasonDraft.value || '').trim() !== currentReason
})

const fetchJson = async (endpoint, options = {}) => {
  const response = await fetch(endpoint, withAuthOptions(options))
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
}

const clearTableLoadStatusTimer = () => {
  if (tableLoadStatusTimer) {
    window.clearTimeout(tableLoadStatusTimer)
    tableLoadStatusTimer = null
  }
}

const setTableLoadStatus = (status, nextMessage = '') => {
  clearTableLoadStatusTimer()
  if (status === 'success') {
    tableLoadStatus.value = ''
    tableLoadMessage.value = ''
    return
  }

  tableLoadStatus.value = status
  tableLoadMessage.value = nextMessage
}

const resetDetailDrafts = (application = activeApplication.value) => {
  statusDraft.value = normalizeCandidateApplicationStatus(application?.applicationStatus)
  firstInterviewDraft.value = normalizeFirstInterviewArrangement(application?.firstInterviewArrangement)
  const interview = application?.interview || {}
  interviewScheduledAtDraft.value = toDateTimeLocalValue(interview.scheduledAt)
  applyInterviewDurationDraft(interview.durationMinutes || 30)
  interviewerUserIdDraft.value = String(interview.interviewerUser?.id || '')
  interviewLocationDraft.value = normalizeInterviewLocation(interview.location, '')
  interviewStatusDraft.value = normalizeInterviewStatus(interview.status)
  remarkDraft.value = String(application?.remark || '')
  blacklistReasonDraft.value = String(application?.blacklistEntry?.reason || application?.blacklistReason || '')
  isRemarkEditorOpen.value = false
  isBlacklistEditorOpen.value = false
}

const startNewStatusHistoryDraft = () => {
  editingStatusHistoryId.value = null
  statusDraft.value = normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus)
  firstInterviewDraft.value = normalizeFirstInterviewArrangement(activeApplication.value?.firstInterviewArrangement)
  const interview = activeApplication.value?.interview || {}
  interviewScheduledAtDraft.value = toDateTimeLocalValue(interview.scheduledAt)
  applyInterviewDurationDraft(interview.durationMinutes || 30)
  interviewerUserIdDraft.value = String(interview.interviewerUser?.id || '')
  interviewLocationDraft.value = normalizeInterviewLocation(interview.location, '')
  interviewStatusDraft.value = normalizeInterviewStatus(interview.status)
  remarkDraft.value = ''
}

const editStatusHistoryDraft = (history) => {
  const historyId = Number(history?.id || 0)
  if (!historyId || isStatusModalBusy.value) return
  editingStatusHistoryId.value = historyId
  statusDraft.value = normalizeCandidateApplicationStatus(history?.applicationStatus)
  firstInterviewDraft.value = normalizeFirstInterviewArrangement(history?.firstInterviewArrangement)
  const interview = history?.interview || {}
  interviewScheduledAtDraft.value = toDateTimeLocalValue(interview.scheduledAt)
  applyInterviewDurationDraft(interview.durationMinutes || 30)
  interviewerUserIdDraft.value = String(interview.interviewerUser?.id || '')
  interviewLocationDraft.value = normalizeInterviewLocation(interview.location, '')
  interviewStatusDraft.value = normalizeInterviewStatus(interview.status)
  remarkDraft.value = String(history?.remark || '')
}

const loadApplicationTable = async () => {
  isLoading.value = true
  setTableLoadStatus('loading', '候選人資料加載中')
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/table`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取候選人管理清單失敗')
    applicationRows.value = Array.isArray(data.applications) ? data.applications : []

    const allowedIds = new Set(applicationRows.value.map((row) => Number(row.applicationId)))
    selectedApplicationIds.value = selectedApplicationIds.value.filter((id) => allowedIds.has(Number(id)))
    setTableLoadStatus('success')
  } catch (error) {
    const nextMessage = error?.message || '初始化資料失敗'
    message.value = nextMessage
    setTableLoadStatus('error', nextMessage)
  } finally {
    isLoading.value = false
  }
}

const loadUserOptions = async () => {
  try {
    const data = await fetchJson(`${apiBaseUrl}/api/users/options`)
    userOptions.value = Array.isArray(data.users) ? data.users : []
  } catch (error) {
    userOptions.value = []
    message.value = error?.message || '讀取用戶清單失敗'
  }
}

const loadApplicationDetail = async (applicationId, nextMode = pageMode.value) => {
  const id = Number(applicationId)
  if (!id) return

  isDetailLoading.value = true
  detailError.value = ''
  try {
    const data = await fetchJson(`${apiBaseUrl}/api/job-post-applications/${id}`)
    activeApplication.value = data.application || null
    activeApplicationId.value = Number(activeApplication.value?.applicationId || id)
    pageMode.value = nextMode
    resetDetailDrafts(activeApplication.value)
  } catch (error) {
    detailError.value = error?.message || '讀取候選人詳情失敗'
    message.value = detailError.value
  } finally {
    isDetailLoading.value = false
  }
}

const refreshActiveApplication = async () => {
  if (!activeApplicationId.value) return
  await loadApplicationTable()
  await loadApplicationDetail(activeApplicationId.value, pageMode.value)
  window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
}

const openApplicationDetail = async (row, mode = 'detail') => {
  message.value = ''
  activeApplicationId.value = Number(row?.applicationId || 0)
  activeApplication.value = null
  pageMode.value = mode
  await loadApplicationDetail(activeApplicationId.value, mode)
}

const openApplicationStatusModal = async (row) => {
  const applicationId = Number(row?.applicationId || 0)
  if (!applicationId) return

  message.value = ''
  activeApplicationId.value = applicationId
  activeApplication.value = null
  editingStatusHistoryId.value = null
  isStatusModalOpen.value = true
  await loadApplicationDetail(applicationId, 'list')
  startNewStatusHistoryDraft()
}

const closeApplicationStatusModal = () => {
  if (isStatusModalBusy.value) return
  isStatusModalOpen.value = false
  activeApplicationId.value = null
  activeApplication.value = null
  editingStatusHistoryId.value = null
  detailError.value = ''
  interviewerAvailability.value = null
  interviewerAvailabilityStatus.value = ''
  interviewerAvailabilityMessage.value = ''
  clearAvailabilityLoadTimer()
  resetDetailDrafts(null)
}

const saveStatusModalChanges = async () => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const nextStatus = normalizeCandidateApplicationStatus(statusDraft.value, '')
  if (!applicationId || !nextStatus) {
    message.value = '請先選擇有效狀態'
    return
  }

  const historyId = Number(editingStatusHistoryId.value || 0)
  const isInterviewStatus = isInterviewApplicationStatus(nextStatus)
  const nextFirstInterview = isInterviewStatus
    ? normalizeFirstInterviewArrangement(firstInterviewDraft.value, '')
    : ''
  const shouldSaveInterview = isInterviewStatus && nextFirstInterview === 'can_invite'
  if (shouldSaveInterview) {
    if (!interviewScheduledAtDraft.value || !interviewerUserIdDraft.value || !interviewLocationDraft.value) {
      message.value = '請補充面試時間、面試官與面試地點'
      return
    }
  }

  const interviewPayload = shouldSaveInterview
    ? {
        scheduledAt: interviewScheduledAtDraft.value || '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: interviewerUserIdDraft.value || '',
        location: interviewLocationDraft.value || '',
        status: normalizeInterviewStatus(interviewStatusDraft.value),
      }
    : {
        scheduledAt: '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: '',
        location: '',
        status: 'in_progress',
      }
  const payload = {
    applicationStatus: nextStatus,
    firstInterviewArrangement: nextFirstInterview,
    interview: interviewPayload,
    remark: String(remarkDraft.value || '').trim(),
  }

  isSavingStatusModal.value = true
  try {
    const data = await fetchJson(
      historyId
        ? `${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history/${historyId}`
        : `${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history`,
      {
        method: historyId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    const savedHistoryId = Number(data?.history?.id || historyId || 0)
    message.value = historyId ? '已更新狀態記錄' : '已新增狀態記錄'
    await loadApplicationTable()
    await loadApplicationDetail(applicationId, 'list')
    if (historyId && savedHistoryId) {
      const savedHistory = activeStatusHistory.value.find((history) => Number(history.id) === savedHistoryId)
      if (savedHistory) {
        editStatusHistoryDraft(savedHistory)
      } else {
        editingStatusHistoryId.value = savedHistoryId
      }
    } else {
      startNewStatusHistoryDraft()
    }
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    message.value = error?.message || '保存狀態記錄失敗'
  } finally {
    isSavingStatusModal.value = false
  }
}

const isStatusHistoryDeleting = (historyId) =>
  deletingStatusHistoryIds.value.includes(Number(historyId || 0))

const deleteStatusHistory = async (history) => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const historyId = Number(history?.id || 0)
  if (!applicationId || !historyId || isStatusModalBusy.value) return
  if (!window.confirm('確認刪除此狀態記錄？')) return

  deletingStatusHistoryIds.value = [...deletingStatusHistoryIds.value, historyId]
  try {
    await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history/${historyId}`, {
      method: 'DELETE',
    })
    message.value = '已刪除狀態記錄'
    await loadApplicationTable()
    await loadApplicationDetail(applicationId, 'list')
    startNewStatusHistoryDraft()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    message.value = error?.message || '刪除狀態記錄失敗'
  } finally {
    deletingStatusHistoryIds.value = deletingStatusHistoryIds.value.filter((id) => id !== historyId)
  }
}

const clearAvailabilityLoadTimer = () => {
  if (availabilityLoadTimer) {
    window.clearTimeout(availabilityLoadTimer)
    availabilityLoadTimer = null
  }
}

const loadInterviewerAvailability = async () => {
  const interviewerUserId = Number(interviewerUserIdDraft.value || 0)
  const dateKey = getDateKeyFromDateTimeLocal(interviewScheduledAtDraft.value)
  if (!isStatusModalOpen.value || !shouldShowInterviewFields.value || !interviewerUserId || !dateKey) {
    interviewerAvailability.value = null
    interviewerAvailabilityStatus.value = ''
    interviewerAvailabilityMessage.value = !shouldShowInterviewFields.value
      ? ''
      : interviewerUserId
        ? '請先選擇面試時間'
        : '請先選擇面試官'
    return
  }

  interviewerAvailabilityStatus.value = 'loading'
  interviewerAvailabilityMessage.value = '正在讀取面試官空閒時段'
  try {
    const params = new URLSearchParams({
      interviewerUserId: String(interviewerUserId),
      date: dateKey,
      durationMinutes: String(selectedInterviewDurationMinutes.value),
      applicationId: String(activeApplication.value?.applicationId || activeApplicationId.value || 0),
    })
    const data = await fetchJson(`${apiBaseUrl}/api/schedule/interviewer-availability?${params.toString()}`)
    interviewerAvailability.value = data
    interviewerAvailabilityStatus.value = 'success'
    interviewerAvailabilityMessage.value = ''
  } catch (error) {
    interviewerAvailability.value = null
    interviewerAvailabilityStatus.value = 'error'
    interviewerAvailabilityMessage.value = error?.message || '讀取面試官空閒時段失敗'
  }
}

const scheduleAvailabilityLoad = () => {
  clearAvailabilityLoadTimer()
  availabilityLoadTimer = window.setTimeout(loadInterviewerAvailability, 260)
}

const handleDurationModeChange = (value) => {
  const mode = String(value || '').trim()
  interviewDurationModeDraft.value = mode
  if (mode !== 'custom') {
    interviewDurationMinutesDraft.value = String(normalizeInterviewDurationMinutes(mode))
  }
}

const getAvailabilityTimeRange = (item) =>
  `${String(item?.start || '').slice(11, 16)}-${String(item?.end || '').slice(11, 16)}`

const getAvailabilityItemKey = (item, index) =>
  `${item?.type || 'slot'}-${item?.applicationId || 'free'}-${item?.start || index}-${item?.end || index}-${index}`

const doesSlotFitDuration = (slot) =>
  Number(slot?.durationMinutes || 0) >= selectedInterviewDurationMinutes.value

const doesSelectedInterviewFitSlot = (slot) => {
  if (!doesSlotFitDuration(slot)) return false
  const selectedStart = parseLocalDateTime(interviewScheduledAtDraft.value)
  const selectedEnd = parseLocalDateTime(selectedInterviewEndTime.value)
  const slotStart = parseLocalDateTime(slot?.start)
  const slotEnd = parseLocalDateTime(slot?.end)
  if (!selectedStart || !selectedEnd || !slotStart || !slotEnd) return false
  return selectedStart >= slotStart && selectedEnd <= slotEnd
}

const getAvailabilityItemClass = (item) => {
  if (item?.type === 'preview') return 'preview'
  if (item?.type === 'booked') return 'booked'
  return doesSelectedInterviewFitSlot(item) ? 'free can-insert' : 'free needs-adjustment'
}

const applyAvailabilitySlot = (slot) => {
  if (!slot || slot.type !== 'free' || !doesSlotFitDuration(slot)) return
  const fittedBeforeClick = doesSelectedInterviewFitSlot(slot)
  if (!fittedBeforeClick) {
    interviewScheduledAtDraft.value = toDateTimeLocalFromSql(slot.start)
  }
  interviewerAvailabilityMessage.value = fittedBeforeClick
    ? '所選面試時間可插入此空閒時段'
    : '已將面試時間調整到該空閒時段起始時間'
}

const returnToList = async () => {
  pageMode.value = 'list'
  activeApplicationId.value = null
  activeApplication.value = null
  detailError.value = ''
  resetDetailDrafts(null)
  await loadApplicationTable()
}

const handleApplicationsUpdated = async () => {
  await loadApplicationTable()
  if (pageMode.value !== 'list' && activeApplicationId.value) {
    await loadApplicationDetail(activeApplicationId.value, pageMode.value)
  }
}

const handleTableNotify = ({ message: nextMessage }) => {
  message.value = nextMessage || ''
}

const loadProjectsForTransfer = async () => {
  const data = await fetchJson(`${apiBaseUrl}/api/projects`)
  projectRows.value = Array.isArray(data.projects) ? data.projects : []
  if (!projectTransferForm.value.projectId && projectRows.value[0]?.id) {
    projectTransferForm.value.projectId = String(projectRows.value[0].id)
  }
}

const buildSelectedRowsPreview = (rows) => {
  const names = rows
    .map((row) => String(row.fullName || '').trim())
    .filter(Boolean)
    .slice(0, 10)
  const remainCount = Math.max(rows.length - names.length, 0)
  const namesBlock = names.map((name) => `- ${name}`).join('\n')
  return `${namesBlock || '- （未取得名稱）'}${remainCount > 0 ? `\n- ... 另 ${remainCount} 位` : ''}`
}

const deleteSelectedApplications = async () => {
  if (!selectedApplicationIds.value.length || isBulkDeleting.value) return

  const confirmed = window.confirm(
    `確定刪除已選的 ${selectedApplicationIds.value.length} 筆候選人檔案與投遞資料？此操作無法復原。\n\n` +
      `將刪除名單：\n${buildSelectedRowsPreview(selectedRows.value)}`
  )
  if (!confirmed) return

  isBulkDeleting.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationIds: selectedApplicationIds.value }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '刪除檔案失敗')

    selectedApplicationIds.value = []
    await loadApplicationTable()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = `已刪除 ${Number(data.deletedCount || 0)} 筆檔案與投遞`
  } catch (error) {
    message.value = error?.message || '刪除檔案失敗'
  } finally {
    isBulkDeleting.value = false
  }
}

const summarizeBulkBlacklistResult = ({ action, successCount, failedCount, skippedCount }) => {
  const parts = []
  if (successCount) parts.push(`${action} ${successCount} 筆 Blacklist`)
  if (skippedCount) parts.push(`略過 ${skippedCount} 位`)
  if (failedCount) parts.push(`失敗 ${failedCount} 筆`)
  return parts.join('，') || '沒有可處理的候選人'
}

const openBulkBlacklistModal = () => {
  if (!selectedApplicationIds.value.length || isBulkBlacklisting.value) return
  if (!selectedBlacklistAddUniqueRows.value.length) {
    message.value = '已選候選人沒有可加入 Blacklist 的資料'
    return
  }
  bulkBlacklistReasonDraft.value = ''
  isBulkBlacklistModalOpen.value = true
}

const closeBulkBlacklistModal = () => {
  if (isBulkBlacklisting.value) return
  isBulkBlacklistModalOpen.value = false
  bulkBlacklistReasonDraft.value = ''
}

const bulkAddSelectedToBlacklist = async () => {
  if (!selectedApplicationIds.value.length || isBulkBlacklisting.value) return

  const rowsToAdd = selectedBlacklistAddUniqueRows.value
  if (!rowsToAdd.length) {
    message.value = '已選候選人沒有可加入 Blacklist 的資料'
    closeBulkBlacklistModal()
    return
  }

  const normalizedReason = String(bulkBlacklistReasonDraft.value || '').trim()
  if (!normalizedReason) {
    message.value = '請先輸入 Blacklist 原因'
    return
  }

  const skippedCount = bulkBlacklistSkippedCount.value
  isBulkBlacklisting.value = true
  try {
    const results = await Promise.allSettled(
      rowsToAdd.map((row) =>
        fetchJson(`${apiBaseUrl}/api/candidate-blacklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBlacklistPayloadFromRow(row, normalizedReason)),
        })
      )
    )
    const successCount = results.filter((result) => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    selectedApplicationIds.value = []
    isBulkBlacklistModalOpen.value = false
    bulkBlacklistReasonDraft.value = ''
    await loadApplicationTable()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = summarizeBulkBlacklistResult({
      action: '已加入',
      successCount,
      failedCount,
      skippedCount,
    })
  } catch (error) {
    message.value = error?.message || '批量加入 Blacklist 失敗'
  } finally {
    isBulkBlacklisting.value = false
  }
}

const bulkRemoveSelectedFromBlacklist = async () => {
  if (!selectedApplicationIds.value.length || isBulkUnblacklisting.value) return

  const rowsByEntryId = new Map()
  for (const row of selectedBlacklistRemoveRows.value) {
    const blacklistEntryId = Number(row?.blacklistEntryId || 0)
    if (blacklistEntryId && !rowsByEntryId.has(blacklistEntryId)) {
      rowsByEntryId.set(blacklistEntryId, row)
    }
  }
  const rowsToRemove = Array.from(rowsByEntryId.values())

  if (!rowsToRemove.length) {
    message.value = '已選候選人沒有可取消的 Blacklist'
    return
  }

  const confirmed = window.confirm(
    `確定取消已選候選人的 Blacklist？\n\n` +
      `將處理名單：\n${buildSelectedRowsPreview(rowsToRemove)}`
  )
  if (!confirmed) return

  const skippedCount = Math.max(0, selectedRows.value.length - selectedBlacklistRemoveRows.value.length)
  isBulkUnblacklisting.value = true
  try {
    const results = await Promise.allSettled(
      rowsToRemove.map((row) =>
        fetchJson(`${apiBaseUrl}/api/candidate-blacklist/${Number(row.blacklistEntryId)}`, {
          method: 'DELETE',
        })
      )
    )
    const successCount = results.filter((result) => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    selectedApplicationIds.value = []
    await loadApplicationTable()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = summarizeBulkBlacklistResult({
      action: '已取消',
      successCount,
      failedCount,
      skippedCount,
    })
  } catch (error) {
    message.value = error?.message || '批量取消 Blacklist 失敗'
  } finally {
    isBulkUnblacklisting.value = false
  }
}

const openUploadModal = () => {
  message.value = ''
  isUploadModalOpen.value = true
}

const closeUploadModal = () => {
  isUploadModalOpen.value = false
}

const handleUploadCompleted = async (payload = {}) => {
  closeUploadModal()
  await loadApplicationTable()
  window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  if (payload?.mode === 'batch') {
    message.value = `批量投遞完成，成功 ${payload.successCount || 0} 份，失敗 ${payload.errorCount || 0} 份`
    return
  }
  message.value = `CV 已上傳並建立新投遞${payload?.jobPost?.title ? `：${payload.jobPost.title}` : ''}`
}

const openProjectTransferModal = async (row) => {
  message.value = ''
  projectTransferCandidate.value = row || null
  projectTransferForm.value = {
    projectId: '',
    projectRole: String(row?.matchedPosition || row?.targetPosition || '').trim(),
    startDate: new Date().toISOString().slice(0, 10),
    remark: '',
  }
  isProjectTransferModalOpen.value = true
  try {
    await loadProjectsForTransfer()
    if (!projectRows.value.length) {
      message.value = '請先到項目管理建立項目'
    }
  } catch (error) {
    message.value = error?.message || '讀取項目失敗'
  }
}

const closeProjectTransferModal = () => {
  if (isProjectTransferSaving.value) return
  isProjectTransferModalOpen.value = false
  projectTransferCandidate.value = null
  projectTransferForm.value = createEmptyProjectTransferForm()
}

const submitProjectTransfer = async () => {
  const applicationId = Number(projectTransferCandidate.value?.applicationId || 0)
  if (!applicationId || !projectTransferForm.value.projectId) {
    message.value = '請先選擇要加入的項目'
    return
  }

  isProjectTransferSaving.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/project-personnel/from-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId,
        projectId: projectTransferForm.value.projectId,
        projectRole: projectTransferForm.value.projectRole,
        startDate: projectTransferForm.value.startDate,
        remark: projectTransferForm.value.remark,
      }),
    })
    const candidateName = projectTransferCandidate.value?.fullName || '候選人'
    isProjectTransferModalOpen.value = false
    projectTransferCandidate.value = null
    projectTransferForm.value = createEmptyProjectTransferForm()
    await loadApplicationTable()
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
    message.value = `已將 ${candidateName} 加入項目人員名單`
  } catch (error) {
    message.value = error?.message || '加入項目失敗'
  } finally {
    isProjectTransferSaving.value = false
  }
}

const saveNewStatus = async () => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const nextStatus = normalizeCandidateApplicationStatus(statusDraft.value, '')
  const currentStatus = normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus)
  if (!applicationId || !nextStatus) {
    message.value = '請先選擇有效狀態'
    return
  }
  if (nextStatus === currentStatus) {
    return
  }

  isSavingStatus.value = true
  try {
    const payload = { applicationStatus: nextStatus }
    if (!isInterviewApplicationStatus(nextStatus)) {
      payload.firstInterviewArrangement = ''
      payload.interview = {
        scheduledAt: '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: '',
        location: '',
        status: 'in_progress',
      }
    }
    await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    message.value = `已更新狀態為「${getCandidateApplicationStatusLabel(nextStatus)}」`
    await refreshActiveApplication()
  } catch (error) {
    message.value = error?.message || '更新候選人狀態失敗'
  } finally {
    isSavingStatus.value = false
  }
}

const startRemarkEditor = () => {
  remarkDraft.value = String(activeApplication.value?.remark || '')
  isRemarkEditorOpen.value = true
}

const cancelRemarkEditor = () => {
  remarkDraft.value = String(activeApplication.value?.remark || '')
  isRemarkEditorOpen.value = false
}

const saveApplicationRemark = async () => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const nextRemark = String(remarkDraft.value || '').trim()
  if (!applicationId) return

  isSavingRemark.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: nextRemark }),
    })
    isRemarkEditorOpen.value = false
    message.value = '已更新候選人備註'
    await refreshActiveApplication()
  } catch (error) {
    message.value = error?.message || '更新備註失敗'
  } finally {
    isSavingRemark.value = false
  }
}

const updateFirstInterviewArrangement = async (nextValue) => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const normalizedValue = normalizeFirstInterviewArrangement(nextValue, '')
  const previousValue = normalizeFirstInterviewArrangement(activeApplication.value?.firstInterviewArrangement)
  if (!applicationId) {
    firstInterviewDraft.value = previousValue
    return
  }
  if (normalizedValue === previousValue) {
    firstInterviewDraft.value = previousValue
    return
  }

  firstInterviewDraft.value = normalizedValue
  isSavingFirstInterview.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstInterviewArrangement: normalizedValue }),
    })
    message.value = `已更新面試安排為「${getFirstInterviewArrangementLabel(normalizedValue)}」`
    await refreshActiveApplication()
  } catch (error) {
    firstInterviewDraft.value = previousValue
    message.value = error?.message || '更新面試安排失敗'
  } finally {
    isSavingFirstInterview.value = false
  }
}

const getBlacklistPayload = (reason) => {
  const application = activeApplication.value || {}
  const entry = application.blacklistEntry || {}
  return {
    displayName: String(application.fullName || entry.displayName || '').trim(),
    phone: String(application.phone || entry.phone || '').trim(),
    email: String(application.email || entry.email || '').trim(),
    reason: String(reason || '').trim(),
    status: entry.status || 'active',
    remark: entry.remark || '',
  }
}

const startBlacklistEditor = () => {
  const payload = getBlacklistPayload('')
  if (!payload.phone && !payload.email) {
    message.value = `${activeApplication.value?.fullName || '此候選人'} 沒有電話或 Email，無法加入 Blacklist`
    return
  }
  blacklistReasonDraft.value = ''
  isBlacklistEditorOpen.value = true
}

const cancelBlacklistEditor = () => {
  blacklistReasonDraft.value = String(activeApplication.value?.blacklistEntry?.reason || activeApplication.value?.blacklistReason || '')
  isBlacklistEditorOpen.value = false
}

const saveBlacklistReason = async () => {
  const reason = String(blacklistReasonDraft.value || '').trim()
  if (!reason) {
    message.value = '請先輸入 Blacklist 原因'
    return
  }

  const application = activeApplication.value || {}
  const payload = getBlacklistPayload(reason)
  const blacklistEntryId = Number(application.blacklistEntryId || application.blacklistEntry?.id || 0)
  const endpoint = blacklistEntryId
    ? `${apiBaseUrl}/api/candidate-blacklist/${blacklistEntryId}`
    : `${apiBaseUrl}/api/candidate-blacklist`
  const method = blacklistEntryId ? 'PATCH' : 'POST'

  isSavingBlacklist.value = true
  try {
    await fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    isBlacklistEditorOpen.value = false
    message.value = blacklistEntryId ? '已更新 Blacklist 原因' : '已加入 Blacklist'
    await refreshActiveApplication()
  } catch (error) {
    message.value = error?.message || '保存 Blacklist 失敗'
  } finally {
    isSavingBlacklist.value = false
  }
}

const removeActiveFromBlacklist = async () => {
  const blacklistEntryId = Number(activeApplication.value?.blacklistEntryId || activeApplication.value?.blacklistEntry?.id || 0)
  if (!blacklistEntryId || isSavingBlacklist.value) return

  const confirmed = window.confirm(`確定取消 ${activeApplication.value?.fullName || '此候選人'} 的 Blacklist？`)
  if (!confirmed) return

  isSavingBlacklist.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/candidate-blacklist/${blacklistEntryId}`, {
      method: 'DELETE',
    })
    message.value = '已取消 Blacklist'
    await refreshActiveApplication()
  } catch (error) {
    message.value = error?.message || '取消 Blacklist 失敗'
  } finally {
    isSavingBlacklist.value = false
  }
}

watch(
  [
    interviewerUserIdDraft,
    interviewScheduledAtDraft,
    selectedInterviewDurationMinutes,
    statusDraft,
    firstInterviewDraft,
    isStatusModalOpen,
  ],
  () => {
    if (!isStatusModalOpen.value) return
    if (!shouldShowInterviewFields.value) {
      clearAvailabilityLoadTimer()
      interviewerAvailability.value = null
      interviewerAvailabilityStatus.value = ''
      interviewerAvailabilityMessage.value = ''
      return
    }
    scheduleAvailabilityLoad()
  }
)

onMounted(async () => {
  window.addEventListener('hrai-applications-updated', handleApplicationsUpdated)
  window.addEventListener('focus', handleApplicationsUpdated)
  await loadUserOptions()
  await loadApplicationTable()
})

onUnmounted(() => {
  clearTableLoadStatusTimer()
  clearAvailabilityLoadTimer()
  window.removeEventListener('hrai-applications-updated', handleApplicationsUpdated)
  window.removeEventListener('focus', handleApplicationsUpdated)
})
</script>

<template>
  <section class="candidate-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>{{ pageTitle }}</h2>
          <p>{{ pageDescription }}</p>
        </div>
        <button v-if="pageMode !== 'list'" type="button" class="secondary-btn compact-btn" @click="returnToList">
          返回
        </button>
      </div>
      <p v-if="message" class="message">{{ message }}</p>
    </header>

    <CandidateApplicationsTable
      v-if="pageMode === 'list'"
      :rows="applicationRows"
      :loading="isLoading"
      :load-status="tableLoadStatus"
      :load-message="tableLoadMessage"
      :show-job-column="true"
      :show-target-position-column="false"
      :show-phone-column="false"
      :show-project-transfer-action="true"
      :show-bulk-blacklist-actions="true"
      :show-bulk-upload-action="true"
      :show-job-filter="true"
      :show-status-filter="true"
      :paginated="true"
      :page-size="30"
      :status-actionable="true"
      :bulk-blacklisting="isBulkBlacklisting"
      :bulk-unblacklisting="isBulkUnblacklisting"
      :bulk-blacklist-disabled="bulkBlacklistDisabled"
      :bulk-unblacklist-disabled="bulkUnblacklistDisabled"
      :bulk-upload-disabled="bulkUploadDisabled"
      :selectable="true"
      :selected-ids="selectedApplicationIds"
      :deleting="isBulkDeleting"
      title="候選人清單"
      empty-text="尚無候選人資料"
      search-placeholder="搜尋職位 / 候選人 / 來源 / 對接人 / 狀態 / 面試安排 / 匹配職位 / 備註 / 檔案"
      @selection-change="selectedApplicationIds = $event"
      @delete-selected="deleteSelectedApplications"
      @bulk-blacklist-selected="openBulkBlacklistModal"
      @bulk-unblacklist-selected="bulkRemoveSelectedFromBlacklist"
      @upload-selected-cv="openUploadModal"
      @add-to-project="openProjectTransferModal"
      @edit-status="openApplicationStatusModal"
      @rows-updated="handleApplicationsUpdated"
      @notify="handleTableNotify"
    />

    <section v-else class="candidate-detail-stack">
      <p v-if="isDetailLoading" class="card hint">讀取中...</p>
      <p v-else-if="detailError" class="card error">{{ detailError }}</p>

      <template v-else-if="activeApplication">
        <section class="card detail-card">
          <div class="detail-header">
            <div>
              <h3>{{ pageMode === 'detail' ? '候選人詳情' : '詳情修改' }}</h3>
              <p class="subtle">{{ activeApplication.fullName || '候選人' }}｜{{ activeApplication.jobPostTitle || '未標記職位' }}</p>
            </div>

            <div v-if="pageMode === 'edit'" class="blacklist-editor">
              <button
                v-if="activeApplication.isBlacklisted"
                type="button"
                class="danger-btn compact-btn"
                :disabled="isSavingBlacklist"
                @click="removeActiveFromBlacklist"
              >
                {{ isSavingBlacklist ? '取消中...' : '取消 Blacklist' }}
              </button>
              <button
                v-else-if="!isBlacklistEditorOpen"
                type="button"
                class="danger-btn compact-btn"
                :disabled="isSavingBlacklist"
                @click="startBlacklistEditor"
              >
                加入 Blacklist
              </button>
              <input
                v-model.trim="blacklistReasonDraft"
                type="text"
                class="blacklist-reason-input"
                :disabled="!activeApplication.isBlacklisted && !isBlacklistEditorOpen"
                placeholder="顯示原因原因原因"
              />
              <button
                v-if="activeApplication.isBlacklisted || isBlacklistEditorOpen"
                type="button"
                class="confirm-btn compact-btn"
                :disabled="isSavingBlacklist || !blacklistReasonDraft.trim() || (activeApplication.isBlacklisted && !isBlacklistReasonChanged)"
                @click="saveBlacklistReason"
              >
                {{ isSavingBlacklist ? '保存中...' : '確認' }}
              </button>
              <button
                v-if="isBlacklistEditorOpen && !activeApplication.isBlacklisted"
                type="button"
                class="secondary-btn compact-btn"
                :disabled="isSavingBlacklist"
                @click="cancelBlacklistEditor"
              >
                取消
              </button>
            </div>
          </div>

          <div class="detail-table-wrap">
            <table class="application-table detail-table">
              <thead>
                <tr>
                  <th>職位</th>
                  <th>候選人名稱</th>
                  <th>期望職位</th>
                  <th>匹配職位</th>
                  <th>電話</th>
                  <th>CV檔案</th>
                  <th>AI分析檔案</th>
                  <th>投遞時間</th>
                  <th>是否加入黑名單</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{{ activeApplication.jobPostTitle || '--' }}</td>
                  <td>{{ activeApplication.fullName || '--' }}</td>
                  <td>{{ activeApplication.targetPosition || '--' }}</td>
                  <td>
                    <template v-if="activeApplication.matchedPosition">
                      {{ activeApplication.matchedPosition }}
                      <span class="match-score">{{ activeApplication.matchedScore || 0 }}</span>
                    </template>
                    <span v-else>--</span>
                  </td>
                  <td>{{ activeApplication.phone || '--' }}</td>
                  <td>
                    <a v-if="activeDownloadUrl" class="link-btn file-link" :href="activeDownloadUrl">
                      {{ activeApplication.cvFileName }}
                    </a>
                    <span v-else>--</span>
                  </td>
                  <td>{{ activeApplication.hasExtractedPreview ? activeApplication.extractedFileName : '--' }}</td>
                  <td>{{ formatDateTime(activeApplication.createdAt) }}</td>
                  <td>
                    <span v-if="activeApplication.isBlacklisted" class="blacklist-badge">已拉黑</span>
                    <span v-else class="soft-chip">未加入</span>
                  </td>
                  <td class="detail-remark-cell">{{ activeApplication.remark || '--' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <section
            v-if="activeApplication.dimensionEvaluations?.length || activeApplication.match?.dimensionEvaluations?.length"
            class="match-breakdown-section"
          >
            <h3>匹配維度評分</h3>
            <MatchDimensionBreakdown
              :evaluations="activeApplication.dimensionEvaluations?.length ? activeApplication.dimensionEvaluations : activeApplication.match?.dimensionEvaluations || []"
            />
          </section>
        </section>

        <section class="card status-card">
          <div class="status-header">
            <h3>候選人狀態</h3>

            <div v-if="pageMode === 'edit'" class="status-controls">
              <div class="inline-editor status-inline-editor">
                <AppSelect
                  class="compact-select"
                  :model-value="statusDraft"
                  :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                  placeholder="請選擇狀態"
                  :disabled="isSavingStatus"
                  @update:model-value="statusDraft = $event"
                />
                <button
                  type="button"
                  class="confirm-btn compact-btn"
                  :disabled="isSavingStatus || !isStatusDraftChanged"
                  @click="saveNewStatus"
                >
                  {{ isSavingStatus ? '保存中...' : '保存狀態' }}
                </button>
              </div>

              <div v-if="isInterviewStatusDraft" class="first-interview-editor">
                <span>是否安排面試</span>
                <AppSelect
                  class="compact-select"
                  :model-value="firstInterviewDraft"
                  :options="FIRST_INTERVIEW_ARRANGEMENT_OPTIONS"
                  placeholder="請選擇"
                  :disabled="isSavingFirstInterview"
                  @update:model-value="updateFirstInterviewArrangement"
                />
              </div>

              <button
                v-if="!isRemarkEditorOpen"
                type="button"
                class="edit-btn compact-btn"
                :disabled="isSavingRemark"
                @click="startRemarkEditor"
              >
                修改備註
              </button>
              <div v-else class="inline-editor remark-inline-editor">
                <textarea
                  v-model.trim="remarkDraft"
                  rows="3"
                  :disabled="isSavingRemark"
                  placeholder="輸入原因或跟進記錄"
                ></textarea>
                <button type="button" class="secondary-btn compact-btn" :disabled="isSavingRemark" @click="cancelRemarkEditor">
                  取消
                </button>
                <button type="button" class="confirm-btn compact-btn" :disabled="isSavingRemark" @click="saveApplicationRemark">
                  {{ isSavingRemark ? '保存中...' : '確認' }}
                </button>
              </div>
            </div>
          </div>

          <div class="status-timeline">
            <div
              v-for="(history, index) in activeStatusHistory"
              :key="history.id || `${history.applicationStatus}-${index}`"
              class="timeline-row"
              :class="{ current: index === 0 }"
            >
              <div class="timeline-label">
                <span class="timeline-dot" aria-hidden="true"></span>
                <span class="timeline-status">{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</span>
              </div>
              <div class="timeline-content">
                <p v-if="String(history.remark || '').trim()" class="timeline-remark">{{ history.remark }}</p>
                <p v-if="history.firstInterviewArrangement" class="timeline-extra">
                  面試安排：{{ getFirstInterviewArrangementLabel(history.firstInterviewArrangement) }}
                </p>
                <p v-if="getInterviewSummaryText(history.interview)" class="timeline-extra">
                  面試資訊：{{ getInterviewSummaryText(history.interview) }}
                </p>
                <div class="timeline-meta-row">
                  <span class="timeline-meta">{{ formatDateTime(history.updatedAt || history.createdAt) }}</span>
                  <span class="timeline-operator">
                    <span
                      class="timeline-operator-avatar"
                      :style="getStatusHistoryOperatorAvatarStyle(history)"
                    >
                      {{ getStatusHistoryOperatorAvatarText(history) }}
                    </span>
                    <span>{{ getStatusHistoryOperatorName(history) }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </section>

    <CandidateCvUploadModal
      :open="isUploadModalOpen"
      @close="closeUploadModal"
      @uploaded="handleUploadCompleted"
    />

    <div v-if="isBulkBlacklistModalOpen" class="modal-backdrop" @click.self="closeBulkBlacklistModal">
      <div class="modal-panel bulk-blacklist-modal">
        <header class="modal-header">
          <div>
            <h3>加入黑名單</h3>
            <p class="subtle">將已勾選且有電話或 Email 的候選人加入黑名單。</p>
          </div>
          <button type="button" class="ghost-btn" :disabled="isBulkBlacklisting" @click="closeBulkBlacklistModal">關閉</button>
        </header>

        <div class="selected-preview-box">
          <p class="subtle">
            可加入 {{ selectedBlacklistAddUniqueRows.length }} 位
            <template v-if="bulkBlacklistSkippedCount">｜略過 {{ bulkBlacklistSkippedCount }} 位已在黑名單、缺少聯絡方式或重複資料的候選人</template>
          </p>
          <ul>
            <li v-for="row in selectedBlacklistAddUniqueRows.slice(0, 8)" :key="row.applicationId">
              {{ row.fullName || '候選人' }}
              <span>{{ row.phone || row.email || '--' }}</span>
            </li>
          </ul>
          <p v-if="selectedBlacklistAddUniqueRows.length > 8" class="subtle">另 {{ selectedBlacklistAddUniqueRows.length - 8 }} 位</p>
        </div>

        <label class="field">
          <span>原因</span>
          <textarea
            v-model.trim="bulkBlacklistReasonDraft"
            rows="4"
            :disabled="isBulkBlacklisting"
            placeholder="請輸入加入黑名單的原因"
          ></textarea>
        </label>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="isBulkBlacklisting" @click="closeBulkBlacklistModal">取消</button>
          <button
            type="button"
            class="danger-btn"
            :disabled="isBulkBlacklisting || !bulkBlacklistReasonDraft.trim() || !selectedBlacklistAddUniqueRows.length"
            @click="bulkAddSelectedToBlacklist"
          >
            {{ isBulkBlacklisting ? '加入中...' : '確認加入' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="isStatusModalOpen" class="modal-backdrop" @click.self="closeApplicationStatusModal">
      <div class="modal-panel status-modal">
        <header class="modal-header">
          <div>
            <h3>候選人狀態</h3>
            <p class="subtle">
              {{ activeApplication?.fullName || '候選人' }}
              <template v-if="activeApplication?.jobPostTitle">｜{{ activeApplication.jobPostTitle }}</template>
            </p>
          </div>
          <button type="button" class="ghost-btn" :disabled="isStatusModalBusy" @click="closeApplicationStatusModal">關閉</button>
        </header>

        <p v-if="isDetailLoading" class="hint">讀取中...</p>
        <p v-else-if="detailError" class="error">{{ detailError }}</p>

        <template v-else-if="activeApplication">
          <div class="status-editor-header">
            <div>
              <h4>{{ statusModalEditorTitle }}</h4>
              <p class="subtle">點選下方記錄可修改；未選記錄時會新增一筆狀態記錄。</p>
            </div>
          </div>

          <div class="status-modal-body" :class="{ 'without-availability': !shouldShowInterviewFields }">
            <div class="status-modal-main">
              <div class="status-modal-editor">
                <label class="field">
              <span>候選人狀態</span>
              <AppSelect
                :model-value="statusDraft"
                :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                placeholder="請選擇狀態"
                :disabled="isSavingStatusModal"
                @update:model-value="statusDraft = $event"
              />
                </label>

                <label v-if="isInterviewStatusDraft" class="field">
              <span>是否安排面試</span>
              <AppSelect
                :model-value="firstInterviewDraft"
                :options="FIRST_INTERVIEW_ARRANGEMENT_OPTIONS"
                placeholder="請選擇"
                :disabled="isSavingStatusModal"
                @update:model-value="firstInterviewDraft = $event"
              />
                </label>

                <template v-if="shouldShowInterviewFields">
                  <label class="field">
                <span>面試時間</span>
                <input
                  v-model="interviewScheduledAtDraft"
                  type="datetime-local"
                  autocomplete="off"
                  :disabled="isSavingStatusModal"
                />
                  </label>

                  <label class="field duration-field">
                    <span>面試時長</span>
                    <AppSelect
                      :model-value="interviewDurationModeDraft"
                      :options="INTERVIEW_DURATION_PRESET_OPTIONS"
                      placeholder="請選擇時長"
                      :disabled="isSavingStatusModal"
                      @update:model-value="handleDurationModeChange"
                    />
                    <input
                      v-if="interviewDurationModeDraft === 'custom'"
                      v-model="interviewDurationMinutesDraft"
                      type="number"
                      min="1"
                      max="480"
                      step="1"
                      autocomplete="off"
                      :disabled="isSavingStatusModal"
                      placeholder="分鐘"
                    />
                  </label>

                  <label class="field">
                <span>面試官</span>
                <AppSelect
                  :model-value="interviewerUserIdDraft"
                  :options="interviewerOptions"
                  placeholder="請選擇面試官"
                  :disabled="isSavingStatusModal"
                  @update:model-value="interviewerUserIdDraft = $event"
                />
                  </label>

                  <label class="field">
                <span>面試地點</span>
                <AppSelect
                  :model-value="interviewLocationDraft"
                  :options="[{ value: '', label: '未指定' }, ...INTERVIEW_LOCATION_OPTIONS]"
                  placeholder="請選擇地點"
                  :disabled="isSavingStatusModal"
                  @update:model-value="interviewLocationDraft = $event"
                />
                  </label>

                  <label class="field">
                <span>面試狀態</span>
                <AppSelect
                  :model-value="interviewStatusDraft"
                  :options="INTERVIEW_STATUS_OPTIONS"
                  placeholder="請選擇面試狀態"
                  :disabled="isSavingStatusModal"
                  @update:model-value="interviewStatusDraft = $event"
                />
                  </label>
                </template>

                <label class="field full-span">
              <span>備註</span>
              <textarea
                v-model.trim="remarkDraft"
                rows="4"
                :disabled="isSavingStatusModal"
                placeholder="輸入原因或跟進記錄"
              ></textarea>
                </label>
              </div>

              <section class="status-history-section">
            <h4>狀態記錄</h4>
            <div class="status-timeline">
              <div
                v-for="(history, index) in activeStatusHistory"
                :key="history.id || `${history.applicationStatus}-${index}`"
                class="timeline-row"
                :class="{
                  current: index === 0,
                  selected: Number(editingStatusHistoryId) === Number(history.id),
                  disabled: isStatusModalBusy || !history.id,
                }"
                role="button"
                tabindex="0"
                @click="editStatusHistoryDraft(history)"
                @keydown.enter.prevent="editStatusHistoryDraft(history)"
                @keydown.space.prevent="editStatusHistoryDraft(history)"
              >
                <div class="timeline-label">
                  <span class="timeline-dot" aria-hidden="true"></span>
                  <span class="timeline-status">{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</span>
                </div>
                <div class="timeline-content">
                  <p v-if="String(history.remark || '').trim()" class="timeline-remark">{{ history.remark }}</p>
                  <p v-if="history.firstInterviewArrangement" class="timeline-extra">
                    面試安排：{{ getFirstInterviewArrangementLabel(history.firstInterviewArrangement) }}
                  </p>
                  <p v-if="getInterviewSummaryText(history.interview)" class="timeline-extra">
                    面試資訊：{{ getInterviewSummaryText(history.interview) }}
                  </p>
                  <div class="timeline-meta-row">
                    <span class="timeline-meta">{{ formatDateTime(history.updatedAt || history.createdAt) }}</span>
                    <span class="timeline-operator">
                      <span
                        class="timeline-operator-avatar"
                        :style="getStatusHistoryOperatorAvatarStyle(history)"
                      >
                        {{ getStatusHistoryOperatorAvatarText(history) }}
                      </span>
                      <span>{{ getStatusHistoryOperatorName(history) }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
              </section>
            </div>

            <aside v-if="shouldShowInterviewFields" class="availability-panel">
              <div class="availability-header">
                <div>
                  <h4>面試官空閒時間</h4>
                  <p>
                    <template v-if="availabilityDateLabel">{{ availabilityDateLabel }}</template>
                    <template v-else>請先選擇面試官與面試時間</template>
                  </p>
                </div>
                <span>{{ getInterviewDurationLabel(selectedInterviewDurationMinutes) }}</span>
              </div>

              <p v-if="interviewerAvailabilityStatus === 'loading'" class="hint">讀取空閒時段中...</p>
              <p v-else-if="interviewerAvailabilityMessage" class="hint">{{ interviewerAvailabilityMessage }}</p>

              <div v-if="availabilityTimelineItems.length" class="availability-timeline">
                <button
                  v-for="(item, index) in availabilityTimelineItems"
                  :key="getAvailabilityItemKey(item, index)"
                  type="button"
                  class="availability-slot"
                  :class="getAvailabilityItemClass(item)"
                  :disabled="item.type !== 'free' || !doesSlotFitDuration(item)"
                  @click="applyAvailabilitySlot(item)"
                >
                  <span class="availability-time">{{ getAvailabilityTimeRange(item) }}</span>
                  <span class="availability-copy">
                    <strong>{{ item.type === 'preview' ? '當前安排' : item.type === 'booked' ? '已安排' : '空閒' }}</strong>
                    <em v-if="item.type === 'preview'">{{ item.fullName || '當前候選人' }}｜{{ item.jobPostTitle || '--' }}</em>
                    <em v-else-if="item.type === 'booked'">{{ item.fullName || '候選人' }}｜{{ item.jobPostTitle || '--' }}</em>
                    <em v-else-if="doesSelectedInterviewFitSlot(item)">可插入當前面試時間</em>
                    <em v-else-if="doesSlotFitDuration(item)">可點擊調整到此時段</em>
                    <em v-else>時長不足</em>
                  </span>
                </button>
              </div>
              <p v-else-if="interviewerUserIdDraft && interviewScheduledAtDraft && interviewerAvailabilityStatus !== 'loading'" class="hint">
                當天沒有可顯示的空閒時段。
              </p>
            </aside>
          </div>
        </template>

        <div class="modal-actions">
          <button
            v-if="isEditingStatusHistory"
            type="button"
            class="secondary-btn"
            :disabled="isStatusModalBusy"
            @click="startNewStatusHistoryDraft"
          >
            改為新增
          </button>
          <button
            v-if="isEditingStatusHistory && selectedStatusHistory"
            type="button"
            class="danger-btn"
            :disabled="isStatusModalBusy || isStatusHistoryDeleting(editingStatusHistoryId)"
            @click="deleteStatusHistory(selectedStatusHistory)"
          >
            {{ isStatusHistoryDeleting(editingStatusHistoryId) ? '刪除中...' : '刪除狀態記錄' }}
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="isStatusModalBusy || !activeApplication"
            @click="saveStatusModalChanges"
          >
            {{ isSavingStatusModal ? '保存中...' : (isEditingStatusHistory ? '更新狀態記錄' : '新增狀態記錄') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="isProjectTransferModalOpen" class="modal-backdrop" @click.self="closeProjectTransferModal">
      <div class="modal-panel project-transfer-modal">
        <header class="modal-header">
          <div>
            <h3>加入項目人員名單</h3>
            <p class="subtle">{{ projectTransferCandidate?.fullName || '候選人' }}｜{{ projectTransferCandidate?.matchedPosition || projectTransferCandidate?.targetPosition || '未標記職位' }}</p>
          </div>
          <button type="button" class="ghost-btn" :disabled="isProjectTransferSaving" @click="closeProjectTransferModal">關閉</button>
        </header>

        <div class="transfer-form-grid">
          <label class="field">
            <span>項目</span>
            <AppSelect
              :model-value="projectTransferForm.projectId"
              :options="projectOptions"
              placeholder="選擇項目"
              empty-text="尚未建立項目"
              :disabled="isProjectTransferSaving"
              @update:model-value="projectTransferForm.projectId = $event"
            />
          </label>
          <label class="field">
            <span>項目角色</span>
            <input v-model.trim="projectTransferForm.projectRole" type="text" :disabled="isProjectTransferSaving" placeholder="例如：顧問 / 分析師" />
          </label>
          <label class="field">
            <span>入組日期</span>
            <input v-model="projectTransferForm.startDate" type="date" :disabled="isProjectTransferSaving" />
          </label>
          <label class="field full-span">
            <span>備註</span>
            <textarea v-model.trim="projectTransferForm.remark" rows="3" :disabled="isProjectTransferSaving" placeholder="補充轉入原因或安排說明"></textarea>
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="isProjectTransferSaving" @click="closeProjectTransferModal">取消</button>
          <button type="button" class="primary-btn" :disabled="isProjectTransferSaving || !projectTransferForm.projectId" @click="submitProjectTransfer">
            {{ isProjectTransferSaving ? '加入中...' : '加入項目' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.candidate-page,
.candidate-detail-stack {
  display: grid;
  gap: 0.9rem;
  color: var(--text-base);
}

.header-main,
.detail-header,
.status-header,
.modal-header,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.compact-btn {
  min-height: 36px;
  padding: 0.48rem 0.9rem;
  font-size: 0.84rem;
}

.detail-card,
.status-card,
.status-modal,
.bulk-blacklist-modal,
.project-transfer-modal {
  display: grid;
  gap: 1rem;
}

.detail-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius-md) - 4px);
  background: rgba(255, 255, 255, 0.72);
}

.detail-table {
  width: max-content;
  min-width: 100%;
}

.detail-table th,
.detail-table td {
  white-space: nowrap;
}

.match-breakdown-section {
  display: grid;
  gap: 0.75rem;
}

.match-breakdown-section h3 {
  margin: 0;
}

.detail-remark-cell {
  min-width: 220px;
  max-width: 320px;
  white-space: pre-wrap;
}

.file-link {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.blacklist-editor {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.72rem;
  flex-wrap: wrap;
  min-width: min(520px, 100%);
}

.blacklist-reason-input {
  width: min(240px, 100%);
  min-height: 38px;
  padding: 0.56rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: #ffffff;
  color: var(--text-strong);
}

.blacklist-reason-input:disabled {
  color: var(--text-muted);
  background: var(--surface-muted);
  cursor: not-allowed;
}

.blacklist-badge,
.soft-chip,
.match-score {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0.2rem 0.64rem;
  border-radius: var(--radius-pill);
  font-size: 0.78rem;
  font-weight: 800;
}

.blacklist-badge {
  color: #b42318;
  background: rgba(217, 45, 32, 0.1);
}

.soft-chip,
.match-score {
  color: var(--text-base);
  background: var(--surface-soft);
}

.status-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.72rem;
  flex-wrap: wrap;
}

.inline-editor,
.first-interview-editor {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.first-interview-editor > span {
  color: var(--text-base);
  font-size: 0.84rem;
  font-weight: 700;
}

.compact-select {
  width: min(230px, 100%);
}

.compact-select :deep(.app-select-trigger) {
  min-height: 38px;
  padding: 0.48rem 0.85rem;
  border-radius: var(--radius-pill);
}

.compact-select :deep(.app-select-menu) {
  width: max-content;
  min-width: 100%;
}

.remark-inline-editor textarea {
  width: min(360px, 100%);
  min-height: 72px;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-strong);
  resize: vertical;
}

.status-timeline {
  display: grid;
  gap: 1rem;
}

.status-modal {
  width: min(1180px, calc(100vw - 2rem));
}

.bulk-blacklist-modal,
.project-transfer-modal {
  width: min(620px, calc(100vw - 2rem));
}

.selected-preview-box {
  display: grid;
  gap: 0.55rem;
  padding: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(245, 248, 252, 0.68);
}

.selected-preview-box ul {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.selected-preview-box li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--text-strong);
  font-size: 0.88rem;
  font-weight: 700;
}

.selected-preview-box li span {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 600;
}

.status-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.status-editor-header h4 {
  margin: 0;
  color: var(--text-strong);
  font-size: 1rem;
}

.status-editor-header .subtle {
  margin-top: 0.28rem;
}

.status-modal-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  gap: 1rem;
  align-items: start;
}

.status-modal-body.without-availability {
  grid-template-columns: minmax(0, 1fr);
}

.status-modal-main {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.status-modal-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.duration-field {
  gap: 0.5rem;
}

.status-modal-editor textarea,
.status-modal-editor input {
  min-height: 98px;
}

.status-modal-editor input {
  min-height: 42px;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.36);
  border-radius: 12px;
  color: var(--text-base);
  font: inherit;
}

.status-modal-editor textarea {
  resize: vertical;
}

.status-modal .modal-actions {
  justify-content: flex-end;
}

.availability-panel {
  position: sticky;
  top: 0;
  display: grid;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  background: #f8fafc;
}

.availability-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.availability-header h4,
.availability-header p {
  margin: 0;
}

.availability-header h4 {
  color: var(--text-strong);
  font-size: 0.98rem;
}

.availability-header p,
.availability-copy em {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-style: normal;
}

.availability-header > span {
  flex: 0 0 auto;
  padding: 0.24rem 0.55rem;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 0.78rem;
  font-weight: 800;
}

.availability-timeline {
  position: relative;
  display: grid;
  gap: 0.55rem;
  padding-left: 0.7rem;
}

.availability-timeline::before {
  content: '';
  position: absolute;
  top: 0.2rem;
  bottom: 0.2rem;
  left: 0.18rem;
  width: 2px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.38);
}

.availability-slot {
  position: relative;
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 0.6rem;
  align-items: start;
  width: 100%;
  padding: 0.62rem 0.72rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: #fff;
  color: var(--text-base);
  text-align: left;
  cursor: pointer;
}

.availability-slot::before {
  content: '';
  position: absolute;
  top: 0.9rem;
  left: -0.73rem;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: currentColor;
}

.availability-slot.booked {
  color: #64748b;
  cursor: not-allowed;
  opacity: 0.72;
}

.availability-slot.preview {
  border-color: rgba(37, 99, 235, 0.34);
  background: #dbeafe;
  color: #1d4ed8;
  cursor: default;
}

.availability-slot.preview .availability-copy strong {
  color: #1e40af;
}

.availability-slot.free.can-insert:hover {
  border-color: rgba(22, 163, 74, 0.42);
  background: #dcfce7;
  color: #166534;
}

.availability-slot.free.needs-adjustment:hover {
  border-color: rgba(217, 119, 6, 0.42);
  background: #fef3c7;
  color: #92400e;
}

.availability-slot:disabled {
  cursor: not-allowed;
}

.availability-slot.preview:disabled {
  cursor: default;
}

.availability-time {
  color: inherit;
  font-size: 0.78rem;
  font-weight: 900;
}

.availability-copy {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.availability-copy strong {
  color: var(--text-strong);
  font-size: 0.86rem;
}

.status-history-section {
  display: grid;
  gap: 0.85rem;
  padding-top: 0.2rem;
}

.status-history-section h4 {
  margin: 0;
  color: var(--text-strong);
  font-size: 1rem;
}

.timeline-row {
  display: grid;
  grid-template-columns: minmax(190px, 250px) minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
}

.timeline-row.disabled {
  cursor: default;
}

.timeline-row:not(.disabled):hover .timeline-label,
.timeline-row.selected .timeline-label {
  border-color: rgba(47, 111, 237, 0.24);
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.08);
}

.timeline-label {
  display: inline-flex;
  align-items: center;
  align-self: start;
  gap: 0.5rem;
  min-height: 38px;
  padding: 0.45rem 0.9rem;
  border: 1px solid rgba(16, 24, 40, 0.08);
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--text-base);
  font-weight: 800;
}

.timeline-row.current .timeline-label {
  border-color: rgba(47, 111, 237, 0.14);
  background: rgba(47, 111, 237, 0.13);
  color: var(--accent);
}

.timeline-dot {
  width: 0.48rem;
  height: 0.48rem;
  border-radius: 999px;
  background: currentColor;
}

.timeline-content {
  display: grid;
  gap: 0.38rem;
  min-width: 0;
}

.timeline-meta,
.timeline-extra,
.timeline-operator {
  margin: 0;
  color: var(--text-soft);
  font-size: 0.82rem;
  font-weight: 400;
}

.timeline-remark {
  margin: 0;
  color: var(--text-base);
  font-size: 0.9rem;
  font-weight: 650;
  line-height: 1.5;
  white-space: pre-wrap;
}

.timeline-meta-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.38rem 0.72rem;
  min-width: 0;
  padding-top: 0.24rem;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  text-align: right;
}

.timeline-operator {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  font-weight: 400;
}

.timeline-operator-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.46rem;
  height: 1.46rem;
  border-radius: 999px;
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

.transfer-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.full-span {
  grid-column: 1 / -1;
}

@media (max-width: 900px) {
  .header-main,
  .detail-header,
  .status-header,
  .modal-header,
  .modal-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .blacklist-editor,
  .status-controls,
  .inline-editor,
  .first-interview-editor {
    justify-content: flex-start;
  }

  .timeline-row {
    grid-template-columns: 1fr;
  }

  .transfer-form-grid {
    grid-template-columns: 1fr;
  }

  .status-modal-body {
    grid-template-columns: 1fr;
  }

  .availability-panel {
    position: static;
  }

  .status-modal-editor {
    grid-template-columns: 1fr;
  }
}
</style>
