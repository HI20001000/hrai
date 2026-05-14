<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'
import MatchDimensionBreakdown from '../components/MatchDimensionBreakdown.vue'
import CandidateApplicationsTable from '../components/candidate/CandidateApplicationsTable.vue'
import CandidateCvUploadModal from '../components/candidate/CandidateCvUploadModal.vue'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  FIRST_INTERVIEW_ARRANGEMENT_OPTIONS,
  getCandidateApplicationStatusLabel,
  getFirstInterviewArrangementLabel,
  normalizeCandidateApplicationStatus,
  normalizeFirstInterviewArrangement,
} from '../scripts/candidateApplicationStatus.js'

const message = ref('')
const applicationRows = ref([])
const selectedApplicationIds = ref([])
const isLoading = ref(false)
const isBulkDeleting = ref(false)
const isUploadModalOpen = ref(false)
const isStatusModalOpen = ref(false)
const isSavingStatusModal = ref(false)
const editingStatusHistoryId = ref(null)
const isProjectTransferModalOpen = ref(false)
const isProjectTransferSaving = ref(false)
const projectRows = ref([])
const projectTransferCandidate = ref(null)
const projectTransferForm = ref(createEmptyProjectTransferForm())

const pageMode = ref('list')
const activeApplicationId = ref(null)
const activeApplication = ref(null)
const isDetailLoading = ref(false)
const detailError = ref('')
const isStatusEditorOpen = ref(false)
const isRemarkEditorOpen = ref(false)
const isBlacklistEditorOpen = ref(false)
const statusDraft = ref('')
const remarkDraft = ref('')
const firstInterviewDraft = ref('')
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

const selectedRows = computed(() => {
  const selectedSet = new Set(selectedApplicationIds.value.map((id) => Number(id)))
  return applicationRows.value.filter((row) => selectedSet.has(Number(row.applicationId)))
})

const bulkUploadDisabled = computed(() => false)

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
  return [
    {
      id: 0,
      applicationStatus: activeApplication.value.applicationStatus,
      firstInterviewArrangement: activeApplication.value.firstInterviewArrangement,
      remark: activeApplication.value.remark,
      createdAt: activeApplication.value.createdAt,
      updatedAt: activeApplication.value.createdAt,
    },
  ]
})

const canEditFirstInterview = computed(
  () => normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus) === 'screening_hr_approved'
)

const canEditFirstInterviewDraft = computed(
  () => normalizeCandidateApplicationStatus(statusDraft.value, '') === 'screening_hr_approved'
)

const isStatusModalBusy = computed(() => isDetailLoading.value || isSavingStatusModal.value)

const isEditingStatusHistory = computed(() => Number(editingStatusHistoryId.value || 0) > 0)

const statusModalEditorTitle = computed(() =>
  isEditingStatusHistory.value ? '編輯狀態記錄' : '新增狀態記錄'
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
  const response = await fetch(endpoint, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
}

const resetDetailDrafts = (application = activeApplication.value) => {
  statusDraft.value = normalizeCandidateApplicationStatus(application?.applicationStatus)
  firstInterviewDraft.value = normalizeFirstInterviewArrangement(application?.firstInterviewArrangement)
  remarkDraft.value = String(application?.remark || '')
  blacklistReasonDraft.value = String(application?.blacklistEntry?.reason || application?.blacklistReason || '')
  isStatusEditorOpen.value = false
  isRemarkEditorOpen.value = false
  isBlacklistEditorOpen.value = false
}

const startNewStatusHistoryDraft = () => {
  editingStatusHistoryId.value = null
  statusDraft.value = normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus)
  firstInterviewDraft.value = normalizeFirstInterviewArrangement(activeApplication.value?.firstInterviewArrangement)
  remarkDraft.value = ''
}

