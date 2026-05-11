<script setup>
import { computed, ref } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import AppSelect from '../AppSelect.vue'
import {
  CANDIDATE_APPLICATION_STATUS_OPTIONS,
  getCandidateApplicationStatusLabel,
  normalizeCandidateApplicationStatus,
} from '../../scripts/candidateApplicationStatus.js'
import CandidateTextPreviewModal from './CandidateTextPreviewModal.vue'

const props = defineProps({
  title: {
    type: String,
    default: '候選人清單',
  },
  subtitle: {
    type: String,
    default: '',
  },
  rows: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  showJobColumn: {
    type: Boolean,
    default: false,
  },
  editableStatus: {
    type: Boolean,
    default: false,
  },
  showBlacklistAction: {
    type: Boolean,
    default: false,
  },
  showProjectTransferAction: {
    type: Boolean,
    default: false,
  },
  showBulkBlacklistActions: {
    type: Boolean,
    default: false,
  },
  showBulkUploadAction: {
    type: Boolean,
    default: false,
  },
  bulkBlacklisting: {
    type: Boolean,
    default: false,
  },
  bulkUnblacklisting: {
    type: Boolean,
    default: false,
  },
  bulkUploading: {
    type: Boolean,
    default: false,
  },
  bulkBlacklistDisabled: {
    type: Boolean,
    default: false,
  },
  bulkUnblacklistDisabled: {
    type: Boolean,
    default: false,
  },
  bulkUploadDisabled: {
    type: Boolean,
    default: false,
  },
  deleteSelectedLabel: {
    type: String,
    default: '刪除已選擇',
  },
  selectable: {
    type: Boolean,
    default: false,
  },
  selectedIds: {
    type: Array,
    default: () => [],
  },
  deleting: {
    type: Boolean,
    default: false,
  },
  emptyText: {
    type: String,
    default: '尚無候選人資料',
  },
  searchPlaceholder: {
    type: String,
    default: '搜尋候選人 / 狀態 / 期望職位 / 匹配職位 / 電話 / 備註 / 檔案',
  },
})

const emit = defineEmits([
  'selection-change',
  'delete-selected',
  'bulk-blacklist-selected',
  'bulk-unblacklist-selected',
  'upload-selected-cv',
  'add-to-project',
  'rows-updated',
  'notify',
])

const searchKeyword = ref('')
const statusOverrides = ref({})
const savingStatusIds = ref([])
const remarkDrafts = ref({})
const savingRemarkIds = ref([])
const addingBlacklistIds = ref([])

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

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getMatchScoreTone = (score) => {
  const numericScore = Number(score || 0)
  if (numericScore >= 85) return 'score-high'
  if (numericScore >= 60) return 'score-medium'
  if (numericScore > 0) return 'score-low'
  return 'score-empty'
}

const getStatusToneClass = (status) => {
  const normalized = normalizeCandidateApplicationStatus(status)
  return `status-tone-${normalized}`
}

const getBlacklistMatchedByLabel = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'phone') return '電話'
  if (normalized === 'email') return 'Email'
  return '--'
}

const isRemarkSaving = (applicationId) => savingRemarkIds.value.includes(Number(applicationId))

const getRemarkDraft = (row) => {
  const applicationId = Number(row?.applicationId)
  return Object.prototype.hasOwnProperty.call(remarkDrafts.value, applicationId)
    ? remarkDrafts.value[applicationId]
    : String(row?.remark || '')
}

const getRemarkTooltip = (row) => String(getRemarkDraft(row) || '').trim() || undefined

const isStatusSaving = (applicationId) => savingStatusIds.value.includes(Number(applicationId))
const isBlacklistSaving = (applicationId) => addingBlacklistIds.value.includes(Number(applicationId))

const displayRows = computed(() =>
  props.rows.map((row) => ({
    ...row,
    applicationStatus:
      statusOverrides.value[Number(row.applicationId)] ??
      normalizeCandidateApplicationStatus(row.applicationStatus),
  }))
)

const filteredRows = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  if (!keyword) return displayRows.value

  return displayRows.value.filter((row) => {
    const haystack = [
      props.showJobColumn ? row.jobPostTitle : '',
      row.fullName,
      getCandidateApplicationStatusLabel(row.applicationStatus),
      row.targetPosition,
      row.matchedPosition,
      row.phone,
      row.cvFileName,
      row.extractedFileName,
      row.remark,
      row.blacklistReason,
      row.blacklistMatchedBy,
      formatDateTime(row.createdAt),
    ]
      .map((item) => normalizeSearchText(item))
      .join(' ')
    return haystack.includes(keyword)
  })
})

