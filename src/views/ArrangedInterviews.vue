<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import { handleUnauthorizedResponse, requireAuthToken, withAuthHeaders } from '../scripts/authState.js'
import { normalizeSearchText } from '../scripts/searchNormalize.js'
import AppSelect from '../components/AppSelect.vue'
import {
  INTERVIEW_STATUS_OPTIONS,
  getCandidateApplicationStatusLabel,
  getInterviewDurationLabel,
  getInterviewLocationLabel,
  getInterviewStatusLabel,
  normalizeInterviewStatus,
} from '../scripts/candidateApplicationStatus.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const interviews = ref([])
const isLoading = ref(false)
const message = ref('')
const searchKeyword = ref('')
const statusFilter = ref('')
const savingIds = ref([])

const pad = (number) => String(number).padStart(2, '0')

const parseDateTime = (value) => {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDateTime = (value) => {
  const date = parseDateTime(value)
  if (!date) return value || '--'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatTimeRange = (interview) => {
  const start = parseDateTime(interview?.scheduledAt)
  if (!start) return '--'
  const minutes = Number(interview?.durationMinutes || 30) || 30
  const end = new Date(start.getTime() + minutes * 60000)
  return `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`
}

const getUserName = (user) => String(user?.username || user?.email || user?.mail || '').trim() || '--'

const isSaving = (applicationId) => savingIds.value.includes(Number(applicationId))

const canEditInterviewStatus = computed(() => String(props.currentUser?.role || '').trim() !== 'viewer')

const statusOptions = computed(() => [{ value: '', label: '全部' }, ...INTERVIEW_STATUS_OPTIONS])

const filteredInterviews = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  const status = normalizeInterviewStatus(statusFilter.value, '')
  return interviews.value.filter((row) => {
    const interview = row.interview || {}
    if (status && interview.status !== status) return false
    if (!keyword) return true

    const haystack = normalizeSearchText([
      row.fullName,
      row.jobPostTitle,
      row.source,
      row.applicationStatus,
      getCandidateApplicationStatusLabel(row.applicationStatus),
      getInterviewStatusLabel(interview.status),
      getInterviewLocationLabel(interview.location),
      getUserName(interview.interviewerUser),
      getUserName(row.ownerUser),
      formatDateTime(interview.scheduledAt),
      formatTimeRange(interview),
    ].join(' '))
    return haystack.includes(keyword)
  })
})

