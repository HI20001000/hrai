<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import AppSelect from '../components/AppSelect.vue'

const activeView = ref('manage')
const pageMessage = ref('')
const pageError = ref('')

const projects = ref([])
const selectedProject = ref(null)
const assignments = ref([])
const personnelRows = ref([])

const projectKeyword = ref('')
const projectStatusFilter = ref('')
const personnelKeyword = ref('')

const projectsLoading = ref(false)
const projectSaving = ref(false)
const projectDeleting = ref(false)
const assignmentSaving = ref(false)
const assignmentRemovingIds = ref([])
const transferSaving = ref(false)
const csvImporting = ref(false)

const transferAssignment = ref(null)
const csvFile = ref(null)
const csvSummary = ref(null)
const isProjectModalOpen = ref(false)
const projectModalMode = ref('create')
const projectModalProjectId = ref(null)
const isAssignmentModalOpen = ref(false)
const isAssignmentEditorOpen = ref(false)

const projectStatusOptions = [
  { value: '', label: '全部狀態' },
  { value: 'planned', label: '籌備中' },
  { value: 'active', label: '進行中' },
  { value: 'paused', label: '暫停' },
  { value: 'completed', label: '已完成' },
]

const projectStatusFormOptions = projectStatusOptions.filter((item) => item.value)

const assignmentStatusOptions = [
  { value: 'active', label: '在組' },
  { value: 'transferred', label: '已調動' },
  { value: 'removed', label: '已移出' },
]

const sourceLabels = {
  manual: '手動',
  csv: 'CSV',
  candidate: '候選人',
}

const createEmptyProjectForm = () => ({
  projectName: '',
  status: 'planned',
  ownerPersonnelId: '',
  startDate: '',
  endDate: '',
  remark: '',
})

const createEmptyAssignmentForm = () => ({
  personnelId: '',
})

const projectForm = ref(createEmptyProjectForm())
const assignmentForm = ref(createEmptyAssignmentForm())
const transferForm = ref({
  targetProjectId: '',
  projectRole: '',
  transferDate: '',
  remark: '',
})

const isProjectModalEditing = computed(() => projectModalMode.value === 'edit')

const ownerOptions = computed(() => [
  { value: '', label: '未指定負責人' },
  ...personnelRows.value.map((row) => ({
    value: String(row.id),
    label: row.fullName || `人員 #${row.id}`,
  })),
])

const transferProjectOptions = computed(() => {
  const currentProjectId = Number(transferAssignment.value?.projectId || selectedProject.value?.id || 0)
  return projects.value
    .filter((project) => Number(project.id) !== currentProjectId)
    .map((project) => ({
      value: String(project.id),
      label: project.projectName || `項目 #${project.id}`,
    }))
})

const activeAssignments = computed(() => assignments.value.filter((row) => row.status === 'active'))
const activeAssignedPersonnelIds = computed(() =>
  new Set(activeAssignments.value.map((row) => Number(row.personnelId)).filter((id) => Number.isInteger(id) && id > 0))
)
const filteredPersonnelRows = computed(() => {
  const keyword = String(personnelKeyword.value || '').trim().toLowerCase()
  if (!keyword) return personnelRows.value
  return personnelRows.value.filter((row) =>
    [
      row.fullName,
      row.department,
      row.team,
      row.title,
      row.email,
      row.phone,
      row.managerName,
    ].join(' ').toLowerCase().includes(keyword)
  )
})
const selectedPersonnelForAdd = computed(() =>
  personnelRows.value.find((row) => Number(row.id) === Number(assignmentForm.value.personnelId || 0)) || null
)

const clearFeedback = () => {
  pageMessage.value = ''
  pageError.value = ''
}

