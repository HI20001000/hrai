<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppSelect from '../AppSelect.vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import { handleUnauthorizedResponse, withAuthHeaders } from '../../scripts/authState.js'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  INTERVIEW_DURATION_PRESET_OPTIONS,
  INTERVIEW_LOCATION_OPTIONS,
  INTERVIEW_STATUS_OPTIONS,
  getCandidateApplicationStatusLabel,
  getInterviewDurationLabel,
  getInterviewLocationLabel,
  getInterviewStatusLabel,
  normalizeCandidateApplicationStatus,
  normalizeInterviewDurationMinutes,
  normalizeInterviewLocation,
  normalizeInterviewStatus,
} from '../../scripts/candidateApplicationStatus.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  application: { type: Object, default: null },
  userOptions: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'saved', 'notify'])

const activeApplication = ref(null)
const isLoading = ref(false)
const isSaving = ref(false)
const deletingHistoryIds = ref([])
const errorMessage = ref('')
const editingStatusHistoryId = ref(0)
const statusDraft = ref('')
const remarkDraft = ref('')
const interviewScheduledAtDraft = ref('')
const interviewDurationModeDraft = ref('30')
const interviewDurationMinutesDraft = ref('30')
const interviewerUserIdDraft = ref('')
const interviewLocationDraft = ref('')
const interviewStatusDraft = ref('not_started')
const interviewerAvailability = ref(null)
const interviewerAvailabilityStatus = ref('')
const interviewerAvailabilityMessage = ref('')
let availabilityLoadTimer = null

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

