<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'

const props = defineProps({
  userProfile: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['profile-updated'])

const profileLoading = ref(false)
const profileMessage = ref('')
const profileError = ref('')
const username = ref('')
const avatarText = ref('')
const avatarBgColor = ref('#334155')
const isAdvancedAvatarEditorOpen = ref(false)

const avatarEmojiPresets = ['🙂', '😎', '🤖', '🦊', '🐼', '🐧', '🐱', '🧠', '🚀', '🎯']
const avatarBgColorPresets = [
  '#a9c2ff',
  '#b5b8ff',
  '#c5b6f5',
  '#e1b8ea',
  '#f6bfd4',
  '#f9ccb1',
  '#f6dfa8',
  '#cfe9b6',
  '#bde7cc',
  '#b9e7e1',
]

const passwordLoading = ref(false)
const passwordMessage = ref('')
const passwordError = ref('')
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

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

  const expiresAtMs = Date.parse(String(auth?.expiresAt || ''))
  if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
    window.localStorage.removeItem('innerai_auth')
    window.localStorage.removeItem('innerai_user')
    return { ok: false, message: '登入已過期，請重新登入' }
  }

  return {
    ok: true,
    token,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }
}

const handleUnauthorized = (target) => {
  window.localStorage.removeItem('innerai_auth')
  window.localStorage.removeItem('innerai_user')
  if (target === 'password') {
    passwordError.value = '登入已過期，請重新登入後再試'
    return
  }
  if (target === 'dictionary') {
    jobDictionaryError.value = '登入已過期，請重新登入後再試'
    return
  }
  profileError.value = '登入已過期，請重新登入後再試'
}

const applyUserProfile = (user) => {
  const payload = user && typeof user === 'object' ? user : {}
  username.value = String(payload.username || '').trim()
  avatarText.value = String(payload.avatarText || '').trim() || 'U'
  avatarBgColor.value = /^#[0-9a-fA-F]{6}$/.test(String(payload.avatarBgColor || '').trim())
    ? String(payload.avatarBgColor).trim()
    : '#334155'
}

const selectAvatarEmojiPreset = (emoji) => {
  avatarText.value = String(emoji || '').trim() || avatarText.value
}

const selectAvatarBgColorPreset = (color) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(color || '').trim())) return
  avatarBgColor.value = String(color).trim()
}

const persistUserProfile = (user) => {
  if (!user || typeof user !== 'object') return
  window.localStorage.setItem('innerai_user', JSON.stringify(user))
  emit('profile-updated', user)
}

const sortedJobEntries = computed(() =>
  Object.entries(jobDictionary.value || {}).sort((a, b) => a[0].localeCompare(b[0]))
)

const rawDictionaryPreview = computed(() => JSON.stringify(jobDictionary.value || {}, null, 2))

const activeJobTitle = computed(() => {
  const job = jobDictionary.value?.[selectedJobKey.value]
  return normalizeText(job?.title) || selectedJobKey.value || '未選擇職位'
})

watch(
  () => props.userProfile,
  (value) => {
    if (!value) return
    applyUserProfile(value)
  },
  { immediate: true }
)

const selectJob = (jobKey) => {
  selectedJobKey.value = normalizeText(jobKey)
  jobDraft.value = buildJobDraft(jobDictionary.value?.[selectedJobKey.value])
  jobDictionaryMessage.value = ''
  jobDictionaryError.value = ''
}

