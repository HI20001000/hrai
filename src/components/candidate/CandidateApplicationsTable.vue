<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import AppSelect from '../AppSelect.vue'
import CandidateColumnFilter from './CandidateColumnFilter.vue'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  getCandidateApplicationStatusLabel,
  getInterviewDurationLabel,
  getInterviewLocationLabel,
  getInterviewStatusLabel,
  normalizeCandidateApplicationStatus,
} from '../../scripts/candidateApplicationStatus.js'
import { normalizeSearchText } from '../../scripts/searchNormalize.js'
import { CV_SOURCE_OPTIONS, normalizeCvSource } from '../../scripts/cvSource.js'
import CandidateTextPreviewModal from './CandidateTextPreviewModal.vue'

const props = defineProps({
  title: {
    type: String,
    default: '候選人清單',
  },
  subtitle: {
    type: String,
    default: '',
  },
  rows: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadStatus: {
    type: String,
    default: '',
  },
  loadMessage: {
    type: String,
    default: '',
  },
  showJobColumn: {
    type: Boolean,
    default: false,
  },
  showTargetPositionColumn: {
    type: Boolean,
    default: true,
  },
  showPhoneColumn: {
    type: Boolean,
    default: true,
  },
  editableStatus: {
    type: Boolean,
    default: false,
  },
  showBlacklistAction: {
    type: Boolean,
    default: false,
  },
  showProjectTransferAction: {
    type: Boolean,
    default: false,
  },
  showRowActions: {
    type: Boolean,
    default: false,
  },
  statusActionable: {
    type: Boolean,
    default: false,
  },
  showBulkBlacklistActions: {
    type: Boolean,
    default: false,
  },
  showBulkUploadAction: {
    type: Boolean,
    default: false,
  },
  showStatusFilter: {
    type: Boolean,
    default: false,
  },
  showJobFilter: {
    type: Boolean,
    default: false,
  },
  showOwnerFilter: {
    type: Boolean,
    default: true,
  },
  showSourceFilter: {
    type: Boolean,
    default: true,
  },
  paginated: {
    type: Boolean,
    default: false,
  },
  pageSize: {
    type: Number,
    default: 30,
  },
  tableMaxHeight: {
    type: String,
    default: 'min(66vh, 760px)',
  },
  bulkBlacklisting: {
    type: Boolean,
    default: false,
  },
  bulkUnblacklisting: {
    type: Boolean,
    default: false,
  },
  bulkUploading: {
    type: Boolean,
    default: false,
  },
  bulkBlacklistDisabled: {
    type: Boolean,
    default: false,
  },
  bulkUnblacklistDisabled: {
    type: Boolean,
    default: false,
  },
  bulkUploadDisabled: {
    type: Boolean,
    default: false,
  },
  deleteSelectedLabel: {
    type: String,
    default: '刪除已選擇',
  },
  selectable: {
    type: Boolean,
    default: false,
  },
  selectedIds: {
    type: Array,
    default: () => [],
  },
  deleting: {
    type: Boolean,
    default: false,
  },
  emptyText: {
    type: String,
    default: '尚無候選人資料',
  },
  searchPlaceholder: {
    type: String,
    default: '搜尋候選人 / 來源 / 對接人 / 狀態 / 面試資訊 / 期望職位 / 匹配職位 / 電話 / 備註 / 檔案',
  },
})

const emit = defineEmits([
  'selection-change',
  'delete-selected',
  'bulk-blacklist-selected',
  'bulk-unblacklist-selected',
  'upload-selected-cv',
  'add-to-project',
  'view-details',
  'edit-details',
  'edit-status',
  'rows-updated',
  'notify',
])

const searchKeyword = ref('')
const statusFilter = ref('')
const jobFilter = ref('')
const ownerFilter = ref('')
const sourceFilter = ref('')
const matchedPositionFilter = ref('')
const matchedScoreSort = ref('')
const currentPage = ref(1)
const statusOverrides = ref({})
const savingStatusIds = ref([])
const remarkDrafts = ref({})
const savingRemarkIds = ref([])
const addingBlacklistIds = ref([])
const activeStatusPopoverKey = ref('')
const activeStatusPopoverRow = ref(null)
const statusPopoverStyle = ref({})
let statusPopoverCloseTimer = null
const activeColumnFilter = ref('')
const columnFilterSearchKeyword = ref('')
const columnFilterSearchInput = ref(null)
const columnFilterMenuStyle = ref({})
const columnFilterInstanceId = `candidate-filter-${Math.random().toString(36).slice(2)}`

const isPreviewOpen = ref(false)
const previewTitle = ref('')
const previewContent = ref('')
const previewType = ref('cv')
const previewCvId = ref(null)
const previewApplicationId = ref(null)
const isPreviewLoading = ref(false)
const previewError = ref('')
const previewDownloadUrl = ref('')
const previewDownloadFileName = ref('')
const previewFileUrl = ref('')

const normalizeFilterText = (value) => String(value ?? '').trim()

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getMatchScoreTone = (score) => {
  const numericScore = Number(score || 0)
  if (numericScore >= 85) return 'score-high'
  if (numericScore >= 60) return 'score-medium'
  if (numericScore > 0) return 'score-low'
  return 'score-empty'
}

const getStatusToneClass = (status) => {
  const normalized = normalizeCandidateApplicationStatus(status)
  return `status-tone-${normalized}`
}

const isInterviewApplicationStatus = (status) =>
  ['hr_interview', 'department_interview'].includes(normalizeCandidateApplicationStatus(status, ''))

const getInterviewUserName = (interview) => {
  const user = interview?.interviewerUser || null
  return String(user?.username || user?.email || user?.mail || '').trim()
}

const getInterviewSummaryParts = (row) => {
  const interview = row?.interview || {}
  const interviewerName = getInterviewUserName(interview)
  const hasInterviewInfo =
    Boolean(interview.scheduledAt || interview.location || interviewerName) ||
    String(interview.status || '').trim() === 'passed' ||
    String(interview.status || '').trim() === 'failed'
  const parts = []
  if (interview.scheduledAt) parts.push(formatDateTime(interview.scheduledAt))
  if (hasInterviewInfo && interview.durationMinutes) parts.push(getInterviewDurationLabel(interview.durationMinutes))
  if (interview.location) parts.push(getInterviewLocationLabel(interview.location))
  if (interviewerName) parts.push(`面試官：${interviewerName}`)
  if (hasInterviewInfo && interview.status) parts.push(getInterviewStatusLabel(interview.status))
  return parts.filter(Boolean)
}

const getInterviewSummaryText = (row) => {
  const parts = getInterviewSummaryParts(row)
  if (parts.length) return parts.join('｜')
  return '--'
}

const shouldShowStatusHistoryInterview = (history = {}) =>
  isInterviewApplicationStatus(history?.applicationStatus) && getInterviewSummaryParts(history).length > 0

const getRowStatusHistory = (row) => {
  const history = Array.isArray(row?.statusHistory) ? row.statusHistory : []
  if (history.length) return history

  return [
    {
      id: 0,
      applicationStatus: row?.applicationStatus,
      interview: row?.interview,
      remark: row?.remark,
      createdAt: row?.createdAt,
      updatedAt: row?.updatedAt || row?.createdAt,
    },
  ]
}

const getStatusHistoryKey = (history, index) =>
  history?.id || `${history?.applicationStatus || 'status'}-${history?.createdAt || index}`

const getRowKey = (row) =>
  row?.rowId || (row?.statusHistoryId ? `history-${Number(row.statusHistoryId)}` : Number(row?.applicationId || 0))

const getStatusPopoverKey = (row) => `status-${getRowKey(row)}`

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
  if (!props.statusActionable) return
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

const openStatusEditor = (row) => {
  clearStatusPopoverTimer()
  closeStatusPopover()
  emit('edit-status', row)
}