const toDateTimeLocalValue = (value) => {
  const date = parseDateTime(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getCurrentInterviewDateTimeMin = () => {
  const currentMinute = new Date()
  currentMinute.setSeconds(0, 0)
  return toDateTimeLocalValue(currentMinute)
}

const toDateKey = (value) => String(value || '').slice(0, 10)

const getDurationMode = (minutes) => {
  const normalized = normalizeInterviewDurationMinutes(minutes)
  return ['10', '30', '60'].includes(String(normalized)) ? String(normalized) : 'custom'
}

const isBusy = computed(() => isLoading.value || isSaving.value || deletingHistoryIds.value.length > 0)
const isEditingStatusHistory = computed(() => Number(editingStatusHistoryId.value || 0) > 0)
const isInterviewStatusDraft = computed(() =>
  ['hr_interview', 'department_interview'].includes(normalizeCandidateApplicationStatus(statusDraft.value, ''))
)
const selectedInterviewDurationMinutes = computed(() =>
  normalizeInterviewDurationMinutes(interviewDurationMinutesDraft.value)
)

const interviewerOptions = computed(() => [
  { value: '', label: '未指定' },
  ...props.userOptions.map((user) => ({
    value: String(user.id),
    label: user.username || user.email || `用戶 #${user.id}`,
    avatarText: user.avatarText || String(user.username || user.email || 'U').slice(0, 1).toUpperCase(),
    avatarBgColor: user.avatarBgColor || '#64748b',
  })),
])

const activeStatusHistory = computed(() => {
  const history = Array.isArray(activeApplication.value?.statusHistory)
    ? activeApplication.value.statusHistory
    : []
  return history
    .filter((item) => normalizeCandidateApplicationStatus(item?.applicationStatus, ''))
    .sort((left, right) => {
      const leftTime = Date.parse(String(left?.updatedAt || left?.createdAt || ''))
      const rightTime = Date.parse(String(right?.updatedAt || right?.createdAt || ''))
      const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : 0
      const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : 0
      if (normalizedRightTime !== normalizedLeftTime) return normalizedRightTime - normalizedLeftTime
      return Number(right?.id || 0) - Number(left?.id || 0)
    })
})

const selectedStatusHistory = computed(() =>
  activeStatusHistory.value.find((history) => Number(history.id || 0) === Number(editingStatusHistoryId.value || 0)) || null
)

const selectedInterviewEndTime = computed(() => {
  const start = parseDateTime(interviewScheduledAtDraft.value)
  if (!start) return ''
  const end = new Date(start.getTime() + selectedInterviewDurationMinutes.value * 60000)
  return toDateTimeLocalValue(end)
})

const availabilityDateLabel = computed(() => {
  const dateKey = toDateKey(interviewScheduledAtDraft.value)
  return dateKey ? `${dateKey} 空閒時段` : ''
})

const availabilityTimelineItems = computed(() => {
  const items = Array.isArray(interviewerAvailability.value?.items) ? interviewerAvailability.value.items : []
  if (!interviewScheduledAtDraft.value || !isInterviewStatusDraft.value) return items
  const start = interviewScheduledAtDraft.value
  const end = selectedInterviewEndTime.value
  return [
    {
      type: 'preview',
      start,
      end,
      durationMinutes: selectedInterviewDurationMinutes.value,
      fullName: activeApplication.value?.fullName,
      jobPostTitle: activeApplication.value?.jobPostTitle,
    },
    ...items,
  ].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
})

const getUserName = (user) => String(user?.username || user?.email || user?.mail || '').trim() || '--'
const getInterviewUserName = (interview) => getUserName(interview?.interviewerUser)

const getInterviewSummaryText = (interview = {}) => {
  const parts = []
  if (interview.scheduledAt) parts.push(formatDateTime(interview.scheduledAt))
  if (interview.durationMinutes) parts.push(getInterviewDurationLabel(interview.durationMinutes))
  if (interview.location) parts.push(getInterviewLocationLabel(interview.location))
  const interviewerName = getInterviewUserName(interview)
  if (interviewerName && interviewerName !== '--') parts.push(`面試官：${interviewerName}`)
  if (interview.status) parts.push(getInterviewStatusLabel(interview.status))
  return parts.filter(Boolean).join('｜')
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
  const color = String(getStatusHistoryOperator(history)?.avatarBgColor || '').trim()
  return { background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#64748b' }
}

const fetchJson = async (endpoint, options = {}) => {
  const response = await fetch(endpoint, {
    ...options,
    headers: withAuthHeaders(options.headers || {}),
  })
  const data = await response.json().catch(() => ({}))
  if (handleUnauthorizedResponse(response)) throw new Error('登入已失效，請重新登入')
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
}

const applyInterviewDurationDraft = (minutes) => {
  const normalized = normalizeInterviewDurationMinutes(minutes)
  interviewDurationMinutesDraft.value = String(normalized)
  interviewDurationModeDraft.value = getDurationMode(normalized)
}

const resetStatusDraftFields = () => {
  statusDraft.value = ''
  remarkDraft.value = ''
  interviewScheduledAtDraft.value = ''
  applyInterviewDurationDraft(30)
  interviewerUserIdDraft.value = ''
  interviewLocationDraft.value = ''
  interviewStatusDraft.value = 'not_started'
}

const fillDraftFromSource = (source = {}) => {
  const interview = source?.interview || {}
  statusDraft.value = normalizeCandidateApplicationStatus(source?.applicationStatus, '')
  remarkDraft.value = String(source?.remark || '')
  interviewScheduledAtDraft.value = toDateTimeLocalValue(interview.scheduledAt) || getCurrentInterviewDateTimeMin()
  applyInterviewDurationDraft(interview.durationMinutes || 30)
  interviewerUserIdDraft.value = String(interview.interviewerUser?.id || '')
  interviewLocationDraft.value = normalizeInterviewLocation(interview.location, '')
  interviewStatusDraft.value = normalizeInterviewStatus(interview.status)
}

const startNewStatusHistoryDraft = () => {
  editingStatusHistoryId.value = 0
  resetStatusDraftFields()
}

const editStatusHistoryDraft = (history, { allowToggle = true } = {}) => {
  const historyId = Number(history?.id || 0)
  if (!historyId || isBusy.value) return
  if (allowToggle && Number(editingStatusHistoryId.value || 0) === historyId) {
    startNewStatusHistoryDraft()
    return
  }
  editingStatusHistoryId.value = historyId
  fillDraftFromSource(history)
}

const editCurrentStatusHistoryDraft = () => {
  const latestHistory = activeStatusHistory.value[0] || null
  if (!latestHistory?.id) {
    resetStatusDraftFields()
    return
  }
  editStatusHistoryDraft(latestHistory, { allowToggle: false })
}

const loadApplicationDetail = async () => {
  const applicationId = Number(props.application?.applicationId || 0)
  resetStatusDraftFields()
  if (!applicationId) return
  isLoading.value = true
  errorMessage.value = ''
  activeApplication.value = props.application
  try {
    const data = await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}`)
    activeApplication.value = {
      ...props.application,
      ...(data.application || {}),
      statusHistory: Array.isArray(data.application?.statusHistory)
        ? data.application.statusHistory
        : props.application?.statusHistory,
    }
    editCurrentStatusHistoryDraft()
  } catch (error) {
    errorMessage.value = error?.message || '讀取候選人狀態失敗'
    editCurrentStatusHistoryDraft()
  } finally {
    isLoading.value = false
  }
}

const closeModal = () => {
  if (isBusy.value) return
  emit('update:modelValue', false)
}

const resetModalState = () => {
  activeApplication.value = null
  errorMessage.value = ''
  editingStatusHistoryId.value = 0
  resetStatusDraftFields()
  interviewerAvailability.value = null
  interviewerAvailabilityStatus.value = ''
  interviewerAvailabilityMessage.value = ''
  clearAvailabilityLoadTimer()
}

const handleDurationModeChange = (value) => {
  const mode = String(value || '').trim()
  interviewDurationModeDraft.value = mode
  if (mode !== 'custom') interviewDurationMinutesDraft.value = String(normalizeInterviewDurationMinutes(mode))
}

const validateRequiredInterviewFields = () => {
  if (!isInterviewStatusDraft.value) return true
  const missing = []
  if (!interviewerUserIdDraft.value) missing.push('面試官')
  if (!interviewScheduledAtDraft.value) missing.push('面試時間')
  if (!interviewLocationDraft.value) missing.push('面試地點')
  if (!missing.length) return true
  const nextMessage = `請先填寫：${missing.join('、')}`
  errorMessage.value = nextMessage
  window.alert(nextMessage)
  return false
}

const saveStatusHistory = async () => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const nextStatus = normalizeCandidateApplicationStatus(statusDraft.value, '')
  if (!applicationId || !nextStatus || !validateRequiredInterviewFields()) return

  const historyId = Number(editingStatusHistoryId.value || 0)
  const interviewPayload = isInterviewStatusDraft.value
    ? {
        scheduledAt: interviewScheduledAtDraft.value || '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: interviewerUserIdDraft.value || '',
        location: interviewLocationDraft.value || '',
        status: normalizeInterviewStatus(interviewStatusDraft.value),
      }
    : {
        scheduledAt: '',
        durationMinutes: selectedInterviewDurationMinutes.value,
        interviewerUserId: '',
        location: '',
        status: 'not_started',
      }

  isSaving.value = true
  errorMessage.value = ''
  try {
    const data = await fetchJson(
      historyId
        ? `${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history/${historyId}`
        : `${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history`,
      {
        method: historyId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationStatus: nextStatus,
          firstInterviewArrangement: '',
          interview: interviewPayload,
          remark: String(remarkDraft.value || '').trim(),
        }),
      }
    )
    const nextMessage = data?.statusRule?.message || (historyId ? '已更新狀態記錄' : '已新增狀態記錄')
    emit('notify', nextMessage)
    emit('saved', { message: nextMessage, applicationId, historyId: Number(data?.history?.id || historyId || 0) })
    await loadApplicationDetail()
  } catch (error) {
    errorMessage.value = error?.message || '保存狀態記錄失敗'
  } finally {
    isSaving.value = false
  }
}

const isStatusHistoryDeleting = (historyId) => deletingHistoryIds.value.includes(Number(historyId || 0))

const deleteStatusHistory = async (history) => {
  const applicationId = Number(activeApplication.value?.applicationId || 0)
  const historyId = Number(history?.id || 0)
  if (!applicationId || !historyId || isBusy.value) return
  if (!window.confirm('確認刪除此狀態記錄？')) return

  deletingHistoryIds.value = [...deletingHistoryIds.value, historyId]
  try {
    await fetchJson(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status-history/${historyId}`, {
      method: 'DELETE',
    })
    emit('notify', '已刪除狀態記錄')
    emit('saved', { message: '已刪除狀態記錄', applicationId, deletedHistoryId: historyId })
    await loadApplicationDetail()
  } catch (error) {
    errorMessage.value = error?.message || '刪除狀態記錄失敗'
  } finally {
    deletingHistoryIds.value = deletingHistoryIds.value.filter((id) => id !== historyId)
  }
}

const clearAvailabilityLoadTimer = () => {
  if (availabilityLoadTimer) {
    window.clearTimeout(availabilityLoadTimer)
    availabilityLoadTimer = null
  }
}

const loadInterviewerAvailability = async () => {
  const interviewerUserId = Number(interviewerUserIdDraft.value || 0)
  const dateKey = toDateKey(interviewScheduledAtDraft.value)
  if (!props.modelValue || !isInterviewStatusDraft.value || !interviewerUserId || !dateKey) {
    interviewerAvailability.value = null
    interviewerAvailabilityStatus.value = ''
    interviewerAvailabilityMessage.value = !isInterviewStatusDraft.value
      ? ''
      : interviewerUserId
        ? '請先選擇面試時間'
        : '請先選擇面試官'
    return
  }

  interviewerAvailabilityStatus.value = 'loading'
  interviewerAvailabilityMessage.value = '正在讀取面試官空閒時段'
  try {
    const params = new URLSearchParams({
      interviewerUserId: String(interviewerUserId),
      date: dateKey,
      durationMinutes: String(selectedInterviewDurationMinutes.value),
      statusHistoryId: String(editingStatusHistoryId.value || 0),
    })
    const data = await fetchJson(`${apiBaseUrl}/api/schedule/interviewer-availability?${params.toString()}`)
    interviewerAvailability.value = data
    interviewerAvailabilityStatus.value = 'success'
    interviewerAvailabilityMessage.value = ''
  } catch (error) {
    interviewerAvailability.value = null
    interviewerAvailabilityStatus.value = 'error'
    interviewerAvailabilityMessage.value = error?.message || '讀取面試官空閒時段失敗'
  }
}

const scheduleAvailabilityLoad = () => {
  clearAvailabilityLoadTimer()
  availabilityLoadTimer = window.setTimeout(loadInterviewerAvailability, 260)
}

const getAvailabilityTimeRange = (item) =>
  `${String(item?.start || '').slice(11, 16)}-${String(item?.end || '').slice(11, 16)}`

const getAvailabilityItemKey = (item, index) =>
  `${item?.type || 'slot'}-${item?.applicationId || 'free'}-${item?.start || index}-${item?.end || index}-${index}`

const doesSlotFitDuration = (slot) => Number(slot?.durationMinutes || 0) >= selectedInterviewDurationMinutes.value

const doesSelectedInterviewFitSlot = (slot) => {
  if (!doesSlotFitDuration(slot)) return false
  const selectedStart = parseDateTime(interviewScheduledAtDraft.value)
  const selectedEnd = parseDateTime(selectedInterviewEndTime.value)
  const slotStart = parseDateTime(slot?.start)
  const slotEnd = parseDateTime(slot?.end)
  if (!selectedStart || !selectedEnd || !slotStart || !slotEnd) return false
  return selectedStart >= slotStart && selectedEnd <= slotEnd
}

const getAvailabilityItemClass = (item) => {
  if (item?.type === 'preview') return 'preview'
  if (item?.type === 'booked') return 'booked'
  return doesSelectedInterviewFitSlot(item) ? 'free can-insert' : 'free needs-adjustment'
}

const applyAvailabilitySlot = (slot) => {
  if (!slot || slot.type !== 'free' || !doesSlotFitDuration(slot)) return
  const fittedBeforeClick = doesSelectedInterviewFitSlot(slot)
  if (!fittedBeforeClick) interviewScheduledAtDraft.value = toDateTimeLocalValue(slot.start)
  interviewerAvailabilityMessage.value = fittedBeforeClick
    ? '所選面試時間可插入此空閒時段'
    : '已將面試時間調整到該空閒時段起始時間'
}

watch(
  () => [props.modelValue, props.application?.applicationId, props.application?.statusHistoryId],
  () => {
    if (!props.modelValue) {
      resetModalState()
      return
    }
    loadApplicationDetail()
  },
  { immediate: true }
)

watch(
  [interviewerUserIdDraft, interviewScheduledAtDraft, selectedInterviewDurationMinutes, statusDraft],
  () => {
    if (!props.modelValue) return
    if (!isInterviewStatusDraft.value) {
      clearAvailabilityLoadTimer()
      interviewerAvailability.value = null
      interviewerAvailabilityStatus.value = ''
      interviewerAvailabilityMessage.value = ''
      return
    }
    scheduleAvailabilityLoad()
  }
)

onBeforeUnmount(() => {
  clearAvailabilityLoadTimer()
})
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="closeModal">
    <section class="modal-panel status-modal">
      <header class="modal-header">
        <div>
          <h3>候選人狀態</h3>
          <p class="subtle">
            {{ activeApplication?.fullName || application?.fullName || '候選人' }}
            <template v-if="activeApplication?.jobPostTitle || application?.jobPostTitle">
              ｜{{ activeApplication?.jobPostTitle || application?.jobPostTitle }}
            </template>
          </p>
        </div>
        <button type="button" class="ghost-btn" :disabled="isBusy" @click="closeModal">關閉</button>
      </header>

      <p v-if="isLoading" class="hint">讀取中...</p>
      <p v-else-if="errorMessage" class="message">{{ errorMessage }}</p>

      <template v-if="activeApplication">
        <div class="status-editor-header">
          <h4>{{ isEditingStatusHistory ? '編輯狀態記錄' : '新增狀態記錄' }}</h4>
          <div class="status-editor-actions">
            <button
              v-if="isEditingStatusHistory && selectedStatusHistory"
              type="button"
              class="danger-btn compact-btn"
              :disabled="isBusy || isStatusHistoryDeleting(editingStatusHistoryId)"
              @click="deleteStatusHistory(selectedStatusHistory)"
            >
              {{ isStatusHistoryDeleting(editingStatusHistoryId) ? '刪除中...' : '刪除狀態記錄' }}
            </button>
            <button type="button" class="primary-btn compact-btn" :disabled="isBusy" @click="saveStatusHistory">
              {{ isSaving ? '保存中...' : (isEditingStatusHistory ? '更新狀態記錄' : '新增狀態記錄') }}
            </button>
          </div>
        </div>

        <div class="status-modal-body">
          <section class="status-form-panel">
            <div class="status-modal-editor">
              <label class="field">
                <span>候選人狀態</span>
                <AppSelect
                  v-model="statusDraft"
                  :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                  :disabled="isSaving"
                  placeholder="請選擇狀態"
                />
              </label>

              <div v-if="isInterviewStatusDraft" class="interview-arrangement-table-wrap full-span">
                <table class="application-table interview-arrangement-table">
                  <thead>
                    <tr>
                      <th>安排項目</th>
                      <th>內容</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">面試官<span class="required-mark" aria-hidden="true">*</span></th>
                      <td>
                        <AppSelect
                          v-model="interviewerUserIdDraft"
                          :options="interviewerOptions"
                          :disabled="isSaving"
                          placeholder="請選擇面試官"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">面試時間<span class="required-mark" aria-hidden="true">*</span></th>
                      <td><input v-model="interviewScheduledAtDraft" type="datetime-local" :disabled="isSaving" /></td>
                    </tr>
                    <tr>
                      <th scope="row">面試時長</th>
                      <td>
                        <div class="interview-duration-controls">
                          <AppSelect
                            :model-value="interviewDurationModeDraft"
                            :options="INTERVIEW_DURATION_PRESET_OPTIONS"
                            :disabled="isSaving"
                            @update:model-value="handleDurationModeChange"
                          />
                          <input
                            v-if="interviewDurationModeDraft === 'custom'"
                            v-model="interviewDurationMinutesDraft"
                            type="number"
                            min="1"
                            max="480"
                            :disabled="isSaving"
                            placeholder="分鐘"
                          />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">面試地點<span class="required-mark" aria-hidden="true">*</span></th>
                      <td>
                        <AppSelect
                          v-model="interviewLocationDraft"
                          :options="[{ value: '', label: '未指定' }, ...INTERVIEW_LOCATION_OPTIONS]"
                          :disabled="isSaving"
                          placeholder="請選擇地點"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">面試狀態</th>
                      <td>
                        <AppSelect
                          v-model="interviewStatusDraft"
                          :options="INTERVIEW_STATUS_OPTIONS"
                          :disabled="isSaving"
                          placeholder="請選擇面試狀態"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <label class="field full-span">
                <span>備註</span>
                <textarea
                  v-model.trim="remarkDraft"
                  rows="4"
                  :disabled="isSaving"
                  placeholder="輸入原因或跟進記錄"
                ></textarea>
              </label>
            </div>
          </section>

          <section class="status-lower-panel" :class="{ 'without-availability': !isInterviewStatusDraft }">
            <section class="status-history-section" @click="startNewStatusHistoryDraft">
              <h4>狀態記錄</h4>
              <div class="status-timeline">
                <div
                  v-for="(history, index) in activeStatusHistory"
                  :key="history.id || `${history.applicationStatus}-${index}`"
                  class="timeline-row"
                  :class="{
                    current: index === 0,
                    selected: Number(editingStatusHistoryId) === Number(history.id),
                    disabled: isBusy || !history.id,
                  }"
                  role="button"
                  tabindex="0"
                  @click.stop="editStatusHistoryDraft(history)"
                  @keydown.enter.prevent.stop="editStatusHistoryDraft(history)"
                  @keydown.space.prevent.stop="editStatusHistoryDraft(history)"
                >
                  <div class="timeline-label">
                    <span class="timeline-dot" aria-hidden="true"></span>
                    <span class="timeline-status">{{ getCandidateApplicationStatusLabel(history.applicationStatus) }}</span>
                  </div>
                  <div class="timeline-content">
                    <p v-if="String(history.remark || '').trim()" class="timeline-remark">{{ history.remark }}</p>
                    <p v-if="getInterviewSummaryText(history.interview)" class="timeline-extra">
                      面試資訊：{{ getInterviewSummaryText(history.interview) }}
                    </p>
                    <div class="timeline-meta-row">
                      <span class="timeline-meta">{{ formatDateTime(history.updatedAt || history.createdAt) }}</span>
                      <span class="timeline-operator">
                        <span class="timeline-operator-avatar" :style="getStatusHistoryOperatorAvatarStyle(history)">
                          {{ getStatusHistoryOperatorAvatarText(history) }}
                        </span>
                        <span>{{ getStatusHistoryOperatorName(history) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <aside v-if="isInterviewStatusDraft" class="availability-panel">
              <div class="availability-header">
                <div>
                  <h4>面試官空閒時間</h4>
                  <p>{{ availabilityDateLabel || '請先選擇面試官與面試時間' }}</p>
                </div>
                <span>{{ getInterviewDurationLabel(selectedInterviewDurationMinutes) }}</span>
              </div>

              <p v-if="interviewerAvailabilityStatus === 'loading'" class="hint">讀取空閒時段中...</p>
              <p v-else-if="interviewerAvailabilityMessage" class="hint">{{ interviewerAvailabilityMessage }}</p>

              <div v-if="availabilityTimelineItems.length" class="availability-timeline">
                <button
                  v-for="(item, index) in availabilityTimelineItems"
                  :key="getAvailabilityItemKey(item, index)"
                  type="button"
                  class="availability-slot"
                  :class="getAvailabilityItemClass(item)"
                  :disabled="item.type !== 'free' || !doesSlotFitDuration(item)"
                  @click="applyAvailabilitySlot(item)"
                >
                  <span class="availability-time">{{ getAvailabilityTimeRange(item) }}</span>
                  <span class="availability-copy">
                    <strong>{{ item.type === 'preview' ? '當前安排' : item.type === 'booked' ? '已安排' : '空閒' }}</strong>
                    <em v-if="item.type === 'preview'">{{ item.fullName || '當前候選人' }}｜{{ item.jobPostTitle || '--' }}</em>
                    <em v-else-if="item.type === 'booked'">
                      {{ item.fullName || '候選人' }}｜{{ item.jobPostTitle || '--' }}｜{{ getCandidateApplicationStatusLabel(item.applicationStatus) }}｜{{ getInterviewStatusLabel(item.interviewStatus) }}
                    </em>
                    <em v-else-if="doesSelectedInterviewFitSlot(item)">可插入當前面試時間</em>
                    <em v-else-if="doesSlotFitDuration(item)">可點擊調整到此時段</em>
                    <em v-else>時長不足</em>
                  </span>
                </button>
              </div>
            </aside>
          </section>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
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
  width: min(1180px, calc(100vw - 2rem));
  max-height: 90vh;
  overflow: auto;
  padding: 1rem;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: var(--shadow-lg);
}

.status-modal,
.status-modal-body {
  display: grid;
  gap: 1rem;
}

.modal-header,
.status-editor-header,
.status-editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.status-editor-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.modal-header h3,
.status-editor-header h4,
.status-history-section h4,
.availability-header h4 {
  margin: 0;
  color: var(--text-strong);
}

.subtle,
.hint {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
}

.message {
  margin: 0;
  color: #b45309;
  font-weight: 700;
}

.compact-btn {
  min-height: 36px;
  padding: 0.48rem 0.9rem;
  font-size: 0.84rem;
}

.status-form-panel,
.status-history-section,
.availability-panel {
  min-width: 0;
  padding: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  background: #f8fafc;
}

.status-modal-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.field {
  display: grid;
  gap: 0.42rem;
}

.field span,
.required-mark {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.required-mark {
  margin-left: 0.2rem;
  color: var(--danger);
}

.full-span {
  grid-column: 1 / -1;
}

.status-modal-editor input,
.status-modal-editor textarea {
  width: 100%;
  min-height: 42px;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.36);
  border-radius: 12px;
  color: var(--text-base);
  background: #ffffff;
  font: inherit;
}

.status-modal-editor textarea {
  min-height: 98px;
  resize: vertical;
}

.interview-arrangement-table-wrap {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.74);
}

.interview-arrangement-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
}

.interview-arrangement-table th,
.interview-arrangement-table td {
  padding: 0.7rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  vertical-align: middle;
}

.interview-arrangement-table th {
  width: 160px;
  color: var(--text-base);
  background: rgba(245, 248, 252, 0.96);
  text-align: left;
  font-size: 0.86rem;
  font-weight: 800;
}

.interview-duration-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(100px, 140px);
  gap: 0.6rem;
  align-items: center;
}

