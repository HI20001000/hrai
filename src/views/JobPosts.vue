<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import CandidateTextPreviewModal from '../components/candidate/CandidateTextPreviewModal.vue'
import JobDictionaryPanel from '../components/job/JobDictionaryPanel.vue'

const message = ref('')
const jobPosts = ref([])
const jobDictionary = ref({})
const selectedJobPost = ref(null)
const applications = ref([])
const applicationSearch = ref('')
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

const normalizeSearchText = (value) => String(value ?? '').trim().toLowerCase()

const getMatchScoreTone = (score) => {
  const numericScore = Number(score || 0)
  if (numericScore >= 85) return 'score-high'
  if (numericScore >= 60) return 'score-medium'
  if (numericScore > 0) return 'score-low'
  return 'score-empty'
}

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
  Object.entries(jobDictionary.value || {}).sort((a, b) => a[0].localeCompare(b[0]))
)

const filteredApplications = computed(() => {
  const keyword = normalizeSearchText(applicationSearch.value)
  if (!keyword) return applications.value

  return applications.value.filter((row) => {
    const haystack = [
      row.fullName,
      row.targetPosition,
      row.matchedPosition,
      row.phone,
      row.cvFileName,
      formatDateTime(row.createdAt),
    ]
      .map((item) => normalizeSearchText(item))
      .join(' ')
    return haystack.includes(keyword)
  })
})

const selectableApplicationIds = computed(() =>
  filteredApplications.value
    .map((row) => Number(row.applicationId))
    .filter((id) => Number.isInteger(id) && id > 0)
)

const selectedCount = computed(() => selectedApplicationIds.value.length)

const allSelected = computed(() => {
  if (!selectableApplicationIds.value.length) return false
  const selectedSet = new Set(selectedApplicationIds.value)
  return selectableApplicationIds.value.every((id) => selectedSet.has(id))
})

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const resetPreviewState = () => {
  isPreviewOpen.value = false
  previewTitle.value = ''
  previewContent.value = ''
  previewType.value = 'cv'
  previewCvId.value = null
  previewApplicationId.value = null
  isPreviewLoading.value = false
  previewError.value = ''
  previewDownloadUrl.value = ''
  previewDownloadFileName.value = ''
}

const loadJobDictionary = async () => {
  const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
    headers: {
      ...getAuthHeaders(),
    },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '讀取職位字典失敗')
  jobDictionary.value = data.dictionary || {}
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
    if (!response.ok) throw new Error(data.message || '讀取投遞列表失敗')
    applications.value = Array.isArray(data.applications) ? data.applications : []
    const allowed = new Set(selectableApplicationIds.value)
    selectedApplicationIds.value = selectedApplicationIds.value.filter((id) => allowed.has(id))
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
  const firstJobKey = sortedDictionaryEntries.value[0]?.[0] || ''
  jobPostForm.value = {
    title: '',
    jobKey: firstJobKey,
    status: 'open',
  }
  message.value = ''
}