const fetchJson = async (endpoint, options = {}) => {
  const response = await fetch(endpoint, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
}

const toQueryString = (params = {}) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    const text = String(value ?? '').trim()
    if (text) search.set(key, text)
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getProjectStatusLabel = (status) =>
  projectStatusFormOptions.find((item) => item.value === status)?.label || status || '--'

const getAssignmentStatusLabel = (status) =>
  assignmentStatusOptions.find((item) => item.value === status)?.label || status || '--'

const getSourceLabel = (source) => sourceLabels[source] || source || '--'

const applyProjectForm = (project) => {
  selectedProject.value = project || null
  projectForm.value = {
    projectName: String(project?.projectName || ''),
    status: String(project?.status || 'planned'),
    ownerPersonnelId: project?.ownerPersonnelId ? String(project.ownerPersonnelId) : '',
    startDate: String(project?.startDate || ''),
    endDate: String(project?.endDate || ''),
    remark: String(project?.remark || ''),
  }
}

const resetProjectForm = () => {
  selectedProject.value = null
  assignments.value = []
  resetAssignmentForm()
  csvSummary.value = null
  activeView.value = 'manage'
}

const openCreateProjectModal = () => {
  clearFeedback()
  projectModalMode.value = 'create'
  projectModalProjectId.value = null
  projectForm.value = createEmptyProjectForm()
  isProjectModalOpen.value = true
}

const openEditProjectModal = (project = selectedProject.value) => {
  clearFeedback()
  if (!project?.id) {
    openCreateProjectModal()
    return
  }
  projectModalMode.value = 'edit'
  projectModalProjectId.value = Number(project.id)
  projectForm.value = {
    projectName: String(project.projectName || ''),
    status: String(project.status || 'planned'),
    ownerPersonnelId: project.ownerPersonnelId ? String(project.ownerPersonnelId) : '',
    startDate: String(project.startDate || ''),
    endDate: String(project.endDate || ''),
    remark: String(project.remark || ''),
  }
  isProjectModalOpen.value = true
}

const closeProjectModal = () => {
  if (projectSaving.value) return
  isProjectModalOpen.value = false
  projectModalMode.value = 'create'
  projectModalProjectId.value = null
}

const openAssignmentModal = async (project = selectedProject.value) => {
  clearFeedback()
  if (!project?.id) {
    pageError.value = '請先選擇項目'
    return
  }
  await selectProject(project.id)
  isAssignmentModalOpen.value = true
  isAssignmentEditorOpen.value = false
  transferAssignment.value = null
}

const closeAssignmentModal = () => {
  if (assignmentSaving.value || transferSaving.value) return
  isAssignmentModalOpen.value = false
  isAssignmentEditorOpen.value = false
  resetAssignmentForm()
}

const openCreateAssignmentPanel = () => {
  resetAssignmentForm()
  personnelKeyword.value = ''
  isAssignmentEditorOpen.value = true
}

const closeAssignmentEditor = () => {
  if (assignmentSaving.value) return
  isAssignmentEditorOpen.value = false
  resetAssignmentForm()
}

const resetAssignmentForm = () => {
  assignmentForm.value = createEmptyAssignmentForm()
  transferAssignment.value = null
  transferForm.value = {
    targetProjectId: '',
    projectRole: '',
    transferDate: '',
    remark: '',
  }
}

const loadPersonnel = async () => {
  const data = await fetchJson(`${apiBaseUrl}/api/personnel`)
  personnelRows.value = Array.isArray(data.personnel) ? data.personnel : []
}

const loadProjects = async ({ preserveSelection = true } = {}) => {
  projectsLoading.value = true
  try {
    const query = toQueryString({
      keyword: projectKeyword.value,
      status: projectStatusFilter.value,
    })
    const data = await fetchJson(`${apiBaseUrl}/api/projects${query}`)
    projects.value = Array.isArray(data.projects) ? data.projects : []

    if (!preserveSelection) return
    const selected = projects.value.find((project) => Number(project.id) === Number(selectedProject.value?.id))
    if (selected?.id) {
      await selectProject(selected.id)
      return
    }
    if (projects.value[0]?.id) {
      await selectProject(projects.value[0].id)
    } else {
      resetProjectForm()
    }
  } catch (error) {
    pageError.value = error?.message || '讀取項目失敗'
  } finally {
    projectsLoading.value = false
  }
}

const selectProject = async (projectId) => {
  clearFeedback()
  csvSummary.value = null
  const id = Number(projectId)
  if (!Number.isInteger(id) || id <= 0) return
  const data = await fetchJson(`${apiBaseUrl}/api/projects/${id}`)
  applyProjectForm(data.project)
  assignments.value = Array.isArray(data.assignments) ? data.assignments : []
  resetAssignmentForm()
}

const saveProject = async () => {
  clearFeedback()
  const payload = {
    ...projectForm.value,
    ownerPersonnelId: projectForm.value.ownerPersonnelId || null,
  }
  if (!payload.projectName.trim()) {
    pageError.value = '請先輸入項目名'
    return
  }

  projectSaving.value = true
  try {
    const endpoint = isProjectModalEditing.value && projectModalProjectId.value
      ? `${apiBaseUrl}/api/projects/${projectModalProjectId.value}`
      : `${apiBaseUrl}/api/projects`
    const method = isProjectModalEditing.value && projectModalProjectId.value ? 'PATCH' : 'POST'
    const data = await fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await loadProjects({ preserveSelection: false })
    if (data?.project?.id) await selectProject(data.project.id)
    pageMessage.value = method === 'POST' ? '項目已建立' : '項目已更新'
    isProjectModalOpen.value = false
    projectModalMode.value = 'create'
    projectModalProjectId.value = null
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
  } catch (error) {
    pageError.value = error?.message || '儲存項目失敗'
  } finally {
    projectSaving.value = false
  }
}

const deleteProject = async (project = selectedProject.value) => {
  if (!project?.id || projectDeleting.value) return
  const confirmed = window.confirm(`確定刪除「${project.projectName || '此項目'}」？相關項目安排會一併移除。`)
  if (!confirmed) return

  clearFeedback()
  projectDeleting.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/projects/${project.id}`, { method: 'DELETE' })
    await loadProjects({ preserveSelection: false })
    if (projects.value[0]?.id) await selectProject(projects.value[0].id)
    else resetProjectForm()
    pageMessage.value = '項目已刪除'
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
  } catch (error) {
    pageError.value = error?.message || '刪除項目失敗'
  } finally {
    projectDeleting.value = false
  }
}

const applyPersonnelSelection = (personnelId) => {
  assignmentForm.value.personnelId = String(personnelId || '')
}

const isPersonnelAlreadyActive = (personnelId) => activeAssignedPersonnelIds.value.has(Number(personnelId))

const saveAssignment = async () => {
  clearFeedback()
  if (!selectedProject.value?.id) {
    pageError.value = '請先選擇項目'
    return
  }
  if (!assignmentForm.value.personnelId) {
    pageError.value = '請先從內部人員名單選擇人員'
    return
  }
  if (isPersonnelAlreadyActive(assignmentForm.value.personnelId)) {
    pageError.value = '此人員已在目前項目組中'
    return
  }

  assignmentSaving.value = true
  try {
    const payload = {
      personnelId: assignmentForm.value.personnelId || null,
      projectRole: '',
      startDate: '',
      endDate: '',
      status: 'active',
      remark: '',
      source: 'manual',
    }
    await fetchJson(`${apiBaseUrl}/api/projects/${selectedProject.value.id}/personnel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await Promise.all([loadPersonnel(), selectProject(selectedProject.value.id)])
    pageMessage.value = '人員已加入項目'
    isAssignmentEditorOpen.value = false
    resetAssignmentForm()
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
  } catch (error) {
    pageError.value = error?.message || '儲存項目人員失敗'
  } finally {
    assignmentSaving.value = false
  }
}

