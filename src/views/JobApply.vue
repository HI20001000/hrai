<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import CvUploadFlowPanel from '../components/CvUploadFlowPanel.vue'

const message = ref('')
const jobPosts = ref([])
const selectedJobPost = ref(null)
const searchKeyword = ref('')
const isLoading = ref(false)
const isUploadModalOpen = ref(false)

const normalizeSearchText = (value) => String(value ?? '').trim().toLowerCase()

const filteredJobPosts = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  if (!keyword) return jobPosts.value

  return jobPosts.value.filter((jobPost) => {
    const haystack = [
      jobPost.title,
      jobPost.jobKey,
      jobPost.matchedPosition,
      jobPost.status,
    ]
      .map((item) => normalizeSearchText(item))
      .join(' ')
    return haystack.includes(keyword)
  })
})

const selectedSnapshot = computed(() => selectedJobPost.value?.jobSnapshot || null)

const getStatusLabel = (status) => {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'open') return '開放中'
  if (value === 'draft') return '草稿'
  if (value === 'closed') return '已關閉'
  return status || '--'
}

const loadOpenJobPosts = async () => {
  isLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-posts?status=open`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取開放中的職位失敗')

    jobPosts.value = Array.isArray(data.jobPosts) ? data.jobPosts : []
    if (selectedJobPost.value?.id) {
      const nextSelected = jobPosts.value.find((item) => Number(item.id) === Number(selectedJobPost.value.id))
      selectedJobPost.value = nextSelected || jobPosts.value[0] || null
      return
    }
    selectedJobPost.value = jobPosts.value[0] || null
  } catch {
    message.value = '讀取開放中的職位失敗'
  } finally {
    isLoading.value = false
  }
}

const selectJobPost = async (jobPost) => {
  selectedJobPost.value = jobPost || null
  message.value = ''
  if (!selectedJobPost.value?.id) return

  try {
    const response = await fetch(`${apiBaseUrl}/api/job-posts/${selectedJobPost.value.id}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取職位詳情失敗')
    selectedJobPost.value = data.jobPost || selectedJobPost.value
  } catch {
    message.value = '讀取職位詳情失敗'
  }
}

const openUploadModal = () => {
  if (!selectedJobPost.value?.id) {
    message.value = '請先選擇要投遞的職位'
    return
  }
  isUploadModalOpen.value = true
}

const closeUploadModal = () => {
  isUploadModalOpen.value = false
}

const handleUploadCompleted = async (payload = {}) => {
  if (payload?.mode === 'batch') {
    message.value = `批量投遞完成，成功 ${payload.successCount || 0} 份，失敗 ${payload.errorCount || 0} 份`
    await loadOpenJobPosts()
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    return
  }

  message.value = 'CV 匹配完成，已同步更新到 CV 管理'
  await loadOpenJobPosts()
  window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
}

onMounted(async () => {
  await loadOpenJobPosts()
})
</script>

<template>
  <section class="job-apply-page">
    <header class="page-header">
      <div>
        <h2>候選人CV上傳</h2>
        <p>先挑選一個開放中的職位，再提交單份或多份 CV。系統會依照該職位綁定的金融職位資料逐份完成匹配。</p>
      </div>
      <button type="button" class="primary-btn" :disabled="!selectedJobPost?.id" @click="openUploadModal">
        上傳 CV 到目前職位
      </button>
    </header>

    <p v-if="message" class="message">{{ message }}</p>

    <div class="content-grid">
      <section class="card list-card">
        <div class="card-header">
          <h3>開放中的職位</h3>
          <input
            v-model.trim="searchKeyword"
            type="text"
            class="search-input"
            placeholder="搜尋職位名稱或代碼"
          />
        </div>

        <p v-if="isLoading" class="hint">讀取中...</p>
        <p v-else-if="!filteredJobPosts.length" class="hint">目前沒有開放中的職位</p>
        <div v-else class="job-post-list">
          <button
            v-for="jobPost in filteredJobPosts"
            :key="jobPost.id"
            type="button"
            class="job-post-item"
            :class="{ active: selectedJobPost?.id === jobPost.id }"
            @click="selectJobPost(jobPost)"
          >
            <strong>{{ jobPost.title }}</strong>
            <span>{{ jobPost.matchedPosition || jobPost.jobKey }}</span>
            <small>{{ jobPost.jobKey }}</small>
          </button>
        </div>
      </section>

      <section class="card detail-card">
        <template v-if="selectedJobPost">
          <div class="detail-header">
            <div>
              <h3>{{ selectedJobPost.title }}</h3>
              <p class="subtle">{{ selectedJobPost.jobKey }}</p>
            </div>
            <span class="status-chip">{{ getStatusLabel(selectedJobPost.status) }}</span>
          </div>

          <div v-if="selectedSnapshot" class="snapshot-sections">
            <section class="snapshot-box">
              <h4>職位概覽</h4>
              <p><strong>職位名稱：</strong>{{ selectedSnapshot.title || '--' }}</p>
              <p><strong>描述：</strong>{{ selectedSnapshot.description || '--' }}</p>
              <p><strong>行業：</strong>{{ (selectedSnapshot.industry || []).join('、') || '--' }}</p>
            </section>

            <section class="snapshot-box">
              <h4>核心職責</h4>
              <p>{{ (selectedSnapshot.coreResponsibilities || []).join('、') || '--' }}</p>
            </section>

            <section class="snapshot-box">
              <h4>必備能力</h4>
              <p>{{ (selectedSnapshot.requiredSkills || []).join('、') || '--' }}</p>
            </section>

            <section class="snapshot-box">
              <h4>加分能力與條件</h4>
              <p><strong>加分技能：</strong>{{ (selectedSnapshot.preferredSkills || []).join('、') || '--' }}</p>
              <p><strong>證書：</strong>{{ (selectedSnapshot.certifications || []).join('、') || '--' }}</p>
              <p><strong>最低年資：</strong>{{ selectedSnapshot.minWorkYears || 0 }} 年</p>
            </section>
          </div>
        </template>

        <p v-else class="hint">請先從左側選擇要投遞的職位</p>
      </section>
    </div>

    <div v-if="isUploadModalOpen" class="modal-backdrop" @click.self="closeUploadModal">
      <div class="modal-panel">
        <CvUploadFlowPanel
          :job-post-id="selectedJobPost?.id || null"
          :job-post-title="selectedJobPost?.title || ''"
          @uploaded="handleUploadCompleted"
          @closed="closeUploadModal"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.job-apply-page {
  color: var(--text-base);
  gap: 0.8rem;
}

.page-header,
.card-header,
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.content-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(290px, 360px) minmax(0, 1fr);
}

.list-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.search-input {
  width: min(260px, 100%);
}

.job-post-list,
.snapshot-sections {
  display: grid;
  gap: 0.8rem;
}

.job-post-item {
  display: grid;
  gap: 0.26rem;
  text-align: left;
  padding: 1rem 1.05rem;
  border: 1px solid var(--border-default);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.76);
  cursor: pointer;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.job-post-item:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.job-post-item.active {
  border-color: rgba(47, 111, 237, 0.18);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.1), rgba(255, 255, 255, 0.82));
}

.job-post-item span,
.job-post-item small {
  color: var(--text-muted);
}

.snapshot-box {
  gap: 0.45rem;
  padding: 1.05rem 1.15rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(244, 248, 252, 0.92));
}

.snapshot-box p {
  color: var(--text-base);
  line-height: 1.55;
}

@media (max-width: 1100px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .page-header,
  .card-header,
  .detail-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
