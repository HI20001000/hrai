<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import { resolveJobDictionary } from '../../scripts/jobDictionary.js'

const props = defineProps({
  selectedTitle: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['updated', 'selected-title-change'])

const jobDictionaryLoading = ref(false)
const jobDictionarySaving = ref(false)
const jobDictionaryMessage = ref('')
const jobDictionaryError = ref('')
const jobDictionary = ref({})
const selectedJobTitle = ref('')
const newJobTitle = ref('')
const jobDraft = ref(null)

const WEIGHT_FIELDS = [
  { key: 'requiredSkills', label: '必備技能' },
  { key: 'projectExperience', label: '專案經驗' },
  { key: 'industry', label: '行業背景' },
  { key: 'coreResponsibilities', label: '核心職責' },
  { key: 'certifications', label: '證照' },
  { key: 'workYears', label: '工作年資' },
  { key: 'candidatePreference', label: '候選人偏好' },
]

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

const normalizeText = (value) => String(value ?? '').trim()

const normalizeListText = (value) =>
  String(value ?? '')
    .split(/[\n,，;；、|/]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const createEmptyJob = () => ({
  description: '',
  industry: [],
  roleKeywords: [],
  coreResponsibilities: [],
  requiredSkills: [],
  preferredSkills: [],
  certifications: [],
  minWorkYears: 1,
  salaryRange: { min: 0, max: 0 },
  weights: {
    requiredSkills: 0.25,
    projectExperience: 0.2,
    industry: 0.15,
    coreResponsibilities: 0.1,
    certifications: 0.1,
    workYears: 0.1,
    candidatePreference: 0.1,
  },
})

const buildJobDraft = (jobTitle, job) => {
  const source = job && typeof job === 'object' ? job : createEmptyJob()
  return {
    title: normalizeText(jobTitle),
    description: normalizeText(source.description),
    industryText: (source.industry || []).join(', '),
    roleKeywordsText: (source.roleKeywords || []).join(', '),
    coreResponsibilitiesText: (source.coreResponsibilities || []).join(', '),
    requiredSkillsText: (source.requiredSkills || []).join(', '),
    preferredSkillsText: (source.preferredSkills || []).join(', '),
    certificationsText: (source.certifications || []).join(', '),
    minWorkYears: String(source.minWorkYears ?? 1),
    salaryMin: String(source?.salaryRange?.min ?? 0),
    salaryMax: String(source?.salaryRange?.max ?? 0),
    weights: Object.fromEntries(
      WEIGHT_FIELDS.map((field) => [field.key, String(source?.weights?.[field.key] ?? 0)])
    ),
  }
}

const draftToJob = (draft) => ({
  description: normalizeText(draft?.description),
  industry: normalizeListText(draft?.industryText),
  roleKeywords: normalizeListText(draft?.roleKeywordsText),
  coreResponsibilities: normalizeListText(draft?.coreResponsibilitiesText),
  requiredSkills: normalizeListText(draft?.requiredSkillsText),
  preferredSkills: normalizeListText(draft?.preferredSkillsText),
  certifications: normalizeListText(draft?.certificationsText),
  minWorkYears: Number(draft?.minWorkYears || 0),
  salaryRange: {
    min: Number(draft?.salaryMin || 0),
    max: Number(draft?.salaryMax || 0),
  },
  weights: Object.fromEntries(
    WEIGHT_FIELDS.map((field) => [field.key, Number(draft?.weights?.[field.key] || 0)])
  ),
})

const getAuthContext = () => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  if (!token) return { ok: false, message: '尚未登入或登入資訊已過期' }
  return {
    ok: true,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }
}

const sortedJobTitles = computed(() =>
  Object.keys(jobDictionary.value || {}).sort((a, b) => a.localeCompare(b))
)

const rawDictionaryPreview = computed(() => JSON.stringify(jobDictionary.value || {}, null, 2))

const activeJobTitle = computed(() => selectedJobTitle.value || '未選擇職位')

const emitUpdated = () => {
  emit('updated', jobDictionary.value)
}

const emitSelectedTitleChange = (title) => {
  emit('selected-title-change', normalizeText(title))
}

const setSelectedJob = (jobTitle) => {
  const normalizedTitle = normalizeText(jobTitle)
  selectedJobTitle.value = normalizedTitle
  jobDraft.value = normalizedTitle && jobDictionary.value?.[normalizedTitle]
    ? buildJobDraft(normalizedTitle, jobDictionary.value[normalizedTitle])
    : null
  jobDictionaryMessage.value = ''
  jobDictionaryError.value = ''
  emitSelectedTitleChange(normalizedTitle)
}

const syncExternalSelection = (title) => {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) return
  if (jobDictionary.value[normalizedTitle]) {
    setSelectedJob(normalizedTitle)
    return
  }
  selectedJobTitle.value = ''
  jobDraft.value = null
}