const selectedCount = computed(() => props.selectedIds.length)

const tableColumnCount = computed(() => {
  let count = 9
  if (props.showJobColumn) count += 1
  return count
})

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
  previewDownloadUrl.value = type === 'cv' && row.hasDownload
    ? `${apiBaseUrl}/api/candidate-cvs/${row.cvId}/download`
    : ''
  previewDownloadFileName.value = type === 'cv' ? String(row.cvFileName || '') : ''
  previewTitle.value = type === 'extracted'
    ? `AI分析檔案預覽 - ${row.extractedFileName || row.cvFileName}`
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
  emit('rows-updated')
  emit('notify', { type: 'success', message: 'AI分析檔案已更新' })
}

const toggleRowSelection = (applicationId, checked) => {
  const id = Number(applicationId)
  if (!Number.isInteger(id) || id <= 0) return

  if (checked) {
    if (!props.selectedIds.includes(id)) {
      emit('selection-change', [...props.selectedIds, id])
    }
    return
  }

  emit(
    'selection-change',
    props.selectedIds.filter((value) => Number(value) !== id)
  )
}

const handleRowClick = (row, event) => {
  if (!props.selectable) return

  const target = event?.target
  if (
    target?.closest?.(
      'button, input, textarea, label, a, .app-select, .app-select-trigger, .app-select-menu'
    )
  ) {
    return
  }

  const applicationId = Number(row?.applicationId)
  if (!Number.isInteger(applicationId) || applicationId <= 0) return
  toggleRowSelection(applicationId, !props.selectedIds.includes(applicationId))
}

const saveApplicationRemark = async (row) => {
  const applicationId = Number(row?.applicationId)
  if (!applicationId) return

  const nextRemark = String(getRemarkDraft(row) || '').trim()
  const previousRemark = String(row?.remark || '').trim()
  if (nextRemark === previousRemark) return

  savingRemarkIds.value = [...savingRemarkIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: nextRemark }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '更新備註失敗')
    }

    remarkDrafts.value = {
      ...remarkDrafts.value,
      [applicationId]: String(data?.application?.remark || nextRemark),
    }
    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已更新 ${row?.fullName || '候選人'} 的備註`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    remarkDrafts.value = {
      ...remarkDrafts.value,
      [applicationId]: previousRemark,
    }
    emit('notify', {
      type: 'error',
      message: error?.message || '更新備註失敗',
    })
  } finally {
    savingRemarkIds.value = savingRemarkIds.value.filter((id) => id !== applicationId)
  }
}

const updateApplicationStatus = async (row, nextStatus) => {
  const applicationId = Number(row?.applicationId)
  const previousStatus = normalizeCandidateApplicationStatus(row?.applicationStatus)
  const normalizedStatus = normalizeCandidateApplicationStatus(nextStatus, '')

  if (!applicationId || !normalizedStatus || normalizedStatus === previousStatus) {
    statusOverrides.value = {
      ...statusOverrides.value,
      [applicationId]: previousStatus,
    }
    return
  }

  savingStatusIds.value = [...savingStatusIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-post-applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationStatus: normalizedStatus }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '更新候選人狀態失敗')
    }

    statusOverrides.value = {
      ...statusOverrides.value,
      [applicationId]: normalizedStatus,
    }
    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已更新 ${row?.fullName || '候選人'} 的狀態為「${getCandidateApplicationStatusLabel(normalizedStatus)}」`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    statusOverrides.value = {
      ...statusOverrides.value,
      [applicationId]: previousStatus,
    }
    emit('notify', {
      type: 'error',
      message: error?.message || '更新候選人狀態失敗',
    })
  } finally {
    savingStatusIds.value = savingStatusIds.value.filter((id) => id !== applicationId)
  }
}

