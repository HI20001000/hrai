<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'

const pageMessage = ref('')
const pageError = ref('')
const blacklistRows = ref([])
const blacklistLoading = ref(false)
const blacklistSaving = ref(false)
const blacklistDeleting = ref(false)
const blacklistKeyword = ref('')
const blacklistStatusFilter = ref('')
const selectedBlacklistId = ref(null)
const blacklistForm = ref(createEmptyBlacklistForm())

const statusFilterOptions = [
  { value: '', label: '全部狀態' },
  { value: 'active', label: '啟用中' },
  { value: 'inactive', label: '停用' },
]

const recordStatusOptions = [
  { value: 'active', label: '啟用中' },
  { value: 'inactive', label: '停用' },
]

function createEmptyBlacklistForm() {
  return {
    displayName: '',
    phone: '',
    email: '',
    reason: '',
    status: 'active',
    remark: '',
  }
}

const isCreatingBlacklist = computed(() => !selectedBlacklistId.value)

const clearPageFeedback = () => {
  pageMessage.value = ''
  pageError.value = ''
}

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toQueryString = (params) => {
  const search = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    const text = String(value ?? '').trim()
    if (text) search.set(key, text)
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

const fetchJson = async (endpoint, options = {}) => {
  const response = await fetch(endpoint, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
}

const resetBlacklistForm = () => {
  selectedBlacklistId.value = null
  blacklistForm.value = createEmptyBlacklistForm()
}

const applyBlacklistSelection = (row) => {
  selectedBlacklistId.value = Number(row?.id || 0) || null
  blacklistForm.value = {
    displayName: String(row?.displayName || ''),
    phone: String(row?.phone || ''),
    email: String(row?.email || ''),
    reason: String(row?.reason || ''),
    status: String(row?.status || 'active'),
    remark: String(row?.remark || ''),
  }
}

const loadBlacklist = async ({ preserveSelection = true } = {}) => {
  blacklistLoading.value = true
  try {
    const query = toQueryString({
      keyword: blacklistKeyword.value,
      status: blacklistStatusFilter.value,
    })
    const data = await fetchJson(`${apiBaseUrl}/api/candidate-blacklist${query}`)
    blacklistRows.value = Array.isArray(data.blacklist) ? data.blacklist : []

    if (!preserveSelection) {
      resetBlacklistForm()
      return
    }

    const selected = blacklistRows.value.find((row) => Number(row.id) === Number(selectedBlacklistId.value))
    if (selected) applyBlacklistSelection(selected)
    else if (!selectedBlacklistId.value && blacklistRows.value[0]) applyBlacklistSelection(blacklistRows.value[0])
    else if (!selected) resetBlacklistForm()
  } catch (error) {
    pageError.value = error?.message || '讀取黑名單失敗'
  } finally {
    blacklistLoading.value = false
  }
}

const saveBlacklist = async () => {
  clearPageFeedback()
  const reason = String(blacklistForm.value.reason || '').trim()
  if (!reason) {
    pageError.value = '請先填寫原因'
    return
  }

  blacklistSaving.value = true
  try {
    const isEditing = !!selectedBlacklistId.value
    const endpoint = selectedBlacklistId.value
      ? `${apiBaseUrl}/api/candidate-blacklist/${selectedBlacklistId.value}`
      : `${apiBaseUrl}/api/candidate-blacklist`
    const method = selectedBlacklistId.value ? 'PATCH' : 'POST'
    const data = await fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blacklistForm.value),
    })

    await loadBlacklist({ preserveSelection: false })
    if (data?.blacklistEntry?.id) applyBlacklistSelection(data.blacklistEntry)
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    pageMessage.value = isEditing ? '黑名單已更新' : '黑名單已建立'
  } catch (error) {
    pageError.value = error?.message || '儲存黑名單失敗'
  } finally {
    blacklistSaving.value = false
  }
}

