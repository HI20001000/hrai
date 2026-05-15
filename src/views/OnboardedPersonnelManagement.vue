<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'

const pageMessage = ref('')
const pageError = ref('')
const personnelRows = ref([])
const personnelOptionsSource = ref([])
const projectRows = ref([])
const personnelLoading = ref(false)
const personnelSaving = ref(false)
const personnelDeleting = ref(false)
const projectJoining = ref(false)
const blacklistSaving = ref(false)
const personnelKeyword = ref('')
const personnelStatusFilter = ref('')
const selectedPersonnelId = ref(null)
const personnelForm = ref(createEmptyPersonnelForm())
const isProjectModalOpen = ref(false)
const isBlacklistModalOpen = ref(false)
const projectForm = ref(createEmptyProjectForm())
const blacklistReasonDraft = ref('')

const statusFilterOptions = [
  { value: '', label: '全部狀態' },
  { value: 'active', label: '在職' },
  { value: 'inactive', label: '已離職' },
]

const recordStatusOptions = [
  { value: 'active', label: '在職' },
  { value: 'inactive', label: '已離職' },
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

function createEmptyProjectForm() {
  return {
    projectId: '',
    projectRole: '',
    startDate: new Date().toISOString().slice(0, 10),
    remark: '',
  }
}

const isCreatingPersonnel = computed(() => !selectedPersonnelId.value)
const selectedPersonnel = computed(() =>
  personnelRows.value.find((row) => Number(row.id) === Number(selectedPersonnelId.value)) || null
)

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

const projectOptions = computed(() =>
  projectRows.value.map((project) => ({
    value: String(project.id),
    label: project.projectName || `項目 #${project.id}`,
  }))
)

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

const getPersonnelStatusLabel = (status) => status === 'inactive' ? '已離職' : '在職'

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

const loadPersonnelOptionsSource = async () => {
  const data = await fetchJson(`${apiBaseUrl}/api/personnel`)
  personnelOptionsSource.value = Array.isArray(data.personnel) ? data.personnel : []
}

const loadProjects = async () => {
  const data = await fetchJson(`${apiBaseUrl}/api/projects`)
  projectRows.value = Array.isArray(data.projects) ? data.projects : []
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
    pageError.value = error?.message || '讀取已入職名單失敗'
  } finally {
    personnelLoading.value = false
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
    pageMessage.value = isEditing ? '已入職人員已更新' : '已入職人員已建立'
  } catch (error) {
    pageError.value = error?.message || '儲存已入職人員失敗'
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
    pageMessage.value = '已入職人員已刪除'
  } catch (error) {
    pageError.value = error?.message || '刪除已入職人員失敗'
  } finally {
    personnelDeleting.value = false
  }
}

const openProjectModal = async () => {
  clearPageFeedback()
  if (!selectedPersonnel.value) {
    pageError.value = '請先選擇人員'
    return
  }
  projectForm.value = {
    ...createEmptyProjectForm(),
    projectRole: selectedPersonnel.value.title || '',
  }
  isProjectModalOpen.value = true
  try {
    await loadProjects()
    if (!projectForm.value.projectId && projectRows.value[0]?.id) {
      projectForm.value.projectId = String(projectRows.value[0].id)
    }
  } catch (error) {
    pageError.value = error?.message || '讀取項目失敗'
  }
}

const closeProjectModal = () => {
  if (projectJoining.value) return
  isProjectModalOpen.value = false
  projectForm.value = createEmptyProjectForm()
}

const submitProjectJoin = async () => {
  const person = selectedPersonnel.value
  if (!person || !projectForm.value.projectId) {
    pageError.value = '請先選擇人員與項目'
    return
  }

  projectJoining.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/projects/${projectForm.value.projectId}/personnel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personnelId: person.id,
        fullName: person.fullName,
        department: person.department,
        team: person.team,
        title: person.title,
        email: person.email,
        phone: person.phone,
        managerPersonnelId: person.managerPersonnelId || null,
        projectRole: projectForm.value.projectRole,
        startDate: projectForm.value.startDate,
        source: 'manual',
        status: 'active',
        remark: projectForm.value.remark,
      }),
    })
    isProjectModalOpen.value = false
    projectForm.value = createEmptyProjectForm()
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
    pageMessage.value = `已將 ${person.fullName || '此人員'} 加入項目組`
  } catch (error) {
    pageError.value = error?.message || '加入項目組失敗'
  } finally {
    projectJoining.value = false
  }
}

const openBlacklistModal = () => {
  clearPageFeedback()
  const person = selectedPersonnel.value
  if (!person) {
    pageError.value = '請先選擇人員'
    return
  }
  if (!String(person.phone || '').trim() && !String(person.email || '').trim()) {
    pageError.value = `${person.fullName || '此人員'} 沒有電話或 Email，無法加入黑名單`
    return
  }
  blacklistReasonDraft.value = ''
  isBlacklistModalOpen.value = true
}

const closeBlacklistModal = () => {
  if (blacklistSaving.value) return
  blacklistReasonDraft.value = ''
  isBlacklistModalOpen.value = false
}

const submitBlacklist = async () => {
  const person = selectedPersonnel.value
  const reason = String(blacklistReasonDraft.value || '').trim()
  if (!person || !reason) {
    pageError.value = '請先填寫黑名單原因'
    return
  }

  blacklistSaving.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/candidate-blacklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: String(person.fullName || '').trim(),
        phone: String(person.phone || '').trim(),
        email: String(person.email || '').trim(),
        reason,
        status: 'active',
        remark: '由已入職名單加入',
      }),
    })
    isBlacklistModalOpen.value = false
    blacklistReasonDraft.value = ''
    window.dispatchEvent(new CustomEvent('hrai-applications-updated'))
    pageMessage.value = `已將 ${person.fullName || '此人員'} 加入黑名單`
  } catch (error) {
    pageError.value = error?.message || '加入黑名單失敗'
  } finally {
    blacklistSaving.value = false
  }
}