const validateJobDraft = (jobTitle, nextJob) => {
  if (!normalizeText(jobTitle)) throw new Error('職位名稱不可為空')
  if (!normalizeText(nextJob.description)) throw new Error('職位描述不可為空')
  if (!nextJob.industry.length) throw new Error('行業背景至少需填 1 項')
  if (!nextJob.roleKeywords.length) throw new Error('職位關鍵字至少需填 1 項')
  if (!nextJob.coreResponsibilities.length) throw new Error('核心職責至少需填 1 項')
  if (!nextJob.requiredSkills.length) throw new Error('必備技能至少需填 1 項')
  if (!nextJob.preferredSkills.length) throw new Error('加分技能至少需填 1 項')
  if (!nextJob.certifications.length) throw new Error('證照至少需填 1 項')
  if (!Number.isFinite(nextJob.minWorkYears)) throw new Error('最低工作年資必須是數字')
  if (!Number.isFinite(nextJob.salaryRange.min) || !Number.isFinite(nextJob.salaryRange.max)) {
    throw new Error('薪資範圍必須是數字')
  }
  if (nextJob.salaryRange.min > nextJob.salaryRange.max) {
    throw new Error('最低薪資不可大於最高薪資')
  }

  const sum = Object.values(nextJob.weights).reduce((acc, value) => acc + Number(value || 0), 0)
  if (Math.abs(sum - 1) > 0.000001) throw new Error('權重總和必須等於 1.0')
}

const commitSelectedJobDraft = () => {
  if (!selectedJobTitle.value || !jobDraft.value) {
    jobDictionaryError.value = '請先選擇職位'
    return false
  }

  try {
    const nextTitle = normalizeText(jobDraft.value.title)
    const nextJob = draftToJob(jobDraft.value)
    validateJobDraft(nextTitle, nextJob)

    if (nextTitle !== selectedJobTitle.value && jobDictionary.value[nextTitle]) {
      throw new Error('職位名稱已存在')
    }

    const nextDictionary = {}
    for (const title of sortedJobTitles.value) {
      if (title === selectedJobTitle.value) {
        nextDictionary[nextTitle] = nextJob
      } else {
        nextDictionary[title] = jobDictionary.value[title]
      }
    }

    if (!nextDictionary[nextTitle]) {
      nextDictionary[nextTitle] = nextJob
    }

    jobDictionary.value = nextDictionary
    selectedJobTitle.value = nextTitle
    jobDraft.value = buildJobDraft(nextTitle, nextJob)
    jobDictionaryMessage.value = `已套用「${nextTitle}」的編輯內容`
    jobDictionaryError.value = ''
    emitUpdated()
    return true
  } catch (error) {
    jobDictionaryError.value = error?.message || '職位資料驗證失敗'
    jobDictionaryMessage.value = ''
    return false
  }
}

const loadJobDictionary = async () => {
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  jobDictionaryLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
      method: 'GET',
      headers: {
        Authorization: auth.headers.Authorization,
      },
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '讀取職位字典失敗'
      return
    }

    jobDictionary.value = resolveJobDictionary(data)
    if (normalizeText(props.selectedTitle)) {
      syncExternalSelection(props.selectedTitle)
    } else {
      const firstTitle = sortedJobTitles.value[0] || ''
      if (firstTitle) setSelectedJob(firstTitle)
      else {
        selectedJobTitle.value = ''
        jobDraft.value = null
      }
    }
    emitUpdated()
  } catch {
    jobDictionaryError.value = '讀取職位字典失敗'
  } finally {
    jobDictionaryLoading.value = false
  }
}

const addJob = () => {
  const title = normalizeText(newJobTitle.value)
  if (!title) {
    jobDictionaryError.value = '請輸入新的職位名稱'
    return
  }
  if (jobDictionary.value[title]) {
    jobDictionaryError.value = '職位名稱已存在'
    return
  }

  jobDictionary.value = {
    ...jobDictionary.value,
    [title]: createEmptyJob(),
  }
  newJobTitle.value = ''
  setSelectedJob(title)
  jobDictionaryMessage.value = `已新增職位「${title}」，請編輯後儲存字典`
  emitUpdated()
}