const getBlacklistMatchedByLabel = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'phone') return '電話'
  if (normalized === 'email') return 'Email'
  return '--'
}

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const attachPreviewSource = (text, source) => {
  const normalizedSource = String(source || '').trim()
  if (!normalizedSource) return String(text || '')
  const parsed = parseJsonSafe(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return String(text || '')
  return JSON.stringify({ ...parsed, source: parsed.source || normalizedSource }, null, 2)
}

const withAuthHeaders = (headers = {}) => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const clientTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const baseHeaders = { ...headers, 'X-HRAI-Client-Time': clientTime }
  return token ? { ...baseHeaders, Authorization: `Bearer ${token}` } : baseHeaders
}

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

const getOwnerUser = (row) => row?.ownerUser || null

const getOwnerUserName = (row) => {
  const owner = getOwnerUser(row)
  return String(owner?.username || owner?.email || owner?.mail || '').trim()
}

const getOwnerUserAvatarText = (row) => {
  const owner = getOwnerUser(row)
  const fallback = getOwnerUserName(row).slice(0, 1).toUpperCase() || 'U'
  return String(owner?.avatarText || '').trim() || fallback
}

const getOwnerUserAvatarStyle = (row) => {
  const owner = getOwnerUser(row)
  const color = String(owner?.avatarBgColor || '').trim()
  return { background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#64748b' }
}

const isRemarkSaving = (applicationId) => savingRemarkIds.value.includes(Number(applicationId))

const getRemarkDraft = (row) => {
  const applicationId = Number(row?.applicationId)
  return Object.prototype.hasOwnProperty.call(remarkDrafts.value, applicationId)
    ? remarkDrafts.value[applicationId]
    : String(row?.remark || '')
}

const getRemarkTooltip = (row) => String(getRemarkDraft(row) || '').trim() || undefined

const isStatusSaving = (applicationId) => savingStatusIds.value.includes(Number(applicationId))
const isBlacklistSaving = (applicationId) => addingBlacklistIds.value.includes(Number(applicationId))

const displayRows = computed(() =>
  props.rows.map((row) => ({
    ...row,
    applicationStatus:
      statusOverrides.value[Number(row.applicationId)] ??
      normalizeCandidateApplicationStatus(row.applicationStatus),
  }))
)

const statusFilterOptions = computed(() => [
  { value: '', label: '全部' },
  ...CANDIDATE_APPLICATION_STATUS_OPTIONS,
])

const sourceFilterOptions = computed(() => [
  { value: '', label: '全部' },
  ...CV_SOURCE_OPTIONS,
])

const jobFilterOptions = computed(() => {
  const seen = new Set()
  const options = []

  for (const row of displayRows.value) {
    const title = normalizeFilterText(row.jobPostTitle)
    if (!title || seen.has(title)) continue
    seen.add(title)
    options.push({ value: title, label: title })
  }

  return [{ value: '', label: '全部' }, ...options]
})

const ownerFilterOptions = computed(() => {
  const seen = new Set()
  const options = []

  for (const row of displayRows.value) {
    const owner = getOwnerUser(row)
    const value = owner?.id ? String(owner.id) : ''
    const label = getOwnerUserName(row)
    if (!value || !label || seen.has(value)) continue
    seen.add(value)
    options.push({
      value,
      label,
      avatarText: getOwnerUserAvatarText(row),
      avatarBgColor: owner?.avatarBgColor || '',
    })
  }

  return [{ value: '', label: '全部' }, ...options]
})

const matchedPositionFilterOptions = computed(() => {
  const seen = new Set()
  const options = []

  for (const row of displayRows.value) {
    const position = normalizeFilterText(row.matchedPosition)
    if (!position || seen.has(position)) continue
    seen.add(position)
    options.push({ value: position, label: position })
  }

  return [{ value: '', label: '全部' }, ...options]
})

const columnFilterLabels = {
  job: '職位',
  status: '候選人狀態',
  owner: '對接人',
  source: 'CV 來源',
  matchedPosition: '匹配職位',
}

const getColumnFilterOptions = (key) => {
  if (key === 'job') return jobFilterOptions.value
  if (key === 'status') return statusFilterOptions.value
  if (key === 'owner') return ownerFilterOptions.value
  if (key === 'source') return sourceFilterOptions.value
  if (key === 'matchedPosition') return matchedPositionFilterOptions.value
  return []
}

const getColumnFilterValue = (key) => {
  if (key === 'job') return jobFilter.value
  if (key === 'status') return statusFilter.value
  if (key === 'owner') return ownerFilter.value
  if (key === 'source') return sourceFilter.value
  if (key === 'matchedPosition') return matchedPositionFilter.value
  return ''
}

const setColumnFilterValue = (key, value) => {
  const nextValue = String(value ?? '')
  if (key === 'job') {
    jobFilter.value = nextValue
    return
  }
  if (key === 'status') {
    statusFilter.value = nextValue
    return
  }
  if (key === 'owner') {
    ownerFilter.value = nextValue
    return
  }
  if (key === 'source') {
    sourceFilter.value = nextValue
    return
  }
  if (key === 'matchedPosition') {
    matchedPositionFilter.value = nextValue
  }
}

const toggleMatchedScoreSort = (direction) => {
  matchedScoreSort.value = matchedScoreSort.value === direction ? '' : direction
}

const getColumnFilterOptionAvatarStyle = (option) => {
  const color = String(option?.avatarBgColor || '').trim()
  return { background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#64748b' }
}

const closeColumnFilter = () => {
  activeColumnFilter.value = ''
  columnFilterSearchKeyword.value = ''
  columnFilterMenuStyle.value = {}
}

const isColumnFilterOpen = (key) => activeColumnFilter.value === key

const isColumnFilterActive = (key) => Boolean(getColumnFilterValue(key))

const getColumnFilterButtonLabel = (key) => {
  const label = columnFilterLabels[key] || '欄位'
  const value = getColumnFilterValue(key)
  if (!value) return `篩選${label}`

  const selectedOption = getColumnFilterOptions(key).find((option) => option.value === value)
  return `${label}篩選：${selectedOption?.label || value}`
}

const getColumnFilterSearchPlaceholder = (key) => `搜尋${columnFilterLabels[key] || '欄位'}`

const getVisibleColumnFilterOptions = (key) => {
  const keyword = normalizeSearchText(columnFilterSearchKeyword.value)
  const options = getColumnFilterOptions(key).filter((option) => option.value !== '')
  if (!keyword) return options

  return options.filter((option) =>
    [option.label, option.value]
      .map((item) => normalizeSearchText(item))
      .join(' ')
      .includes(keyword)
  )
}

const buildColumnFilterMenuStyle = (target, key) => {
  if (!target || typeof target.getBoundingClientRect !== 'function') return {}

  const anchor = target.closest?.('th') || target
  const rect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768
  const margin = 12
  const gap = 8
  const width = Math.min(Math.max(rect.width, 180), Math.max(180, viewportWidth - margin * 2))
  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, viewportWidth - width - margin)
  )
  const spaceBelow = viewportHeight - rect.bottom - gap - margin
  const spaceAbove = rect.top - gap - margin
  const openAbove = spaceBelow < 260 && spaceAbove > spaceBelow
  const maxHeight = Math.max(220, Math.min(460, openAbove ? spaceAbove : spaceBelow))

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

const toggleColumnFilter = async (key, event = null) => {
  if (activeColumnFilter.value === key) {
    closeColumnFilter()
    return
  }

  activeColumnFilter.value = key
  columnFilterSearchKeyword.value = ''
  columnFilterMenuStyle.value = buildColumnFilterMenuStyle(event?.currentTarget, key)
  await nextTick()
  columnFilterSearchInput.value?.focus?.()
}

const selectColumnFilterOption = (key, value) => {
  const nextValue = String(value ?? '')
  setColumnFilterValue(key, getColumnFilterValue(key) === nextValue ? '' : nextValue)
  columnFilterSearchKeyword.value = ''
  closeColumnFilter()
}

const updateColumnFilterSearchKeyword = (value) => {
  columnFilterSearchKeyword.value = String(value || '').trim()
  if (columnFilterSearchKeyword.value && activeColumnFilter.value) {
    setColumnFilterValue(activeColumnFilter.value, '')
  }
}

const handleColumnFilterPointerDown = (event) => {
  if (!activeColumnFilter.value) return
  const ownerNode = event.target?.closest?.('[data-filter-owner]')
  if (ownerNode?.dataset?.filterOwner === columnFilterInstanceId) return

  const menuNode = document.querySelector(
    `.column-filter-menu[data-filter-owner="${columnFilterInstanceId}"]`
  )
  const rect = menuNode?.getBoundingClientRect?.()
  if (
    rect &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  ) {
    return
  }

  closeColumnFilter()
}

const handleColumnFilterKeydown = (event) => {
  if (event.key === 'Escape') closeColumnFilter()
}

const handleColumnFilterViewportChange = () => {
  if (activeColumnFilter.value) closeColumnFilter()
}

// 篩選條件採 AND 關係；關鍵字與 haystack 皆走簡繁 normalize，避免簡繁資料互搜漏命中。
const filteredRows = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  const selectedStatus = normalizeCandidateApplicationStatus(statusFilter.value, '')
  const selectedJob = normalizeFilterText(jobFilter.value)
  const selectedOwner = normalizeFilterText(ownerFilter.value)
  const selectedSource = normalizeCvSource(sourceFilter.value)
  const selectedMatchedPosition = normalizeFilterText(matchedPositionFilter.value)

  return displayRows.value.filter((row) => {
    if (
      selectedStatus &&
      normalizeCandidateApplicationStatus(row.applicationStatus, '') !== selectedStatus
    ) {
      return false
    }

    if (selectedJob && normalizeFilterText(row.jobPostTitle) !== selectedJob) {
      return false
    }

    if (selectedOwner && String(row.ownerUser?.id || '') !== selectedOwner) {
      return false
    }

    if (selectedSource && normalizeCvSource(row.source) !== selectedSource) {
      return false
    }

    if (selectedMatchedPosition && normalizeFilterText(row.matchedPosition) !== selectedMatchedPosition) {
      return false
    }

    if (!keyword) return true

    const haystack = [
      props.showJobColumn ? row.jobPostTitle : '',
      row.fullName,
      row.source,
      getOwnerUserName(row),
      getCandidateApplicationStatusLabel(row.applicationStatus),
      getInterviewSummaryText(row),
      props.showTargetPositionColumn ? row.targetPosition : '',
      row.matchedPosition,
      props.showPhoneColumn ? row.phone : '',
      row.cvFileName,
      row.extractedFileName,
      row.remark,
      row.blacklistReason,
      row.blacklistMatchedBy,
      formatDateTime(row.createdAt),
    ]
      .map((item) => normalizeSearchText(item))
      .join(' ')
    return haystack.includes(keyword)
  })
})