const quickAddToBlacklist = async (row) => {
  const applicationId = Number(row?.applicationId)
  if (!applicationId || row?.isBlacklisted || isBlacklistSaving(applicationId)) return

  const phone = String(row?.phone || '').trim()
  const email = String(row?.email || '').trim()
  if (!phone && !email) {
    emit('notify', {
      type: 'error',
      message: `${row?.fullName || '此候選人'} 沒有電話或 Email，無法加入 Blacklist`,
    })
    return
  }

  const reason = window.prompt('請輸入加入 Blacklist 的原因', '由候選人管理頁快速加入')
  if (reason === null) return

  const normalizedReason = String(reason || '').trim()
  if (!normalizedReason) {
    emit('notify', {
      type: 'error',
      message: '請先輸入 Blacklist 原因',
    })
    return
  }

  addingBlacklistIds.value = [...addingBlacklistIds.value, applicationId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/candidate-blacklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: String(row?.fullName || '').trim(),
        phone,
        email,
        reason: normalizedReason,
        status: 'active',
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || '加入 Blacklist 失敗')
    }

    emit('rows-updated')
    emit('notify', {
      type: 'success',
      message: `已將 ${row?.fullName || '此候選人'} 加入 Blacklist`,
    })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
  } catch (error) {
    emit('notify', {
      type: 'error',
      message: error?.message || '加入 Blacklist 失敗',
    })
  } finally {
    addingBlacklistIds.value = addingBlacklistIds.value.filter((id) => id !== applicationId)
  }
}
</script>

