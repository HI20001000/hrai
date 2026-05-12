<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'
import CandidateApplicationsTable from '../components/candidate/CandidateApplicationsTable.vue'
import CandidateCvUploadModal from '../components/candidate/CandidateCvUploadModal.vue'

const message = ref('')
const applicationRows = ref([])
const selectedApplicationIds = ref([])
const isLoading = ref(false)
const isBulkDeleting = ref(false)
const isBulkBlacklisting = ref(false)
const isBulkUnblacklisting = ref(false)
const isUploadModalOpen = ref(false)
const isProjectTransferModalOpen = ref(false)
const isProjectTransferSaving = ref(false)
const projectRows = ref([])
const projectTransferCandidate = ref(null)
const projectTransferForm = ref(createEmptyProjectTransferForm())

function createEmptyProjectTransferForm() {
  return {
    projectId: '',
    projectRole: '',
    startDate: new Date().toISOString().slice(0, 10),
    remark: '',
  }
}

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()
const normalizePhone = (value) => String(value ?? '').trim().replace(/[\s\-()]/g, '')

const selectedRows = computed(() => {
  const selectedSet = new Set(selectedApplicationIds.value.map((id) => Number(id)))
  return applicationRows.value.filter((row) => selectedSet.has(Number(row.applicationId)))
})

const bulkBlacklistDisabled = computed(
  () => !selectedRows.value.some((row) => !row.isBlacklisted && (row.phone || row.email))
)

const bulkUnblacklistDisabled = computed(
  () => !selectedRows.value.some((row) => row.isBlacklisted && Number(row.blacklistEntryId) > 0)
)

const bulkUploadDisabled = computed(() => false)

const projectOptions = computed(() =>
  projectRows.value.map((project) => ({
    value: String(project.id),
    label: project.projectName || `項目 #${project.id}`,
  }))
)

const fetchJson = async (endpoint, options = {}) => {
  const response = await fetch(endpoint, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
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

const handleApplicationsUpdated = async () => {
  await loadApplicationTable()
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

const getUniqueBlacklistTargets = (rows) => {
  const seen = new Set()
  return rows.filter((row) => {
    const key = `${normalizeEmail(row.email)}|${normalizePhone(row.phone)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const addSelectedToBlacklist = async () => {
  const candidates = getUniqueBlacklistTargets(
    selectedRows.value.filter((row) => !row.isBlacklisted && (row.phone || row.email))
  )
  if (!candidates.length) {
    message.value = '已選資料中沒有可加入 Blacklist 的候選人'
    return
  }

  const reason = window.prompt('請輸入加入 Blacklist 的原因', '由候選人管理批量加入')
  if (reason === null) return
  const normalizedReason = String(reason || '').trim()
  if (!normalizedReason) {
    message.value = '請先輸入 Blacklist 原因'
    return
  }

  isBulkBlacklisting.value = true
  try {
    const results = await Promise.allSettled(
      candidates.map(async (row) => {
        const response = await fetch(`${apiBaseUrl}/api/candidate-blacklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: String(row.fullName || '').trim(),
            phone: String(row.phone || '').trim(),
            email: String(row.email || '').trim(),
            reason: normalizedReason,
            status: 'active',
          }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || '加入 Blacklist 失敗')
        return data
      })
    )

    const successCount = results.filter((result) => result.status === 'fulfilled').length
    const failureCount = results.length - successCount
    await loadApplicationTable()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = `批量加入 Blacklist 完成：成功 ${successCount} 位，失敗 ${failureCount} 位`
  } catch {
    message.value = '批量加入 Blacklist 失敗'
  } finally {
    isBulkBlacklisting.value = false
  }
}

const removeSelectedFromBlacklist = async () => {
  const blacklistEntryIds = [...new Set(
    selectedRows.value
      .map((row) => Number(row.blacklistEntryId))
      .filter((id) => Number.isInteger(id) && id > 0)
  )]
  if (!blacklistEntryIds.length) {
    message.value = '已選資料中沒有可取消的 Blacklist'
    return
  }

  const confirmed = window.confirm(`確定將 ${blacklistEntryIds.length} 筆黑名單資料移除？`)
  if (!confirmed) return

  isBulkUnblacklisting.value = true
  try {
    const results = await Promise.allSettled(
      blacklistEntryIds.map(async (id) => {
        const response = await fetch(`${apiBaseUrl}/api/candidate-blacklist/${id}`, {
          method: 'DELETE',
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || '取消 Blacklist 失敗')
        return data
      })
    )

    const successCount = results.filter((result) => result.status === 'fulfilled').length
    const failureCount = results.length - successCount
    await loadApplicationTable()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = `取消 Blacklist 完成：成功 ${successCount} 筆，失敗 ${failureCount} 筆`
  } catch {
    message.value = '取消 Blacklist 失敗'
  } finally {
    isBulkUnblacklisting.value = false
  }
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
          <h2>候選人管理</h2>
          <p>這裡集中查看所有職位下的候選人投遞與匹配結果，並可直接更新候選人狀態。</p>
        </div>
      </div>
      <p v-if="message" class="message">{{ message }}</p>
    </header>

    <CandidateApplicationsTable
      :rows="applicationRows"
      :loading="isLoading"
      :show-job-column="true"
      :editable-status="true"
      :show-blacklist-action="true"
      :show-project-transfer-action="true"
      :show-bulk-blacklist-actions="true"
      :show-bulk-upload-action="true"
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
      search-placeholder="搜尋職位 / 候選人 / 狀態 / 一面安排 / 期望職位 / 匹配職位 / 電話 / 備註 / 檔案"
      @selection-change="selectedApplicationIds = $event"
      @delete-selected="deleteSelectedApplications"
      @bulk-blacklist-selected="addSelectedToBlacklist"
      @bulk-unblacklist-selected="removeSelectedFromBlacklist"
      @upload-selected-cv="openUploadModal"
      @add-to-project="openProjectTransferModal"
      @rows-updated="handleApplicationsUpdated"
      @notify="handleTableNotify"
    />

    <CandidateCvUploadModal
      :open="isUploadModalOpen"
      @close="closeUploadModal"
      @uploaded="handleUploadCompleted"
    />

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
.candidate-page {
  color: var(--text-base);
  gap: 0.8rem;
}

.header-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.project-transfer-modal {
  display: grid;
  gap: 1rem;
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
}

.transfer-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.full-span {
  grid-column: 1 / -1;
}

@media (max-width: 720px) {
  .header-main,
  .modal-header,
  .modal-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .transfer-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
