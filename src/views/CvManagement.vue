<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import CandidateTextPreviewModal from '../components/candidate/CandidateTextPreviewModal.vue'

const message = ref('')
const applicationRows = ref([])
const searchKeyword = ref('')
const isLoading = ref(false)

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

const filteredApplicationRows = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  if (!keyword) return applicationRows.value

  return applicationRows.value.filter((row) => {
    const haystack = [
      row.jobPostTitle,
      row.fullName,
      row.targetPosition,
      row.matchedPosition,
      row.phone,
      row.cvFileName,
      row.extractedFileName,
      formatDateTime(row.createdAt),
    ]
      .map((item) => normalizeSearchText(item))
      .join(' ')
    return haystack.includes(keyword)
  })
})

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const loadApplicationTable = async () => {
  isLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/table`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取 CV 管理清單失敗')
    applicationRows.value = Array.isArray(data.applications) ? data.applications : []
  } catch {
    message.value = '初始化資料失敗'
  } finally {
    isLoading.value = false
  }
}

const handleApplicationsUpdated = async () => {
  await loadApplicationTable()
}

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
  try {
    await loadApplicationTable()
    message.value = 'CV 提取資料已更新'
  } catch {
    message.value = 'CV 提取資料更新後刷新列表失敗'
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
  <section class="cv-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>CV 管理</h2>
          <p>這裡集中查看所有職缺下的 CV 投遞與匹配結果。建立職缺請到左側的職缺管理頁面。</p>
        </div>
      </div>
      <p v-if="message" class="message">{{ message }}</p>
    </header>

    <div class="card">
      <div class="card-header">
        <h3>CV 與投遞清單</h3>
        <input
          v-model.trim="searchKeyword"
          type="text"
          class="search-input"
          placeholder="搜尋職缺 / 候選人 / 期望職位 / 匹配結果 / 電話 / 檔案"
        />
      </div>

      <p v-if="isLoading" class="hint">讀取中...</p>
      <div v-else class="table-wrap">
        <table class="candidate-table">
          <thead>
            <tr>
              <th>職缺</th>
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
            <tr v-if="!filteredApplicationRows.length">
              <td colspan="8" class="empty-cell">尚無 CV 投遞資料</td>
            </tr>
            <tr v-for="row in filteredApplicationRows" :key="row.applicationId">
              <td>{{ row.jobPostTitle || '--' }}</td>
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
              <td class="file-column">
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
              <td>{{ formatDateTime(row.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
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
      @close="closePreviewModal"
      @updated="handlePreviewUpdated"
    />
  </section>
</template>

<style scoped>
.cv-page {
  color: var(--text-base);
  gap: 0.8rem;
}

.header-main,
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.search-input {
  width: min(360px, 100%);
}

.candidate-table {
  table-layout: fixed;
}

.candidate-table th:nth-child(6),
.candidate-table td:nth-child(6),
.candidate-table th:nth-child(7),
.candidate-table td:nth-child(7) {
  width: 180px;
  max-width: 180px;
}

.file-column {
  min-width: 0;
  max-width: 180px;
}

.file-link,
.file-link-text {
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

@media (max-width: 720px) {
  .header-main,
  .card-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