const saveJobPost = async () => {
  const payload = {
    title: String(jobPostForm.value.title || '').trim(),
    status: String(jobPostForm.value.status || 'open').trim(),
  }
  if (isCreatingJobPost.value) payload.jobKey = String(jobPostForm.value.jobKey || '').trim()

  if (!payload.title) {
    message.value = '請先填寫職位標題'
    return
  }
  if (isCreatingJobPost.value && !payload.jobKey) {
    message.value = '請先選擇對應職位'
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

const openPreview = async (row, type) => {
  if (!row?.cvId) return

  isPreviewOpen.value = true
  isPreviewLoading.value = true
  previewError.value = ''
  previewContent.value = ''
  previewType.value = type === 'extracted' ? 'extracted' : 'cv'
  previewCvId.value = Number(row.cvId)
  previewApplicationId.value = Number(row.applicationId || 0) || null
  previewDownloadUrl.value = type === 'cv' ? `${apiBaseUrl}/api/candidate-cvs/${row.cvId}/download` : ''
  previewDownloadFileName.value = type === 'cv' ? String(row.cvFileName || '') : ''
  previewTitle.value = type === 'extracted'
    ? `CV 提取檔案預覽 - ${row.extractedFileName || row.cvFileName}`
    : `CV 檔案預覽 - ${row.cvFileName}`

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
  if (!selectedJobPost.value?.id) return
  try {
    await loadApplications(selectedJobPost.value.id)
    message.value = 'CV 提取資料已更新'
  } catch {
    message.value = 'CV 提取資料更新後刷新列表失敗'
  }
}

const toggleRowSelection = (applicationId, checked) => {
  const id = Number(applicationId)
  if (!Number.isInteger(id) || id <= 0) return

  if (checked) {
    if (!selectedApplicationIds.value.includes(id)) {
      selectedApplicationIds.value = [...selectedApplicationIds.value, id]
    }
    return
  }

  selectedApplicationIds.value = selectedApplicationIds.value.filter((value) => value !== id)
}

const toggleSelectAll = (checked) => {
  if (checked) {
    selectedApplicationIds.value = [...selectableApplicationIds.value]
    return
  }
  selectedApplicationIds.value = []
}

const deleteSelectedApplications = async () => {
  if (!selectedApplicationIds.value.length || isBulkDeleting.value) return
  const selectedSet = new Set(selectedApplicationIds.value)
  const selectedNames = filteredApplications.value
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
  if (isCreatingJobPost.value && !jobDictionary.value[jobPostForm.value.jobKey]) {
    jobPostForm.value.jobKey = sortedDictionaryEntries.value[0]?.[0] || ''
  }
  await loadJobPosts()
}

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
          <p>建立職位時，對應職位資料來自 `finance-job-positions.json`，之後可查看該職位下的候選人投遞資料。</p>
        </div>
      </div>
      <p v-if="message" class="message">{{ message }}</p>
    </header>

    <div class="top-grid">
      <section class="card job-post-list-card">
        <div class="card-header">
          <h3>職位列表</h3>
          <span class="count-chip">{{ jobPosts.length }}</span>
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
            <button type="button" class="secondary-btn" @click="beginCreateJobPost">新增職位</button>
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
            <input v-model.trim="jobPostForm.title" type="text" placeholder="例如：澳門零售銀行客戶經理" />
          </label>

          <label class="field">
            <span>對應職位</span>
            <select v-model="jobPostForm.jobKey" :disabled="!isCreatingJobPost">
              <option v-for="[jobKey, job] in sortedDictionaryEntries" :key="jobKey" :value="jobKey">
                {{ job.title }} ({{ jobKey }})
              </option>
            </select>
          </label>

          <label class="field">
            <span>狀態</span>
            <select v-model="jobPostForm.status">
              <option value="open">開放中</option>
              <option value="draft">草稿</option>
              <option value="closed">已關閉</option>
            </select>
          </label>
        </div>

        <p class="hint">職位資料會在建立時固化成快照，之後字典更新不會影響已建立的職位。</p>

        <div v-if="!isCreatingJobPost && selectedJobPost?.jobSnapshot" class="snapshot-box">
          <h4>目前快照</h4>
          <p><strong>匹配職位：</strong>{{ selectedJobPost.jobSnapshot.title || '--' }}</p>
          <p><strong>核心職責：</strong>{{ (selectedJobPost.jobSnapshot.coreResponsibilities || []).join('、') || '--' }}</p>
          <p><strong>必備能力：</strong>{{ (selectedJobPost.jobSnapshot.requiredSkills || []).join('、') || '--' }}</p>
        </div>

        <section class="card applications-card">
          <div class="card-header">
            <div>
              <h3>目前職位投遞清單</h3>
              <p class="subtle">{{ selectedJobPost?.title || '請先選擇職位' }}</p>
            </div>
            <div class="table-search-wrap">
              <input
                v-model.trim="applicationSearch"
                type="text"
                class="search-input"
                placeholder="搜尋候選人 / 期望職位 / 匹配結果 / 電話 / 檔案"
              />
            </div>
            <div class="table-actions">
              <label class="select-all">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :disabled="!selectableApplicationIds.length"
                  @change="toggleSelectAll($event.target.checked)"
                />
                <span>全選</span>
              </label>
              <button
                type="button"
                class="danger-btn"
                :disabled="!selectedCount || isBulkDeleting"
                @click="deleteSelectedApplications"
              >
                {{ isBulkDeleting ? '刪除中...' : `刪除已選擇（${selectedCount}）` }}
              </button>
            </div>
          </div>

          <p v-if="isApplicationsLoading" class="hint">投遞清單讀取中...</p>
          <div v-else class="table-wrap">
            <table class="application-table">
              <thead>
                <tr>
                  <th></th>
                  <th>候選人名稱</th>
                  <th>期望職位</th>
                  <th>匹配職位</th>
                  <th>電話</th>
                  <th>CV 檔案</th>
                  <th>CV 提取檔案</th>
                  <th>投遞時間</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!filteredApplications.length">
                  <td colspan="8" class="empty-cell">尚無投遞資料</td>
                </tr>
                <tr v-for="row in filteredApplications" :key="row.applicationId">
                  <td>
                    <label class="row-check">
                      <input
                        type="checkbox"
                        :checked="selectedApplicationIds.includes(Number(row.applicationId))"
                        @change="toggleRowSelection(row.applicationId, $event.target.checked)"
                      />
                    </label>
                  </td>
                  <td>{{ row.fullName || '--' }}</td>
                  <td>{{ row.targetPosition || '--' }}</td>
                  <td>
                    <template v-if="row.matchedPosition">
                      <span>{{ row.matchedPosition }}</span>
                      <span class="match-score" :class="getMatchScoreTone(row.matchedScore)">
                        {{ row.matchedScore || 0 }}
                      </span>
                    </template>
                    <span v-else>--</span>
                  </td>
                  <td>{{ row.phone || '--' }}</td>
                  <td class="file-column">
                    <button v-if="row.cvFileName" type="button" class="link-btn file-link" @click="openPreview(row, 'cv')">
                      {{ row.cvFileName }}
                    </button>
                    <span v-else>--</span>
                  </td>
                  <td class="file-column">
                    <button
                      v-if="row.extractedFileName"
                      type="button"
                      class="link-btn file-link"
                      @click="openPreview(row, 'extracted')"
                    >
                      {{ row.extractedFileName }}
                    </button>
                    <span v-else>--</span>
                  </td>
                  <td>{{ formatDateTime(row.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>

    <JobDictionaryPanel @updated="handleDictionaryUpdated" />

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
      @close="resetPreviewState"
      @updated="handlePreviewUpdated"
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
.form-header-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
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

.form-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.snapshot-box {
  gap: 0.5rem;
  padding: 1.1rem 1.15rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(244, 248, 252, 0.92));
}

.applications-card {
  margin-top: 0.25rem;
  min-width: 0;
}

.applications-card .card-header,
.job-post-form-card > .card-header {
  flex-wrap: wrap;
}

.applications-card .card-header > *,
.job-post-form-card > .card-header > * {
  min-width: 0;
}

.table-search-wrap {
  flex: 1 1 320px;
  width: min(420px, 100%);
  min-width: min(320px, 100%);
}

.table-search-wrap .search-input {
  width: 100%;
}

.table-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  flex: 0 1 auto;
  flex-wrap: wrap;
  min-width: 0;
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-base);
  white-space: nowrap;
}

.row-check input,
.select-all input {
  width: 16px;
  height: 16px;
}

.applications-card :deep(thead th:first-child),
.applications-card :deep(tbody td:first-child) {
  width: 48px;
}

.table-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.application-table {
  table-layout: fixed;
}

.application-table th,
.application-table td {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.application-table th:nth-child(5),
.application-table td:nth-child(5) {
  width: 140px;
}

.application-table th:nth-child(6),
.application-table td:nth-child(6),
.application-table th:nth-child(7),
.application-table td:nth-child(7) {
  width: 190px;
  max-width: 190px;
}

.application-table th:nth-child(8),
.application-table td:nth-child(8) {
  width: 168px;
}

.file-column {
  min-width: 0;
  max-width: 190px;
}

.file-link {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

@media (max-width: 1100px) {
  .top-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .header-main,
  .card-header,
  .table-actions,
  .form-header-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .table-search-wrap {
    width: 100%;
    min-width: 0;
  }
}
</style>