const validateJobDraft = (jobKey, nextJob) => {
  if (!normalizeText(jobKey)) throw new Error('job key 不可為空')
  if (!normalizeText(nextJob.title)) throw new Error('title 不可為空')
  if (!normalizeText(nextJob.description)) throw new Error('description 不可為空')
  if (!nextJob.industry.length) throw new Error('industry 至少需填 1 項')
  if (!nextJob.roleKeywords.length) throw new Error('roleKeywords 至少需填 1 項')
  if (!nextJob.coreResponsibilities.length) throw new Error('coreResponsibilities 至少需填 1 項')
  if (!nextJob.requiredSkills.length) throw new Error('requiredSkills 至少需填 1 項')
  if (!nextJob.preferredSkills.length) throw new Error('preferredSkills 至少需填 1 項')
  if (!nextJob.certifications.length) throw new Error('certifications 至少需填 1 項')
  if (!Number.isFinite(nextJob.minWorkYears)) throw new Error('minWorkYears 必須是數字')
  if (!Number.isFinite(nextJob.salaryRange.min) || !Number.isFinite(nextJob.salaryRange.max)) {
    throw new Error('salaryRange 必須是數字')
  }
  if (nextJob.salaryRange.min > nextJob.salaryRange.max) {
    throw new Error('salaryRange.min 不可大於 salaryRange.max')
  }

  const sum = Object.values(nextJob.weights).reduce((acc, value) => acc + Number(value || 0), 0)
  if (Math.abs(sum - 1) > 0.000001) throw new Error('weights 總和必須等於 1.0')
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

const loadMyProfile = async () => {
  profileError.value = ''
  profileMessage.value = ''
  const auth = getAuthContext()
  if (!auth.ok) {
    profileError.value = auth.message
    return
  }

  profileLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/profile`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    })
    const data = await response.json()
    if (response.status === 401) {
      handleUnauthorized('profile')
      return
    }
    if (!response.ok) {
      profileError.value = data.message || '讀取個人設定失敗'
      return
    }

    applyUserProfile(data.user)
    persistUserProfile(data.user)
  } catch {
    profileError.value = '讀取個人設定失敗'
  } finally {
    profileLoading.value = false
  }
}

const saveProfile = async () => {
  profileError.value = ''
  profileMessage.value = ''

  const auth = getAuthContext()
  if (!auth.ok) {
    profileError.value = auth.message
    return
  }

  const normalizedUsername = username.value.trim()
  if (!normalizedUsername) {
    profileError.value = '使用者名稱不可為空'
    return
  }

  const normalizedAvatarText = avatarText.value.trim()
  if (!normalizedAvatarText) {
    profileError.value = '頭像文字不可為空'
    return
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(avatarBgColor.value.trim())) {
    profileError.value = '頭像背景色格式錯誤'
    return
  }

  profileLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/profile`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        username: normalizedUsername,
        avatarText: normalizedAvatarText,
        avatarBgColor: avatarBgColor.value.trim(),
      }),
    })
    const data = await response.json()
    if (response.status === 401) {
      handleUnauthorized('profile')
      return
    }
    if (!response.ok) {
      profileError.value = data.message || '儲存個人設定失敗'
      return
    }

    applyUserProfile(data.user)
    persistUserProfile(data.user)
    profileMessage.value = '個人設定已更新'
  } catch {
    profileError.value = '儲存個人設定失敗'
  } finally {
    profileLoading.value = false
  }
}

const changePassword = async () => {
  passwordError.value = ''
  passwordMessage.value = ''

  const auth = getAuthContext()
  if (!auth.ok) {
    passwordError.value = auth.message
    return
  }

  if (!currentPassword.value || !newPassword.value) {
    passwordError.value = '請輸入目前密碼與新密碼'
    return
  }

  if (newPassword.value.length < 6) {
    passwordError.value = '新密碼至少需要 6 碼'
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = '新密碼與確認密碼不一致'
    return
  }

  passwordLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    })
    const data = await response.json()
    if (response.status === 401) {
      handleUnauthorized('password')
      return
    }
    if (!response.ok) {
      passwordError.value = data.message || '修改密碼失敗'
      return
    }

    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordMessage.value = '密碼已更新'
  } catch {
    passwordError.value = '修改密碼失敗'
  } finally {
    passwordLoading.value = false
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
        Authorization: `Bearer ${auth.token}`,
      },
    })
    const data = await response.json()
    if (response.status === 401) {
      handleUnauthorized('dictionary')
      return
    }
    if (!response.ok) {
      jobDictionaryError.value = data.message || '讀取職位字典失敗'
      return
    }

    jobDictionary.value = data.dictionary && typeof data.dictionary === 'object' ? data.dictionary : {}
    const firstKey = selectedJobKey.value && jobDictionary.value[selectedJobKey.value]
      ? selectedJobKey.value
      : sortedJobEntries.value[0]?.[0] || ''
    if (firstKey) selectJob(firstKey)
    else {
      selectedJobKey.value = ''
      jobDraft.value = null
    }
  } catch {
    jobDictionaryError.value = '讀取職位字典失敗'
  } finally {
    jobDictionaryLoading.value = false
  }
}