const removeAssignment = async (row) => {
  const assignmentId = Number(row?.id)
  if (!assignmentId || assignmentRemovingIds.value.includes(assignmentId)) return
  const confirmed = window.confirm(`確定將「${row.fullName || '此人員'}」移出項目？`)
  if (!confirmed) return

  clearFeedback()
  assignmentRemovingIds.value = [...assignmentRemovingIds.value, assignmentId]
  try {
    await fetchJson(`${apiBaseUrl}/api/project-personnel-assignments/${assignmentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endDate: new Date().toISOString().slice(0, 10) }),
    })
    await selectProject(selectedProject.value.id)
    pageMessage.value = '人員已移出項目'
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
  } catch (error) {
    pageError.value = error?.message || '移出項目失敗'
  } finally {
    assignmentRemovingIds.value = assignmentRemovingIds.value.filter((id) => id !== assignmentId)
  }
}

const beginTransfer = (row) => {
  transferAssignment.value = row
  const firstTarget = transferProjectOptions.value[0]?.value || ''
  transferForm.value = {
    targetProjectId: firstTarget,
    projectRole: row.projectRole || '',
    transferDate: new Date().toISOString().slice(0, 10),
    remark: '',
  }
}

const transferSelectedAssignment = async () => {
  clearFeedback()
  if (!transferAssignment.value?.id || !transferForm.value.targetProjectId) {
    pageError.value = '請先選擇要調動到的項目'
    return
  }

  transferSaving.value = true
  try {
    await fetchJson(`${apiBaseUrl}/api/project-personnel-assignments/${transferAssignment.value.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transferForm.value),
    })
    await Promise.all([loadProjects({ preserveSelection: false }), selectProject(selectedProject.value.id)])
    pageMessage.value = '人員調動已完成'
    resetAssignmentForm()
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
  } catch (error) {
    pageError.value = error?.message || '調動人員失敗'
  } finally {
    transferSaving.value = false
  }
}

