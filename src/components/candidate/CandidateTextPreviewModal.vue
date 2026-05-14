<script setup>
import { computed, ref, watch } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import ProjectExperiencesField from '../ProjectExperiencesField.vue'
import MatchDimensionBreakdown from '../MatchDimensionBreakdown.vue'
import { parseJsonObject } from '../../scripts/cvExtractedPreview.js'
import {
  buildDraftFieldsFromRows,
  buildExtractedPreviewData,
  getEditableRows,
  normalizeDraftForCompare,
} from '../../scripts/cvExtractedEditor.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  previewType: { type: String, default: 'cv' },
  candidateCvId: { type: Number, default: null },
  applicationId: { type: Number, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  downloadUrl: { type: String, default: '' },
  downloadFileName: { type: String, default: '' },
  filePreviewUrl: { type: String, default: '' },
})

const emit = defineEmits(['close', 'updated'])

const localContent = ref('')
const isEditingAll = ref(false)
const isSavingAll = ref(false)
const draftFields = ref({})
const initialDraftFields = ref({})
const updateMessage = ref('')
const updateError = ref('')
const matchLoading = ref(false)
const matchError = ref('')
const jobMatches = ref([])

const resetEditState = () => {
  isEditingAll.value = false
  isSavingAll.value = false
  draftFields.value = {}
  initialDraftFields.value = {}
}

const resetMatchState = () => {
  matchLoading.value = false
  matchError.value = ''
  jobMatches.value = []
}

const readEmbeddedJobMatches = () => {
  const payload = parseJsonObject(localContent.value)
  const rawMatch = payload?.matchReport
  if (!rawMatch || typeof rawMatch !== 'object') return []

  return [
    {
      jobKey: String(rawMatch.jobKey || '').trim(),
      jobTitle: String(rawMatch.jobTitle || rawMatch.matchedPosition || '').trim(),
      rankNo: 1,
      matchScore: Number(rawMatch.matchScore || 0),
      matchLevel: String(rawMatch.matchLevel || '').trim(),
      reasonSummary: String(rawMatch.reasonSummary || '').trim(),
      strengths: Array.isArray(rawMatch.strengths) ? rawMatch.strengths : [],
      gaps: Array.isArray(rawMatch.gaps) ? rawMatch.gaps : [],
      dimensionEvaluations: Array.isArray(rawMatch.dimensionEvaluations) ? rawMatch.dimensionEvaluations : [],
    },
  ].filter((match) => match.jobKey || match.jobTitle || match.reasonSummary)
}

watch(
  () => props.content,
  (value) => {
    localContent.value = String(value || '')
    updateError.value = ''
    updateMessage.value = ''
    resetEditState()
    resetMatchState()
  },
  { immediate: true }
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      updateError.value = ''
      updateMessage.value = ''
      resetEditState()
      resetMatchState()
    }
  }
)

const extractedPreviewData = computed(() => {
  if (props.previewType !== 'extracted') return null
  return buildExtractedPreviewData({ content: localContent.value })
})

const editableRows = computed(() => {
  return getEditableRows(extractedPreviewData.value)
})

const projectExperienceField = computed(() => extractedPreviewData.value?.projectExperienceField || null)

const shouldRenderExtractedTable = computed(() => !!extractedPreviewData.value)

const loadJobMatches = async () => {
  if (!props.open || props.previewType !== 'extracted') return
  matchLoading.value = true
  matchError.value = ''
  try {
    const endpoint = props.applicationId
      ? `${apiBaseUrl}/api/job-post-applications/${props.applicationId}/match`
      : props.candidateCvId
        ? `${apiBaseUrl}/api/candidate-cvs/${props.candidateCvId}/job-matches`
        : ''
    if (!endpoint) {
      jobMatches.value = readEmbeddedJobMatches()
      return
    }

    const response = await fetch(endpoint)
    const data = await response.json()
    if (!response.ok) {
      matchError.value = data.message || '讀取匹配結果失敗'
      jobMatches.value = readEmbeddedJobMatches()
      return
    }
    if (props.applicationId) {
      jobMatches.value = data.match ? [data.match] : readEmbeddedJobMatches()
      return
    }
    jobMatches.value = Array.isArray(data.matches) && data.matches.length ? data.matches : readEmbeddedJobMatches()
  } catch {
    matchError.value = '讀取匹配結果失敗'
    jobMatches.value = readEmbeddedJobMatches()
  } finally {
    matchLoading.value = false
  }
}

watch(
  () => [props.open, props.candidateCvId, props.applicationId, props.previewType],
  () => {
    if (props.open && props.previewType === 'extracted' && (props.applicationId || props.candidateCvId)) {
      loadJobMatches()
      return
    }
    resetMatchState()
  },
  { immediate: true }
)