const addJob = () => {
  const jobKey = normalizeText(newJobKey.value)
  if (!jobKey) {
    jobDictionaryError.value = '請輸入新的 job key'
    return
  }
  if (!/^[a-z0-9_]+$/i.test(jobKey)) {
    jobDictionaryError.value = 'job key 只能包含英文、數字與底線'
    return
  }
  if (jobDictionary.value[jobKey]) {
    jobDictionaryError.value = 'job key 已存在'
    return
  }

  jobDictionary.value = {
    ...jobDictionary.value,
    [jobKey]: createEmptyJob(),
  }
  newJobKey.value = ''
  selectJob(jobKey)
  jobDictionaryMessage.value = `已新增職位 ${jobKey}，請編輯後儲存字典`
}

const deleteSelectedJob = () => {
  if (!selectedJobKey.value || !jobDictionary.value[selectedJobKey.value]) {
    jobDictionaryError.value = '請先選擇要刪除的職位'
    return
  }

  const nextDictionary = { ...jobDictionary.value }
  delete nextDictionary[selectedJobKey.value]
  jobDictionary.value = nextDictionary
  const nextKey = Object.keys(nextDictionary).sort()[0] || ''
  if (nextKey) selectJob(nextKey)
  else {
    selectedJobKey.value = ''
    jobDraft.value = null
  }
  jobDictionaryMessage.value = '已從當前字典草稿移除職位，記得儲存整份字典'
  jobDictionaryError.value = ''
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
    if (response.status === 401) {
      handleUnauthorized('dictionary')
      return
    }
    if (!response.ok) {
      jobDictionaryError.value = data.message || '儲存職位字典失敗'
      return
    }

    jobDictionary.value = data.dictionary && typeof data.dictionary === 'object' ? data.dictionary : jobDictionary.value
    if (selectedJobKey.value) {
      jobDraft.value = buildJobDraft(jobDictionary.value[selectedJobKey.value])
    }
    jobDictionaryMessage.value = '職位字典已更新，僅影響之後新上傳或新觸發匹配的 CV'
  } catch {
    jobDictionaryError.value = '儲存職位字典失敗'
  } finally {
    jobDictionarySaving.value = false
  }
}

onMounted(() => {
  if (!props.userProfile) loadMyProfile()
  loadJobDictionary()
})
</script>