onMounted(async () => {
  clearPageFeedback()
  await Promise.all([loadPersonnel(), loadProjects()])
})
</script>

<template>
  <section class="app-page personnel-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>已入職名單</h2>
          <p>維護已入職人員資料，可加入項目組、加入黑名單，並標記是否已離職。</p>
        </div>
      </div>
      <p v-if="pageMessage" class="message">{{ pageMessage }}</p>
      <p v-if="pageError" class="error">{{ pageError }}</p>
    </header>

    <div class="directory-grid">
      <section class="card">
        <div class="card-header directory-card-header">
          <div>
            <h3>已入職名單</h3>
            <p class="subtle">狀態使用在職 / 已離職；已離職對應原 inactive。</p>
          </div>
          <div class="directory-actions">
            <button type="button" class="secondary-btn" @click="loadPersonnel">刷新</button>
            <button type="button" class="primary-btn" @click="resetPersonnelForm">新增</button>
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
                <td colspan="7" class="empty-cell">尚無已入職人員資料</td>
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
                <td><span class="status-chip" :class="row.status === 'inactive' ? 'status-inactive' : 'status-active'">{{ getPersonnelStatusLabel(row.status) }}</span></td>
                <td>{{ formatDateTime(row.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header directory-card-header">
          <div>
            <h3>{{ isCreatingPersonnel ? '新增已入職人員' : '編輯已入職人員' }}</h3>
            <p class="subtle">可標記是否已離職，並進一步加入項目組或黑名單。</p>
          </div>
          <div class="directory-actions">
            <button v-if="!isCreatingPersonnel" type="button" class="secondary-btn" @click="openProjectModal">加入項目組</button>
            <button v-if="!isCreatingPersonnel" type="button" class="danger-btn" @click="openBlacklistModal">加入黑名單</button>
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
              {{ personnelSaving ? '儲存中...' : isCreatingPersonnel ? '新增' : '保存' }}
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
            <span>是否已離職</span>
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

    <div v-if="isProjectModalOpen" class="modal-backdrop" @click.self="closeProjectModal">
      <div class="modal-panel action-modal">
        <header class="modal-header">
          <div>
            <h3>加入項目組</h3>
            <p class="subtle">{{ selectedPersonnel?.fullName || '人員' }}</p>
          </div>
          <button type="button" class="ghost-btn" :disabled="projectJoining" @click="closeProjectModal">關閉</button>
        </header>
        <div class="editor-grid">
          <label class="field full-span">
            <span>項目</span>
            <AppSelect
              :model-value="projectForm.projectId"
              :options="projectOptions"
              placeholder="選擇項目"
              empty-text="尚未建立項目"
              :disabled="projectJoining"
              @update:model-value="projectForm.projectId = $event"
            />
          </label>
          <label class="field">
            <span>項目角色</span>
            <input v-model.trim="projectForm.projectRole" type="text" :disabled="projectJoining" />
          </label>
          <label class="field">
            <span>入組日期</span>
            <input v-model="projectForm.startDate" type="date" :disabled="projectJoining" />
          </label>
          <label class="field full-span">
            <span>備註</span>
            <textarea v-model.trim="projectForm.remark" rows="3" :disabled="projectJoining"></textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="projectJoining" @click="closeProjectModal">取消</button>
          <button type="button" class="primary-btn" :disabled="projectJoining || !projectForm.projectId" @click="submitProjectJoin">
            {{ projectJoining ? '加入中...' : '加入項目組' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="isBlacklistModalOpen" class="modal-backdrop" @click.self="closeBlacklistModal">
      <div class="modal-panel action-modal">
        <header class="modal-header">
          <div>
            <h3>加入黑名單</h3>
            <p class="subtle">{{ selectedPersonnel?.fullName || '人員' }}｜{{ selectedPersonnel?.phone || selectedPersonnel?.email || '--' }}</p>
          </div>
          <button type="button" class="ghost-btn" :disabled="blacklistSaving" @click="closeBlacklistModal">關閉</button>
        </header>
        <label class="field">
          <span>原因</span>
          <textarea v-model.trim="blacklistReasonDraft" rows="4" :disabled="blacklistSaving" placeholder="請輸入加入黑名單的原因"></textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="blacklistSaving" @click="closeBlacklistModal">取消</button>
          <button type="button" class="danger-btn" :disabled="blacklistSaving || !blacklistReasonDraft.trim()" @click="submitBlacklist">
            {{ blacklistSaving ? '加入中...' : '確認加入' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.personnel-page {
  color: var(--text-base);
}

.header-main,
.directory-card-header,
.modal-header,
.modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.directory-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(360px, 0.95fr);
  gap: 1rem;
}

.directory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}

.directory-filters {
  display: grid;
  grid-template-columns: minmax(220px, 0.78fr) minmax(168px, 180px) 72px;
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
  min-height: 50px;
  height: 50px;
}

.directory-filters .secondary-btn {
  width: 72px;
  justify-content: center;
  padding-inline: 0.7rem;
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
  color: var(--danger);
  background: var(--danger-soft);
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.full-span {
  grid-column: 1 / -1;
}

.action-modal {
  display: grid;
  gap: 1rem;
  width: min(620px, calc(100vw - 2rem));
}

.modal-actions {
  justify-content: flex-end;
}

@media (max-width: 1040px) {
  .directory-grid,
  .directory-filters,
  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