const deleteSelectedJob = () => {
  if (!selectedJobTitle.value || !jobDictionary.value[selectedJobTitle.value]) {
    jobDictionaryError.value = '請先選擇要刪除的職位'
    return
  }

  const confirmed = window.confirm(`確定刪除職位字典「${selectedJobTitle.value}」？`)
  if (!confirmed) return

  const nextDictionary = { ...jobDictionary.value }
  delete nextDictionary[selectedJobTitle.value]
  jobDictionary.value = nextDictionary
  const nextTitle = Object.keys(nextDictionary).sort((a, b) => a.localeCompare(b))[0] || ''
  if (nextTitle) {
    setSelectedJob(nextTitle)
  } else {
    selectedJobTitle.value = ''
    jobDraft.value = null
  }
  jobDictionaryMessage.value = '已從當前字典草稿移除職位，記得儲存整份字典'
  jobDictionaryError.value = ''
  emitUpdated()
}

const saveJobDictionaryConfig = async () => {
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  if (!commitSelectedJobDraft()) return

  jobDictionarySaving.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
      method: 'PUT',
      headers: auth.headers,
      body: JSON.stringify({ dictionary: jobDictionary.value }),
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '儲存職位字典失敗'
      return
    }

    const resolvedDictionary = resolveJobDictionary(data)
    jobDictionary.value = Object.keys(resolvedDictionary).length ? resolvedDictionary : jobDictionary.value
    if (selectedJobTitle.value && jobDictionary.value[selectedJobTitle.value]) {
      jobDraft.value = buildJobDraft(selectedJobTitle.value, jobDictionary.value[selectedJobTitle.value])
    }
    jobDictionaryMessage.value = '職位字典已更新，僅影響之後新上傳或新觸發匹配的 CV'
    emitUpdated()
  } catch {
    jobDictionaryError.value = '儲存職位字典失敗'
  } finally {
    jobDictionarySaving.value = false
  }
}

watch(
  () => props.selectedTitle,
  (value) => {
    if (!jobDictionaryLoading.value && Object.keys(jobDictionary.value).length) {
      syncExternalSelection(value)
    }
  }
)

onMounted(() => {
  loadJobDictionary()
})
</script>