.status-lower-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  gap: 1rem;
  align-items: start;
}

.status-lower-panel.without-availability {
  grid-template-columns: minmax(0, 1fr);
}

.status-timeline {
  display: grid;
  gap: 1rem;
}

.timeline-row {
  display: grid;
  grid-template-columns: minmax(130px, 0.32fr) minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.74rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
}

.timeline-row.selected {
  border-color: rgba(47, 111, 237, 0.36);
  background: rgba(47, 111, 237, 0.08);
}

.timeline-row.disabled {
  cursor: default;
  opacity: 0.72;
}

.timeline-label,
.timeline-operator {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.timeline-dot {
  width: 0.58rem;
  height: 0.58rem;
  border: 2px solid currentColor;
  border-radius: 999px;
  color: var(--accent);
}

.timeline-row.current .timeline-dot {
  background: currentColor;
}

.timeline-status {
  color: var(--text-strong);
  font-weight: 850;
}

.timeline-content {
  display: grid;
  gap: 0.28rem;
  min-width: 0;
}

.timeline-content p,
.timeline-meta-row {
  margin: 0;
}

.timeline-extra,
.timeline-meta,
.timeline-operator,
.availability-header p,
.availability-copy em {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-style: normal;
}

.timeline-remark {
  color: var(--text-base);
  font-size: 0.86rem;
  font-weight: 650;
}

.timeline-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  flex-wrap: wrap;
  padding-top: 0.18rem;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}