const sortedRows = computed(() => {
  const rows = [...filteredRows.value]
  if (!matchedScoreSort.value) return rows

  const direction = matchedScoreSort.value === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const aScore = Number(a?.matchedScore || 0)
    const bScore = Number(b?.matchedScore || 0)
    if (aScore !== bScore) return (aScore - bScore) * direction
    return normalizeFilterText(a?.matchedPosition).localeCompare(normalizeFilterText(b?.matchedPosition))
  })
})

const effectivePageSize = computed(() => Math.max(1, Number(props.pageSize) || 30))

const totalPages = computed(() =>
  Math.max(1, Math.ceil(sortedRows.value.length / effectivePageSize.value))
)

const visibleRows = computed(() => {
  if (!props.paginated) return sortedRows.value

  const start = (currentPage.value - 1) * effectivePageSize.value
  return sortedRows.value.slice(start, start + effectivePageSize.value)
})

const paginationPages = computed(() => {
  const pageCount = totalPages.value
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const start = Math.max(1, Math.min(currentPage.value - 2, pageCount - 4))
  return Array.from({ length: 5 }, (_, index) => start + index)
})

const paginationStart = computed(() =>
  sortedRows.value.length ? (currentPage.value - 1) * effectivePageSize.value + 1 : 0
)

const paginationEnd = computed(() =>
  Math.min(currentPage.value * effectivePageSize.value, sortedRows.value.length)
)

const tableWrapStyle = computed(() =>
  props.paginated
    ? { '--application-table-max-height': props.tableMaxHeight }
    : undefined
)

const effectiveLoadStatus = computed(() => {
  if (props.loading) return 'loading'
  const status = String(props.loadStatus || '').trim().toLowerCase()
  return ['loading', 'error'].includes(status) ? status : ''
})

const showLoadStatus = computed(() => Boolean(effectiveLoadStatus.value))

const loadStatusMessage = computed(() => {
  if (props.loadMessage) return props.loadMessage
  if (effectiveLoadStatus.value === 'loading') return '資料加載中'
  if (effectiveLoadStatus.value === 'error') return '資料加載失敗'
  return ''
})

const loadStatusIcon = computed(() => {
  if (effectiveLoadStatus.value === 'error') return '!'
  return ''
})

const selectedCount = computed(() => props.selectedIds.length)

const selectedRowsForBulkActions = computed(() => {
  const selectedSet = new Set(props.selectedIds.map((id) => Number(id)))
  return displayRows.value.filter((row) => selectedSet.has(Number(row.applicationId)))
})

const bulkBlacklistActionMode = computed(() => {
  if (!selectedRowsForBulkActions.value.length) return 'add'
  return selectedRowsForBulkActions.value.some((row) => !row?.isBlacklisted) ? 'add' : 'remove'
})

const bulkBlacklistActionEvent = computed(() =>
  bulkBlacklistActionMode.value === 'remove' ? 'bulk-unblacklist-selected' : 'bulk-blacklist-selected'
)

const bulkBlacklistActionDisabled = computed(() => {
  if (!selectedCount.value) return true
  if (bulkBlacklistActionMode.value === 'remove') {
    return props.bulkUnblacklistDisabled || props.bulkUnblacklisting
  }
  return props.bulkBlacklistDisabled || props.bulkBlacklisting
})

const bulkBlacklistActionLabel = computed(() => {
  if (bulkBlacklistActionMode.value === 'remove') {
    return props.bulkUnblacklisting ? '取消中...' : '取消黑名單'
  }
  return props.bulkBlacklisting ? '加入中...' : '加入黑名單'
})

const tableColumnCount = computed(() => {
  let count = 9
  if (props.showJobColumn) count += 1
  if (props.showTargetPositionColumn) count += 1
  if (props.showPhoneColumn) count += 1
  if (props.showRowActions) count += 1
  return count
})

const goToPage = (page) => {
  currentPage.value = Math.max(1, Math.min(Number(page) || 1, totalPages.value))
}

watch([searchKeyword, statusFilter, jobFilter, ownerFilter, sourceFilter, matchedPositionFilter, matchedScoreSort], () => {
  currentPage.value = 1
})

watch(totalPages, (nextTotal) => {
  if (currentPage.value > nextTotal) {
    currentPage.value = nextTotal
  }
})

const closePreviewModal = () => {
  isPreviewOpen.value = false
  previewTitle.value = ''
  previewContent.value = ''
  previewType.value = 'cv'
  previewCvId.value = null
  previewApplicationId.value = null
  previewError.value = ''
  isPreviewLoading.value = false
  previewDownloadUrl.value = ''
  previewDownloadFileName.value = ''
  previewFileUrl.value = ''
}

const canPreviewCv = (row) => Boolean(row?.cvId && row?.cvFileName && row?.hasDownload)

const canPreviewExtracted = (row) =>
  Boolean(row?.cvId && row?.extractedFileName && row?.hasExtractedPreview)

