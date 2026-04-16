<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import { resolveJobDictionary } from '../scripts/jobDictionary.js'
import AppSelect from '../components/AppSelect.vue'
import CandidateApplicationsTable from '../components/candidate/CandidateApplicationsTable.vue'
import JobDictionaryPanel from '../components/job/JobDictionaryPanel.vue'

const message = ref('')
const jobPosts = ref([])
const jobDictionary = ref({})
const selectedJobPost = ref(null)
const applications = ref([])
const selectedApplicationIds = ref([])

const isJobPostsLoading = ref(false)
const isApplicationsLoading = ref(false)
const isCreatingJobPost = ref(true)
const isJobPostSaving = ref(false)
const isJobPostDeleting = ref(false)
const isBulkDeleting = ref(false)

const jobPostForm = ref({
  title: '',
  jobKey: '',
  status: 'open',
})

const getStatusLabel = (status) => {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'open') return '開放中'
  if (value === 'draft') return '草稿'
  if (value === 'closed') return '已關閉'
  return status || '--'
}

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

const getAuthHeaders = () => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const sortedDictionaryEntries = computed(() =>
  Object.keys(jobDictionary.value || {}).sort((a, b) => a.localeCompare(b))
)

const jobDictionaryOptions = computed(() =>
  sortedDictionaryEntries.value.map((jobTitle) => ({
    value: jobTitle,
    label: jobTitle,
  }))
)

const statusOptions = [
  { value: 'open', label: '開放中' },
  { value: 'draft', label: '草稿' },
  { value: 'closed', label: '已關閉' },
]

const selectedDictionaryTitle = computed(() =>
  String(jobPostForm.value.jobKey || '').trim() ||
  selectedJobPost.value?.jobSnapshot?.title ||
  selectedJobPost.value?.jobKey ||
  ''
)

const syncCreateFormFromDictionary = (jobTitle) => {
  const normalizedTitle = String(jobTitle || '').trim()
  if (!isCreatingJobPost.value) return
  jobPostForm.value.jobKey = normalizedTitle
  jobPostForm.value.title = normalizedTitle
}

const loadJobDictionary = async () => {
  const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
    headers: {
      ...getAuthHeaders(),
    },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '讀取職位字典失敗')
  jobDictionary.value = resolveJobDictionary(data)
}

const loadJobPosts = async () => {
  isJobPostsLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-posts`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取職位失敗')
    jobPosts.value = Array.isArray(data.jobPosts) ? data.jobPosts : []
  } finally {
    isJobPostsLoading.value = false
  }
}

const loadJobPostDetail = async (jobPostId) => {
  const response = await fetch(`${apiBaseUrl}/api/job-posts/${jobPostId}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '讀取職位詳情失敗')
  selectedJobPost.value = data.jobPost || null
}