const loadInterviews = async () => {
  isLoading.value = true
  message.value = ''
  try {
    if (!requireAuthToken()) throw new Error('登入已失效，請重新登入')
    const response = await fetch(`${apiBaseUrl}/api/interviews/arranged`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取安排面試失敗')
    interviews.value = Array.isArray(data.interviews) ? data.interviews : []
  } catch (error) {
    message.value = error?.message || '讀取安排面試失敗'
  } finally {
    isLoading.value = false
  }
}

const updateInterviewStatus = async (row, nextValue) => {
  const applicationId = Number(row?.applicationId || 0)
  const nextStatus = normalizeInterviewStatus(nextValue, '')
  const currentStatus = normalizeInterviewStatus(row?.interview?.status, '')
  if (!applicationId || !nextStatus || nextStatus === currentStatus || isSaving(applicationId)) return

  savingIds.value = [...savingIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/interview-status`, {
      method: 'PATCH',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: nextStatus }),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '更新面試結果失敗')

    interviews.value = interviews.value.map((item) =>
      Number(item.applicationId) === applicationId
        ? { ...item, interview: { ...(item.interview || {}), status: nextStatus } }
        : item
    )
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    window.dispatchEvent(new CustomEvent('hrai-interviews-updated'))
    message.value = `已更新 ${row.fullName || '候選人'} 的面試結果`
  } catch (error) {
    message.value = error?.message || '更新面試結果失敗'
  } finally {
    savingIds.value = savingIds.value.filter((id) => id !== applicationId)
  }
}

onMounted(loadInterviews)
</script>

<template>
  <section class="arranged-page">
    <header class="page-header">
      <div>
        <h2>安排面試</h2>
        <p>集中查看全系統已安排面試，並直接更新面試結果。</p>
      </div>
      <button type="button" class="secondary-btn" :disabled="isLoading" @click="loadInterviews">
        {{ isLoading ? '刷新中...' : '刷新' }}
      </button>
    </header>

    <p v-if="message" class="message">{{ message }}</p>

    <section class="interview-card">
      <header class="table-tools">
        <div>
          <h3>面試安排表格</h3>
          <p>目前顯示 {{ filteredInterviews.length }} / {{ interviews.length }} 場面試</p>
        </div>
        <div class="tool-controls">
          <input
            v-model.trim="searchKeyword"
            type="search"
            placeholder="搜尋候選人 / 職位 / 來源 / 面試官 / 對接人"
            autocomplete="off"
          />
          <AppSelect
            class="status-filter"
            :model-value="statusFilter"
            :options="statusOptions"
            placeholder="面試結果"
            @update:model-value="statusFilter = $event"
          />
        </div>
      </header>

      <div class="table-wrap">
        <table class="interview-table">
          <thead>
            <tr>
              <th>候選人</th>
              <th>職位</th>
              <th>招聘來源</th>
              <th>面試時間</th>
              <th>區間</th>
              <th>時長</th>
              <th>面試官</th>
              <th>地點</th>
              <th>對接人</th>
              <th>候選人狀態</th>
              <th>面試結果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredInterviews" :key="row.applicationId">
              <td>{{ row.fullName || '--' }}</td>
              <td>{{ row.jobPostTitle || '--' }}</td>
              <td>{{ row.source || '--' }}</td>
              <td>{{ formatDateTime(row.interview?.scheduledAt) }}</td>
              <td>{{ formatTimeRange(row.interview) }}</td>
              <td>{{ getInterviewDurationLabel(row.interview?.durationMinutes) }}</td>
              <td>{{ getUserName(row.interview?.interviewerUser) }}</td>
              <td>{{ getInterviewLocationLabel(row.interview?.location) || '--' }}</td>
              <td>{{ getUserName(row.ownerUser) }}</td>
              <td>
                <span class="status-chip">{{ getCandidateApplicationStatusLabel(row.applicationStatus) }}</span>
              </td>
              <td class="result-cell">
                <AppSelect
                  :model-value="row.interview?.status"
                  :options="INTERVIEW_STATUS_OPTIONS"
                  :disabled="!canEditInterviewStatus || isSaving(row.applicationId)"
                  @update:model-value="updateInterviewStatus(row, $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!isLoading && !filteredInterviews.length" class="empty-state">
        暫無符合條件的安排面試。
      </p>
    </section>
  </section>
</template>

<style scoped>
.arranged-page {
  display: grid;
  gap: 1rem;
}

.page-header,
.table-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.page-header h2,
.table-tools h3 {
  margin: 0;
  color: var(--text-strong);
}

.page-header p,
.table-tools p,
.empty-state {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
}

.message {
  margin: 0;
  color: #b45309;
  font-weight: 700;
}

.interview-card {
  display: grid;
  gap: 1rem;
  min-width: 0;
  padding: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-sm);
}

.tool-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.tool-controls input {
  width: min(360px, 42vw);
  min-height: 42px;
  padding: 0.65rem 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  color: var(--text-base);
  font: inherit;
}

.status-filter {
  width: 150px;
}

.table-wrap {
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
}

.interview-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  background: #fff;
}

.interview-table th,
.interview-table td {
  padding: 0.78rem 0.85rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  color: var(--text-base);
  font-size: 0.86rem;
  text-align: left;
  white-space: nowrap;
}

.interview-table th {
  background: #f8fafc;
  color: var(--text-muted);
  font-weight: 800;
}

.result-cell {
  min-width: 148px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.12);
  color: #2f6fed;
  font-weight: 800;
}

.empty-state {
  padding: 1rem;
  text-align: center;
}

@media (max-width: 900px) {
  .page-header,
  .table-tools,
  .tool-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .tool-controls input,
  .status-filter {
    width: 100%;
  }
}
</style>