<template>
  <section class="settings-page">
    <header class="page-header settings-hero">
      <div>
        <h2>系統設定</h2>
        <p>在這裡管理個人資料、密碼與職位字典，維持乾淨一致的編輯體驗。</p>
      </div>
    </header>

    <div class="card">
      <header class="card-header">
        <div>
          <h3>個人資料</h3>
          <p>可修改工具欄頭像、頭像背景色與用戶名稱。</p>
        </div>
        <button type="button" class="secondary-btn" :disabled="profileLoading" @click="loadMyProfile">重新讀取</button>
      </header>

      <div class="profile-grid">
        <label class="field">
          <span>用戶名稱</span>
          <input v-model="username" type="text" maxlength="80" placeholder="請輸入用戶名稱" />
        </label>
      </div>

      <section class="preset-section">
        <p class="preset-title">頭像模板（Emoji）</p>
        <div class="emoji-grid">
          <button
            v-for="emoji in avatarEmojiPresets"
            :key="emoji"
            type="button"
            class="preset-emoji-btn"
            :class="{ selected: avatarText === emoji }"
            @click="selectAvatarEmojiPreset(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </section>

      <section class="preset-section">
        <p class="preset-title">背景色模板（低飽和）</p>
        <div class="color-swatch-grid">
          <button
            v-for="color in avatarBgColorPresets"
            :key="color"
            type="button"
            class="color-swatch-btn"
            :class="{ selected: avatarBgColor.toLowerCase() === color.toLowerCase() }"
            :title="color"
            :style="{ background: color }"
            @click="selectAvatarBgColorPreset(color)"
          />
        </div>
      </section>

      <div class="advanced-toggle-row">
        <button type="button" class="secondary-btn" @click="isAdvancedAvatarEditorOpen = !isAdvancedAvatarEditorOpen">
          {{ isAdvancedAvatarEditorOpen ? '收起進階自訂' : '進階自訂（手動輸入更多）' }}
        </button>
      </div>

      <div v-if="isAdvancedAvatarEditorOpen" class="advanced-grid">
        <label class="field">
          <span>頭像文字（手動）</span>
          <input v-model="avatarText" type="text" maxlength="6" placeholder="例如 A 或 🙂" />
        </label>

        <label class="field">
          <span>頭像背景色（手動）</span>
          <div class="color-row">
            <input v-model="avatarBgColor" class="color-picker" type="color" />
            <input v-model="avatarBgColor" type="text" placeholder="#334155" />
          </div>
        </label>
      </div>

      <div class="preview-row">
        <span class="preview-label">工具欄頭像預覽</span>
        <span class="avatar-preview" :style="{ background: avatarBgColor }">{{ avatarText || 'U' }}</span>
      </div>

      <div class="actions">
        <button type="button" class="primary-btn" :disabled="profileLoading" @click="saveProfile">
          {{ profileLoading ? '儲存中...' : '儲存個人資料' }}
        </button>
      </div>

      <p v-if="profileMessage" class="success-msg">{{ profileMessage }}</p>
      <p v-if="profileError" class="error-msg">{{ profileError }}</p>
    </div>

    <div class="card">
      <header class="card-header">
        <div>
          <h3>密碼修改</h3>
          <p>輸入目前密碼後設定新密碼。</p>
        </div>
      </header>

      <div class="password-grid">
        <label class="field">
          <span>目前密碼</span>
          <input v-model="currentPassword" type="password" placeholder="請輸入目前密碼" />
        </label>

        <label class="field">
          <span>新密碼</span>
          <input v-model="newPassword" type="password" placeholder="至少 6 碼" />
        </label>

        <label class="field">
          <span>確認新密碼</span>
          <input v-model="confirmPassword" type="password" placeholder="請再次輸入新密碼" />
        </label>
      </div>

      <div class="actions">
        <button type="button" class="primary-btn" :disabled="passwordLoading" @click="changePassword">
          {{ passwordLoading ? '更新中...' : '更新密碼' }}
        </button>
      </div>

      <p v-if="passwordMessage" class="success-msg">{{ passwordMessage }}</p>
      <p v-if="passwordError" class="error-msg">{{ passwordError }}</p>
    </div>

    <div class="card">
      <header class="card-header">
        <div>
          <h3>職位字典配置</h3>
          <p>維護 `finance-job-positions.json`。更新後僅影響之後新上傳或新觸發匹配的 CV。</p>
        </div>
        <button type="button" class="secondary-btn" :disabled="jobDictionaryLoading || jobDictionarySaving" @click="loadJobDictionary">
          重新載入
        </button>
      </header>

      <div class="dictionary-create-row">
        <input
          v-model.trim="newJobKey"
          type="text"
          placeholder="輸入新的 job key，例如 compliance_officer"
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
                <span>描述</span>
                <textarea v-model="jobDraft.description" rows="3" />
              </label>

              <label class="field">
                <span>行業</span>
                <textarea v-model="jobDraft.industryText" rows="3" />
              </label>

              <label class="field">
                <span>角色關鍵詞</span>
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
                <span>最低年資</span>
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
              <p class="weight-title">權重設定</p>
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
            <p>只讀預覽，實際儲存以前以上方編輯表單為準。</p>
          </div>
        </div>
        <pre class="raw-preview">{{ rawDictionaryPreview }}</pre>
      </section>
    </div>
  </section>
