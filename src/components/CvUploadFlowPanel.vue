<script setup>
import { computed, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import CvExtractedFilePreview from './CvExtractedFilePreview.vue'
import {
  EDITABLE_EXTRACTED_FIELDS,
  buildDraftFieldsFromRows,
  buildEditedExtractedFromDraft,
  buildExtractedPreviewData,
  computeMissingFields,
  getEditableRows,
} from '../scripts/cvExtractedEditor.js'

const props = defineProps({
  jobPostId: {
    type: Number,
    default: null,
  },
  jobPostTitle: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['uploaded', 'closed'])

const fileInputRef = ref(null)
const selectedFile = ref(null)
const cachedCvId = ref('')
const cachedCvName = ref('')
const parsedCandidate = ref(null)
const parsedExtractedText = ref('')

const isEditingExtracted = ref(false)
const hasEditedExtracted = ref(false)
const draftFields = ref({})

const message = ref('')
const isCaching = ref(false)
const isParsing = ref(false)
const isConfirmingUpload = ref(false)

const isBusy = computed(() => isCaching.value || isParsing.value || isConfirmingUpload.value)

const loadingTitle = computed(() => {
  if (isConfirmingUpload.value) return '正在提交到 Job Post 並進行職位匹配'
  if (isParsing.value) return '正在調用 LLM 解析 CV'
  if (isCaching.value) return '正在快取 CV 檔案'
  return ''
})

const loadingDescription = computed(() => {
  if (isConfirmingUpload.value) return '請稍候，系統正在建立投遞記錄並生成此 Job Post 的單一職位匹配結果。'
  if (isParsing.value) return '請稍候，系統正在抽取履歷內容並生成結構化欄位。'
  if (isCaching.value) return '請稍候，系統正在上傳暫存檔案。'
  return ''
})

const selectedFileName = computed(() => {
  const name = String(selectedFile.value?.name || '').trim()
  return name || '尚未選擇檔案'
})

const editFieldDefs = EDITABLE_EXTRACTED_FIELDS.map((field) => ({
  key: field.fieldKey,
  label: field.label,
  kind: field.inputType === 'textarea' ? 'textarea' : 'text',
  required: !!field.required,
}))

const getScopedEndpoint = (suffix) => {
  const jobPostId = Number(props.jobPostId)
  if (!Number.isInteger(jobPostId) || jobPostId <= 0) return ''
  return `${apiBaseUrl}/api/job-posts/${jobPostId}${suffix}`
}

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('read-failed'))
    reader.readAsDataURL(file)
  })

const triggerFilePicker = () => {
  if (isBusy.value) return
  fileInputRef.value?.click()
}

const resetParsedState = () => {
  parsedCandidate.value = null
  parsedExtractedText.value = ''
  isEditingExtracted.value = false
  hasEditedExtracted.value = false
  draftFields.value = {}
}

const clearAllState = () => {
  selectedFile.value = null
  cachedCvId.value = ''
  cachedCvName.value = ''
  resetParsedState()
  if (fileInputRef.value) fileInputRef.value.value = ''
}

const isExpiredCacheResponse = (response, data) =>
  Number(response?.status || 0) === 404 &&
  /cached cv not found|expired/i.test(String(data?.message || ''))

const cacheCvFile = async (file) => {
  if (!file) {
    cachedCvId.value = ''
    cachedCvName.value = ''
    return false
  }

  const endpoint = getScopedEndpoint('/cv/cache')
  if (!endpoint) {
    message.value = '請先選擇有效的 Job Post'
    return false
  }

  isCaching.value = true
  try {
    const contentBase64 = await fileToBase64(file)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64,
      }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'CV 快取失敗')

    cachedCvId.value = data.cacheId || ''
    cachedCvName.value = data.fileName || file.name
    return !!cachedCvId.value
  } catch (error) {
    cachedCvId.value = ''
    cachedCvName.value = ''
    message.value = error?.message || 'CV 快取失敗'
    return false
  } finally {
    isCaching.value = false
  }
}

const ensureCachedCv = async () => {
  if (cachedCvId.value) return true
  return cacheCvFile(selectedFile.value)
}

const recacheSelectedFile = async () => {
  if (!selectedFile.value) {
    message.value = '快取已失效，請重新選擇 CV 檔案後再試'
    return false
  }

  message.value = '快取已失效，正在自動重新快取檔案...'
  cachedCvId.value = ''
  cachedCvName.value = ''
  return cacheCvFile(selectedFile.value)
}

const handleFileChange = (event) => {
  selectedFile.value = event.target.files?.[0] || null
  cachedCvId.value = ''
  cachedCvName.value = ''
  message.value = ''
  resetParsedState()
}

