<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import AppSelect from '../AppSelect.vue'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  FIRST_INTERVIEW_ARRANGEMENT_OPTIONS,
  getCandidateApplicationStatusLabel,
  getFirstInterviewArrangementLabel,
  normalizeCandidateApplicationStatus,
  normalizeFirstInterviewArrangement,
} from '../../scripts/candidateApplicationStatus.js'
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
    default: '搜尋候選人 / 狀態 / 面試安排 / 期望職位 / 匹配職位 / 電話 / 備註 / 檔案',
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
const currentPage = ref(1)
const statusOverrides = ref({})
const savingStatusIds = ref([])
const firstInterviewOverrides = ref({})
const savingFirstInterviewIds = ref([])
const remarkDrafts = ref({})
const savingRemarkIds = ref([])
const addingBlacklistIds = ref([])
const activeStatusPopoverKey = ref('')
let statusPopoverCloseTimer = null

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

const normalizeSearchText = (value) => String(value ?? '').trim().toLowerCase()
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

const getRowStatusHistory = (row) => {
  const history = Array.isArray(row?.statusHistory) ? row.statusHistory : []
  if (history.length) return history

  return [
    {
      id: 0,
      applicationStatus: row?.applicationStatus,
      firstInterviewArrangement: row?.firstInterviewArrangement,
      remark: row?.remark,
      createdAt: row?.createdAt,
      updatedAt: row?.createdAt,
    },
  ]
}

const getStatusHistoryKey = (history, index) =>
  history?.id || `${history?.applicationStatus || 'status'}-${history?.createdAt || index}`

const getStatusPopoverKey = (row) => `status-${Number(row?.applicationId || 0)}`

const clearStatusPopoverTimer = () => {
  if (statusPopoverCloseTimer) {
    window.clearTimeout(statusPopoverCloseTimer)
    statusPopoverCloseTimer = null
  }
}

const openStatusPopover = (row) => {
  if (!props.statusActionable) return
  clearStatusPopoverTimer()
  activeStatusPopoverKey.value = getStatusPopoverKey(row)
}

const scheduleStatusPopoverClose = () => {
  clearStatusPopoverTimer()
  statusPopoverCloseTimer = window.setTimeout(() => {
    activeStatusPopoverKey.value = ''
    statusPopoverCloseTimer = null
  }, 420)
}

const isStatusPopoverActive = (row) => activeStatusPopoverKey.value === getStatusPopoverKey(row)

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

const withAuthHeaders = (headers = {}) => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  return token ? { ...headers, Authorization: `Bearer ${token}` } : { ...headers }
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

const isRemarkSaving = (applicationId) => savingRemarkIds.value.includes(Number(applicationId))

const getRemarkDraft = (row) => {
  const applicationId = Number(row?.applicationId)
  return Object.prototype.hasOwnProperty.call(remarkDrafts.value, applicationId)
    ? remarkDrafts.value[applicationId]
    : String(row?.remark || '')
}

const getRemarkTooltip = (row) => String(getRemarkDraft(row) || '').trim() || undefined

const isStatusSaving = (applicationId) => savingStatusIds.value.includes(Number(applicationId))
const isFirstInterviewSaving = (applicationId) => savingFirstInterviewIds.value.includes(Number(applicationId))
const isBlacklistSaving = (applicationId) => addingBlacklistIds.value.includes(Number(applicationId))

const displayRows = computed(() =>
  props.rows.map((row) => ({
    ...row,
    applicationStatus:
      statusOverrides.value[Number(row.applicationId)] ??
      normalizeCandidateApplicationStatus(row.applicationStatus),
    firstInterviewArrangement:
      firstInterviewOverrides.value[Number(row.applicationId)] ??
      normalizeFirstInterviewArrangement(row.firstInterviewArrangement),
  }))
)

const statusFilterOptions = computed(() => [
  { value: '', label: '全部' },
  ...CANDIDATE_APPLICATION_STATUS_OPTIONS,
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

const filteredRows = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  const selectedStatus = normalizeCandidateApplicationStatus(statusFilter.value, '')
  const selectedJob = normalizeFilterText(jobFilter.value)

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

    if (!keyword) return true

    const haystack = [
      props.showJobColumn ? row.jobPostTitle : '',
      row.fullName,
      getCandidateApplicationStatusLabel(row.applicationStatus),
      getFirstInterviewArrangementLabel(row.firstInterviewArrangement),
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

const effectivePageSize = computed(() => Math.max(1, Number(props.pageSize) || 30))

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredRows.value.length / effectivePageSize.value))
)