const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('讀取 CSV 失敗'))
    reader.readAsText(file)
  })

const handleCsvFileChange = (event) => {
  csvFile.value = event.target.files?.[0] || null
  csvSummary.value = null
}

const importCsv = async () => {
  clearFeedback()
  if (!selectedProject.value?.id) {
    pageError.value = '請先選擇項目'
    return
  }
  if (!csvFile.value) {
    pageError.value = '請先選擇 CSV 檔案'
    return
  }

  csvImporting.value = true
  try {
    const csvText = await readFileText(csvFile.value)
    const data = await fetchJson(`${apiBaseUrl}/api/projects/${selectedProject.value.id}/personnel/import-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText }),
    })
    csvSummary.value = data.summary || null
    assignments.value = Array.isArray(data.assignments) ? data.assignments : assignments.value
    await Promise.all([loadPersonnel(), loadProjects({ preserveSelection: false })])
    pageMessage.value = `CSV 匯入完成：新增 ${csvSummary.value?.createdCount || 0}，更新 ${csvSummary.value?.updatedCount || 0}，錯誤 ${csvSummary.value?.errorCount || 0}`
    window.dispatchEvent(new CustomEvent('hrai-projects-updated'))
  } catch (error) {
    pageError.value = error?.message || 'CSV 匯入失敗'
  } finally {
    csvImporting.value = false
  }
}

const handleProjectsUpdated = async () => {
  await loadProjects()
}

onMounted(async () => {
  clearFeedback()
  window.addEventListener('hrai-projects-updated', handleProjectsUpdated)
  await loadPersonnel()
  await loadProjects()
})

onUnmounted(() => {
  window.removeEventListener('hrai-projects-updated', handleProjectsUpdated)
})
</script>

<template>
  <section class="app-page project-page">
    <header class="page-header">
      <div class="header-main">
        <div>
          <h2>項目管理</h2>
          <p>建立項目、維護項目組人員名單，並保留加入、移出與調動記錄。</p>
        </div>
        <div class="view-tabs" role="tablist" aria-label="項目管理視圖">
          <button type="button" class="tab-btn" :class="{ active: activeView === 'manage' }" @click="activeView = 'manage'">
            建立 / 編輯
          </button>
          <button type="button" class="tab-btn" :class="{ active: activeView === 'preview' }" @click="activeView = 'preview'">
            名單預覽
          </button>
        </div>
      </div>
      <p v-if="pageMessage" class="message">{{ pageMessage }}</p>
      <p v-if="pageError" class="error">{{ pageError }}</p>
    </header>

    <div class="project-grid">
      <section class="card project-list-card">
        <div class="card-header">
          <div>
            <h3>項目列表</h3>
            <p class="subtle">共 {{ projects.length }} 個項目</p>
          </div>
          <div class="toolbar-actions">
            <button
              v-if="selectedProject?.id"
              type="button"
              class="secondary-btn"
              @click="openCreateProjectModal"
            >
              新增項目
            </button>
            <button
              type="button"
              class="primary-btn"
              @click="selectedProject?.id ? openEditProjectModal() : openCreateProjectModal()"
            >
              {{ selectedProject?.id ? '編輯項目' : '新增項目' }}
            </button>
          </div>
        </div>

        <div class="project-filters">
          <input
            v-model.trim="projectKeyword"
            type="text"
            class="search-input"
            placeholder="搜尋項目 / 負責人 / 備註"
            @keyup.enter="loadProjects({ preserveSelection: false })"
          />
          <AppSelect
            :model-value="projectStatusFilter"
            :options="projectStatusOptions"
            placeholder="篩選狀態"
            @update:model-value="projectStatusFilter = $event; loadProjects({ preserveSelection: false })"
          />
          <button type="button" class="secondary-btn" @click="loadProjects({ preserveSelection: false })">搜尋</button>
        </div>

        <p v-if="projectsLoading" class="hint">讀取中...</p>
        <div v-else class="table-wrap">
          <table class="structured-table project-index-table">
            <thead>
              <tr>
                <th>項目名</th>
                <th>狀態</th>
                <th>負責人</th>
                <th>日期</th>
                <th>人員安排</th>
                <th>更新時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!projects.length">
                <td colspan="7" class="empty-cell">尚未建立項目</td>
              </tr>
              <tr
                v-for="project in projects"
                :key="project.id"
                class="project-row"
                :class="{ active: Number(project.id) === Number(selectedProject?.id) }"
                @click="selectProject(project.id)"
              >
                <td><strong>{{ project.projectName || '--' }}</strong></td>
                <td><span class="status-chip">{{ getProjectStatusLabel(project.status) }}</span></td>
                <td>{{ project.ownerName || '--' }}</td>
                <td>{{ project.startDate || '--' }} / {{ project.endDate || '--' }}</td>
                <td>
                  <button type="button" class="arrangement-link" @click.stop="openAssignmentModal(project)">
                    在組 {{ project.activeAssignmentCount }} / 總安排 {{ project.assignmentCount }}
                  </button>
                </td>
                <td>{{ formatDateTime(project.updatedAt) }}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="link-btn" @click.stop="openEditProjectModal(project)">編輯</button>
                    <button type="button" class="link-btn danger-text" :disabled="projectDeleting" @click.stop="deleteProject(project)">刪除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="activeView === 'preview'" class="card preview-card">
        <div class="card-header">
          <div>
            <h3>人員名單預覽</h3>
            <p class="subtle">{{ selectedProject?.projectName || '請先選擇項目' }}</p>
          </div>
          <span class="count-chip">{{ assignments.length }}</span>
        </div>

        <div class="table-wrap">
          <table class="structured-table preview-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>部門 / 組別</th>
                <th>職稱</th>
                <th>Email</th>
                <th>電話</th>
                <th>主管</th>
                <th>項目角色</th>
                <th>入組日期</th>
                <th>離組日期</th>
                <th>來源</th>
                <th>狀態</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!assignments.length">
                <td colspan="12" class="empty-cell">尚無可預覽的人員名單</td>
              </tr>
              <tr v-for="row in assignments" :key="row.id">
                <td>{{ row.fullName || '--' }}</td>
                <td>{{ [row.department, row.team].filter(Boolean).join(' / ') || '--' }}</td>
                <td>{{ row.title || '--' }}</td>
                <td>{{ row.email || '--' }}</td>
                <td>{{ row.phone || '--' }}</td>
                <td>{{ row.managerName || '--' }}</td>
                <td>{{ row.projectRole || '--' }}</td>
                <td>{{ row.startDate || '--' }}</td>
                <td>{{ row.endDate || '--' }}</td>
                <td>{{ getSourceLabel(row.source) }}</td>
                <td>{{ getAssignmentStatusLabel(row.status) }}</td>
                <td class="remark-cell">{{ row.remark || '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="selectedProject?.updatedAt" class="subtle">最後更新：{{ formatDateTime(selectedProject.updatedAt) }}</p>
      </section>
    </div>

    <div v-if="isProjectModalOpen" class="modal-backdrop" @click.self="closeProjectModal">
      <div class="modal-panel project-modal">
        <header class="modal-header">
          <div>
            <h3>{{ isProjectModalEditing ? '編輯項目' : '新增項目' }}</h3>
            <p class="subtle">維護項目主檔，保存後會回到目前項目列表。</p>
          </div>
          <button type="button" class="ghost-btn" :disabled="projectSaving" @click="closeProjectModal">關閉</button>
        </header>

        <div class="form-grid">
          <label class="field">
            <span>項目名</span>
            <input v-model.trim="projectForm.projectName" type="text" placeholder="例如：澳門零售銀行招聘項目" />
          </label>
          <label class="field">
            <span>項目狀態</span>
            <AppSelect
              :model-value="projectForm.status"
              :options="projectStatusFormOptions"
              placeholder="選擇狀態"
              @update:model-value="projectForm.status = $event"
            />
          </label>
          <label class="field">
            <span>負責人</span>
            <AppSelect
              :model-value="projectForm.ownerPersonnelId"
              :options="ownerOptions"
              placeholder="選擇負責人"
              @update:model-value="projectForm.ownerPersonnelId = $event"
            />
          </label>
          <label class="field">
            <span>開始日期</span>
            <input v-model="projectForm.startDate" type="date" />
          </label>
          <label class="field">
            <span>結束日期</span>
            <input v-model="projectForm.endDate" type="date" />
          </label>
          <label class="field full-span">
            <span>備註</span>
            <textarea v-model.trim="projectForm.remark" rows="3" placeholder="補充項目說明"></textarea>
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="projectSaving" @click="closeProjectModal">取消</button>
          <button type="button" class="primary-btn" :disabled="projectSaving" @click="saveProject">
            {{ projectSaving ? '儲存中...' : isProjectModalEditing ? '更新項目' : '建立項目' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="isAssignmentModalOpen" class="modal-backdrop" @click.self="closeAssignmentModal">
      <div class="modal-panel assignment-modal">
        <header class="modal-header">
          <div>
            <h3>人員安排</h3>
            <p class="subtle">{{ selectedProject?.projectName || '未選擇項目' }}｜在組 {{ activeAssignments.length }} 人，總安排 {{ assignments.length }} 筆</p>
          </div>
          <div class="toolbar-actions">
            <button type="button" class="primary-btn" :disabled="!selectedProject?.id" @click="openCreateAssignmentPanel">
              新增人員
            </button>
            <button type="button" class="ghost-btn" :disabled="assignmentSaving || transferSaving" @click="closeAssignmentModal">
              關閉
            </button>
          </div>
        </header>

        <div class="table-wrap">
          <table class="structured-table project-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>項目角色</th>
                <th>部門 / 組別</th>
                <th>職稱</th>
                <th>來源</th>
                <th>狀態</th>
                <th>入組 / 離組</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!assignments.length">
                <td colspan="8" class="empty-cell">尚無已安排人員</td>
              </tr>
              <tr v-for="row in assignments" :key="row.id">
                <td>{{ row.fullName || '--' }}</td>
                <td>{{ row.projectRole || '--' }}</td>
                <td>{{ [row.department, row.team].filter(Boolean).join(' / ') || '--' }}</td>
                <td>{{ row.title || '--' }}</td>
                <td>{{ getSourceLabel(row.source) }}</td>
                <td><span class="status-chip" :class="`assignment-${row.status}`">{{ getAssignmentStatusLabel(row.status) }}</span></td>
                <td>{{ row.startDate || '--' }} / {{ row.endDate || '--' }}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="link-btn" :disabled="row.status !== 'active'" @click="beginTransfer(row)">調動</button>
                    <button
                      type="button"
                      class="link-btn danger-text"
                      :disabled="row.status !== 'active' || assignmentRemovingIds.includes(Number(row.id))"
                      @click="removeAssignment(row)"
                    >
                      移出
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <section v-if="transferAssignment" class="transfer-card">
          <div class="card-header">
            <div>
              <h3>調動人員</h3>
              <p class="subtle">{{ transferAssignment.fullName }}｜目前項目：{{ transferAssignment.projectName }}</p>
            </div>
            <button type="button" class="ghost-btn" @click="transferAssignment = null">取消調動</button>
          </div>
          <div class="form-grid">
            <label class="field">
              <span>調入項目</span>
              <AppSelect
                :model-value="transferForm.targetProjectId"
                :options="transferProjectOptions"
                placeholder="選擇目標項目"
                @update:model-value="transferForm.targetProjectId = $event"
              />
            </label>
            <label class="field">
              <span>新項目角色</span>
              <input v-model.trim="transferForm.projectRole" type="text" />
            </label>
            <label class="field">
              <span>調動日期</span>
              <input v-model="transferForm.transferDate" type="date" />
            </label>
            <label class="field full-span">
              <span>調動備註</span>
              <textarea v-model.trim="transferForm.remark" rows="3"></textarea>
            </label>
          </div>
          <div class="toolbar-actions">
            <button type="button" class="primary-btn" :disabled="transferSaving || !transferForm.targetProjectId" @click="transferSelectedAssignment">
              {{ transferSaving ? '調動中...' : '確認調動' }}
            </button>
          </div>
        </section>

        <section class="csv-panel">
          <div class="card-header">
            <div>
              <h3>CSV 匯入</h3>
              <p class="subtle">欄位支援：姓名、部門、組別、職稱、Email、電話、主管、項目角色、入組日期、離組日期、備註。</p>
            </div>
            <div class="csv-actions">
              <input type="file" accept=".csv,text/csv" :disabled="!selectedProject?.id || csvImporting" @change="handleCsvFileChange" />
              <button type="button" class="secondary-btn" :disabled="!selectedProject?.id || !csvFile || csvImporting" @click="importCsv">
                {{ csvImporting ? '匯入中...' : '匯入 CSV' }}
              </button>
            </div>
          </div>
          <div v-if="csvSummary" class="import-summary">
            <span>總筆數：{{ csvSummary.total }}</span>
            <span>新增：{{ csvSummary.createdCount }}</span>
            <span>更新：{{ csvSummary.updatedCount }}</span>
            <span>錯誤：{{ csvSummary.errorCount }}</span>
          </div>
          <div v-if="csvSummary?.errors?.length" class="table-wrap">
            <table class="structured-table">
              <thead>
                <tr>
                  <th>CSV 行號</th>
                  <th>錯誤原因</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="error in csvSummary.errors.slice(0, 8)" :key="`${error.rowNumber}-${error.message}`">
                  <td>{{ error.rowNumber }}</td>
                  <td>{{ error.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>

    <div v-if="isAssignmentEditorOpen" class="modal-backdrop layered-modal" @click.self="closeAssignmentEditor">
      <div class="modal-panel assignment-editor-modal">
        <header class="modal-header">
          <div>
            <h3>加入項目人員</h3>
            <p class="subtle">{{ selectedProject?.projectName || '請先選擇項目' }}｜從內部人員名單點選人員後加入</p>
          </div>
          <button type="button" class="ghost-btn" :disabled="assignmentSaving" @click="closeAssignmentEditor">關閉</button>
        </header>

        <div class="personnel-picker-toolbar">
          <input
            v-model.trim="personnelKeyword"
            type="text"
            class="search-input"
            placeholder="搜尋姓名 / 部門 / 組別 / 職稱 / 電話 / Email / 主管"
          />
          <span class="selected-count-chip">
            {{ selectedPersonnelForAdd?.fullName ? `已選：${selectedPersonnelForAdd.fullName}` : '尚未選擇人員' }}
          </span>
        </div>

        <div class="table-wrap">
          <table class="structured-table personnel-picker-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>部門 / 組別</th>
                <th>職稱</th>
                <th>Email</th>
                <th>電話</th>
                <th>主管</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredPersonnelRows.length">
                <td colspan="7" class="empty-cell">沒有符合條件的內部人員</td>
              </tr>
              <tr
                v-for="person in filteredPersonnelRows"
                :key="person.id"
                class="personnel-picker-row"
                :class="{
                  selected: Number(assignmentForm.personnelId) === Number(person.id),
                  assigned: isPersonnelAlreadyActive(person.id),
                }"
                @click="!isPersonnelAlreadyActive(person.id) && applyPersonnelSelection(person.id)"
              >
                <td><strong>{{ person.fullName || '--' }}</strong></td>
                <td>{{ [person.department, person.team].filter(Boolean).join(' / ') || '--' }}</td>
                <td>{{ person.title || '--' }}</td>
                <td>{{ person.email || '--' }}</td>
                <td>{{ person.phone || '--' }}</td>
                <td>{{ person.managerName || '--' }}</td>
                <td>
                  <span v-if="isPersonnelAlreadyActive(person.id)" class="status-chip assignment-active">已在組</span>
                  <span v-else class="status-chip">可加入</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" :disabled="assignmentSaving" @click="closeAssignmentEditor">取消</button>
          <button
            type="button"
            class="primary-btn"
            :disabled="!selectedProject?.id || !assignmentForm.personnelId || isPersonnelAlreadyActive(assignmentForm.personnelId) || assignmentSaving"
            @click="saveAssignment"
          >
            {{ assignmentSaving ? '加入中...' : '加入項目' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.project-page {
  color: var(--text-base);
}

.header-main,
.toolbar-actions,
.view-tabs,
.csv-actions,
.row-actions,
.modal-header,
.modal-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.header-main {
  justify-content: space-between;
  align-items: flex-start;
}

.view-tabs {
  justify-content: flex-end;
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
  background: linear-gradient(180deg, #4b84ff 0%, var(--accent) 100%);
  box-shadow: 0 12px 24px rgba(47, 111, 237, 0.2);
}

.project-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.project-list-card {
  align-self: start;
}

.project-filters {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 220px auto;
  gap: 0.75rem;
}

.project-index-table,
.project-table,
.preview-table {
  width: max-content;
  min-width: 100%;
}

.project-row {
  cursor: pointer;
  transition: background-color 180ms ease;
}

.project-row:hover {
  background: rgba(47, 111, 237, 0.04);
}

.project-row.active {
  background: rgba(47, 111, 237, 0.08);
}

.project-row strong {
  color: var(--text-strong);
}

.arrangement-link {
  padding: 0;
  color: var(--accent);
  background: transparent;
  font-weight: 700;
}

.arrangement-link:hover {
  color: var(--accent-hover);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.9rem;
}

.full-span {
  grid-column: 1 / -1;
}

.muted {
  opacity: 0.74;
}

.transfer-card {
  border-color: rgba(47, 111, 237, 0.2);
  background: rgba(239, 246, 255, 0.72);
}

.csv-actions {
  justify-content: flex-end;
}

.csv-actions input {
  max-width: 260px;
}

.import-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.import-summary span {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0.32rem 0.72rem;
  border-radius: var(--radius-pill);
  background: var(--surface-soft);
  font-weight: 700;
  font-size: 0.83rem;
}

.preview-card {
  min-width: 0;
}

.project-modal,
.assignment-modal,
.assignment-editor-modal {
  display: grid;
  gap: 1rem;
}

.assignment-modal {
  width: min(1180px, calc(100vw - 2rem));
}

.assignment-editor-modal {
  width: min(1080px, calc(100vw - 2rem));
}

.personnel-picker-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.personnel-picker-toolbar .search-input {
  flex: 1 1 360px;
  min-width: min(360px, 100%);
}

.selected-count-chip {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0.38rem 0.82rem;
  border: 1px solid rgba(47, 111, 237, 0.18);
  border-radius: var(--radius-pill);
  background: rgba(239, 246, 255, 0.82);
  color: var(--accent);
  font-size: 0.86rem;
  font-weight: 800;
}

.personnel-picker-table {
  width: max-content;
  min-width: 100%;
}

.personnel-picker-row {
  cursor: pointer;
  transition: background-color 180ms ease, opacity 180ms ease;
}

.personnel-picker-row:hover {
  background: rgba(47, 111, 237, 0.04);
}

.personnel-picker-row.selected {
  background: rgba(47, 111, 237, 0.1);
}

.personnel-picker-row.assigned {
  cursor: not-allowed;
  opacity: 0.58;
}

.layered-modal {
  z-index: 1100;
  background: rgba(13, 20, 33, 0.34);
}

.modal-header,
.modal-actions {
  justify-content: space-between;
}

.modal-header h3 {
  margin: 0;
}

.remark-cell {
  min-width: 220px;
  max-width: 320px;
  white-space: pre-wrap;
}

.assignment-active {
  color: var(--success);
  background: var(--success-soft);
}

.assignment-transferred {
  color: var(--accent);
  background: var(--accent-soft);
}

.assignment-removed {
  color: #8a5b00;
  background: rgba(255, 206, 107, 0.18);
}

.transfer-card,
.csv-panel {
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.72);
}

.transfer-card,
.csv-panel {
  display: grid;
  gap: 0.9rem;
}

.transfer-card {
  border-color: rgba(47, 111, 237, 0.2);
  background: rgba(239, 246, 255, 0.72);
}

.danger-text {
  color: var(--danger);
}

.row-actions {
  min-width: 160px;
}

.link-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 1180px) {
  .project-filters,
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .header-main,
  .card-header,
  .modal-header,
  .modal-actions,
  .toolbar-actions,
  .view-tabs,
  .csv-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