const parseCv = async () => {
  message.value = ''
  const endpoint = getScopedEndpoint('/cv/parse')
  if (!endpoint) {
    message.value = '請先選擇有效的 Job Post'
    return
  }
  if (!selectedFile.value) {
    message.value = '請先選擇 CV 檔案'
    return
  }

  const hasCached = await ensureCachedCv()
  if (!hasCached) {
    if (!message.value) message.value = 'CV 快取失敗，請重新選擇檔案'
    return
  }

  isParsing.value = true
  try {
    let response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheId: cachedCvId.value }),
    })
    let data = await response.json()

    if (!response.ok && isExpiredCacheResponse(response, data)) {
      const recached = await recacheSelectedFile()
      if (!recached) return

      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheId: cachedCvId.value }),
      })
      data = await response.json()
    }

    if (!response.ok) {
      message.value = data.message || 'CV 解析失敗'
      return
    }

    parsedCandidate.value = data.candidate || null
    parsedExtractedText.value = String(data.extractedText || '')
    isEditingExtracted.value = false
    hasEditedExtracted.value = false
    draftFields.value = {}
    message.value = 'CV 解析完成，請確認提取結果'
  } catch {
    message.value = 'CV 解析失敗'
  } finally {
    isParsing.value = false
  }
}

const startEditingExtracted = () => {
  if (!parsedCandidate.value) return
  const previewData = buildExtractedPreviewData({
    content: parsedExtractedText.value,
    extracted: parsedCandidate.value.extracted || {},
    parser: parsedCandidate.value.parser || '',
    missingFields: parsedCandidate.value.missingFields || [],
  })
  draftFields.value = buildDraftFieldsFromRows(getEditableRows(previewData))
  isEditingExtracted.value = true
  message.value = ''
}

const cancelEditingExtracted = () => {
  isEditingExtracted.value = false
  draftFields.value = {}
}

const saveEditedExtracted = () => {
  if (!parsedCandidate.value) return
  const editedExtracted = buildEditedExtractedFromDraft(draftFields.value)
  if (!editedExtracted.fullName) {
    message.value = '姓名不可為空'
    return
  }

  const missingFields = computeMissingFields(editedExtracted)
  parsedCandidate.value = {
    ...parsedCandidate.value,
    fullName: editedExtracted.fullName,
    email: editedExtracted.email,
    phone: editedExtracted.phone,
    extracted: editedExtracted,
    missingFields,
    parser: 'manual',
  }
  parsedExtractedText.value = JSON.stringify(
    {
      extracted: editedExtracted,
      missingFields,
      parser: 'manual',
    },
    null,
    2
  )
  hasEditedExtracted.value = true
  isEditingExtracted.value = false
  draftFields.value = {}
  message.value = '已套用編輯內容，確認後即可提交'
}

const cancelParsedUpload = () => {
  clearAllState()
  message.value = '已取消本次 CV 上傳'
}

const confirmUpload = async () => {
  message.value = ''
  const endpoint = getScopedEndpoint('/cv/intake')
  if (!endpoint) {
    message.value = '請先選擇有效的 Job Post'
    return
  }
  if (!cachedCvId.value || !parsedCandidate.value) {
    message.value = '請先完成解析並確認提取結果'
    return
  }
  if (isEditingExtracted.value) {
    message.value = '請先儲存或取消編輯後再提交'
    return
  }

  isConfirmingUpload.value = true
  try {
    const payload = { cacheId: cachedCvId.value }
    if (hasEditedExtracted.value && parsedCandidate.value?.extracted) {
      payload.editedExtracted = parsedCandidate.value.extracted
    }

    let response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    let data = await response.json()

    if (!response.ok && isExpiredCacheResponse(response, data)) {
      const recached = await recacheSelectedFile()
      if (!recached) return

      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, cacheId: cachedCvId.value }),
      })
      data = await response.json()
    }

    if (!response.ok) {
      message.value = data.message || 'CV 提交失敗'
      return
    }

    emit('uploaded', {
      candidateId: data?.candidate?.id ? Number(data.candidate.id) : null,
      applicationId: data?.application?.id ? Number(data.application.id) : null,
      jobPostId: Number(props.jobPostId || 0) || null,
    })
    message.value = 'CV 已提交到 Job Post 並完成職位匹配'
    clearAllState()
  } catch {
    message.value = 'CV 提交失敗'
  } finally {
    isConfirmingUpload.value = false
  }
}
</script>

