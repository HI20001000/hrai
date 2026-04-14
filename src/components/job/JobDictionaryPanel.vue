<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'

const emit = defineEmits(['updated'])

const jobDictionaryLoading = ref(false)
const jobDictionarySaving = ref(false)
const jobDictionaryMessage = ref('')
const jobDictionaryError = ref('')
const jobDictionary = ref({})
const selectedJobKey = ref('')
const newJobKey = ref('')
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
  title: '',
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

const buildJobDraft = (job) => {
  const source = job && typeof job === 'object' ? job : createEmptyJob()
  return {
    title: normalizeText(source.title),
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
  title: normalizeText(draft?.title),
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

const sortedJobEntries = computed(() =>
  Object.entries(jobDictionary.value || {}).sort((a, b) => a[0].localeCompare(b[0]))
)

const rawDictionaryPreview = computed(() => JSON.stringify(jobDictionary.value || {}, null, 2))

const activeJobTitle = computed(() => {
  const job = jobDictionary.value?.[selectedJobKey.value]
  return normalizeText(job?.title) || selectedJobKey.value || '未選擇職位'
})

const selectJob = (jobKey) => {
  selectedJobKey.value = normalizeText(jobKey)
  jobDraft.value = buildJobDraft(jobDictionary.value?.[selectedJobKey.value])
  jobDictionaryMessage.value = ''
  jobDictionaryError.value = ''
}

const validateJobDraft = (jobKey, nextJob) => {
  if (!normalizeText(jobKey)) throw new Error('職位代碼不可為空')
  if (!normalizeText(nextJob.title)) throw new Error('職位名稱不可為空')
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
  if (!selectedJobKey.value || !jobDraft.value) {
    jobDictionaryError.value = '請先選擇職位'
    return false
  }

  try {
    const nextJob = draftToJob(jobDraft.value)
    validateJobDraft(selectedJobKey.value, nextJob)
    jobDictionary.value = {
      ...jobDictionary.value,
      [selectedJobKey.value]: nextJob,
    }
    jobDictionaryMessage.value = `已套用 ${selectedJobKey.value} 的編輯內容`
    jobDictionaryError.value = ''
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

    jobDictionary.value = data.dictionary && typeof data.dictionary === 'object' ? data.dictionary : {}
    const firstKey = selectedJobKey.value && jobDictionary.value[selectedJobKey.value]
      ? selectedJobKey.value
      : Object.keys(jobDictionary.value)[0] || ''
    if (firstKey) {
      selectJob(firstKey)
    } else {
      selectedJobKey.value = ''
      jobDraft.value = null
    }
    emit('updated', jobDictionary.value)
  } catch {
    jobDictionaryError.value = '讀取職位字典失敗'
  } finally {
    jobDictionaryLoading.value = false
  }
}

const addJob = () => {
  const jobKey = normalizeText(newJobKey.value)
  if (!jobKey) {
    jobDictionaryError.value = '請輸入新的職位代碼'
    return
  }
  if (jobDictionary.value[jobKey]) {
    jobDictionaryError.value = '職位代碼已存在'
    return
  }

  jobDictionary.value = {
    ...jobDictionary.value,
    [jobKey]: createEmptyJob(),
  }
  newJobKey.value = ''
  selectJob(jobKey)
  jobDictionaryMessage.value = `已新增職位「${jobKey}」，請編輯後儲存字典`
}

const deleteSelectedJob = () => {
  if (!selectedJobKey.value || !jobDictionary.value[selectedJobKey.value]) {
    jobDictionaryError.value = '請先選擇要刪除的職位'
    return
  }

  const nextDictionary = { ...jobDictionary.value }
  delete nextDictionary[selectedJobKey.value]
  jobDictionary.value = nextDictionary
  const nextKey = Object.keys(nextDictionary)[0] || ''
  if (nextKey) {
    selectJob(nextKey)
  } else {
    selectedJobKey.value = ''
    jobDraft.value = null
  }
  jobDictionaryMessage.value = '已從當前字典草稿移除職位，記得儲存整份字典'
  jobDictionaryError.value = ''
  emit('updated', jobDictionary.value)
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

    jobDictionary.value = data.dictionary && typeof data.dictionary === 'object' ? data.dictionary : jobDictionary.value
    if (selectedJobKey.value) {
      jobDraft.value = buildJobDraft(jobDictionary.value[selectedJobKey.value])
    }
    jobDictionaryMessage.value = '職位字典已更新，僅影響之後新建立的 Job Post 或新觸發匹配的 CV'
    emit('updated', jobDictionary.value)
  } catch {
    jobDictionaryError.value = '儲存職位字典失敗'
  } finally {
    jobDictionarySaving.value = false
  }
}

onMounted(() => {
  loadJobDictionary()
})
</script>

<template>
  <section class="card dictionary-card">
    <header class="card-header">
      <div>
        <h3>職位字典配置</h3>
        <p>維護 `finance-job-positions.json`。更新後會影響之後新建立的 Job Post。</p>
      </div>
      <button type="button" class="secondary-btn" :disabled="jobDictionaryLoading || jobDictionarySaving" @click="loadJobDictionary">
        重新載入
      </button>
    </header>

    <div class="dictionary-create-row">
      <input
        v-model.trim="newJobKey"
        type="text"
        placeholder="輸入新的職位代碼，例如 客戶經理 或 compliance_officer"
        :disabled="jobDictionaryLoading || jobDictionarySaving"
      />
      <button type="button" class="secondary-btn" :disabled="jobDictionaryLoading || jobDictionarySaving" @click="addJob">
        新增職位
      </button>
      <button
        type="button"
        class="danger-btn"
        :disabled="!selectedJobKey || jobDictionaryLoading || jobDictionarySaving"
        @click="deleteSelectedJob"
      >
        刪除當前職位
      </button>
    </div>

    <p v-if="jobDictionaryMessage" class="success-msg">{{ jobDictionaryMessage }}</p>
    <p v-if="jobDictionaryError" class="error-msg">{{ jobDictionaryError }}</p>

    <div class="dictionary-layout">
      <aside class="dictionary-sidebar">
        <p class="sidebar-title">職位列表</p>
        <div class="job-list">
          <button
            v-for="[jobKey, job] in sortedJobEntries"
            :key="jobKey"
            type="button"
            class="job-list-item"
            :class="{ active: selectedJobKey === jobKey }"
            @click="selectJob(jobKey)"
          >
            <strong>{{ job.title || jobKey }}</strong>
            <span>{{ jobKey }}</span>
          </button>
        </div>
      </aside>

      <section class="dictionary-editor">
        <template v-if="selectedJobKey && jobDraft">
          <div class="editor-header">
            <div>
              <h4>{{ activeJobTitle }}</h4>
              <p>{{ selectedJobKey }}</p>
            </div>
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
            <p class="weight-title">Weights</p>
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
            <button type="button" class="primary-btn" :disabled="jobDictionaryLoading || jobDictionarySaving" @click="saveJobDictionaryConfig">
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

.job-list-item span,
.editor-header p,
.empty-dictionary-state {
  color: var(--text-muted);
}

.dictionary-create-row,
.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.dictionary-create-row input {
  flex: 1;
  min-width: 220px;
}

.dictionary-layout {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
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
  border-color: rgba(47, 111, 237, 0.2);
  background: rgba(47, 111, 237, 0.08);
}

.editor-grid,
.weight-grid {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.weight-section {
  display: grid;
  gap: 0.75rem;
}

.raw-preview {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  background: var(--surface-inverse);
  color: rgba(255, 255, 255, 0.82);
  border-radius: 18px;
  padding: 0.9rem;
  font-size: 0.84rem;
}

@media (max-width: 1100px) {
  .dictionary-layout {
    grid-template-columns: 1fr;
  }

  .editor-grid,
  .weight-grid {
    grid-template-columns: 1fr;
  }
}
</style>