// 原始 CV 走 iframe 檔案預覽；AI 分析預覽則拉文字內容，並兼容較早沒有來源欄位的提取結果。
const openPreview = async (row, type) => {
  if (!row?.cvId) return
  const normalizedType = type === 'extracted' ? 'extracted' : 'cv'

  if (normalizedType === 'cv' && !canPreviewCv(row)) {
    emit('notify', { type: 'error', message: '原始 CV 檔案不存在，無法預覽' })
    return
  }

  if (normalizedType === 'extracted' && !canPreviewExtracted(row)) {
    emit('notify', { type: 'error', message: 'AI分析檔案不存在，無法預覽' })
    return
  }

  isPreviewOpen.value = true
  isPreviewLoading.value = true
  previewError.value = ''
  previewContent.value = ''
  previewType.value = normalizedType
  previewCvId.value = Number(row.cvId)
  previewApplicationId.value = Number(row.applicationId || 0) || null
  previewDownloadUrl.value = normalizedType === 'cv'
    ? `${apiBaseUrl}/api/candidate-cvs/${row.cvId}/download`
    : ''
  previewDownloadFileName.value = normalizedType === 'cv' ? String(row.cvFileName || '') : ''
  previewFileUrl.value = normalizedType === 'cv'
    ? `${apiBaseUrl}/api/candidate-cvs/${row.cvId}/file-preview`
    : ''
  previewTitle.value = normalizedType === 'extracted'
    ? `AI分析檔案預覽 - ${row.extractedFileName || row.cvFileName}`
    : `CV 檔案預覽 - ${row.cvFileName}`

  if (previewFileUrl.value) {
    isPreviewLoading.value = false
    return
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/candidate-cvs/${row.cvId}/preview?type=${normalizedType}`)
    const data = await response.json()
    if (!response.ok) {
      previewError.value = data.message || '讀取預覽失敗'
      return
    }
    previewContent.value =
      normalizedType === 'extracted' ? attachPreviewSource(data.text || '', data.source || row.source) : data.text || ''
  } catch {
    previewError.value = '讀取預覽失敗'
  } finally {
    isPreviewLoading.value = false
  }
}

const handlePreviewUpdated = async () => {
  emit('rows-updated')
  emit('notify', { type: 'success', message: 'AI分析檔案已更新' })
}

const toggleRowSelection = (applicationId, checked) => {
  const id = Number(applicationId)
  if (!Number.isInteger(id) || id <= 0) return

  if (checked) {
    if (!props.selectedIds.includes(id)) {
      emit('selection-change', [...props.selectedIds, id])
    }
    return
  }

  emit(
    'selection-change',
    props.selectedIds.filter((value) => Number(value) !== id)
  )
}

const handleRowClick = (row, event) => {
  if (!props.selectable) return

  const target = event?.target
  if (
    target?.closest?.(
      'button, input, textarea, label, a, .app-select, .app-select-trigger, .app-select-menu, .blacklist-badge, .blacklist-tooltip, .status-history-popover'
    )
  ) {
    return
  }

  const applicationId = Number(row?.applicationId)
  if (!Number.isInteger(applicationId) || applicationId <= 0) return
  toggleRowSelection(applicationId, !props.selectedIds.includes(applicationId))
}

const saveApplicationRemark = async (row) => {
  const applicationId = Number(row?.applicationId)
  if (!applicationId) return

  const nextRemark = String(getRemarkDraft(row) || '').trim()
  const previousRemark = String(row?.remark || '').trim()
  if (nextRemark === previousRemark) return

  savingRemarkIds.value = [...savingRemarkIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remark: nextRemark }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '更新備註失敗')
    }

    remarkDrafts.value = {
      ...remarkDrafts.value,
      [applicationId]: String(data?.application?.remark || nextRemark),
    }
    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已更新 ${row?.fullName || '候選人'} 的備註`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    remarkDrafts.value = {
      ...remarkDrafts.value,
      [applicationId]: previousRemark,
    }
    emit('notify', {
      type: 'error',
      message: error?.message || '更新備註失敗',
    })
  } finally {
    savingRemarkIds.value = savingRemarkIds.value.filter((id) => id !== applicationId)
  }
}