<template>
  <section class="card applications-card">
    <div class="card-header">
      <div>
        <h3>{{ title }}</h3>
        <p v-if="subtitle" class="subtle">{{ subtitle }}</p>
      </div>
      <div class="table-search-wrap">
        <input
          v-model.trim="searchKeyword"
          type="text"
          class="search-input"
          :placeholder="searchPlaceholder"
        />
      </div>
      <div v-if="selectable" class="table-actions">
        <span class="selected-count-chip">已選 {{ selectedCount }}</span>
        <button
          v-if="showBulkBlacklistActions"
          type="button"
          class="danger-btn"
          :disabled="!selectedCount || bulkBlacklistDisabled || bulkBlacklisting"
          @click="emit('bulk-blacklist-selected')"
        >
          {{ bulkBlacklisting ? '加入中...' : '加入 Blacklist' }}
        </button>
        <button
          v-if="showBulkBlacklistActions"
          type="button"
          class="secondary-btn"
          :disabled="!selectedCount || bulkUnblacklistDisabled || bulkUnblacklisting"
          @click="emit('bulk-unblacklist-selected')"
        >
          {{ bulkUnblacklisting ? '取消中...' : '取消 Blacklist' }}
        </button>
        <button
          v-if="showBulkUploadAction"
          type="button"
          class="primary-btn"
          :disabled="bulkUploadDisabled || bulkUploading"
          @click="emit('upload-selected-cv')"
        >
          {{ bulkUploading ? '開啟中...' : '上傳 CV' }}
        </button>
        <button
          type="button"
          class="danger-btn"
          :disabled="!selectedCount || deleting"
          @click="emit('delete-selected')"
        >
          {{ deleting ? '刪除中...' : `刪除已選擇（${selectedCount}）` }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="hint">讀取中...</p>
    <div v-else class="table-wrap">
      <table class="application-table">
        <thead>
          <tr>
            <th v-if="showJobColumn" class="job-col">職位</th>
            <th class="name-col">候選人名稱</th>
            <th class="status-col">候選人狀態</th>
            <th class="remark-col">備註</th>
            <th class="position-col">期望職位</th>
            <th class="position-col">匹配職位</th>
            <th class="phone-col">電話</th>
            <th class="file-col">CV檔案</th>
            <th class="file-col">AI分析檔案</th>
            <th class="time-col">投遞時間</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredRows.length">
            <td :colspan="tableColumnCount" class="empty-cell">{{ emptyText }}</td>
          </tr>
          <tr
            v-for="row in filteredRows"
            :key="row.applicationId"
            :class="{
              'blacklist-row': row.isBlacklisted,
              'selected-row': selectable && selectedIds.includes(Number(row.applicationId)),
              'selectable-row': selectable,
            }"
            @click="handleRowClick(row, $event)"
          >
            <td v-if="showJobColumn" class="job-col">{{ row.jobPostTitle || '--' }}</td>
            <td class="name-col">
              <div class="candidate-name-cell">
                <span>{{ row.fullName || '--' }}</span>
                <span v-if="row.isBlacklisted" class="blacklist-badge">Blacklist</span>
                <button
                  v-else-if="showBlacklistAction"
                  type="button"
                  class="blacklist-action-btn"
                  :disabled="isBlacklistSaving(row.applicationId)"
                  @click="quickAddToBlacklist(row)"
                >
                  {{ isBlacklistSaving(row.applicationId) ? '加入中...' : '加入 Blacklist' }}
                </button>
                <button
                  v-if="showProjectTransferAction && normalizeCandidateApplicationStatus(row.applicationStatus) === 'onboarded'"
                  type="button"
                  class="project-action-btn"
                  @click="emit('add-to-project', row)"
                >
                  加入項目
                </button>
              </div>
              <div v-if="row.isBlacklisted" class="blacklist-note">
                <strong>原因：</strong>{{ row.blacklistReason || '--' }}
                <span class="blacklist-divider">｜</span>
                <strong>命中：</strong>{{ getBlacklistMatchedByLabel(row.blacklistMatchedBy) }}
              </div>
            </td>
            <td class="status-col">
              <div
                v-if="editableStatus"
                class="status-select-wrap"
                :class="[getStatusToneClass(row.applicationStatus), { saving: isStatusSaving(row.applicationId) }]"
              >
                <span class="status-dot" aria-hidden="true"></span>
                <AppSelect
                  class="status-select"
                  :model-value="row.applicationStatus"
                  :options="CANDIDATE_APPLICATION_STATUS_OPTIONS"
                  placeholder="請選擇狀態"
                  :disabled="isStatusSaving(row.applicationId)"
                  @update:model-value="updateApplicationStatus(row, $event)"
                />
              </div>
              <span v-else class="status-chip" :class="getStatusToneClass(row.applicationStatus)">
                {{ getCandidateApplicationStatusLabel(row.applicationStatus) }}
              </span>
            </td>
            <td class="remark-col">
              <textarea
                v-if="editableStatus"
                class="remark-input"
                :value="getRemarkDraft(row)"
                :title="getRemarkTooltip(row)"
                :disabled="isRemarkSaving(row.applicationId)"
                rows="2"
                placeholder="輸入原因或跟進記錄"
                @input="remarkDrafts = { ...remarkDrafts, [Number(row.applicationId)]: $event.target.value }"
                @blur="saveApplicationRemark(row)"
              ></textarea>
              <div v-else class="remark-text" :title="String(row.remark || '').trim() || undefined">
                {{ row.remark || '--' }}
              </div>
            </td>
            <td class="position-col">{{ row.targetPosition || '--' }}</td>
            <td class="position-col">
              <template v-if="row.matchedPosition">
                <span>{{ row.matchedPosition }}</span>
                <span class="match-score" :class="getMatchScoreTone(row.matchedScore)">
                  {{ row.matchedScore || 0 }}
                </span>
              </template>
              <span v-else>--</span>
            </td>
            <td class="phone-col">{{ row.phone || '--' }}</td>
            <td class="file-column file-col">
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
            <td class="file-column file-col">
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
            <td class="time-col">{{ formatDateTime(row.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
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
.applications-card {
  min-width: 0;
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.card-header > * {
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
  flex-wrap: wrap;
  min-width: 0;
}

.selected-count-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0.3rem 0.72rem;
  border-radius: 999px;
  color: var(--text-base);
  background: var(--surface-soft);
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
}

.table-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.application-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}

.application-table th,
.application-table td {
  white-space: nowrap;
  overflow-wrap: normal;
  word-break: normal;
  vertical-align: middle;
}

.application-table th,
.application-table td {
  min-width: 120px;
}

.job-col,
.name-col {
  min-width: 180px;
}

.candidate-name-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.blacklist-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0.14rem 0.52rem;
  border-radius: 999px;
  color: #b42318;
  background: rgba(217, 45, 32, 0.12);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.blacklist-action-btn,
.project-action-btn {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0.22rem 0.62rem;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, opacity 180ms ease;
}

.blacklist-action-btn {
  border: 1px solid rgba(217, 45, 32, 0.24);
  color: #b42318;
  background: rgba(217, 45, 32, 0.08);
}

.project-action-btn {
  border: 1px solid rgba(47, 111, 237, 0.22);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.08);
}

.blacklist-action-btn:hover {
  background: rgba(217, 45, 32, 0.12);
  border-color: rgba(217, 45, 32, 0.32);
}

.project-action-btn:hover {
  background: rgba(47, 111, 237, 0.12);
  border-color: rgba(47, 111, 237, 0.3);
}

.blacklist-action-btn:disabled,
.project-action-btn:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.blacklist-note {
  margin-top: 0.42rem;
  color: #b42318;
  font-size: 0.78rem;
  line-height: 1.4;
  white-space: normal;
}

.blacklist-divider {
  margin: 0 0.25rem;
  color: rgba(180, 35, 24, 0.55);
}

.blacklist-row td {
  background: rgba(217, 45, 32, 0.05);
}

.selectable-row {
  cursor: pointer;
}

.selected-row td {
  background: rgba(47, 111, 237, 0.1);
}

.selected-row:hover td {
  background: rgba(47, 111, 237, 0.14);
}

.blacklist-row.selected-row td {
  background: linear-gradient(0deg, rgba(47, 111, 237, 0.08), rgba(47, 111, 237, 0.08)), rgba(217, 45, 32, 0.06);
}

.blacklist-row:hover td {
  background: rgba(217, 45, 32, 0.08);
}

.status-col {
  min-width: 220px;
}

.position-col {
  min-width: 160px;
}

.phone-col {
  min-width: 140px;
}

.file-col {
  min-width: 220px;
}

.remark-col {
  min-width: 240px;
}

.time-col {
  min-width: 168px;
}

.file-column {
  min-width: 0;
  max-width: 220px;
}

.file-link,
.file-link-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remark-input {
  width: 100%;
  min-height: 3.6rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-base);
  font: inherit;
  line-height: 1.45;
  white-space: normal;
  resize: vertical;
}