const editStatusHistoryDraft = (history) => {
  const historyId = Number(history?.id || 0)
  if (!historyId || isStatusModalBusy.value) return
  editingStatusHistoryId.value = historyId
  statusDraft.value = normalizeCandidateApplicationStatus(history?.applicationStatus)
  firstInterviewDraft.value = normalizeFirstInterviewArrangement(history?.firstInterviewArrangement)
  remarkDraft.value = String(history?.remark || '')
}

const loadApplicationTable = async () => {
  isLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/table`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取候選人管理清單失敗')
    applicationRows.value = Array.isArray(data.applications) ? data.applications : []

    const allowedIds = new Set(applicationRows.value.map((row) => Number(row.applicationId)))
    selectedApplicationIds.value = selectedApplicationIds.value.filter((id) => allowedIds.has(Number(id)))
  } catch {
    message.value = '初始化資料失敗'
  } finally {
    isLoading.value = false
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
  const nextFirstInterview = canEditFirstInterviewDraft.value
    ? normalizeFirstInterviewArrangement(firstInterviewDraft.value, '')
    : ''
  const payload = {
    applicationStatus: nextStatus,
    firstInterviewArrangement: nextFirstInterview,
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
    if (savedHistoryId) {
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

const startStatusEditor = () => {
  statusDraft.value = normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus)
  isStatusEditorOpen.value = true
}

const cancelStatusEditor = () => {
  statusDraft.value = normalizeCandidateApplicationStatus(activeApplication.value?.applicationStatus)
  isStatusEditorOpen.value = false
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
    isStatusEditorOpen.value = false
    return
  }

  isSavingStatus.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationStatus: nextStatus }),
    })
    isStatusEditorOpen.value = false
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
  if (!applicationId || !canEditFirstInterview.value) {
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

onMounted(async () => {
  window.addEventListener('hrai-applications-updated', handleApplicationsUpdated)
  window.addEventListener('focus', handleApplicationsUpdated)
  await loadApplicationTable()
})

onUnmounted(() => {
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
      :show-job-column="true"
      :show-target-position-column="false"
      :show-phone-column="false"
      :show-project-transfer-action="true"
      :show-bulk-upload-action="true"
      :show-job-filter="true"
      :show-status-filter="true"
      :paginated="true"
      :page-size="30"
      :status-actionable="true"
      :bulk-upload-disabled="bulkUploadDisabled"
      :selectable="true"
      :selected-ids="selectedApplicationIds"
      :deleting="isBulkDeleting"
      title="候選人清單"
      empty-text="尚無候選人資料"
      search-placeholder="搜尋職位 / 候選人 / 狀態 / 面試安排 / 匹配職位 / 備註 / 檔案"
      @selection-change="selectedApplicationIds = $event"
      @delete-selected="deleteSelectedApplications"
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
                    <span v-else>{{ activeApplication.cvFileName || '--' }}</span>
                  </td>
                  <td>{{ activeApplication.extractedFileName || '--' }}</td>
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
              <button
                v-if="!isStatusEditorOpen"
                type="button"
                class="create-status-btn"
                :disabled="isSavingStatus"
                @click="startStatusEditor"
              >
                點擊創建新狀態
              </button>
              <div v-else class="inline-editor status-inline-editor">
                <AppSelect
                  class="compact-select"
                  :model-value="statusDraft"
                  :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                  placeholder="請選擇狀態"
                  :disabled="isSavingStatus"
                  @update:model-value="statusDraft = $event"
                />
                <button type="button" class="secondary-btn compact-btn" :disabled="isSavingStatus" @click="cancelStatusEditor">
                  取消
                </button>
                <button type="button" class="confirm-btn compact-btn" :disabled="isSavingStatus" @click="saveNewStatus">
                  {{ isSavingStatus ? '保存中...' : '確認' }}
                </button>
              </div>

              <div class="first-interview-editor">
                <span>是否安排面試</span>
                <AppSelect
                  class="compact-select"
                  :model-value="firstInterviewDraft"
                  :options="FIRST_INTERVIEW_ARRANGEMENT_OPTIONS"
                  placeholder="請選擇"
                  :disabled="!canEditFirstInterview || isSavingFirstInterview"
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
              :class="{ current: index === activeStatusHistory.length - 1 }"
            >
              <div class="timeline-label">
                <span class="timeline-dot" aria-hidden="true"></span>
                <span class="timeline-status">{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</span>
              </div>
              <div class="timeline-content">
                <p class="timeline-meta">
                  狀態創建時間 {{ formatDateTime(history.createdAt) }}
                  <template v-if="history.updatedAt">｜狀態修改時間 {{ formatDateTime(history.updatedAt) }}</template>
                </p>
                <p>{{ history.remark || '未填寫備註' }}</p>
                <p v-if="history.firstInterviewArrangement" class="timeline-extra">
                  面試安排：{{ getFirstInterviewArrangementLabel(history.firstInterviewArrangement) }}
                </p>
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
            <h4>{{ statusModalEditorTitle }}</h4>
            <button
              type="button"
              class="secondary-btn compact-btn"
              :disabled="isStatusModalBusy"
              @click="startNewStatusHistoryDraft"
            >
              新增狀態記錄
            </button>
          </div>

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

            <label class="field">
              <span>是否安排面試</span>
              <AppSelect
                :model-value="firstInterviewDraft"
                :options="FIRST_INTERVIEW_ARRANGEMENT_OPTIONS"
                placeholder="請選擇"
                :disabled="!canEditFirstInterviewDraft || isSavingStatusModal"
                @update:model-value="firstInterviewDraft = $event"
              />
            </label>

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
              <button
                v-for="(history, index) in activeStatusHistory"
                :key="history.id || `${history.applicationStatus}-${index}`"
                type="button"
                class="timeline-row"
                :class="{
                  current: index === activeStatusHistory.length - 1,
                  selected: Number(editingStatusHistoryId) === Number(history.id),
                }"
                :disabled="isStatusModalBusy || !history.id"
                @click="editStatusHistoryDraft(history)"
              >
                <div class="timeline-label">
                  <span class="timeline-dot" aria-hidden="true"></span>
                  <span class="timeline-status">{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</span>
                </div>
                <div class="timeline-content">
                  <p class="timeline-meta">
                    狀態創建時間 {{ formatDateTime(history.createdAt) }}
                    <template v-if="history.updatedAt">｜狀態修改時間 {{ formatDateTime(history.updatedAt) }}</template>
                  </p>
                  <p>{{ history.remark || '未填寫備註' }}</p>
                  <p v-if="history.firstInterviewArrangement" class="timeline-extra">
                    面試安排：{{ getFirstInterviewArrangementLabel(history.firstInterviewArrangement) }}
                  </p>
                </div>
              </button>
            </div>
          </section>
        </template>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="isStatusModalBusy" @click="closeApplicationStatusModal">取消</button>
          <button
            type="button"
            class="primary-btn"
            :disabled="isStatusModalBusy || !activeApplication"
            @click="saveStatusModalChanges"
          >
            {{ isSavingStatusModal ? '保存中...' : '保存' }}
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

.create-status-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0.48rem 1.05rem;
  border: 1px solid rgba(31, 143, 99, 0.2);
  border-radius: var(--radius-pill);
  color: #176b4c;
  background: rgba(31, 143, 99, 0.18);
  font-weight: 700;
  cursor: pointer;
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
  width: min(920px, calc(100vw - 2rem));
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

.status-modal-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.status-modal-editor textarea {
  min-height: 98px;
  resize: vertical;
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

.timeline-row:disabled {
  cursor: default;
}

.timeline-row:not(:disabled):hover .timeline-label,
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
  gap: 0.2rem;
  min-width: 0;
}

.timeline-meta,
.timeline-extra {
  color: var(--text-soft);
  font-size: 0.82rem;
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

  .status-modal-editor {
    grid-template-columns: 1fr;
  }
}
</style>
