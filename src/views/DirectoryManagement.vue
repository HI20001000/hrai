<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'

const activeTab = ref('personnel')
const pageMessage = ref('')
const pageError = ref('')

const personnelRows = ref([])
const personnelOptionsSource = ref([])
const personnelLoading = ref(false)
const personnelSaving = ref(false)
const personnelDeleting = ref(false)
const personnelKeyword = ref('')
const personnelStatusFilter = ref('')
const selectedPersonnelId = ref(null)
const personnelForm = ref(createEmptyPersonnelForm())

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

function createEmptyPersonnelForm() {
  return {
    fullName: '',
    department: '',
    team: '',
    title: '',
    email: '',
    phone: '',
    managerPersonnelId: '',
    status: 'active',
    remark: '',
  }
}

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

const isCreatingPersonnel = computed(() => !selectedPersonnelId.value)
const isCreatingBlacklist = computed(() => !selectedBlacklistId.value)

const managerOptions = computed(() => {
  const selectedId = Number(selectedPersonnelId.value || 0)
  const options = personnelOptionsSource.value
    .filter((row) => Number(row.id) !== selectedId)
    .map((row) => ({
      value: String(row.id),
      label: row.fullName || `人員 #${row.id}`,
    }))
  return [{ value: '', label: '無直屬主管' }, ...options]
})

const selectedTabTitle = computed(() => activeTab.value === 'personnel' ? '內部人員' : '候選人 Blacklist')

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

const resetPersonnelForm = () => {
  selectedPersonnelId.value = null
  personnelForm.value = createEmptyPersonnelForm()
}

const resetBlacklistForm = () => {
  selectedBlacklistId.value = null
  blacklistForm.value = createEmptyBlacklistForm()
}

const applyPersonnelSelection = (row) => {
  selectedPersonnelId.value = Number(row?.id || 0) || null
  personnelForm.value = {
    fullName: String(row?.fullName || ''),
    department: String(row?.department || ''),
    team: String(row?.team || ''),
    title: String(row?.title || ''),
    email: String(row?.email || ''),
    phone: String(row?.phone || ''),
    managerPersonnelId: row?.managerPersonnelId ? String(row.managerPersonnelId) : '',
    status: String(row?.status || 'active'),
    remark: String(row?.remark || ''),
  }
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

const loadPersonnelOptionsSource = async () => {
  const data = await fetchJson(`${apiBaseUrl}/api/personnel`)
  personnelOptionsSource.value = Array.isArray(data.personnel) ? data.personnel : []
}

const loadPersonnel = async ({ preserveSelection = true } = {}) => {
  personnelLoading.value = true
  try {
    const query = toQueryString({
      keyword: personnelKeyword.value,
      status: personnelStatusFilter.value,
    })
    const data = await fetchJson(`${apiBaseUrl}/api/personnel${query}`)
    personnelRows.value = Array.isArray(data.personnel) ? data.personnel : []
    await loadPersonnelOptionsSource()

    if (!preserveSelection) {
      resetPersonnelForm()
      return
    }

    const selected = personnelRows.value.find((row) => Number(row.id) === Number(selectedPersonnelId.value))
    if (selected) applyPersonnelSelection(selected)
    else if (!selectedPersonnelId.value && personnelRows.value[0]) applyPersonnelSelection(personnelRows.value[0])
    else if (!selected) resetPersonnelForm()
  } catch (error) {
    pageError.value = error?.message || '讀取內部人員失敗'
  } finally {
    personnelLoading.value = false
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
    pageError.value = error?.message || '讀取候選人 Blacklist 失敗'
  } finally {
    blacklistLoading.value = false
  }
}

const savePersonnel = async () => {
  clearPageFeedback()
  personnelSaving.value = true
  try {
    const isEditing = !!selectedPersonnelId.value
    const endpoint = selectedPersonnelId.value
      ? `${apiBaseUrl}/api/personnel/${selectedPersonnelId.value}`
      : `${apiBaseUrl}/api/personnel`
    const method = selectedPersonnelId.value ? 'PATCH' : 'POST'
    const data = await fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...personnelForm.value,
        managerPersonnelId: personnelForm.value.managerPersonnelId || null,
      }),
    })

    await loadPersonnelOptionsSource()
    await loadPersonnel({ preserveSelection: false })
    if (data?.personnel?.id) applyPersonnelSelection(data.personnel)
    pageMessage.value = isEditing ? '內部人員已更新' : '內部人員已建立'
  } catch (error) {
    pageError.value = error?.message || '儲存內部人員失敗'
  } finally {
    personnelSaving.value = false
  }
}