const deleteBlacklistRecord = async () => {
  if (!selectedBlacklistId.value || blacklistDeleting.value) return
  const confirmed = window.confirm(`確定刪除「${blacklistForm.value.displayName || blacklistForm.value.phone || blacklistForm.value.email || '此黑名單資料'}」？`)
  if (!confirmed) return

  clearPageFeedback()
  blacklistDeleting.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/candidate-blacklist/${selectedBlacklistId.value}`, {
      method: 'DELETE',
    })
    await loadBlacklist({ preserveSelection: false })
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    pageMessage.value = '黑名單已刪除'
  } catch (error) {
    pageError.value = error?.message || '刪除黑名單失敗'
  } finally {
    blacklistDeleting.value = false
  }
}

onMounted(async () => {
  clearPageFeedback()
  await loadBlacklist()
})
</script>

<template>
  <section class="app-page directory-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>黑名單</h2>
          <p>維護候選人黑名單；候選人清單命中時會提示風險。</p>
        </div>
      </div>
      <p v-if="pageMessage" class="message">{{ pageMessage }}</p>
      <p v-if="pageError" class="error">{{ pageError }}</p>
    </header>

    <div class="directory-grid">
      <section class="card">
        <div class="card-header directory-card-header">
          <div>
            <h3>黑名單</h3>
            <p class="subtle">命中資料只做標紅警示，不阻擋現有招聘流程。</p>
          </div>
          <div class="directory-actions">
            <button type="button" class="secondary-btn" @click="loadBlacklist">重新整理</button>
            <button type="button" class="primary-btn" @click="resetBlacklistForm">新增黑名單</button>
          </div>
        </div>

        <div class="directory-filters">
          <input
            v-model.trim="blacklistKeyword"
            type="text"
            class="search-input"
            placeholder="搜尋姓名 / 電話 / Email / 原因 / 備註"
            @keyup.enter="loadBlacklist({ preserveSelection: false })"
          />
          <AppSelect
            :model-value="blacklistStatusFilter"
            :options="statusFilterOptions"
            placeholder="篩選狀態"
            @update:model-value="blacklistStatusFilter = $event; loadBlacklist({ preserveSelection: false })"
          />
          <button type="button" class="secondary-btn" @click="loadBlacklist({ preserveSelection: false })">搜尋</button>
        </div>

        <p v-if="blacklistLoading" class="hint">讀取中...</p>
        <div v-else class="table-wrap">
          <table class="structured-table directory-table">
            <thead>
              <tr>
                <th>顯示名稱</th>
                <th>電話</th>
                <th>Email</th>
                <th>原因</th>
                <th>狀態</th>
                <th>更新時間</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!blacklistRows.length">
                <td colspan="6" class="empty-cell">尚無黑名單資料</td>
              </tr>
              <tr
                v-for="row in blacklistRows"
                :key="row.id"
                class="directory-row"
                :class="{ active: Number(row.id) === Number(selectedBlacklistId) }"
                @click="applyBlacklistSelection(row)"
              >
                <td>{{ row.displayName || '--' }}</td>
                <td>{{ row.phone || '--' }}</td>
                <td>{{ row.email || '--' }}</td>
                <td class="reason-cell">{{ row.reason || '--' }}</td>
                <td><span class="status-chip" :class="row.status === 'inactive' ? 'status-inactive' : 'status-active'">{{ row.status === 'inactive' ? '停用' : '啟用中' }}</span></td>
                <td>{{ formatDateTime(row.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header directory-card-header">
          <div>
            <h3>{{ isCreatingBlacklist ? '新增黑名單' : '編輯黑名單' }}</h3>
            <p class="subtle">電話或 Email 擇一即可；原因必填。</p>
          </div>
          <div class="directory-actions">
            <button
              v-if="!isCreatingBlacklist"
              type="button"
              class="danger-btn"
              :disabled="blacklistDeleting"
              @click="deleteBlacklistRecord"
            >
              {{ blacklistDeleting ? '刪除中...' : '刪除' }}
            </button>
            <button type="button" class="primary-btn" :disabled="blacklistSaving" @click="saveBlacklist">
              {{ blacklistSaving ? '儲存中...' : isCreatingBlacklist ? '建立名單' : '更新名單' }}
            </button>
          </div>
        </div>

        <div class="editor-grid">
          <label class="field">
            <span>顯示名稱</span>
            <input v-model.trim="blacklistForm.displayName" type="text" placeholder="例如：王小明" />
          </label>
          <label class="field">
            <span>電話</span>
            <input v-model.trim="blacklistForm.phone" type="text" placeholder="至少填電話或 Email 其中一項" />
          </label>
          <label class="field">
            <span>Email</span>
            <input v-model.trim="blacklistForm.email" type="email" placeholder="至少填電話或 Email 其中一項" />
          </label>
          <label class="field">
            <span>狀態</span>
            <AppSelect
              :model-value="blacklistForm.status"
              :options="recordStatusOptions"
              placeholder="選擇狀態"
              @update:model-value="blacklistForm.status = $event"
            />
          </label>
          <label class="field full-span">
            <span>原因</span>
            <textarea v-model.trim="blacklistForm.reason" rows="4" placeholder="例如：曾明確要求不再聯絡、資料來源不合規等"></textarea>
          </label>
          <label class="field full-span">
            <span>備註</span>
            <textarea v-model.trim="blacklistForm.remark" rows="3" placeholder="補充說明"></textarea>
          </label>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.directory-page {
  color: var(--text-base);
}

.header-main,
.directory-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.directory-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.95fr);
  gap: 1rem;
}

.directory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.directory-filters {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(168px, 200px) minmax(92px, auto);
  align-items: stretch;
  gap: 0.75rem;
  padding: 0.85rem;
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius-md) - 4px);
  background: rgba(245, 248, 252, 0.58);
}

.directory-filters .search-input,
.directory-filters :deep(.app-select),
.directory-filters .secondary-btn {
  min-width: 0;
}

.directory-filters .search-input,
.directory-filters :deep(.app-select-trigger),
.directory-filters .secondary-btn {
  min-height: 48px;
}

.directory-row {
  cursor: pointer;
  transition: background-color 160ms ease;
}

.directory-row:hover {
  background: rgba(47, 111, 237, 0.06);
}

.directory-row.active {
  background: rgba(47, 111, 237, 0.1);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0.2rem 0.62rem;
  border-radius: var(--radius-pill);
  font-size: 0.78rem;
  font-weight: 800;
}

.status-active {
  color: #117a52;
  background: rgba(17, 122, 82, 0.12);
}

.status-inactive {
  color: var(--text-muted);
  background: rgba(148, 163, 184, 0.14);
}

.reason-cell {
  max-width: 280px;
  white-space: normal;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.full-span {
  grid-column: 1 / -1;
}

@media (max-width: 1040px) {
  .directory-grid,
  .directory-filters,
  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
