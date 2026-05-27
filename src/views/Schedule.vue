<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import { handleUnauthorizedResponse, requireAuthToken, withAuthHeaders } from '../scripts/authState.js'
import AppSelect from '../components/AppSelect.vue'
import CandidateApplicationsTable from '../components/candidate/CandidateApplicationsTable.vue'
import {
  getInterviewLocationLabel,
  getInterviewStatusLabel,
  normalizeCandidateApplicationStatus,
  normalizeInterviewStatus,
} from '../scripts/candidateApplicationStatus.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const scheduleData = ref({
  month: '',
  stats: {},
  relatedApplications: [],
  events: [],
  tasksByDate: {},
})
const isLoading = ref(false)
const message = ref('')
const currentMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const selectedDateKey = ref('')
const selectedUserId = ref('')
const userOptions = ref([])
const isRelatedModalOpen = ref(false)
const activeRelatedFilter = ref('total')

const pad = (number) => String(number).padStart(2, '0')

const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const monthKey = computed(() => `${currentMonth.value.getFullYear()}-${pad(currentMonth.value.getMonth() + 1)}`)

const monthTitle = computed(() => `${currentMonth.value.getFullYear()}年 ${currentMonth.value.getMonth() + 1}月`)

const isAdminUser = computed(() => String(props.currentUser?.role || '').trim() === 'admin')

const scheduleUserOptions = computed(() => {
  const options = userOptions.value.map((user) => ({
    value: String(user.id),
    label: user.username || user.email || `用戶 #${user.id}`,
  }))
  const currentId = String(props.currentUser?.id || '')
  if (currentId && !options.some((option) => option.value === currentId)) {
    options.unshift({
      value: currentId,
      label: props.currentUser?.username || props.currentUser?.mail || props.currentUser?.email || '目前用戶',
    })
  }
  return options
})

const formatTime = (value) => {
  if (!value) return '--'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16) || '--'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatTimeRange = (interview) => {
  const start = new Date(String(interview?.scheduledAt || '').replace(' ', 'T'))
  if (Number.isNaN(start.getTime())) return '--'
  const minutes = Number(interview?.durationMinutes || 30) || 30
  const end = new Date(start.getTime() + minutes * 60000)
  return `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`
}

const getUserName = (user) => String(user?.username || user?.email || user?.mail || '').trim() || '--'

const getInterview = (row) => row?.interview || {}

const getTaskStatusClass = (status) => `interview-${String(status || 'not_started').trim() || 'not_started'}`

const selectedDateTasks = computed(() => {
  const key = selectedDateKey.value
  return Array.isArray(scheduleData.value.tasksByDate?.[key]) ? scheduleData.value.tasksByDate[key] : []
})