<template>
  <section class="card dictionary-card">
    <header class="card-header">
      <div>
        <h3>職位字典配置</h3>
        <p>維護 `finance-job-positions.json`。更新後僅影響之後新上傳或新觸發匹配的 CV。</p>
      </div>
      <button
        type="button"
        class="secondary-btn"
        :disabled="jobDictionaryLoading || jobDictionarySaving"
        @click="loadJobDictionary"
      >
        刷新
      </button>
    </header>

    <p v-if="jobDictionaryMessage" class="success-msg">{{ jobDictionaryMessage }}</p>
    <p v-if="jobDictionaryError" class="error-msg">{{ jobDictionaryError }}</p>

    <div class="dictionary-layout">
      <aside class="dictionary-sidebar">
        <div class="sidebar-header">
          <p class="sidebar-title">職位列表</p>
          <div class="dictionary-create-row">
            <input
              v-model.trim="newJobTitle"
              type="text"
              placeholder="輸入新的職位名稱"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
            />
            <button
              type="button"
              class="secondary-btn"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
              @click="addJob"
            >
              新增職位
            </button>
          </div>
        </div>

        <div class="job-list">
          <button
            v-for="jobTitle in sortedJobTitles"
            :key="jobTitle"
            type="button"
            class="job-list-item"
            :class="{ active: selectedJobTitle === jobTitle }"
            @click="setSelectedJob(jobTitle)"
          >
            <strong>{{ jobTitle }}</strong>
          </button>
        </div>
      </aside>

      <section class="dictionary-editor">
        <template v-if="selectedJobTitle && jobDraft">
          <div class="editor-header">
            <div>
              <h4>{{ activeJobTitle }}</h4>
            </div>
            <button
              type="button"
              class="danger-btn"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
              @click="deleteSelectedJob"
            >
              刪除當前職位
            </button>
          </div>

          <div class="editor-grid">
            <label class="field">
              <span>職位名稱</span>
              <input v-model="jobDraft.title" type="text" />
            </label>

            <label class="field full-width">
              <span>職位描述</span>
              <textarea v-model="jobDraft.description" rows="3" />
            </label>

            <label class="field">
              <span>行業背景</span>
              <textarea v-model="jobDraft.industryText" rows="3" />
            </label>

            <label class="field">
              <span>職位關鍵字</span>
              <textarea v-model="jobDraft.roleKeywordsText" rows="3" />
            </label>

            <label class="field">
              <span>核心職責</span>
              <textarea v-model="jobDraft.coreResponsibilitiesText" rows="3" />
            </label>

            <label class="field">
              <span>必備技能</span>
              <textarea v-model="jobDraft.requiredSkillsText" rows="3" />
            </label>

            <label class="field">
              <span>加分技能</span>
              <textarea v-model="jobDraft.preferredSkillsText" rows="3" />
            </label>

            <label class="field">
              <span>證照</span>
              <textarea v-model="jobDraft.certificationsText" rows="3" />
            </label>

            <label class="field">
              <span>最低工作年資</span>
              <input v-model="jobDraft.minWorkYears" type="number" min="0" step="1" />
            </label>

            <label class="field">
              <span>最低薪資（MOP / 月）</span>
              <input v-model="jobDraft.salaryMin" type="number" min="0" step="1" />
            </label>

            <label class="field">
              <span>最高薪資（MOP / 月）</span>
              <input v-model="jobDraft.salaryMax" type="number" min="0" step="1" />
            </label>
          </div>

          <section class="weight-section">
            <p class="weight-title">權重</p>
            <div class="weight-grid">
              <label v-for="field in WEIGHT_FIELDS" :key="field.key" class="field">
                <span>{{ field.label }}</span>
                <input v-model="jobDraft.weights[field.key]" type="number" min="0" max="1" step="0.01" />
              </label>
            </div>
          </section>

          <div class="actions">
            <button type="button" class="secondary-btn" :disabled="jobDictionarySaving" @click="commitSelectedJobDraft">
              套用當前編輯
            </button>
            <button
              type="button"
              class="primary-btn"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
              @click="saveJobDictionaryConfig"
            >
              {{ jobDictionarySaving ? '儲存中...' : '儲存整份字典' }}
            </button>
          </div>
        </template>

        <p v-else class="empty-dictionary-state">尚未選擇職位。</p>
      </section>
    </div>

    <section class="raw-preview-section">
      <div class="card-header">
        <div>
          <h3>原始 JSON 預覽</h3>
          <p>只讀預覽，實際儲存以上方表單編輯內容為準。</p>
        </div>
      </div>
      <pre class="raw-preview">{{ rawDictionaryPreview }}</pre>
    </section>
  </section>
</template>

<style scoped>
.dictionary-card {
  color: var(--text-base);
}

.sidebar-title,
.weight-title {
  margin: 0;
}

.job-list-item strong,
.editor-header h4 {
  margin: 0;
  color: var(--text-strong);
}

.empty-dictionary-state {
  color: var(--text-muted);
}

.sidebar-header,
.dictionary-create-row,
.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.sidebar-header {
  flex-direction: column;
  margin-bottom: 0.9rem;
}

.dictionary-create-row input {
  flex: 1;
  min-width: 180px;
}

.dictionary-layout {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 1rem;
}

.dictionary-sidebar,
.dictionary-editor,
.raw-preview-section {
  padding: 0.9rem;
}

.job-list {
  display: grid;
  gap: 0.55rem;
  max-height: 460px;
  overflow: auto;
}

.job-list-item {
  border: 1px solid var(--border-default);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  padding: 0.85rem;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 0.2rem;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.job-list-item:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.job-list-item.active {
  border-color: rgba(47, 111, 237, 0.18);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.1), rgba(255, 255, 255, 0.82));
}

.dictionary-editor {
  display: grid;
  gap: 1rem;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.editor-grid,
.weight-grid {
  display: grid;
  gap: 0.85rem;
}

.editor-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.weight-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.full-width {
  grid-column: 1 / -1;
}

.raw-preview {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 0.9rem;
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.92);
  color: #e2e8f0;
  font-size: 0.82rem;
  line-height: 1.55;
}

@media (max-width: 960px) {
  .dictionary-layout,
  .editor-grid,
  .weight-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .editor-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