.timeline-operator-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.28rem;
  height: 1.28rem;
  border-radius: 999px;
  color: #ffffff;
  font-size: 0.68rem;
  font-weight: 800;
}

.availability-panel {
  position: sticky;
  top: 0;
  display: grid;
  gap: 0.85rem;
}

.availability-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.availability-header > span {
  flex: 0 0 auto;
  padding: 0.24rem 0.55rem;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 0.78rem;
  font-weight: 800;
}

.availability-timeline {
  position: relative;
  display: grid;
  gap: 0.55rem;
  padding-left: 0.7rem;
}

.availability-timeline::before {
  content: '';
  position: absolute;
  top: 0.2rem;
  bottom: 0.2rem;
  left: 0.18rem;
  width: 2px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.38);
}

.availability-slot {
  position: relative;
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 0.6rem;
  align-items: start;
  width: 100%;
  padding: 0.62rem 0.72rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: #fff;
  color: var(--text-base);
  text-align: left;
  cursor: pointer;
}

.availability-slot::before {
  content: '';
  position: absolute;
  top: 0.9rem;
  left: -0.73rem;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: #94a3b8;
}

.availability-slot.preview {
  border-color: rgba(47, 111, 237, 0.3);
  background: rgba(47, 111, 237, 0.08);
}

.availability-slot.booked {
  color: #92400e;
  background: #fff7ed;
}

.availability-slot.free {
  color: #166534;
  background: #f0fdf4;
}

.availability-slot:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.availability-time,
.availability-copy strong {
  font-weight: 850;
}

.availability-copy {
  display: grid;
  gap: 0.18rem;
}

@media (max-width: 900px) {
  .status-modal-editor,
  .status-lower-panel {
    grid-template-columns: 1fr;
  }

  .timeline-row {
    grid-template-columns: 1fr;
  }
}
</style>