const deletePersonnelRecord = async () => {
  if (!selectedPersonnelId.value || personnelDeleting.value) return
  const confirmed = window.confirm(`確定刪除「${personnelForm.value.fullName || '此人員'}」？`)
  if (!confirmed) return

  clearPageFeedback()
  personnelDeleting.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/personnel/${selectedPersonnelId.value}`, {
      method: 'DELETE',
    })
    await loadPersonnel({ preserveSelection: false })
    pageMessage.value = '內部人員已刪除'
  } catch (error) {
    pageError.value = error?.message || '刪除內部人員失敗'
  } finally {
    personnelDeleting.value = false
  }
}

const saveBlacklist = async () => {
  clearPageFeedback()
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
    pageMessage.value = isEditing ? 'Blacklist 已更新' : 'Blacklist 已建立'
  } catch (error) {
    pageError.value = error?.message || '儲存 Blacklist 失敗'
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
    pageMessage.value = 'Blacklist 已刪除'
  } catch (error) {
    pageError.value = error?.message || '刪除 Blacklist 失敗'
  } finally {
    blacklistDeleting.value = false
  }
}

const refreshActiveTab = async () => {
  clearPageFeedback()
  if (activeTab.value === 'personnel') {
    await loadPersonnel()
    return
  }
  await loadBlacklist()
}

onMounted(async () => {
  clearPageFeedback()
  await Promise.all([
    loadPersonnel(),
    loadBlacklist(),
  ])
})
</script>

<template>
  <section class="app-page directory-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>名單管理</h2>
          <p>集中維護內部人員資料與候選人 Blacklist，並讓候選人清單即時帶出風險警示。</p>
        </div>
      </div>
      <div class="directory-tabs" role="tablist" aria-label="名單管理分頁">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'personnel' }"
          @click="activeTab = 'personnel'; clearPageFeedback()"
        >
          內部人員
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'blacklist' }"
          @click="activeTab = 'blacklist'; clearPageFeedback()"
        >
          候選人 Blacklist
        </button>
      </div>
      <p v-if="pageMessage" class="message">{{ pageMessage }}</p>
      <p v-if="pageError" class="error">{{ pageError }}</p>
    </header>

    <div v-if="activeTab === 'personnel'" class="directory-grid">
      <section class="card">
        <div class="card-header directory-card-header">
          <div>
            <h3>內部人員清單</h3>
            <p class="subtle">目前分頁：{{ selectedTabTitle }}</p>
          </div>
          <div class="directory-actions">
            <button type="button" class="secondary-btn" @click="refreshActiveTab">重新整理</button>
            <button type="button" class="primary-btn" @click="resetPersonnelForm">新增人員</button>
          </div>
        </div>

        <div class="directory-filters">
          <input
            v-model.trim="personnelKeyword"
            type="text"
            class="search-input"
            placeholder="搜尋姓名 / 部門 / 組別 / 職稱 / 電話 / Email / 備註"
            @keyup.enter="loadPersonnel({ preserveSelection: false })"
          />
          <AppSelect
            :model-value="personnelStatusFilter"
            :options="statusFilterOptions"
            placeholder="篩選狀態"
            @update:model-value="personnelStatusFilter = $event; loadPersonnel({ preserveSelection: false })"
          />
          <button type="button" class="secondary-btn" @click="loadPersonnel({ preserveSelection: false })">搜尋</button>
        </div>

        <p v-if="personnelLoading" class="hint">讀取中...</p>
        <div v-else class="table-wrap">
          <table class="structured-table directory-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>部門 / 組別</th>
                <th>職稱</th>
                <th>直屬主管</th>
                <th>聯絡方式</th>
                <th>狀態</th>
                <th>更新時間</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!personnelRows.length">
                <td colspan="7" class="empty-cell">尚無內部人員資料</td>
              </tr>
              <tr
                v-for="row in personnelRows"
                :key="row.id"
                class="directory-row"
                :class="{ active: Number(row.id) === Number(selectedPersonnelId) }"
                @click="applyPersonnelSelection(row)"
              >
                <td>{{ row.fullName || '--' }}</td>
                <td>{{ [row.department, row.team].filter(Boolean).join(' / ') || '--' }}</td>
                <td>{{ row.title || '--' }}</td>
                <td>{{ row.managerName || '--' }}</td>
                <td>{{ row.phone || row.email || '--' }}</td>
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
            <h3>{{ isCreatingPersonnel ? '新增內部人員' : '編輯內部人員' }}</h3>
            <p class="subtle">建立組織層級與聯絡資料，不含排班與指派流程。</p>
          </div>
          <div class="directory-actions">
            <button
              v-if="!isCreatingPersonnel"
              type="button"
              class="danger-btn"
              :disabled="personnelDeleting"
              @click="deletePersonnelRecord"
            >
              {{ personnelDeleting ? '刪除中...' : '刪除' }}
            </button>
            <button type="button" class="primary-btn" :disabled="personnelSaving" @click="savePersonnel">
              {{ personnelSaving ? '儲存中...' : isCreatingPersonnel ? '建立人員' : '更新人員' }}
            </button>
          </div>
        </div>

        <div class="editor-grid">
          <label class="field">
            <span>姓名</span>
            <input v-model.trim="personnelForm.fullName" type="text" placeholder="例如：陳小美" />
          </label>
          <label class="field">
            <span>部門</span>
            <input v-model.trim="personnelForm.department" type="text" placeholder="例如：招聘部" />
          </label>
          <label class="field">
            <span>組別</span>
            <input v-model.trim="personnelForm.team" type="text" placeholder="例如：金融組" />
          </label>
          <label class="field">
            <span>職稱 / 角色</span>
            <input v-model.trim="personnelForm.title" type="text" placeholder="例如：HRBP" />
          </label>
          <label class="field">
            <span>Email</span>
            <input v-model.trim="personnelForm.email" type="email" placeholder="例如：name@company.com" />
          </label>
          <label class="field">
            <span>電話</span>
            <input v-model.trim="personnelForm.phone" type="text" placeholder="例如：9876 5432" />
          </label>
          <label class="field">
            <span>直屬主管</span>
            <AppSelect
              :model-value="personnelForm.managerPersonnelId"
              :options="managerOptions"
              placeholder="選擇直屬主管"
              @update:model-value="personnelForm.managerPersonnelId = $event"
            />
          </label>
          <label class="field">
            <span>狀態</span>
            <AppSelect
              :model-value="personnelForm.status"
              :options="recordStatusOptions"
              placeholder="選擇狀態"
              @update:model-value="personnelForm.status = $event"
            />
          </label>
          <label class="field full-span">
            <span>備註</span>
            <textarea v-model.trim="personnelForm.remark" rows="4" placeholder="補充說明、人員背景或備註"></textarea>
          </label>
        </div>
      </section>
    </div>

    <div v-else class="directory-grid">
      <section class="card">
        <div class="card-header directory-card-header">
          <div>
            <h3>候選人 Blacklist</h3>
            <p class="subtle">命中資料只做標紅警示，不阻擋現有招聘流程。</p>
          </div>
          <div class="directory-actions">
            <button type="button" class="secondary-btn" @click="refreshActiveTab">重新整理</button>
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
                <td colspan="6" class="empty-cell">尚無 Blacklist 資料</td>
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
            <h3>{{ isCreatingBlacklist ? '新增 Blacklist' : '編輯 Blacklist' }}</h3>
            <p class="subtle">電話或 Email 擇一即可；若命中候選人清單，會在列表中整行標紅。</p>
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
            <span>列入原因</span>
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

.header-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.directory-tabs {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
}

.tab-btn {
  min-height: 42px;
  padding: 0.72rem 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-base);
  font-weight: 700;
  cursor: pointer;
  transition: all 180ms ease;
}

.tab-btn.active {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(180deg, #e25a66 0%, #cb3347 100%);
  box-shadow: 0 12px 24px rgba(203, 51, 71, 0.22);
}

.directory-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.95fr);
  gap: 1rem;
}

.directory-card-header {
  align-items: flex-start;
}

.directory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.directory-filters {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(168px, 200px) minmax(92px, auto);
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

.directory-filters .search-input {
  overflow: hidden;
  text-overflow: ellipsis;
}

.directory-filters .secondary-btn {
  align-self: stretch;
  min-width: 92px;
  padding-inline: 1rem;
}

.directory-table tbody tr {
  cursor: pointer;
  transition: background-color 180ms ease;
}

.directory-row.active {
  background: rgba(47, 111, 237, 0.08);
}

.reason-cell {
  min-width: 220px;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.95rem;
}

.full-span {
  grid-column: 1 / -1;
}

.status-active {
  color: var(--success);
  background: var(--success-soft);
}

.status-inactive {
  color: #8a5b00;
  background: rgba(255, 206, 107, 0.18);
}

@media (max-width: 1024px) {
  .directory-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  .directory-filters {
    grid-template-columns: minmax(0, 1fr) minmax(160px, 200px);
  }

  .directory-filters .secondary-btn {
    grid-column: 2;
  }
}

@media (max-width: 720px) {
  .directory-filters,
  .editor-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .directory-filters {
    padding: 0.75rem;
  }

  .directory-filters .secondary-btn {
    grid-column: auto;
    width: 100%;
  }

  .header-main,
  .directory-card-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
