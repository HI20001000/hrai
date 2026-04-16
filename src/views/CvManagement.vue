<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import CandidateApplicationsTable from '../components/candidate/CandidateApplicationsTable.vue'

const message = ref('')
const applicationRows = ref([])
const isLoading = ref(false)

const loadApplicationTable = async () => {
  isLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/table`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取候選人管理清單失敗')
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

const handleTableNotify = ({ message: nextMessage }) => {
  message.value = nextMessage || ''
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
      title="候選人清單"
      empty-text="尚無候選人資料"
      search-placeholder="搜尋職位 / 候選人 / 狀態 / 期望職位 / 匹配職位 / 電話 / 備註 / 檔案"
      @rows-updated="handleApplicationsUpdated"
      @notify="handleTableNotify"
    />
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

@media (max-width: 720px) {
  .header-main {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