// 狀態更新會寫入後端歷史紀錄，後端再同步主表狀態與對接人，所以前端成功後只刷新列表資料源。
const updateApplicationStatus = async (row, nextStatus) => {
  const applicationId = Number(row?.applicationId)
  const previousStatus = normalizeCandidateApplicationStatus(row?.applicationStatus)
  const normalizedStatus = normalizeCandidateApplicationStatus(nextStatus, '')

  if (!applicationId || !normalizedStatus || normalizedStatus === previousStatus) {
    statusOverrides.value = {
      ...statusOverrides.value,
      [applicationId]: previousStatus,
    }
    return
  }

  savingStatusIds.value = [...savingStatusIds.value, applicationId]
  try {
    const payload = { applicationStatus: normalizedStatus, firstInterviewArrangement: '' }
    if (!isInterviewApplicationStatus(normalizedStatus)) {
      payload.interview = {
        scheduledAt: '',
        durationMinutes: 30,
        interviewerUserId: '',
        location: '',
        status: 'not_started',
      }
    }
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '更新候選人狀態失敗')
    }

    statusOverrides.value = {
      ...statusOverrides.value,
      [applicationId]: normalizedStatus,
    }
    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已更新 ${row?.fullName || '候選人'} 的狀態為「${getCandidateApplicationStatusLabel(normalizedStatus)}」`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    statusOverrides.value = {
      ...statusOverrides.value,
      [applicationId]: previousStatus,
    }
    emit('notify', {
      type: 'error',
      message: error?.message || '更新候選人狀態失敗',
    })
  } finally {
    savingStatusIds.value = savingStatusIds.value.filter((id) => id !== applicationId)
  }
}

const quickAddToBlacklist = async (row) => {
  const applicationId = Number(row?.applicationId)
  if (!applicationId || row?.isBlacklisted || isBlacklistSaving(applicationId)) return

  const phone = String(row?.phone || '').trim()
  const email = String(row?.email || '').trim()
  if (!phone && !email) {
    emit('notify', {
      type: 'error',
      message: `${row?.fullName || '此候選人'} 沒有電話或 Email，無法加入 Blacklist`,
    })
    return
  }

  const reason = window.prompt('請輸入加入 Blacklist 的原因', '由候選人管理頁快速加入')
  if (reason === null) return

  const normalizedReason = String(reason || '').trim()
  if (!normalizedReason) {
    emit('notify', {
      type: 'error',
      message: '請先輸入 Blacklist 原因',
    })
    return
  }

  addingBlacklistIds.value = [...addingBlacklistIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/candidate-blacklist`, {
      method: 'POST',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        displayName: String(row?.fullName || '').trim(),
        phone,
        email,
        reason: normalizedReason,
        status: 'active',
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '加入 Blacklist 失敗')
    }

    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已將 ${row?.fullName || '此候選人'} 加入 Blacklist`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    emit('notify', {
      type: 'error',
      message: error?.message || '加入 Blacklist 失敗',
    })
  } finally {
    addingBlacklistIds.value = addingBlacklistIds.value.filter((id) => id !== applicationId)
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleColumnFilterPointerDown)
  document.addEventListener('keydown', handleColumnFilterKeydown)
  window.addEventListener('resize', handleColumnFilterViewportChange)
})

onBeforeUnmount(() => {
  clearStatusPopoverTimer()
  closeStatusPopover()
  closeColumnFilter()
  document.removeEventListener('pointerdown', handleColumnFilterPointerDown)
  document.removeEventListener('keydown', handleColumnFilterKeydown)
  window.removeEventListener('resize', handleColumnFilterViewportChange)
})
</script>

<template>
  <section class="card applications-card">
    <div class="card-header">
      <div class="table-title-block">
        <h3>{{ title }}</h3>
        <p v-if="subtitle" class="subtle">{{ subtitle }}</p>
      </div>
      <div class="table-search-wrap">
        <input
          v-model.trim="searchKeyword"
          type="text"
          class="search-input"
          :placeholder="searchPlaceholder"
        />
      </div>
      <div v-if="selectable" class="table-actions">
        <span class="selected-count-chip">已選 {{ selectedCount }}</span>
        <button
          v-if="showBulkBlacklistActions"
          type="button"
          :class="bulkBlacklistActionMode === 'remove' ? 'secondary-btn' : 'danger-btn'"
          :disabled="bulkBlacklistActionDisabled"
          @click="emit(bulkBlacklistActionEvent)"
        >
          {{ bulkBlacklistActionLabel }}
        </button>
        <button
          v-if="showBulkUploadAction"
          type="button"
          class="primary-btn"
          :disabled="bulkUploadDisabled || bulkUploading"
          @click="emit('upload-selected-cv')"
        >
          {{ bulkUploading ? '開啟中...' : '上傳 CV' }}
        </button>
        <button
          type="button"
          class="danger-btn"
          :disabled="!selectedCount || deleting"
          @click="emit('delete-selected')"
        >
          {{ deleting ? '刪除中...' : `刪除已選擇（${selectedCount}）` }}
        </button>
      </div>
    </div>

    <Transition name="load-status-fade">
      <div
        v-if="showLoadStatus"
        class="load-status-strip"
        :class="`load-status-${effectiveLoadStatus}`"
        :aria-busy="effectiveLoadStatus === 'loading'"
        aria-live="polite"
      >
        <span v-if="effectiveLoadStatus === 'loading'" class="load-spinner" aria-hidden="true"></span>
        <span v-else class="load-status-icon" aria-hidden="true">{{ loadStatusIcon }}</span>
        <span>{{ loadStatusMessage }}</span>
      </div>
    </Transition>
    <div
      v-if="!loading"
      class="table-wrap"
      :class="{ 'table-wrap-paginated': paginated }"
      :style="tableWrapStyle"
    >
      <table class="application-table">
        <thead>
          <tr>
            <th v-if="showJobColumn" class="job-col">
              <div class="column-header">
                <span class="column-title">職位</span>
                <CandidateColumnFilter
                  v-if="showJobFilter"
                  v-model="jobFilter"
                  filter-key="job"
                  :label="columnFilterLabels.job"
                  :options="jobFilterOptions"
                />
              </div>
            </th>
            <th class="name-col">候選人名稱</th>
            <th class="status-col">
              <div class="column-header">
                <span class="column-title">候選人狀態</span>
                <CandidateColumnFilter
                  v-if="showStatusFilter"
                  v-model="statusFilter"
                  filter-key="status"
                  :label="columnFilterLabels.status"
                  :options="statusFilterOptions"
                />
              </div>
            </th>
            <th class="remark-col">備註</th>
            <th v-if="showTargetPositionColumn" class="position-col">期望職位</th>
            <th class="position-col">
              <div class="column-header match-column-header">
                <span class="column-title">匹配職位</span>
                <CandidateColumnFilter
                  v-model="matchedPositionFilter"
                  filter-key="matched-position"
                  :label="columnFilterLabels.matchedPosition"
                  :options="matchedPositionFilterOptions"
                />
                <span class="match-sort-controls" aria-label="匹配分數排序">
                  <button
                    type="button"
                    class="match-sort-btn"
                    :class="{ active: matchedScoreSort === 'asc' }"
                    title="匹配分數升序"
                    @click="toggleMatchedScoreSort('asc')"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="match-sort-btn"
                    :class="{ active: matchedScoreSort === 'desc' }"
                    title="匹配分數降序"
                    @click="toggleMatchedScoreSort('desc')"
                  >
                    ↓
                  </button>
                </span>
              </div>
            </th>
            <th v-if="showPhoneColumn" class="phone-col">電話</th>
            <th class="source-col">
              <div class="column-header">
                <span class="column-title">CV 來源</span>
                <CandidateColumnFilter
                  v-if="showSourceFilter"
                  v-model="sourceFilter"
                  filter-key="source"
                  :label="columnFilterLabels.source"
                  :options="sourceFilterOptions"
                />
              </div>
            </th>
            <th class="owner-col">
              <div class="column-header">
                <span class="column-title">對接人</span>
                <CandidateColumnFilter
                  v-if="showOwnerFilter"
                  v-model="ownerFilter"
                  filter-key="owner"
                  :label="columnFilterLabels.owner"
                  :options="ownerFilterOptions"
                />
              </div>
            </th>
            <th class="file-col">CV檔案</th>
            <th class="file-col">AI分析檔案</th>
            <th class="time-col">投遞時間</th>
            <th v-if="showRowActions" class="actions-col">修改</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!visibleRows.length">
            <td :colspan="tableColumnCount" class="empty-cell">{{ emptyText }}</td>
          </tr>
          <tr
            v-for="row in visibleRows"
            :key="getRowKey(row)"
            :class="{
              'blacklist-row': row.isBlacklisted,
              'duplicate-row': !row.isBlacklisted && row.isDuplicateApplication,
              'selected-row': selectable && selectedIds.includes(Number(row.applicationId)),
              'selectable-row': selectable,
            }"
            @click="handleRowClick(row, $event)"
          >
            <td v-if="showJobColumn" class="job-col">{{ row.jobPostTitle || '--' }}</td>
            <td class="name-col">
              <div class="candidate-name-cell">
                <span>{{ row.fullName || '--' }}</span>
                <span
                  v-if="row.isBlacklisted"
                  class="blacklist-badge"
                  tabindex="0"
                  :aria-label="`Blacklist，原因：${row.blacklistReason || '--'}，命中：${getBlacklistMatchedByLabel(row.blacklistMatchedBy)}`"
                  @click.stop
                >
                  Blacklist
                  <span class="blacklist-tooltip" role="tooltip">
                    <span><strong>原因：</strong>{{ row.blacklistReason || '--' }}</span>
                    <span><strong>命中：</strong>{{ getBlacklistMatchedByLabel(row.blacklistMatchedBy) }}</span>
                  </span>
                </span>
                <button
                  v-else-if="showBlacklistAction"
                  type="button"
                  class="blacklist-action-btn"
                  :disabled="isBlacklistSaving(row.applicationId)"
                  @click="quickAddToBlacklist(row)"
                >
                  {{ isBlacklistSaving(row.applicationId) ? '加入中...' : '加入 Blacklist' }}
                </button>
                <span v-if="!row.isBlacklisted && row.isDuplicateApplication" class="duplicate-badge">
                  重複投遞
                </span>
                <button
                  v-if="showProjectTransferAction && normalizeCandidateApplicationStatus(row.applicationStatus) === 'onboarded'"
                  type="button"
                  class="project-action-btn"
                  @click="emit('add-to-project', row)"
                >
                  加入項目
                </button>
              </div>
            </td>
            <td class="status-col">
              <div
                class="status-cell-wrap"
                :class="{ actionable: statusActionable, 'popover-active': isStatusPopoverActive(row) }"
                @mouseenter="openStatusPopover(row, $event)"
                @mouseleave="scheduleStatusPopoverClose"
                @focusin="openStatusPopover(row, $event)"
                @focusout="scheduleStatusPopoverClose"
              >
                <div
                  v-if="editableStatus"
                  class="status-select-wrap"
                  :class="[getStatusToneClass(row.applicationStatus), { saving: isStatusSaving(row.applicationId) }]"
                >
                  <span class="status-dot" aria-hidden="true"></span>
                  <AppSelect
                    class="status-select"
                    :model-value="row.applicationStatus"
                    :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                    placeholder="請選擇狀態"
                    :disabled="isStatusSaving(row.applicationId)"
                    @update:model-value="updateApplicationStatus(row, $event)"
                  />
                </div>
                <button
                  v-else-if="statusActionable"
                  type="button"
                  class="status-chip status-action-chip"
                  :class="getStatusToneClass(row.applicationStatus)"
                  @click.stop="openStatusEditor(row)"
                >
                  {{ getCandidateApplicationStatusLabel(row.applicationStatus) }}
                </button>
                <span v-else class="status-chip" :class="getStatusToneClass(row.applicationStatus)">
                  {{ getCandidateApplicationStatusLabel(row.applicationStatus) }}
                </span>

              </div>
            </td>
            <td class="remark-col">
              <textarea
                v-if="editableStatus"
                class="remark-input"
                :value="getRemarkDraft(row)"
                :title="getRemarkTooltip(row)"
                :disabled="isRemarkSaving(row.applicationId)"
                rows="2"
                placeholder="輸入原因或跟進記錄"
                @input="remarkDrafts = { ...remarkDrafts, [Number(row.applicationId)]: $event.target.value }"
                @blur="saveApplicationRemark(row)"
              ></textarea>
              <div v-else class="remark-text" :title="String(row.remark || '').trim() || undefined">
                {{ row.remark || '--' }}
              </div>
            </td>
            <td v-if="showTargetPositionColumn" class="position-col">{{ row.targetPosition || '--' }}</td>
            <td class="position-col">
              <template v-if="row.matchedPosition">
                <span>{{ row.matchedPosition }}</span>
                <span class="match-score" :class="getMatchScoreTone(row.matchedScore)">
                  {{ row.matchedScore || 0 }}
                </span>
              </template>
              <span v-else>--</span>
            </td>
            <td v-if="showPhoneColumn" class="phone-col">{{ row.phone || '--' }}</td>
            <td class="source-col">{{ row.source || '--' }}</td>
            <td class="owner-col">
              <span v-if="getOwnerUser(row)" class="owner-user-pill">
                <span class="owner-avatar" :style="getOwnerUserAvatarStyle(row)">
                  {{ getOwnerUserAvatarText(row) }}
                </span>
                <span>{{ getOwnerUserName(row) }}</span>
              </span>
              <span v-else>--</span>
            </td>
            <td class="file-column file-col">
              <button
                v-if="canPreviewCv(row)"
                type="button"
                class="file-icon-btn"
                :title="`預覽 CV 檔案：${row.cvFileName}`"
                :aria-label="`預覽 CV 檔案：${row.cvFileName}`"
                @click="openPreview(row, 'cv')"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 3.5h6.2L19 8.3v10.2a2 2 0 0 1-2 2H8a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Z" />
                  <path d="M14 3.8V8h4.2" />
                  <path d="M8.5 12h7M8.5 15.2h7M8.5 18.4H13" />
                </svg>
                <span class="sr-only">預覽 CV 檔案</span>
              </button>
              <span v-else class="file-link-text">--</span>
            </td>
            <td class="file-column file-col">
              <button
                v-if="canPreviewExtracted(row)"
                type="button"
                class="file-icon-btn"
                :title="`預覽 AI 分析檔案：${row.extractedFileName}`"
                :aria-label="`預覽 AI 分析檔案：${row.extractedFileName}`"
                @click="openPreview(row, 'extracted')"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M7.5 3.5h9A2.5 2.5 0 0 1 19 6v12a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18V6a2.5 2.5 0 0 1 2.5-2.5Z" />
                  <path d="M8.5 16.5v-3M12 16.5V10M15.5 16.5v-5" />
                  <path d="M8.5 7.5h7" />
                </svg>
                <span class="sr-only">預覽 AI 分析檔案</span>
              </button>
              <span v-else class="file-link-text">--</span>
            </td>
            <td class="time-col">{{ formatDateTime(row.createdAt) }}</td>
            <td v-if="showRowActions" class="actions-col">
              <div class="row-actions">
                <button type="button" class="row-action-btn" @click="emit('view-details', row)">詳情</button>
                <button type="button" class="row-action-btn" @click="emit('edit-details', row)">修改</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="paginated" class="table-pagination" aria-label="候選人清單分頁">
      <p class="pagination-summary">
        <template v-if="sortedRows.length">
          顯示 {{ paginationStart }}-{{ paginationEnd }} / 共 {{ sortedRows.length }} 筆，每頁 {{ effectivePageSize }} 筆
        </template>
        <template v-else>共 0 筆</template>
      </p>
      <div class="pagination-controls">
        <button
          type="button"
          class="pagination-btn"
          :disabled="currentPage <= 1"
          @click="goToPage(currentPage - 1)"
        >
          上一頁
        </button>
        <button
          v-for="page in paginationPages"
          :key="page"
          type="button"
          class="pagination-page-btn"
          :class="{ active: page === currentPage }"
          :aria-current="page === currentPage ? 'page' : undefined"
          @click="goToPage(page)"
        >
          {{ page }}
        </button>
        <button
          type="button"
          class="pagination-btn"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
        >
          下一頁
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="activeColumnFilter"
        class="column-filter-menu is-floating"
        :style="columnFilterMenuStyle"
        :data-filter-owner="columnFilterInstanceId"
        role="listbox"
        :aria-label="getColumnFilterButtonLabel(activeColumnFilter)"
      >
        <label class="column-filter-search">
          <span class="sr-only">{{ getColumnFilterSearchPlaceholder(activeColumnFilter) }}</span>
          <input
            ref="columnFilterSearchInput"
            :value="columnFilterSearchKeyword"
            type="search"
            :placeholder="getColumnFilterSearchPlaceholder(activeColumnFilter)"
            autocomplete="off"
            @input="updateColumnFilterSearchKeyword($event.target.value)"
          />
        </label>

        <div class="column-filter-options">
          <button
            v-for="option in getVisibleColumnFilterOptions(activeColumnFilter)"
            :key="`${activeColumnFilter}-${option.value}`"
            type="button"
            class="column-filter-option"
            :class="{ selected: option.value === getColumnFilterValue(activeColumnFilter) }"
            role="option"
            :aria-selected="option.value === getColumnFilterValue(activeColumnFilter) ? 'true' : 'false'"
            @click="selectColumnFilterOption(activeColumnFilter, option.value)"
          >
            <span
              v-if="option.avatarText"
              class="column-filter-avatar"
              :style="getColumnFilterOptionAvatarStyle(option)"
              aria-hidden="true"
            >
              {{ option.avatarText }}
            </span>
            <span class="column-filter-option-label">{{ option.label }}</span>
            <span
              v-if="option.value === getColumnFilterValue(activeColumnFilter)"
              class="column-filter-check"
              aria-hidden="true"
            >
              ✓
            </span>
          </button>
        </div>
        <div
          v-if="!getVisibleColumnFilterOptions(activeColumnFilter).length"
          class="column-filter-empty"
        >
          沒有符合的選項
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="statusActionable && activeStatusPopoverRow"
        class="status-history-popover is-floating"
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
              <em v-if="shouldShowStatusHistoryInterview(history)">
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

    <CandidateTextPreviewModal
      :open="isPreviewOpen"
      :title="previewTitle"
      :content="previewContent"
      :preview-type="previewType"
      :candidate-cv-id="previewCvId"
      :application-id="previewApplicationId"
      :loading="isPreviewLoading"
      :error="previewError"
      :download-url="previewDownloadUrl"
      :download-file-name="previewDownloadFileName"
      :file-preview-url="previewFileUrl"
      @close="closePreviewModal"
      @updated="handlePreviewUpdated"
    />
  </section>
</template>

<style scoped>
.applications-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.card-header > * {
  min-width: 0;
}

.table-title-block {
  flex: 0 0 auto;
  max-width: min(280px, 100%);
}

.table-title-block h3 {
  margin: 0;
  white-space: nowrap;
}

.table-title-block .subtle {
  margin-top: 0.25rem;
}

.table-search-wrap {
  flex: 0 1 340px;
  width: min(340px, 100%);
  min-width: min(260px, 100%);
}

.table-search-wrap .search-input {
  width: 100%;
}

.table-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-left: auto;
  min-width: 0;
}

.selected-count-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0.3rem 0.72rem;
  border-radius: 999px;
  color: var(--text-base);
  background: var(--surface-soft);
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
}

.load-status-strip {
  --load-status-color: var(--accent-hover);
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  min-height: 46px;
  margin: 0.1rem 0 0.75rem;
  padding: 0.72rem 0.9rem;
  border: 1px solid rgba(47, 111, 237, 0.14);
  border-radius: 12px;
  color: var(--accent-hover);
  background: rgba(47, 111, 237, 0.08);
  font-size: 0.9rem;
  font-weight: 800;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
}

.load-status-error {
  --load-status-color: var(--danger);
  color: var(--danger);
  border-color: rgba(197, 82, 82, 0.18);
  background: var(--danger-soft);
}

.load-spinner,
.load-status-icon {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}

.load-spinner {
  border: 2px solid rgba(47, 111, 237, 0.2);
  border-top-color: currentColor;
  border-radius: 999px;
  animation: load-spin 760ms linear infinite;
}

.load-status-icon {
  border-radius: 999px;
  color: #ffffff;
  background: var(--load-status-color);
  font-size: 0.78rem;
  line-height: 1;
  animation: load-pop 280ms ease both;
}

.load-status-error .load-status-icon {
  font-weight: 900;
}

.load-status-fade-enter-active,
.load-status-fade-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.load-status-fade-enter-from,
.load-status-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes load-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes load-pop {
  0% {
    transform: scale(0.72);
  }
  70% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}

@media (max-width: 720px) {
  .card-header {
    align-items: stretch;
  }

  .table-title-block,
  .table-search-wrap,
  .table-actions {
    flex: 1 1 100%;
    max-width: 100%;
    width: 100%;
  }

  .table-actions {
    margin-left: 0;
    justify-content: flex-start;
  }
}

.table-wrap {
  flex: 1 1 auto;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.table-wrap-paginated {
  max-height: min(var(--application-table-max-height), 100%);
}

.application-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}

.application-table th,
.application-table td {
  white-space: nowrap;
  overflow-wrap: normal;
  word-break: normal;
  vertical-align: middle;
}

.application-table th,
.application-table td {
  min-width: 120px;
}

.application-table thead th {
  position: sticky;
  top: 0;
  z-index: 60;
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.38rem;
  min-width: 0;
}

.column-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.match-column-header {
  gap: 0.3rem;
}

.match-sort-controls {
  display: inline-flex;
  gap: 0.2rem;
}

.match-sort-btn {
  display: inline-grid;
  place-items: center;
  width: 1.65rem;
  height: 1.65rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.78);
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
}

.match-sort-btn:hover,
.match-sort-btn.active {
  border-color: rgba(47, 111, 237, 0.26);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.1);
}

.column-filter {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.column-filter-btn {
  display: inline-grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.column-filter-btn:hover,
.column-filter-btn.open,
.column-filter-btn.active {
  border-color: rgba(47, 111, 237, 0.26);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.1);
}

.column-filter-btn:hover {
  transform: translateY(-1px);
}

.column-filter-btn:focus-visible {
  outline: none;
  border-color: rgba(47, 111, 237, 0.42);
  box-shadow: var(--focus-ring);
}

.column-filter-btn svg {
  width: 1rem;
  height: 1rem;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.column-filter-menu {
  position: fixed;
  z-index: 20050;
  display: grid;
  gap: 0.4rem;
  padding: 0.55rem;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 24px 54px rgba(15, 23, 42, 0.14),
    0 8px 20px rgba(47, 111, 237, 0.08);
  backdrop-filter: blur(18px);
}

.column-filter-search {
  display: block;
}

.column-filter-search input {
  width: 100%;
  min-height: 38px;
  padding: 0.52rem 0.68rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 9px;
  background: rgba(248, 250, 252, 0.96);
  color: var(--text-strong);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 700;
}

.column-filter-search input:focus {
  outline: none;
  border-color: rgba(47, 111, 237, 0.38);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.column-filter-options {
  display: grid;
  gap: 0.28rem;
}

.column-filter-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 38px;
  padding: 0.52rem 0.62rem;
  border: 1px solid transparent;
  border-radius: 9px;
  color: var(--text-base);
  background: transparent;
  text-align: left;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}

.column-filter-option:hover,
.column-filter-option:focus-visible {
  outline: none;
  border-color: rgba(47, 111, 237, 0.14);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.08);
}

.column-filter-option.selected {
  border-color: rgba(47, 111, 237, 0.18);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.12);
}

.column-filter-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.55rem;
  height: 1.55rem;
  flex: 0 0 auto;
  border-radius: 999px;
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

.column-filter-option-label {
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  margin-right: auto;
}

.column-filter-check {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 900;
}

.column-filter-empty {
  padding: 0.75rem 0.62rem;
  color: var(--text-muted);
  text-align: center;
  font-size: 0.84rem;
  font-weight: 700;
}

.job-col,
.name-col {
  min-width: 180px;
}

.candidate-name-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.blacklist-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0.14rem 0.52rem;
  border-radius: 999px;
  color: #b42318;
  background: rgba(217, 45, 32, 0.12);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  cursor: help;
  outline: none;
}

.duplicate-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0.14rem 0.52rem;
  border-radius: 999px;
  color: #a15c00;
  background: rgba(226, 156, 32, 0.16);
  font-size: 0.74rem;
  font-weight: 800;
}

.blacklist-badge:focus-visible {
  box-shadow: 0 0 0 3px rgba(217, 45, 32, 0.16);
}

.blacklist-tooltip {
  position: absolute;
  left: 0;
  top: calc(100% + 0.45rem);
  z-index: 35;
  display: grid;
  gap: 0.28rem;
  width: max-content;
  min-width: 180px;
  max-width: 280px;
  padding: 0.62rem 0.72rem;
  border: 1px solid rgba(217, 45, 32, 0.16);
  border-radius: 10px;
  color: var(--text-base);
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.12),
    0 6px 16px rgba(217, 45, 32, 0.08);
  font-size: 0.76rem;
  font-weight: 650;
  line-height: 1.45;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-4px);
  transition:
    opacity 160ms ease,
    transform 160ms ease,
    visibility 160ms ease;
}

.blacklist-tooltip strong {
  color: #b42318;
}

.blacklist-badge:hover .blacklist-tooltip,
.blacklist-badge:focus-visible .blacklist-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.blacklist-action-btn,
.project-action-btn {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0.22rem 0.62rem;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, opacity 180ms ease;
}

.blacklist-action-btn {
  border: 1px solid rgba(217, 45, 32, 0.24);
  color: #b42318;
  background: rgba(217, 45, 32, 0.08);
}

.project-action-btn {
  border: 1px solid rgba(47, 111, 237, 0.22);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.08);
}

.blacklist-action-btn:hover {
  background: rgba(217, 45, 32, 0.12);
  border-color: rgba(217, 45, 32, 0.32);
}

.project-action-btn:hover {
  background: rgba(47, 111, 237, 0.12);
  border-color: rgba(47, 111, 237, 0.3);
}

.blacklist-action-btn:disabled,
.project-action-btn:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

/* 行背景優先級由模板控制：黑名單優先於重複投遞，因此 duplicate-row 只會套在非黑名單列。 */
.blacklist-row td {
  background: rgba(217, 45, 32, 0.05);
}

.duplicate-row td {
  background: rgba(226, 156, 32, 0.08);
}

.selectable-row {
  cursor: pointer;
}

.selected-row td {
  background: rgba(47, 111, 237, 0.1);
}

.selected-row:hover td {
  background: rgba(47, 111, 237, 0.14);
}

.blacklist-row.selected-row td {
  background: linear-gradient(0deg, rgba(47, 111, 237, 0.08), rgba(47, 111, 237, 0.08)), rgba(217, 45, 32, 0.06);
}

.blacklist-row:hover td {
  background: rgba(217, 45, 32, 0.08);
}

.duplicate-row.selected-row td {
  background: linear-gradient(0deg, rgba(47, 111, 237, 0.08), rgba(47, 111, 237, 0.08)), rgba(226, 156, 32, 0.1);
}

.duplicate-row:hover td {
  background: rgba(226, 156, 32, 0.12);
}

.status-col {
  min-width: 220px;
}

td.status-col {
  position: relative;
}

th.status-col {
  position: sticky;
  top: 0;
  z-index: 70;
}

.position-col {
  min-width: 160px;
}

.phone-col {
  min-width: 140px;
}

.source-col {
  min-width: 132px;
}

.owner-col {
  min-width: 150px;
}

.owner-user-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
}

.owner-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 999px;
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

.file-col {
  min-width: 82px;
  text-align: center;
}

.remark-col {
  min-width: 240px;
}

.time-col {
  min-width: 168px;
}

.actions-col {
  min-width: 132px;
  text-align: center;
}

.file-column {
  min-width: 0;
  max-width: 92px;
}

.file-link-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 10px;
  background: rgba(47, 111, 237, 0.08);
  color: var(--accent);
  cursor: pointer;
}

.file-icon-btn:hover {
  border-color: rgba(47, 111, 237, 0.3);
  background: rgba(47, 111, 237, 0.14);
}

.file-icon-btn svg {
  width: 1.2rem;
  height: 1.2rem;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.remark-input {
  width: 100%;
  min-height: 3.6rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-base);
  font: inherit;
  line-height: 1.45;
  white-space: normal;
  resize: vertical;
}

.remark-input:focus {
  outline: none;
  border-color: rgba(47, 111, 237, 0.28);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.remark-text {
  display: block;
  min-width: 220px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.45;
  color: var(--text-base);
}

.row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
}

.row-action-btn {
  color: var(--text-strong);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: color 180ms ease, transform 180ms ease;
}

.row-action-btn:hover {
  color: var(--accent);
  transform: translateY(-1px);
}

.match-score {
  display: inline-flex;
  align-items: center;
  margin-left: 0.5rem;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.2;
}

.score-high {
  color: #117a52;
  background: rgba(17, 122, 82, 0.12);
}

.score-medium {
  color: #2f6fed;
  background: rgba(47, 111, 237, 0.12);
}

.score-low {
  color: #b26a00;
  background: rgba(226, 156, 32, 0.16);
}

.score-empty {
  color: var(--text-soft);
  background: rgba(148, 163, 184, 0.14);
}

.status-select-wrap {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: stretch;
  min-width: 196px;
  max-width: 252px;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.04);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.status-select-wrap:hover {
  transform: translateY(-1px);
}

.status-select-wrap:focus-within {
  z-index: 20;
  border-color: rgba(47, 111, 237, 0.28);
  box-shadow:
    0 0 0 3px rgba(47, 111, 237, 0.12),
    inset 0 0 0 1px rgba(47, 111, 237, 0.12);
}

.status-select {
  width: 100%;
  min-width: 0;
}

.status-select-wrap :deep(.app-select.open) {
  z-index: 30;
}

.status-dot {
  position: absolute;
  left: 0.72rem;
  top: 50%;
  width: 0.48rem;
  height: 0.48rem;
  border-radius: 999px;
  background: currentColor;
  transform: translateY(-50%);
  pointer-events: none;
}

.status-select-wrap.saving {
  opacity: 0.68;
}

.status-select-wrap :deep(.app-select-trigger) {
  min-height: 36px;
  padding: 0.4rem 2rem 0.4rem 1.7rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  color: inherit;
}

.status-select-wrap :deep(.app-select-trigger:hover) {
  transform: none;
  box-shadow: none;
}

.status-select-wrap :deep(.app-select-trigger:focus-visible) {
  border: none;
  box-shadow: none;
}

.status-select-wrap :deep(.app-select-copy) {
  display: block;
}

.status-select-wrap :deep(.app-select-value) {
  color: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.2;
}

.status-select-wrap :deep(.app-select-icon) {
  width: 0.45rem;
  height: 0.45rem;
  border-right-width: 2px;
  border-bottom-width: 2px;
  border-color: currentColor;
  opacity: 0.72;
}

.status-select-wrap :deep(.app-select-menu) {
  left: 0;
  right: auto;
  z-index: 40;
  width: max-content;
  min-width: 100%;
  max-width: 320px;
}

.status-select-wrap :deep(.app-select-option-label) {
  font-size: 0.82rem;
}

.status-select-wrap :deep(.app-select-check) {
  color: currentColor;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  padding: 0.32rem 0.72rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
}

.status-action-chip {
  cursor: pointer;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.status-action-chip:hover {
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.12);
  transform: translateY(-1px);
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

.status-cell-wrap.actionable {
  z-index: 2;
}

.status-cell-wrap.actionable.popover-active {
  z-index: 20;
}

.status-cell-wrap.actionable::after {
  content: '';
  position: absolute;
  left: 0;
  top: 100%;
  display: none;
  width: min(520px, calc(100vw - 2rem));
  height: 0.65rem;
}

.status-cell-wrap.actionable.popover-active::after {
  display: block;
}

.status-history-popover {
  position: absolute;
  left: 0;
  top: calc(100% + 0.55rem);
  z-index: 25;
  display: none;
  width: min(520px, calc(100vw - 2rem));
  max-height: 260px;
  overflow: auto;
  padding: 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 24px 54px rgba(15, 23, 42, 0.14),
    0 8px 20px rgba(47, 111, 237, 0.08);
  pointer-events: auto;
  white-space: normal;
}

.status-history-popover.is-floating {
  position: fixed;
  top: auto;
  bottom: auto;
  z-index: 20000;
  display: block;
}

.status-cell-wrap.actionable.popover-active .status-history-popover {
  display: block;
}

.status-history-title {
  margin: 0 0 0.6rem;
  color: var(--text-strong);
  font-size: 0.86rem;
  font-weight: 800;
}

.status-history-list {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.status-history-list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.5rem;
  min-width: 0;
  color: var(--text-base);
  font-size: 0.82rem;
  font-weight: 650;
}

.status-history-list li.current {
  color: var(--accent);
}

.history-dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.32rem;
  border: 2px solid currentColor;
  border-radius: 999px;
  opacity: 0.52;
}

.status-history-list li.current .history-dot {
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
  font-size: 0.83rem;
  line-height: 1.35;
}

.status-history-list li.current .history-main strong {
  color: var(--accent);
}

.history-main small,
.history-main em,
.history-operator,
.history-remark {
  color: var(--text-soft);
  font-size: 0.76rem;
  font-style: normal;
  font-weight: 400;
  line-height: 1.35;
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
  font-weight: 400;
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
  line-height: 1;
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

.table-pagination {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  min-height: 48px;
  padding: 0.45rem 0 0;
}

.pagination-summary {
  color: var(--text-muted);
  font-size: 0.86rem;
  font-weight: 600;
}

.pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.pagination-btn,
.pagination-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  min-height: 36px;
  padding: 0.45rem 0.72rem;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  color: var(--text-base);
  background: rgba(255, 255, 255, 0.82);
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease;
}

.pagination-btn:hover,
.pagination-page-btn:hover {
  border-color: rgba(47, 111, 237, 0.24);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.08);
  transform: translateY(-1px);
}

.pagination-page-btn.active {
  border-color: rgba(47, 111, 237, 0.28);
  color: #ffffff;
  background: var(--accent);
}

.pagination-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
  transform: none;
}

@media (max-width: 720px) {
  .card-header,
  .table-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .table-search-wrap {
    width: 100%;
    min-width: 0;
  }

  .table-pagination {
    align-items: stretch;
  }

  .pagination-controls {
    justify-content: flex-start;
  }
}
</style>