</template>

<style scoped>
.settings-page {
  color: var(--text-base);
}

.settings-hero {
  background:
    radial-gradient(circle at top right, rgba(47, 111, 237, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(246, 249, 253, 0.94));
}

.profile-grid,
.password-grid {
  display: grid;
  gap: 0.75rem;
}

.profile-grid {
  grid-template-columns: minmax(0, 1fr);
}

.preset-section {
  display: grid;
  gap: 0.55rem;
}

.preset-title,
.sidebar-title,
.weight-title {
  margin: 0;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 0.45rem;
}

.preset-emoji-btn {
  border: 1px solid var(--border-default);
  border-radius: 18px;
  height: 42px;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  font-size: 1.15rem;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.preset-emoji-btn:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.preset-emoji-btn.selected {
  border-color: rgba(47, 111, 237, 0.2);
  box-shadow: var(--focus-ring);
  background: rgba(47, 111, 237, 0.08);
}

.color-swatch-grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 0.45rem;
}

.color-swatch-btn {
  width: 100%;
  height: 38px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.color-swatch-btn:hover {
  transform: translateY(-1px);
}

.color-swatch-btn.selected {
  border-color: rgba(47, 111, 237, 0.2);
  box-shadow: var(--focus-ring);
}

.advanced-toggle-row {
  display: flex;
  justify-content: flex-start;
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.field {
  display: grid;
  gap: 0.38rem;
}

.field.full-width {
  grid-column: 1 / -1;
}

.color-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.5rem;
}

.color-picker {
  width: 54px;
  padding: 0;
  border-radius: 14px;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.preview-label {
  font-size: 0.9rem;
}

.avatar-preview {
  width: 46px;
  height: 46px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 700;
  font-size: 1.05rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.dictionary-create-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
}

.dictionary-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 1rem;
}

.dictionary-sidebar {
  padding: 0.9rem;
  display: grid;
  gap: 0.7rem;
}

.job-list {
  display: grid;
  gap: 0.45rem;
  max-height: 520px;
  overflow: auto;
}

.job-list-item {
  border: 1px solid var(--border-default);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  padding: 0.85rem;
  text-align: left;
  display: grid;
  gap: 0.22rem;
  cursor: pointer;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.job-list-item strong {
  color: var(--text-strong);
}

.job-list-item span {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.job-list-item:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.job-list-item.active {
  border-color: rgba(47, 111, 237, 0.2);
  background: rgba(47, 111, 237, 0.08);
  box-shadow: 0 14px 28px rgba(47, 111, 237, 0.08);
}

.dictionary-editor {
  padding: 1rem;
  display: grid;
  gap: 0.9rem;
}

.editor-header h4 {
  margin: 0;
}

.editor-header p {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
}

.editor-grid,
.weight-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.weight-section {
  display: grid;
  gap: 0.65rem;
}

.raw-preview-section {
  display: grid;
  gap: 0.7rem;
}

.raw-preview {
  margin: 0;
  background: var(--surface-inverse);
  color: rgba(255, 255, 255, 0.82);
  border-radius: 18px;
  padding: 1rem;
  overflow: auto;
  font-size: 0.86rem;
  line-height: 1.45;
}

.empty-dictionary-state {
  margin: 0;
}

@media (max-width: 960px) {
  .emoji-grid,
  .color-swatch-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .advanced-grid,
  .editor-grid,
  .weight-grid,
  .dictionary-create-row,
  .dictionary-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