const visibleRows = computed(() => {
  if (!props.paginated) return filteredRows.value

  const start = (currentPage.value - 1) * effectivePageSize.value
  return filteredRows.value.slice(start, start + effectivePageSize.value)
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
  filteredRows.value.length ? (currentPage.value - 1) * effectivePageSize.value + 1 : 0
)

const paginationEnd = computed(() =>
  Math.min(currentPage.value * effectivePageSize.value, filteredRows.value.length)
)

const tableWrapStyle = computed(() =>
  props.paginated
    ? { '--application-table-max-height': props.tableMaxHeight }
    : undefined
)

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
  let count = 8
  if (props.showJobColumn) count += 1
  if (props.showTargetPositionColumn) count += 1
  if (props.showPhoneColumn) count += 1
  if (props.showRowActions) count += 1
  return count
})

const goToPage = (page) => {
  currentPage.value = Math.max(1, Math.min(Number(page) || 1, totalPages.value))
}

watch([searchKeyword, statusFilter, jobFilter], () => {
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

const openPreview = async (row, type) => {
  if (!row?.cvId) return

  isPreviewOpen.value = true
  isPreviewLoading.value = true
  previewError.value = ''
  previewContent.value = ''
  previewType.value = type === 'extracted' ? 'extracted' : 'cv'
  previewCvId.value = Number(row.cvId)
  previewApplicationId.value = Number(row.applicationId || 0) || null
  previewDownloadUrl.value = type === 'cv' && row.hasDownload
    ? `${apiBaseUrl}/api/candidate-cvs/${row.cvId}/download`
    : ''
  previewDownloadFileName.value = type === 'cv' ? String(row.cvFileName || '') : ''
  previewFileUrl.value = type === 'cv' && row.hasDownload
    ? `${apiBaseUrl}/api/candidate-cvs/${row.cvId}/file-preview`
    : ''
  previewTitle.value = type === 'extracted'
    ? `AI分析檔案預覽 - ${row.extractedFileName || row.cvFileName}`
    : `CV 檔案預覽 - ${row.cvFileName}`

  if (previewFileUrl.value) {
    isPreviewLoading.value = false
    return
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/candidate-cvs/${row.cvId}/preview?type=${type}`)
    const data = await response.json()
    if (!response.ok) {
      previewError.value = data.message || '讀取預覽失敗'
      return
    }
    previewContent.value = data.text || ''
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
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ applicationStatus: normalizedStatus }),
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

const canEditFirstInterviewArrangement = (row) =>
  props.editableStatus &&
  normalizeCandidateApplicationStatus(row?.applicationStatus) === 'screening_hr_approved'

const updateFirstInterviewArrangement = async (row, nextValue) => {
  const applicationId = Number(row?.applicationId)
  const previousValue = normalizeFirstInterviewArrangement(row?.firstInterviewArrangement)
  const normalizedValue = normalizeFirstInterviewArrangement(nextValue, '')

  if (!applicationId || normalizedValue === previousValue) {
    firstInterviewOverrides.value = {
      ...firstInterviewOverrides.value,
      [applicationId]: previousValue,
    }
    return
  }

  savingFirstInterviewIds.value = [...savingFirstInterviewIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ firstInterviewArrangement: normalizedValue }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '更新面試安排失敗')
    }

    firstInterviewOverrides.value = {
      ...firstInterviewOverrides.value,
      [applicationId]: normalizeFirstInterviewArrangement(data?.application?.firstInterviewArrangement),
    }
    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已更新 ${row?.fullName || '候選人'} 的面試安排為「${getFirstInterviewArrangementLabel(normalizedValue)}」`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    firstInterviewOverrides.value = {
      ...firstInterviewOverrides.value,
      [applicationId]: previousValue,
    }
    emit('notify', {
      type: 'error',
      message: error?.message || '更新面試安排失敗',
    })
  } finally {
    savingFirstInterviewIds.value = savingFirstInterviewIds.value.filter((id) => id !== applicationId)
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

onBeforeUnmount(() => {
  clearStatusPopoverTimer()
})
</script>

<template>
  <section class="card applications-card">
    <div class="card-header">
      <div>
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
      <div v-if="showJobFilter || showStatusFilter" class="table-filters">
        <label v-if="showJobFilter" class="filter-control job-filter-control">
          <span>職位篩選</span>
          <AppSelect
            v-model="jobFilter"
            class="filter-select"
            :options="jobFilterOptions"
            placeholder="全部"
            empty-text="目前沒有職位"
          />
        </label>
        <label v-if="showStatusFilter" class="filter-control status-filter-control">
          <span>候選人狀態篩選</span>
          <AppSelect
            v-model="statusFilter"
            class="filter-select"
            :options="statusFilterOptions"
            placeholder="全部"
          />
        </label>
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

    <p v-if="loading" class="hint">讀取中...</p>
    <div
      v-else
      class="table-wrap"
      :class="{ 'table-wrap-paginated': paginated }"
      :style="tableWrapStyle"
    >
      <table class="application-table">
        <thead>
          <tr>
            <th v-if="showJobColumn" class="job-col">職位</th>
            <th class="name-col">候選人名稱</th>
            <th class="status-col">候選人狀態</th>
            <th class="first-interview-col">是否安排面試</th>
            <th class="remark-col">備註</th>
            <th v-if="showTargetPositionColumn" class="position-col">期望職位</th>
            <th class="position-col">匹配職位</th>
            <th v-if="showPhoneColumn" class="phone-col">電話</th>
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
            :key="row.applicationId"
            :class="{
              'blacklist-row': row.isBlacklisted,
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
                @mouseenter="openStatusPopover(row)"
                @mouseleave="scheduleStatusPopoverClose"
                @focusin="openStatusPopover(row)"
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
                  @click.stop="emit('edit-status', row)"
                >
                  {{ getCandidateApplicationStatusLabel(row.applicationStatus) }}
                </button>
                <span v-else class="status-chip" :class="getStatusToneClass(row.applicationStatus)">
                  {{ getCandidateApplicationStatusLabel(row.applicationStatus) }}
                </span>

                <div v-if="statusActionable" class="status-history-popover" role="tooltip">
                  <p class="status-history-title">狀態記錄</p>
                  <ol class="status-history-list">
                    <li
                      v-for="(history, index) in getRowStatusHistory(row)"
                      :key="getStatusHistoryKey(history, index)"
                      :class="{ current: index === 0 }"
                    >
                      <span class="history-dot" aria-hidden="true"></span>
                      <span class="history-main">
                        <strong>{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</strong>
                        <small>
                          {{ formatDateTime(history.createdAt) }}
                          <template v-if="history.updatedAt"> / {{ formatDateTime(history.updatedAt) }}</template>
                        </small>
                        <span class="history-operator">
                          <span
                            class="history-operator-avatar"
                            :style="getStatusHistoryOperatorAvatarStyle(history)"
                          >
                            {{ getStatusHistoryOperatorAvatarText(history) }}
                          </span>
                          <span>{{ getStatusHistoryOperatorName(history) }}</span>
                        </span>
                        <em v-if="history.firstInterviewArrangement">
                          {{ getFirstInterviewArrangementLabel(history.firstInterviewArrangement) }}
                        </em>
                        <span v-if="history.remark" class="history-remark">{{ history.remark }}</span>
                      </span>
                    </li>
                  </ol>
                </div>
              </div>
            </td>
            <td class="first-interview-col">
              <div
                v-if="canEditFirstInterviewArrangement(row)"
                class="first-interview-select-wrap"
                :class="{ saving: isFirstInterviewSaving(row.applicationId) }"
              >
                <AppSelect
                  class="first-interview-select"
                  :model-value="row.firstInterviewArrangement"
                  :options="FIRST_INTERVIEW_ARRANGEMENT_OPTIONS"
                  placeholder="請選擇"
                  :disabled="isFirstInterviewSaving(row.applicationId)"
                  @update:model-value="updateFirstInterviewArrangement(row, $event)"
                />
              </div>
              <span v-else class="first-interview-text">
                {{ getFirstInterviewArrangementLabel(row.firstInterviewArrangement) || '--' }}
              </span>
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
            <td class="file-column file-col">
              <button
                v-if="row.cvFileName"
                type="button"
                class="link-btn file-link"
                @click="openPreview(row, 'cv')"
              >
                {{ row.cvFileName }}
              </button>
              <span v-else class="file-link-text">--</span>
            </td>
            <td class="file-column file-col">
              <button
                v-if="row.extractedFileName"
                type="button"
                class="link-btn file-link"
                @click="openPreview(row, 'extracted')"
              >
                {{ row.extractedFileName }}
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
        <template v-if="filteredRows.length">
          顯示 {{ paginationStart }}-{{ paginationEnd }} / 共 {{ filteredRows.length }} 筆，每頁 {{ effectivePageSize }} 筆
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
  min-width: 0;
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

.table-search-wrap {
  flex: 0 1 340px;
  width: min(340px, 100%);
  min-width: min(260px, 100%);
}

.table-search-wrap .search-input {
  width: 100%;
}

.table-filters {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.85rem;
  flex: 0 1 auto;
  flex-wrap: wrap;
  min-width: 0;
}

.filter-control {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  color: var(--text-base);
  font-size: 0.84rem;
  font-weight: 700;
  white-space: nowrap;
}

.filter-select {
  width: 176px;
}

.status-filter-control .filter-select {
  width: 196px;
}

.filter-control :deep(.app-select-trigger) {
  min-height: 42px;
  padding: 0.48rem 0.95rem 0.48rem 1rem;
  border-color: rgba(151, 190, 126, 0.2);
  border-radius: 999px;
  background: rgba(226, 241, 216, 0.96);
  box-shadow: none;
}

.filter-control :deep(.app-select-trigger:hover) {
  border-color: rgba(116, 166, 86, 0.34);
  background: rgba(218, 236, 205, 0.98);
  box-shadow: none;
}

.filter-control :deep(.app-select-trigger:focus-visible) {
  border-color: rgba(72, 139, 53, 0.36);
  box-shadow: 0 0 0 4px rgba(72, 139, 53, 0.12);
}

.filter-control :deep(.app-select-value),
.filter-control :deep(.app-select-option-label) {
  color: var(--text-strong);
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.25;
}

.filter-control :deep(.app-select-icon) {
  width: 0.48rem;
  height: 0.48rem;
  border-color: rgba(78, 153, 55, 0.8);
}

.filter-control :deep(.app-select-menu) {
  min-width: 100%;
  width: max-content;
  max-width: 320px;
  z-index: 120;
}

.table-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
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

.table-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: auto;
}

.table-wrap-paginated {
  max-height: var(--application-table-max-height);
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

.blacklist-row td {
  background: rgba(217, 45, 32, 0.05);
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

.first-interview-col {
  min-width: 180px;
}

.position-col {
  min-width: 160px;
}

.phone-col {
  min-width: 140px;
}

.file-col {
  min-width: 220px;
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
  max-width: 220px;
}

.file-link,
.file-link-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.first-interview-select-wrap {
  min-width: 156px;
  max-width: 188px;
}

.first-interview-select-wrap.saving {
  opacity: 0.68;
}

.first-interview-select {
  width: 100%;
}

.first-interview-select-wrap :deep(.app-select-trigger) {
  min-height: 36px;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
}

.first-interview-select-wrap :deep(.app-select-menu) {
  min-width: 100%;
  width: max-content;
}

.first-interview-select-wrap :deep(.app-select-value),
.first-interview-select-wrap :deep(.app-select-option-label) {
  font-size: 0.82rem;
}

.first-interview-text {
  color: var(--text-base);
  font-weight: 600;
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
  width: min(340px, calc(100vw - 2rem));
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
  width: min(340px, calc(100vw - 2rem));
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
  gap: 0.16rem;
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
  line-height: 1.35;
}

.history-operator {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  font-weight: 700;
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
}

.status-tone-screening,
.status-tone-screening_hr_approved,
.status-tone-screening_hr_rejected,
.status-tone-screening_department_approved,
.status-tone-screening_department_rejected,
.status-tone-screening_rejected,
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding-top: 0.15rem;
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
  .table-filters,
  .table-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .table-search-wrap,
  .filter-select,
  .status-filter-control .filter-select {
    width: 100%;
    min-width: 0;
  }

  .filter-control {
    align-items: stretch;
    flex-direction: column;
    gap: 0.35rem;
  }

  .table-pagination {
    align-items: stretch;
  }

  .pagination-controls {
    justify-content: flex-start;
  }
}
</style>
