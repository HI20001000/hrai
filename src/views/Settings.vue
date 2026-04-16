<script setup>
import { onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import JobDictionaryPanel from '../components/job/JobDictionaryPanel.vue'

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

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

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

watch(
  () => props.userProfile,
  (value) => {
    if (!value) return
    applyUserProfile(value)
  },
  { immediate: true }
)

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

onMounted(() => {
  if (!props.userProfile) loadMyProfile()
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

    <JobDictionaryPanel />
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