.remark-input:focus {
  outline: none;
  border-color: rgba(47, 111, 237, 0.28);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.remark-text {
  max-width: 280px;
  white-space: pre-wrap;
  line-height: 1.45;
  color: var(--text-base);
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

.status-select-wrap {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: stretch;
  min-width: 196px;
  max-width: 252px;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.04);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.status-select-wrap:hover {
  transform: translateY(-1px);
}

.status-select-wrap:focus-within {
  z-index: 20;
  border-color: rgba(47, 111, 237, 0.28);
  box-shadow:
    0 0 0 3px rgba(47, 111, 237, 0.12),
    inset 0 0 0 1px rgba(47, 111, 237, 0.12);
}

.status-select {
  width: 100%;
  min-width: 0;
}

.status-select-wrap :deep(.app-select.open) {
  z-index: 30;
}

.status-dot {
  position: absolute;
  left: 0.72rem;
  top: 50%;
  width: 0.48rem;
  height: 0.48rem;
  border-radius: 999px;
  background: currentColor;
  transform: translateY(-50%);
  pointer-events: none;
}

.status-select-wrap.saving {
  opacity: 0.68;
}

.status-select-wrap :deep(.app-select-trigger) {
  min-height: 36px;
  padding: 0.4rem 2rem 0.4rem 1.7rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  color: inherit;
}

.status-select-wrap :deep(.app-select-trigger:hover) {
  transform: none;
  box-shadow: none;
}

.status-select-wrap :deep(.app-select-trigger:focus-visible) {
  border: none;
  box-shadow: none;
}

.status-select-wrap :deep(.app-select-copy) {
  display: block;
}

.status-select-wrap :deep(.app-select-value) {
  color: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.2;
}

.status-select-wrap :deep(.app-select-icon) {
  width: 0.45rem;
  height: 0.45rem;
  border-right-width: 2px;
  border-bottom-width: 2px;
  border-color: currentColor;
  opacity: 0.72;
}

.status-select-wrap :deep(.app-select-menu) {
  left: 0;
  right: auto;
  z-index: 40;
  width: max-content;
  min-width: 100%;
  max-width: 320px;
}

.status-select-wrap :deep(.app-select-option-label) {
  font-size: 0.82rem;
}

.status-select-wrap :deep(.app-select-check) {
  color: currentColor;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  padding: 0.32rem 0.72rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
}

.status-chip::before {
  content: '';
  width: 0.46rem;
  height: 0.46rem;
  border-radius: 999px;
  background: currentColor;
}

.status-tone-screening,
.status-tone-screening_hr_approved,
.status-tone-screening_hr_rejected,
.status-tone-screening_department_approved,
.status-tone-screening_department_rejected,
.status-tone-screening_rejected,
.status-tone-hr_interview,
.status-tone-hr_interview_rejected,
.status-tone-department_interview,
.status-tone-department_interview_rejected,
.status-tone-salary_review,
.status-tone-offer_sent,
.status-tone-onboarded,
.status-tone-no_show_or_unreachable,
.status-tone-offer_rejected,
.status-tone-hr_withdrew_onboarding,
.status-tone-transferred {
  background: rgba(47, 111, 237, 0.12);
  color: #2f6fed;
}

@media (max-width: 720px) {
  .card-header,
  .table-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .table-search-wrap {
    width: 100%;
    min-width: 0;
  }
}
</style>