const beginEditAll = () => {
  if (!shouldRenderExtractedTable.value || isSavingAll.value) return
  const draft = buildDraftFieldsFromRows(editableRows.value)
  draftFields.value = { ...draft }
  initialDraftFields.value = { ...draft }
  isEditingAll.value = true
  updateError.value = ''
  updateMessage.value = ''
}

const cancelEditAll = () => {
  if (isSavingAll.value) return
  resetEditState()
}

const saveAllEdits = async () => {
  if (!isEditingAll.value || !props.candidateCvId || isSavingAll.value) return

  const updates = {}
  for (const row of editableRows.value) {
    const current = draftFields.value[row.fieldKey]
    const original = initialDraftFields.value[row.fieldKey]
    if (normalizeDraftForCompare(row, current) === normalizeDraftForCompare(row, original)) continue
    updates[row.fieldKey] =
      row.valueType === 'project-experiences' || row.valueType === 'experiences'
        ? current
        : String(current ?? '')
  }

  if (!Object.keys(updates).length) {
    updateMessage.value = '沒有變更可儲存'
    updateError.value = ''
    resetEditState()
    return
  }

  isSavingAll.value = true
  updateError.value = ''
  updateMessage.value = ''

  try {
    let finalData = null
    let updatedFieldKeys = Object.keys(updates)

    const batchResponse = await fetch(`${apiBaseUrl}/api/candidate-cvs/${props.candidateCvId}/extracted-fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    const batchData = await batchResponse.json()

    if (batchResponse.ok) {
      finalData = batchData
      if (Array.isArray(batchData.updatedFields) && batchData.updatedFields.length) {
        updatedFieldKeys = batchData.updatedFields
      }
    } else {
      for (const [fieldKey, value] of Object.entries(updates)) {
        const response = await fetch(`${apiBaseUrl}/api/candidate-cvs/${props.candidateCvId}/extracted-field`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fieldKey, value }),
        })
        const data = await response.json()
        if (!response.ok) {
          updateError.value = data.message || '更新欄位失敗'
          return
        }
        finalData = data
      }
    }

    localContent.value = String(finalData?.text || localContent.value)
    updateMessage.value = '欄位已更新並同步到資料庫'
    resetEditState()
    await loadJobMatches()
    emit('updated', {
      cvId: Number(props.candidateCvId),
      updatedFields: updatedFieldKeys,
    })
  } catch {
    updateError.value = '更新欄位失敗'
  } finally {
    isSavingAll.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="preview-backdrop" @click.self="emit('close')">
      <section class="preview-panel">
        <header class="preview-header">
          <h3>{{ props.title || '檔案預覽' }}</h3>
          <div class="header-actions">
            <a
              v-if="props.downloadUrl"
              class="download-btn"
              :href="props.downloadUrl"
              :download="props.downloadFileName || ''"
              target="_blank"
              rel="noopener noreferrer"
            >
              下載 CV
            </a>
            <button type="button" class="close-btn" @click="emit('close')">關閉</button>
          </div>
        </header>

        <div class="preview-body">
          <p v-if="props.loading" class="hint">讀取中...</p>
          <p v-else-if="props.error" class="error">{{ props.error }}</p>
          <div v-else-if="shouldRenderExtractedTable" class="structured-preview">
            <p v-if="updateMessage" class="success">{{ updateMessage }}</p>
            <p v-if="updateError" class="error">{{ updateError }}</p>
            <p v-if="matchError" class="error">{{ matchError }}</p>

            <div class="bulk-toolbar">
              <button
                v-if="!isEditingAll"
                type="button"
                class="edit-btn"
                @click="beginEditAll"
              >
                編輯
              </button>
              <p v-else class="edit-hint">已進入編輯模式，請修改欄位後在底部點擊確定。</p>
            </div>

            <section class="preview-section">
              <h4>匹配職位</h4>
              <div class="match-wrap">
                <p v-if="matchLoading" class="hint">匹配結果讀取中...</p>
                <p v-else-if="!jobMatches.length" class="hint">尚未產生匹配結果</p>
                <table v-else class="structured-table">
                  <tbody>
                    <tr v-for="match in jobMatches" :key="`${match.jobKey}-${match.rankNo || 1}`">
                      <th>
                        <div class="match-title-row">
                          <strong>{{ match.jobTitle || match.jobKey }}</strong>
                          <span class="match-score">{{ match.matchScore }}</span>
                        </div>
                      </th>
                      <td>
                        <p v-if="match.reasonSummary" class="match-summary">{{ match.reasonSummary }}</p>
                        <p v-if="match.strengths?.length" class="match-list"><span>優勢：</span>{{ match.strengths.join('、') }}</p>
                        <p v-if="match.gaps?.length" class="match-list"><span>缺口：</span>{{ match.gaps.join('、') }}</p>
                        <MatchDimensionBreakdown :evaluations="match.dimensionEvaluations || []" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="preview-section">
              <h4>基本資料</h4>
              <table class="structured-table">
                <tbody>
                  <tr v-for="row in extractedPreviewData.basicRows" :key="`basic-${row.label}`">
                    <th>{{ row.label }}</th>
                    <td :class="{ 'is-empty': row.empty }">
                      <textarea
                        v-if="isEditingAll && row.editable && row.inputType === 'textarea'"
                        v-model="draftFields[row.fieldKey]"
                        rows="3"
                        class="edit-input"
                        placeholder="請輸入新的值"
                      />
                      <input
                        v-else-if="isEditingAll && row.editable"
                        v-model="draftFields[row.fieldKey]"
                        type="text"
                        class="edit-input"
                        placeholder="請輸入新的值"
                      />
                      <span v-else>{{ row.value }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="preview-section">
              <h4>關鍵維度</h4>
              <table class="structured-table">
                <tbody>
                  <tr v-for="row in extractedPreviewData.dimensionRows" :key="`dim-${row.label}`">
                    <th>{{ row.label }}</th>
                    <td :class="{ 'is-empty': row.empty }">
                      <textarea
                        v-if="isEditingAll && row.editable && row.inputType === 'textarea'"
                        v-model="draftFields[row.fieldKey]"
                        rows="3"
                        class="edit-input"
                        placeholder="請輸入新的值"
                      />
                      <input
                        v-else-if="isEditingAll && row.editable"
                        v-model="draftFields[row.fieldKey]"
                        type="text"
                        class="edit-input"
                        placeholder="請輸入新的值"
                      />
                      <span v-else>{{ row.value }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section v-if="projectExperienceField" class="preview-section">
              <h4>專案經歷</h4>
              <div class="project-section">
                <ProjectExperiencesField
                  v-if="isEditingAll"
                  v-model="draftFields[projectExperienceField.fieldKey]"
                  :legacy-text="projectExperienceField.legacyText || ''"
                />
                <ProjectExperiencesField
                  v-else
                  :model-value="projectExperienceField.rawValue || []"
                  :legacy-text="projectExperienceField.legacyText || ''"
                  readonly
                />
              </div>
            </section>

            <div v-if="isEditingAll" class="bulk-actions">
              <button type="button" class="save-btn" :disabled="isSavingAll" @click="saveAllEdits">確定</button>
              <button type="button" class="cancel-btn" :disabled="isSavingAll" @click="cancelEditAll">取消</button>
            </div>
          </div>
          <template v-else-if="props.previewType === 'cv' && props.filePreviewUrl">
            <iframe
              class="cv-file-preview"
              :src="props.filePreviewUrl"
              title="CV 檔案預覽"
            ></iframe>
          </template>
          <template v-else>
            <p v-if="props.previewType === 'cv' && !props.downloadUrl" class="hint">
              原始 CV 檔案已不在儲存空間，目前只能查看已解析內容。
            </p>
            <pre class="content">{{ localContent || '（無內容）' }}</pre>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.preview-panel {
  display: grid;
  grid-template-rows: auto 1fr;
  width: min(1180px, calc(100vw - 2rem));
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}

.content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-strong);
  font-size: 0.92rem;
  line-height: 1.5;
}

.cv-file-preview {
  display: block;
  width: 100%;
  min-height: min(78vh, 860px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: #ffffff;
}

.structured-preview {
  display: grid;
  gap: 0.9rem;
}

.match-wrap {
  padding: 0.35rem 0;
  display: grid;
  gap: 0.55rem;
}

.match-title-row {
  display: grid;
  gap: 0.35rem;
}

.match-score {
  color: var(--accent);
  font-weight: 700;
}

.match-summary,
.match-list {
  margin: 0.35rem 0 0;
  color: var(--text-base);
  font-size: 0.9rem;
}

.match-list span {
  font-weight: 600;
}

.bulk-toolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.edit-hint {
  margin: 0;
  color: var(--text-base);
  font-size: 0.88rem;
}

.preview-section {
  overflow: hidden;
  background: rgba(255, 255, 255, 0.72);
}

.preview-section h4 {
  margin: 0;
  padding: 0.88rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(244, 248, 252, 0.86);
  color: var(--text-strong);
  font-size: 0.92rem;
}

.project-section {
  padding: 0.95rem 1rem 1rem;
}

.structured-table th {
  width: 150px;
}

.structured-table td {
  white-space: pre-wrap;
  word-break: break-word;
}

.structured-table td.is-empty {
  color: var(--danger);
  font-weight: 600;
}

.bulk-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}

@media (max-width: 700px) {
  .structured-table th {
    width: 110px;
  }

  .bulk-toolbar,
  .bulk-actions {
    justify-content: flex-start;
  }
}
</style>