<template>
  <section class="upload-flow">
    <div v-if="isBusy" class="loading-overlay" aria-live="polite" aria-busy="true">
      <div class="loading-card">
        <div class="spinner" aria-hidden="true" />
        <h4>{{ loadingTitle }}</h4>
        <p>{{ loadingDescription }}</p>
      </div>
    </div>

    <header class="panel-header">
      <div class="panel-title-wrap">
        <h3>上傳與解析 CV</h3>
        <p v-if="props.jobPostTitle" class="job-post-hint">當前 Job Post：{{ props.jobPostTitle }}</p>
      </div>
      <button type="button" class="ghost-btn" @click="emit('closed')">關閉</button>
    </header>

    <div class="card">
      <h4>第一步：解析 CV（不會立即提交）</h4>
      <input
        ref="fileInputRef"
        class="file-input"
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        @change="handleFileChange"
      />
      <div class="file-picker-row">
        <button type="button" class="file-picker-btn" :disabled="isBusy" @click="triggerFilePicker">
          Choose File
        </button>
        <p class="file-name" :class="{ placeholder: !selectedFile }">{{ selectedFileName }}</p>
        <button
          type="button"
          class="primary-action-btn"
          :disabled="isBusy || !selectedFile"
          @click="parseCv"
        >
          {{ isParsing ? '解析中...' : '解析 CV' }}
        </button>
      </div>
      <p v-if="cachedCvId" class="info-line">
        已快取檔案：{{ cachedCvName }}（ID: {{ cachedCvId.slice(0, 8) }}...）
      </p>
      <p v-if="message" class="message">{{ message }}</p>
    </div>

    <div v-if="parsedCandidate" class="card">
      <div class="step-header">
        <h4>第二步：確認 CV 提取結果</h4>
        <button
          v-if="!isEditingExtracted"
          type="button"
          class="edit-btn"
          :disabled="isConfirmingUpload"
          @click="startEditingExtracted"
        >
          編輯
        </button>
      </div>

      <div v-if="isEditingExtracted" class="editor-wrap">
        <p class="edit-hint">請編輯欄位後點擊「儲存編輯」。清單欄位可用逗號或換行分隔。</p>
        <div class="edit-grid">
          <label
            v-for="field in editFieldDefs"
            :key="field.key"
            class="edit-field"
            :class="{ 'full-width': field.kind === 'textarea' }"
          >
            <span>{{ field.label }}</span>
            <textarea
              v-if="field.kind === 'textarea'"
              v-model="draftFields[field.key]"
              rows="3"
              class="edit-input"
              :placeholder="field.required ? '必填' : '選填'"
            />
            <input
              v-else
              v-model="draftFields[field.key]"
              type="text"
              class="edit-input"
              :placeholder="field.required ? '必填' : '選填'"
            />
          </label>
        </div>
        <div class="edit-actions">
          <button type="button" class="save-edit-btn" :disabled="isConfirmingUpload" @click="saveEditedExtracted">
            儲存編輯
          </button>
          <button type="button" class="cancel-edit-btn" :disabled="isConfirmingUpload" @click="cancelEditingExtracted">
            取消編輯
          </button>
        </div>
      </div>

      <CvExtractedFilePreview
        v-else
        :content="parsedExtractedText"
        :extracted="parsedCandidate.extracted || {}"
        :parser="parsedCandidate.parser || ''"
        :missing-fields="parsedCandidate.missingFields || []"
      />

      <div class="confirm-actions">
        <button type="button" class="cancel-btn" :disabled="isConfirmingUpload" @click="cancelParsedUpload">
          取消
        </button>
        <button
          type="button"
          class="confirm-btn"
          :disabled="isConfirmingUpload || isEditingExtracted"
          @click="confirmUpload"
        >
          {{ isConfirmingUpload ? '提交中...' : '確認並提交到 Job Post' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.upload-flow {
  display: grid;
  gap: 1rem;
  color: var(--text-base);
  position: relative;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(243, 247, 251, 0.72);
  border-radius: 28px;
  backdrop-filter: blur(10px);
}

.loading-card {
  min-width: min(360px, 88%);
  max-width: 520px;
  display: grid;
  gap: 0.8rem;
  place-items: center;
  text-align: center;
  padding: 1.2rem 1.25rem;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-md);
}

.loading-card h4,
.loading-card p,
.panel-header h3 {
  margin: 0;
}

.loading-card h4 {
  color: var(--text-strong);
  font-size: 1rem;
}

.loading-card p,
.job-post-hint {
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

.spinner {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 4px solid rgba(16, 24, 40, 0.1);
  border-top-color: var(--accent);
  animation: spin 900ms linear infinite;
}

.panel-header,
.step-header,
.file-picker-row,
.confirm-actions,
.edit-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.panel-title-wrap {
  display: grid;
  gap: 0.2rem;
}

.card {
  display: grid;
  gap: 0.9rem;
}

.file-input {
  display: none;
}

.file-picker-row {
  align-items: stretch;
}

.file-name {
  flex: 1;
  margin: 0;
  padding: 0.82rem 0.95rem;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--border-default);
  border-radius: 18px;
  min-width: 0;
  word-break: break-all;
}

.info-line,
.message,
.edit-hint {
  margin: 0;
}

.editor-wrap,
.edit-grid {
  display: grid;
  gap: 0.8rem;
}

.edit-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.edit-field.full-width {
  grid-column: 1 / -1;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .edit-grid {
    grid-template-columns: 1fr;
  }

  .file-picker-row,
  .confirm-actions,
  .edit-actions,
  .step-header,
  .panel-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