const selectedDateTitle = computed(() => {
  if (!selectedDateKey.value) return '未選擇日期'
  const date = new Date(`${selectedDateKey.value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return selectedDateKey.value
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
})

const calendarDays = computed(() => {
  const start = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth(), 1)
  const firstWeekday = start.getDay()
  const gridStart = new Date(start)
  gridStart.setDate(start.getDate() - firstWeekday)
  const todayKey = toDateKey(new Date())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const key = toDateKey(date)
    const tasks = Array.isArray(scheduleData.value.tasksByDate?.[key]) ? scheduleData.value.tasksByDate[key] : []
    return {
      key,
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === currentMonth.value.getMonth(),
      isSelected: key === selectedDateKey.value,
      isToday: key === toDateKey(new Date()),
      isPast: key < todayKey,
      tasks,
    }
  })
})

const statusCards = computed(() => {
  const rows = Array.isArray(scheduleData.value.relatedApplications)
    ? scheduleData.value.relatedApplications
    : []
  const getApplicationStatus = (row) => normalizeCandidateApplicationStatus(row?.applicationStatus, '')
  const getNormalizedInterviewStatus = (row) => normalizeInterviewStatus(getInterview(row).status, '')
  const hasScheduledTime = (row) => Boolean(getInterview(row).scheduledAt)
  const countInterviewRows = (applicationStatus, interviewStatus = '') =>
    rows.filter((row) => {
      if (!hasScheduledTime(row)) return false
      if (applicationStatus && getApplicationStatus(row) !== applicationStatus) return false
      if (interviewStatus && getNormalizedInterviewStatus(row) !== interviewStatus) return false
      return true
    }).length
  const buildLifecycleStats = (applicationStatus) => [
    { key: 'not_started', label: '未開始', value: countInterviewRows(applicationStatus, 'not_started') },
    { key: 'in_progress', label: '進行中', value: countInterviewRows(applicationStatus, 'in_progress') },
    { key: 'ended', label: '已結束', value: countInterviewRows(applicationStatus, 'ended') },
  ]

  return [
    {
      key: 'total',
      label: '與我相關',
      value: rows.length,
      description: '對接人或面試官為我的所有候選人',
      tone: 'neutral',
    },
    {
      key: 'hrInterview',
      label: 'HR面試',
      value: countInterviewRows('hr_interview'),
      description: '候選人狀態為 HR面試',
      metrics: buildLifecycleStats('hr_interview'),
      tone: 'neutral',
    },
    {
      key: 'departmentInterview',
      label: '部門面試',
      value: countInterviewRows('department_interview'),
      description: '候選人狀態為 部門面試',
      metrics: buildLifecycleStats('department_interview'),
      tone: 'neutral',
    },
    {
      key: 'passed',
      label: '通過',
      value: rows.filter((row) => hasScheduledTime(row) && getNormalizedInterviewStatus(row) === 'passed').length,
      description: '面試結果為通過',
      tone: 'success',
    },
    {
      key: 'failed',
      label: '不通過',
      value: rows.filter((row) => hasScheduledTime(row) && getNormalizedInterviewStatus(row) === 'failed').length,
      description: '面試結果為不通過',
      tone: 'danger',
    },
  ]
})

const activeStatusCard = computed(
  () => statusCards.value.find((card) => card.key === activeRelatedFilter.value) || statusCards.value[0]
)

const filteredRelatedApplications = computed(() => {
  const rows = Array.isArray(scheduleData.value.relatedApplications)
    ? scheduleData.value.relatedApplications
    : []

  return rows.filter((row) => {
    const interview = getInterview(row)
    const hasScheduledTime = Boolean(interview.scheduledAt)
    const interviewStatus = normalizeInterviewStatus(interview.status, '')
    const applicationStatus = normalizeCandidateApplicationStatus(row.applicationStatus, '')

    if (activeRelatedFilter.value === 'total') return true
    if (!hasScheduledTime) return false
    if (activeRelatedFilter.value === 'hrInterview') {
      return applicationStatus === 'hr_interview'
    }
    if (activeRelatedFilter.value === 'departmentInterview') {
      return applicationStatus === 'department_interview'
    }
    if (activeRelatedFilter.value === 'passed') return interviewStatus === 'passed'
    if (activeRelatedFilter.value === 'failed') return interviewStatus === 'failed'
    return true
  })
})

const openRelatedModal = (card) => {
  activeRelatedFilter.value = card?.key || 'total'
  isRelatedModalOpen.value = true
}

const loadSchedule = async () => {
  isLoading.value = true
  message.value = ''
  try {
    if (!requireAuthToken()) throw new Error('登入已失效，請重新登入')
    const params = new URLSearchParams({ month: monthKey.value })
    if (isAdminUser.value && selectedUserId.value) params.set('userId', selectedUserId.value)
    const response = await fetch(`${apiBaseUrl}/api/schedule/interviews?${params.toString()}`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取時間表失敗')
    scheduleData.value = {
      month: data.month || monthKey.value,
      stats: data.stats || {},
      relatedApplications: Array.isArray(data.relatedApplications) ? data.relatedApplications : [],
      events: Array.isArray(data.events) ? data.events : [],
      tasksByDate: data.tasksByDate || {},
    }
    selectedUserId.value = String(data.selectedUserId || selectedUserId.value || props.currentUser?.id || '')
    if (!selectedDateKey.value || !selectedDateKey.value.startsWith(monthKey.value)) {
      selectedDateKey.value = monthKey.value === toDateKey(new Date()).slice(0, 7)
        ? toDateKey(new Date())
        : `${monthKey.value}-01`
    }
  } catch (error) {
    message.value = error?.message || '讀取時間表失敗'
  } finally {
    isLoading.value = false
  }
}

const loadUserOptions = async () => {
  if (!isAdminUser.value) return
  try {
    const response = await fetch(`${apiBaseUrl}/api/users/options`, {
      headers: withAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
    if (!response.ok) throw new Error(data.message || '讀取用戶清單失敗')
    userOptions.value = Array.isArray(data.users) ? data.users : []
  } catch (error) {
    message.value = error?.message || '讀取用戶清單失敗'
    userOptions.value = []
  }
}

const changeMonth = async (offset) => {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + offset, 1)
  selectedDateKey.value = ''
  await loadSchedule()
}

onMounted(loadSchedule)

onMounted(async () => {
  selectedUserId.value = String(props.currentUser?.id || '')
  await loadUserOptions()
})

watch(
  () => props.currentUser?.id,
  (id) => {
    if (!selectedUserId.value) selectedUserId.value = String(id || '')
  }
)

watch(
  () => props.currentUser?.role,
  async (role) => {
    if (String(role || '').trim() === 'admin') {
      if (!selectedUserId.value) selectedUserId.value = String(props.currentUser?.id || '')
      await loadUserOptions()
    }
  }
)

watch(selectedUserId, async (next, previous) => {
  if (!isAdminUser.value || !previous || next === previous) return
  await loadSchedule()
})
</script>

<template>
  <section class="schedule-page">
    <header class="page-header">
      <div>
        <h2>時間表</h2>
        <p>按當前登入用戶匯總對接與面試任務，集中查看本月面試安排。</p>
      </div>
      <div class="header-actions">
        <label v-if="isAdminUser" class="user-switcher">
          <span>檢視用戶</span>
          <AppSelect
            v-model="selectedUserId"
            :options="scheduleUserOptions"
            :disabled="isLoading"
            placeholder="選擇用戶"
          />
        </label>
        <button type="button" class="secondary-btn" :disabled="isLoading" @click="loadSchedule">
          {{ isLoading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </header>

    <p v-if="message" class="message">{{ message }}</p>

    <section class="status-grid" aria-label="面試任務統計">
      <button
        v-for="card in statusCards"
        :key="card.key"
        type="button"
        class="status-card"
        :class="`tone-${card.tone}`"
        @click="openRelatedModal(card)"
      >
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <div v-if="card.metrics?.length" class="status-card-breakdown">
          <span v-for="metric in card.metrics" :key="metric.key">{{ metric.label }} {{ metric.value }}</span>
        </div>
      </button>
    </section>

    <div class="schedule-layout">
      <section class="task-panel">
        <header class="panel-header">
          <div>
            <h3>{{ selectedDateTitle }}</h3>
            <p>{{ selectedDateTasks.length ? `當天共有 ${selectedDateTasks.length} 場面試` : '當天暫無面試安排' }}</p>
          </div>
        </header>

        <div class="task-list">
          <article v-for="task in selectedDateTasks" :key="task.rowId || task.statusHistoryId || task.applicationId" class="task-item">
            <time>{{ formatTime(getInterview(task).scheduledAt) }}</time>
            <div>
              <h4>{{ task.fullName || '候選人' }}｜{{ task.jobPostTitle || '--' }}</h4>
              <p>
                面試官：{{ getUserName(getInterview(task).interviewerUser) }}
                ｜地點：{{ getInterviewLocationLabel(getInterview(task).location) || '--' }}
                ｜狀態：{{ getInterviewStatusLabel(getInterview(task).status) }}
                ｜招聘來源：{{ task.source || '--' }}
              </p>
              <p class="task-meta">
                對接人：{{ getUserName(task.ownerUser) }}｜時間：{{ formatTimeRange(getInterview(task)) }}
              </p>
            </div>
            <span class="task-status" :class="getTaskStatusClass(getInterview(task).status)">
              {{ getInterviewStatusLabel(getInterview(task).status) }}
            </span>
          </article>
          <p v-if="!selectedDateTasks.length" class="empty-state">選擇有標記的日期即可查看面試任務。</p>
        </div>
      </section>

      <section class="calendar-panel">
        <header class="panel-header calendar-header">
          <div>
            <h3>本月行事曆</h3>
            <p>只顯示已填寫面試時間的候選人記錄。</p>
          </div>
          <div class="month-controls">
            <button type="button" class="icon-btn" :disabled="isLoading" @click="changeMonth(-1)">‹</button>
            <strong>{{ monthTitle }}</strong>
            <button type="button" class="icon-btn" :disabled="isLoading" @click="changeMonth(1)">›</button>
          </div>
        </header>

        <div class="calendar-grid">
          <span v-for="week in ['日', '一', '二', '三', '四', '五', '六']" :key="week" class="weekday">{{ week }}</span>
          <button
            v-for="day in calendarDays"
            :key="day.key"
            type="button"
            class="calendar-day"
            :class="{ muted: !day.inMonth, selected: day.isSelected, today: day.isToday, past: day.isPast, 'has-task': day.tasks.length }"
            @click="selectedDateKey = day.key"
          >
            <span>{{ day.day }}</span>
            <em v-if="day.tasks.length">{{ day.tasks.length }} 場面試</em>
          </button>
        </div>
      </section>
    </div>

    <div v-if="isRelatedModalOpen" class="modal-backdrop" @click.self="isRelatedModalOpen = false">
      <div class="modal-panel related-modal">
        <header class="modal-header">
          <div>
            <h3>{{ activeStatusCard.label }}候選人</h3>
            <p class="subtle">
              {{ activeStatusCard.key === 'total' ? '包含對接人為我，或面試官為我的所有候選人。' : activeStatusCard.description }}
              目前顯示 {{ filteredRelatedApplications.length }} 筆。
            </p>
          </div>
          <button type="button" class="ghost-btn" @click="isRelatedModalOpen = false">關閉</button>
        </header>
        <CandidateApplicationsTable
          :title="`${activeStatusCard.label}候選人清單`"
          :rows="filteredRelatedApplications"
          :loading="isLoading"
          :show-job-column="true"
          :show-target-position-column="false"
          :show-phone-column="false"
          :show-owner-filter="true"
          :show-status-filter="true"
          :show-job-filter="true"
          :paginated="true"
          :page-size="12"
          table-max-height="52vh"
          :empty-text="`暫無${activeStatusCard.label}候選人`"
          search-placeholder="搜尋候選人 / 職位 / 對接人 / 面試官 / 面試時間 / 面試狀態"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.schedule-page {
  display: grid;
  gap: 1rem;
}

.page-header,
.panel-header,
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

.user-switcher {
  display: grid;
  gap: 0.25rem;
  min-width: 220px;
}

.user-switcher span {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.page-header h2,
.panel-header h3,
.modal-header h3 {
  margin: 0;
  color: var(--text-strong);
}

.page-header p,
.panel-header p,
.subtle,
.task-item p,
.empty-state {
  margin: 0;
  color: var(--text-muted);
}

.message {
  margin: 0;
  color: #b45309;
  font-weight: 700;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.9rem;
}

.status-card {
  display: grid;
  gap: 0.45rem;
  min-height: 132px;
  padding: 1.15rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 18px;
  background: #fff;
  text-align: left;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}

.status-card strong {
  color: var(--text-strong);
  font-size: 2rem;
}

.status-card span {
  color: var(--text-muted);
  font-weight: 700;
}

.status-card-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.status-card-breakdown span {
  padding: 0.22rem 0.42rem;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-base);
  font-size: 0.76rem;
  font-weight: 800;
}

.status-card.tone-success {
  background: #dcfce7;
}

.status-card.tone-warning,
.status-card.tone-soft {
  background: #fef3c7;
}

.status-card.tone-danger {
  background: #fee2e2;
}

.schedule-layout {
  display: grid;
  grid-template-columns: minmax(300px, 0.95fr) minmax(420px, 1.05fr);
  gap: 1rem;
}

.task-panel,
.calendar-panel {
  min-width: 0;
  padding: 1.1rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: var(--shadow-sm);
}

.task-list {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.task-item {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  gap: 0.85rem;
  align-items: start;
  padding: 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  background: #f8fafc;
}

.task-item h4 {
  margin: 0 0 0.35rem;
  color: var(--text-strong);
}

.task-item time {
  color: #1d4ed8;
  font-weight: 800;
}

.task-meta {
  margin-top: 0.3rem !important;
  font-size: 0.82rem;
}

.task-status {
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
}

.interview-passed {
  background: #dcfce7;
  color: #166534;
}

.interview-not_started {
  background: #e2e8f0;
  color: #475569;
}

.interview-in_progress {
  background: #fef3c7;
  color: #92400e;
}

.interview-ended {
  background: #dbeafe;
  color: #1d4ed8;
}

.interview-failed {
  background: #fee2e2;
  color: #b91c1c;
}

.month-controls {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
}

.icon-btn,
.secondary-btn,
.ghost-btn {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  background: #fff;
  color: var(--text-base);
  font-weight: 800;
  cursor: pointer;
}

.secondary-btn,
.ghost-btn {
  padding: 0.55rem 0.9rem;
}

.icon-btn {
  width: 34px;
  height: 34px;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.45rem;
  margin-top: 1rem;
}

.weekday {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-align: center;
}

.calendar-day {
  display: grid;
  align-content: start;
  gap: 0.5rem;
  min-height: 82px;
  padding: 0.65rem;
  border: 1px solid transparent;
  border-radius: 12px;
  background: none;
  color: var(--text-strong);
  text-align: left;
  cursor: pointer;
}

.calendar-day.muted {
  opacity: 0.38;
}

.calendar-day.today {
  background: #dcfce7;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.35);
}

.calendar-day.selected {
  border-color: #334155;
  background: none;
}

.calendar-day.has-task {
  background: none;
}

.calendar-day.today.selected,
.calendar-day.today.has-task {
  background: #dcfce7;
}

.calendar-day em {
  width: fit-content;
  padding: 0.18rem 0.42rem;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.72rem;
  font-style: normal;
  font-weight: 800;
}

.calendar-day.past em {
  background: #e5e7eb;
  color: #94a3b8;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.42);
}

.modal-panel {
  width: min(1120px, 96vw);
  max-height: 90vh;
  overflow: auto;
  padding: 1rem;
  border-radius: 20px;
  background: #fff;
  box-shadow: var(--shadow-lg);
}

.related-modal {
  display: grid;
  gap: 1rem;
}

@media (max-width: 1180px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .schedule-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .status-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-item {
    grid-template-columns: 1fr;
  }

  .calendar-day {
    min-height: 66px;
    padding: 0.5rem;
  }
}
</style>
