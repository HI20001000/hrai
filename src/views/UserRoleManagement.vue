<script setup>
import { computed, onMounted, ref } from 'vue'
import AppSelect from '../components/AppSelect.vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['profile-updated'])

const users = ref([])
const roles = ref([])
const loading = ref(false)
const error = ref('')
const message = ref('')
const savingRoleIds = ref([])

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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }
}

const roleOptions = computed(() =>
  roles.value.map((role) => ({
    value: role.value,
    label: role.label,
  }))
)

const roleMap = computed(() =>
  Object.fromEntries(roles.value.map((role) => [role.value, role]))
)

const currentUserId = computed(() => Number(props.currentUser?.id || 0) || null)

const persistCurrentUser = (user) => {
  if (!user || typeof user !== 'object') return
  window.localStorage.setItem('innerai_user', JSON.stringify(user))
  emit('profile-updated', user)
}

const isSavingRole = (userId) => savingRoleIds.value.includes(Number(userId))

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const loadUsers = async () => {
  error.value = ''
  message.value = ''
  const auth = getAuthContext()
  if (!auth.ok) {
    error.value = auth.message
    return
  }

  loading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/users`, {
      method: 'GET',
      headers: auth.headers,
    })
    const data = await response.json()
    if (response.status === 401) {
      window.localStorage.removeItem('innerai_auth')
      window.localStorage.removeItem('innerai_user')
      error.value = '登入已過期，請重新登入後再試'
      return
    }
    if (response.status === 403) {
      error.value = data.message || '目前帳號沒有用戶權限管理權限'
      return
    }
    if (!response.ok) {
      error.value = data.message || '讀取用戶列表失敗'
      return
    }

    roles.value = Array.isArray(data.roles) ? data.roles : []
    users.value = Array.isArray(data.users) ? data.users : []
    if (data.currentUser) persistCurrentUser(data.currentUser)
  } catch {
    error.value = '讀取用戶列表失敗'
  } finally {
    loading.value = false
  }
}

const updateUserRole = async (user, nextRole) => {
  const userId = Number(user?.id || 0)
  const normalizedRole = String(nextRole || '').trim()
  if (!userId || !normalizedRole || normalizedRole === user.role || isSavingRole(userId)) return

  const auth = getAuthContext()
  if (!auth.ok) {
    error.value = auth.message
    return
  }

  error.value = ''
  message.value = ''
  savingRoleIds.value = [...savingRoleIds.value, userId]
  try {
    const response = await fetch(`${apiBaseUrl}/api/users/${userId}/role`, {
      method: 'PATCH',
      headers: auth.headers,
      body: JSON.stringify({ role: normalizedRole }),
    })
    const data = await response.json()
    if (!response.ok) {
      error.value = data.message || '更新用戶角色失敗'
      return
    }

    users.value = users.value.map((row) => (Number(row.id) === userId ? data.user : row))
    if (Number(data.currentUser?.id || 0) === currentUserId.value) {
      persistCurrentUser(data.currentUser)
    }
    message.value = `已更新 ${data.user?.username || data.user?.email || '用戶'} 的角色`
  } catch {
    error.value = '更新用戶角色失敗'
  } finally {
    savingRoleIds.value = savingRoleIds.value.filter((id) => id !== userId)
  }
}

onMounted(() => {
  loadUsers()
})
</script>

<template>
  <section class="user-role-page">
    <header class="page-header user-role-hero">
      <div>
        <h2>用戶權限管理</h2>
        <p>集中查看所有用戶，並按角色控制系統使用權限。</p>
      </div>
      <button type="button" class="secondary-btn" :disabled="loading" @click="loadUsers">
        {{ loading ? '讀取中...' : '重新讀取' }}
      </button>
    </header>

    <div class="role-grid">
      <article v-for="role in roles" :key="role.value" class="role-card">
        <div>
          <h3>{{ role.label }}</h3>
          <p>{{ role.description }}</p>
        </div>
        <div class="permission-list">
          <span v-for="permission in role.permissions" :key="permission" class="permission-chip">
            {{ permission }}
          </span>
        </div>
      </article>
    </div>

    <div class="card">
      <header class="card-header">
        <div>
          <h3>全部用戶</h3>
          <p>第一位註冊用戶會自動成為系統管理員；系統至少保留一位管理員。</p>
        </div>
        <span class="count-chip">共 {{ users.length }} 位</span>
      </header>

      <p v-if="message" class="success-msg">{{ message }}</p>
      <p v-if="error" class="error-msg">{{ error }}</p>

      <div class="table-wrap">
        <table class="application-table">
          <thead>
            <tr>
              <th>用戶</th>
              <th>目前角色</th>
              <th>角色權限</th>
              <th>註冊時間</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="4" class="empty-cell">正在讀取用戶列表...</td>
            </tr>
            <tr v-else-if="!users.length">
              <td colspan="4" class="empty-cell">目前沒有可管理的用戶</td>
            </tr>
            <template v-else>
              <tr v-for="user in users" :key="user.id">
                <td>
                  <div class="user-cell">
                    <span class="user-avatar" :style="{ background: user.avatarBgColor || '#334155' }">
                      {{ user.avatarText || 'U' }}
                    </span>
                    <span>
                      <strong>{{ user.username || '--' }}</strong>
                      <small>{{ user.email || user.mail || '--' }}</small>
                    </span>
                  </div>
                </td>
                <td class="role-select-cell">
                  <AppSelect
                    :model-value="user.role"
                    :options="roleOptions"
                    :disabled="loading || isSavingRole(user.id)"
                    @update:model-value="updateUserRole(user, $event)"
                  />
                  <small v-if="Number(user.id) === currentUserId" class="current-user-note">目前登入帳號</small>
                </td>
                <td>
                  <div class="permission-list compact">
                    <span
                      v-for="permission in (roleMap[user.role]?.permissions || user.permissions || [])"
                      :key="permission"
                      class="permission-chip"
                    >
                      {{ permission }}
                    </span>
                  </div>
                </td>
                <td>{{ formatDateTime(user.createdAt) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.user-role-page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: var(--space-6);
  color: var(--text-base);
  min-height: 0;
  overflow: hidden;
}

.user-role-hero {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  background:
    radial-gradient(circle at top right, rgba(47, 111, 237, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(246, 249, 253, 0.94));
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
  min-height: 0;
}

.user-role-page > .card {
  min-height: 0;
  overflow: hidden;
}

.user-role-page .table-wrap {
  min-height: 0;
}

.role-card {
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: var(--shadow-sm);
}

.role-card h3 {
  margin: 0;
  color: var(--text-strong);
  font-size: 1rem;
}

.role-card p {
  margin: 0.28rem 0 0;
  color: var(--text-muted);
  line-height: 1.55;
}

.permission-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.permission-list.compact {
  max-width: 520px;
}

.permission-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0.28rem 0.62rem;
  border: 1px solid rgba(47, 111, 237, 0.12);
  border-radius: var(--radius-pill);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.07);
  font-size: 0.82rem;
  font-weight: 600;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 220px;
}

.user-cell strong,
.user-cell small {
  display: block;
}

.user-cell strong {
  color: var(--text-strong);
}

.user-cell small,
.current-user-note {
  color: var(--text-muted);
}

.user-avatar {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 15px;
  color: #ffffff;
  font-weight: 700;
}

.role-select-cell {
  min-width: 210px;
}

.role-select-cell :deep(.app-select-trigger) {
  min-height: 42px;
  padding: 0.62rem 0.8rem;
}

.role-select-cell :deep(.app-select-menu) {
  z-index: 120;
}

.current-user-note {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.8rem;
}

@media (max-width: 1080px) {
  .role-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .user-role-hero {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