const loadApplications = async (jobPostId) => {
  isApplicationsLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-posts/${jobPostId}/applications`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取候選人清單失敗')
    applications.value = Array.isArray(data.applications) ? data.applications : []
    const allowed = new Set(applications.value.map((row) => Number(row.applicationId)))
    selectedApplicationIds.value = selectedApplicationIds.value.filter((id) => allowed.has(Number(id)))
  } finally {
    isApplicationsLoading.value = false
  }
}

const selectJobPost = async (jobPostId) => {
  const id = Number(jobPostId)
  if (!Number.isInteger(id) || id <= 0) return
  message.value = ''
  await loadJobPostDetail(id)
  await loadApplications(id)
  isCreatingJobPost.value = false
  jobPostForm.value = {
    title: selectedJobPost.value?.title || '',
    jobKey: selectedJobPost.value?.jobKey || '',
    status: selectedJobPost.value?.status || 'open',
  }
}

const beginCreateJobPost = () => {
  isCreatingJobPost.value = true
  selectedJobPost.value = null
  applications.value = []
  selectedApplicationIds.value = []
  const firstJobTitle = sortedDictionaryEntries.value[0] || ''
  jobPostForm.value = {
    title: firstJobTitle,
    jobKey: firstJobTitle,
    status: 'open',
  }
  message.value = ''
}

const saveJobPost = async () => {
  const payload = {
    title: String(jobPostForm.value.title || '').trim(),
    jobKey: String(jobPostForm.value.jobKey || '').trim(),
    status: String(jobPostForm.value.status || 'open').trim(),
  }

  if (!payload.title) {
    message.value = '請先選擇職位字典'
    return
  }
  if (!payload.jobKey) {
    message.value = '請先選擇職位字典'
    return
  }

  isJobPostSaving.value = true
  try {
    const endpoint = isCreatingJobPost.value
      ? `${apiBaseUrl}/api/job-posts`
      : `${apiBaseUrl}/api/job-posts/${selectedJobPost.value?.id}`
    const method = isCreatingJobPost.value ? 'POST' : 'PUT'
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok) {
      message.value = data.message || '儲存職位失敗'
      return
    }

    await loadJobPosts()
    const jobPostId = Number(data?.jobPost?.id || selectedJobPost.value?.id || 0)
    if (jobPostId > 0) {
      await selectJobPost(jobPostId)
    }
    message.value = isCreatingJobPost.value ? '職位已建立' : '職位已更新'
  } catch {
    message.value = '儲存職位失敗'
  } finally {
    isJobPostSaving.value = false
  }
}

const deleteSelectedJobPost = async () => {
  if (isCreatingJobPost.value || !selectedJobPost.value?.id || isJobPostDeleting.value) return

  const applicationCount = Number(selectedJobPost.value?.applicationCount || applications.value.length || 0)
  const confirmed = window.confirm(
    applicationCount > 0
      ? `確定刪除「${selectedJobPost.value.title || '此職位'}」？\n\n這會一併刪除其下 ${applicationCount} 筆投遞與相關 CV 檔案，且無法復原。`
      : `確定刪除「${selectedJobPost.value.title || '此職位'}」？此操作無法復原。`
  )
  if (!confirmed) return

  isJobPostDeleting.value = true
  try {
    const deletingId = Number(selectedJobPost.value.id)
    const response = await fetch(`${apiBaseUrl}/api/job-posts/${deletingId}`, {
      method: 'DELETE',
    })
    const data = await response.json()
    if (!response.ok) {
      message.value = data.message || '刪除職位失敗'
      return
    }

    await loadJobPosts()
    selectedApplicationIds.value = []
    applications.value = []
    selectedJobPost.value = null

    const nextJobPost = jobPosts.value.find((item) => Number(item.id) !== deletingId) || jobPosts.value[0] || null
    if (nextJobPost?.id) {
      await selectJobPost(nextJobPost.id)
    } else {
      beginCreateJobPost()
    }

    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = '職位已刪除'
  } catch {
    message.value = '刪除職位失敗'
  } finally {
    isJobPostDeleting.value = false
  }
}

const deleteSelectedApplications = async () => {
  if (!selectedApplicationIds.value.length || isBulkDeleting.value) return
  const selectedSet = new Set(selectedApplicationIds.value.map((id) => Number(id)))
  const selectedNames = applications.value
    .filter((row) => selectedSet.has(Number(row.applicationId)))
    .map((row) => String(row.fullName || '').trim())
    .filter(Boolean)

  const previewNames = selectedNames.slice(0, 10)
  const remainCount = Math.max(selectedNames.length - previewNames.length, 0)
  const namesBlock = previewNames.map((name) => `- ${name}`).join('\n')
  const extraLine = remainCount > 0 ? `\n- ... 另 ${remainCount} 位` : ''

  const confirmed = window.confirm(
    `確定刪除已選擇的 ${selectedApplicationIds.value.length} 筆投遞與 CV 檔案？此操作無法復原。\n\n` +
      `將刪除名單：\n${namesBlock || '- （未取得名稱）'}${extraLine}`
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
    if (!response.ok) {
      message.value = data.message || '批次刪除失敗'
      return
    }
    selectedApplicationIds.value = []
    await loadJobPosts()
    if (selectedJobPost.value?.id) {
      await loadApplications(selectedJobPost.value.id)
    }
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    message.value = `已刪除 ${Number(data.deletedCount || 0)} 筆投遞`
  } catch {
    message.value = '批次刪除失敗'
  } finally {
    isBulkDeleting.value = false
  }
}

const handleDictionaryUpdated = async (dictionary) => {
  jobDictionary.value = dictionary && typeof dictionary === 'object' ? dictionary : {}
  if (isCreatingJobPost.value) {
    const nextTitle = jobDictionary.value[jobPostForm.value.jobKey]
      ? jobPostForm.value.jobKey
      : sortedDictionaryEntries.value[0] || ''
    syncCreateFormFromDictionary(nextTitle)
  }
  await loadJobPosts()
}

const handleDictionaryTitleSelected = (jobTitle) => {
  const normalizedTitle = String(jobTitle || '').trim()
  if (!normalizedTitle || !jobDictionary.value[normalizedTitle]) return
  if (isCreatingJobPost.value) {
    syncCreateFormFromDictionary(normalizedTitle)
    return
  }
  jobPostForm.value = {
    ...jobPostForm.value,
    jobKey: normalizedTitle,
  }
}

const handleApplicationsUpdated = async () => {
  if (!selectedJobPost.value?.id) return
  await loadApplications(selectedJobPost.value.id)
}

const handleTableNotify = ({ message: nextMessage }) => {
  message.value = nextMessage || ''
}

watch(
  () => jobPostForm.value.jobKey,
  (jobTitle) => {
    if (isCreatingJobPost.value) {
      syncCreateFormFromDictionary(jobTitle)
    }
  }
)

onMounted(async () => {
  try {
    await Promise.all([loadJobDictionary(), loadJobPosts()])
    if (jobPosts.value[0]?.id) {
      await selectJobPost(jobPosts.value[0].id)
      return
    }
    beginCreateJobPost()
  } catch {
    message.value = '初始化資料失敗'
  }
})
</script>

<template>
  <section class="job-post-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>職位管理</h2>
          <p>建立職位時，職位字典資料來自 `finance-job-positions.json`，之後可查看該職位下的候選人投遞資料。</p>
        </div>
      </div>
      <p v-if="message" class="message">{{ message }}</p>
    </header>

    <div class="top-grid">
      <section class="card job-post-list-card">
        <div class="card-header">
          <div class="list-title-wrap">
            <h3>職位列表</h3>
            <span class="count-chip">{{ jobPosts.length }}</span>
          </div>
          <button type="button" class="secondary-btn" @click="beginCreateJobPost">新增職位</button>
        </div>
        <p v-if="isJobPostsLoading" class="hint">讀取中...</p>
        <p v-else-if="!jobPosts.length" class="hint">尚未建立職位</p>
        <div v-else class="job-post-list">
          <button
            v-for="jobPost in jobPosts"
            :key="jobPost.id"
            type="button"
            class="job-post-item"
            :class="{ active: selectedJobPost?.id === jobPost.id }"
            @click="selectJobPost(jobPost.id)"
          >
            <strong>{{ jobPost.title }}</strong>
            <span>{{ jobPost.matchedPosition || jobPost.jobKey }}</span>
            <small>{{ getStatusLabel(jobPost.status) }} · {{ jobPost.applicationCount }} 筆投遞</small>
          </button>
        </div>
      </section>

      <section class="card job-post-form-card">
        <div class="card-header">
          <h3>{{ isCreatingJobPost ? '建立職位' : '編輯職位' }}</h3>
          <div class="form-header-actions">
            <button
              v-if="!isCreatingJobPost && selectedJobPost?.id"
              type="button"
              class="danger-btn"
              :disabled="isJobPostSaving || isJobPostDeleting"
              @click="deleteSelectedJobPost"
            >
              {{ isJobPostDeleting ? '刪除中...' : '刪除職位' }}
            </button>
            <button type="button" class="primary-btn" :disabled="isJobPostSaving || isJobPostDeleting" @click="saveJobPost">
              {{ isJobPostSaving ? '儲存中...' : isCreatingJobPost ? '建立職位' : '更新職位' }}
            </button>
          </div>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>職位標題</span>
            <input
              v-model.trim="jobPostForm.title"
              type="text"
              :readonly="isCreatingJobPost"
              :placeholder="isCreatingJobPost ? '建立時會跟隨職位字典自動同步' : '例如：澳門零售銀行客戶經理'"
            />
          </label>

          <label class="field select-field">
            <span>職位字典</span>
            <AppSelect
              v-model="jobPostForm.jobKey"
              :options="jobDictionaryOptions"
              placeholder="請選擇職位字典"
              empty-text="目前尚未建立職位字典"
            />
          </label>

          <label class="field select-field status-field">
            <span>狀態</span>
            <AppSelect
              v-model="jobPostForm.status"
              :options="statusOptions"
              placeholder="請選擇狀態"
            />
          </label>
        </div>

        <p class="hint">職位資料會在建立時固化成快照，之後字典更新不會影響已建立的職位。</p>

        <div v-if="!isCreatingJobPost && selectedJobPost?.jobSnapshot" class="snapshot-box">
          <h4>職位要求</h4>
          <p><strong>職位名稱：</strong>{{ selectedJobPost.jobSnapshot.title || '--' }}</p>
          <p><strong>核心職責：</strong>{{ (selectedJobPost.jobSnapshot.coreResponsibilities || []).join('、') || '--' }}</p>
          <p><strong>必備能力：</strong>{{ (selectedJobPost.jobSnapshot.requiredSkills || []).join('、') || '--' }}</p>
        </div>

        <CandidateApplicationsTable
          :rows="applications"
          :loading="isApplicationsLoading"
          :selectable="true"
          :selected-ids="selectedApplicationIds"
          :deleting="isBulkDeleting"
          title="目前職位候選人清單"
          :subtitle="selectedJobPost?.title || '請先選擇職位'"
          empty-text="尚無候選人資料"
          search-placeholder="搜尋候選人 / 狀態 / 期望職位 / 匹配職位 / 電話 / 備註 / 檔案"
          @selection-change="selectedApplicationIds = $event"
          @delete-selected="deleteSelectedApplications"
          @rows-updated="handleApplicationsUpdated"
          @notify="handleTableNotify"
        />
      </section>
    </div>

    <JobDictionaryPanel
      :selected-title="selectedDictionaryTitle"
      @updated="handleDictionaryUpdated"
      @selected-title-change="handleDictionaryTitleSelected"
    />
  </section>
</template>

<style scoped>
.job-post-page {
  color: var(--text-base);
  width: 100%;
  min-width: 0;
}

.header-main,
.form-header-actions,
.list-title-wrap {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-main {
  justify-content: space-between;
  align-items: flex-start;
}

.top-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(290px, 360px) minmax(0, 1fr);
  min-width: 0;
}

.top-grid > * {
  min-width: 0;
}

.job-post-list-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.job-post-list {
  display: grid;
  gap: 0.8rem;
}

.job-post-item {
  display: grid;
  gap: 0.28rem;
  padding: 1rem 1.05rem;
  border: 1px solid var(--border-default);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  text-align: left;
  cursor: pointer;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.job-post-item:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.job-post-item.active {
  border-color: rgba(47, 111, 237, 0.18);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.1), rgba(255, 255, 255, 0.8));
  box-shadow: 0 16px 30px rgba(47, 111, 237, 0.08);
}

.job-post-item strong {
  color: var(--text-strong);
}

.job-post-item span,
.job-post-item small,
.snapshot-box p {
  color: var(--text-muted);
}

.job-post-form-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.job-post-form-card > .card-header {
  flex-wrap: wrap;
}

.form-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.select-field {
  align-self: start;
}

.select-field span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.snapshot-box {
  gap: 0.5rem;
  padding: 1.1rem 1.15rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(244, 248, 252, 0.92));
}

@media (max-width: 1100px) {
  .top-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .header-main,
  .card-header,
  .form-header-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
