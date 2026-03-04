<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import AddNodeModal from '../components/CreateProject/AddNodeModal.vue'
import AssigneeDropdown from '../components/CreateProject/AssigneeDropdown.vue'
import EditRowModal from '../components/CreateProject/EditRowModal.vue'
import MoreRowModal from '../components/CreateProject/MoreRowModal.vue'
import StatusDropdown from '../components/CreateProject/StatusDropdown.vue'
import TaskStepsModal from '../components/CreateProject/TaskStepsModal.vue'
import Toolbar from '../components/toolbar/Toolbar.vue'
import {
  createStatus,
  createProduct,
  createProject,
  createTask,
  createTaskStep,
  deleteRow,
  fetchStatuses,
  fetchUsers,
  fetchProjectTree,
  fetchTaskSteps,
  updateTaskStepStatus,
  updateRow,
} from '../scripts/CreateProject/api.js'

const searchQuery = ref('')
const statusFilterId = ref(null)
const assigneeFilterId = ref(null)

const rows = ref([])
const taskCount = ref(0)
const loading = ref(false)
const error = ref('')
const statusOptions = ref([])
const userOptions = ref([])
const metaError = ref('')
const activeMenuId = ref(null)
const stepAssigneeMenuId = 'step-assignee'

const expandedMap = ref(new Set())

const modalVisible = ref(false)
const currentTask = ref(null)
const stepsLoading = ref(false)
const stepsError = ref('')
const stepsData = ref([])
const stepSubmitLoading = ref(false)
const stepSubmitError = ref('')
const editModalVisible = ref(false)
const editModalRow = ref(null)
const editModalLoading = ref(false)
const editModalError = ref('')
const moreModalVisible = ref(false)
const moreModalRow = ref(null)
const moreModalLoading = ref(false)
const moreModalError = ref('')

const addModalVisible = ref(false)
const addModalType = ref('project')
const addModalParent = ref(null)
const addModalLoading = ref(false)
const addModalError = ref('')

const statusFilters = computed(() => {
  if (!statusFilterId.value) return []
  const status = statusOptions.value.find(
    (entry) => String(entry.id) === String(statusFilterId.value)
  )
  return status?.name ? [status.name] : []
})
const assigneeFilters = computed(() => {
  if (!assigneeFilterId.value) return []
  const user = userOptions.value.find(
    (entry) => String(entry.id) === String(assigneeFilterId.value)
  )
  return user?.username ? [user.username] : []
})
const defaultStatusId = computed(() => statusOptions.value[0]?.id ?? null)

const hasActiveFilters = computed(
  () =>
    searchQuery.value.trim().length > 0 ||
    statusFilters.value.length > 0 ||
    assigneeFilters.value.length > 0
)

const rowKey = (rowType, id) => `${rowType}:${id}`
const isExpanded = (row) => expandedMap.value.has(rowKey(row.rowType, row.id))
const canToggle = (row) => row.rowType !== 'task' && row.hasChildren

const addModalConfig = computed(() => {
  switch (addModalType.value) {
    case 'product':
      return {
        title: '新增產品',
        placeholder: '輸入產品名稱',
        confirmLabel: '新增產品',
      }
    case 'task':
      return {
        title: '新增任務',
        placeholder: '輸入任務標題',
        confirmLabel: '新增任務',
      }
    default:
      return {
        title: '新增專案',
        placeholder: '輸入專案名稱',
        confirmLabel: '新增專案',
      }
  }
})

const MAX_TREE_DEPTH = 20

const normalizeRows = (data) => {
  const rawRows = Array.isArray(data) ? data : []
  const normalized = rawRows.map((row) => ({ ...row }))
  const childCounts = new Map()

  normalized.forEach((row) => {
    const parentId = row.parentId ?? null
    if (parentId === null || parentId === undefined) return
    const parentKey =
      row.rowType === 'product'
        ? rowKey('project', parentId)
        : row.rowType === 'task'
          ? rowKey('product', parentId)
          : null
    if (!parentKey) return
    childCounts.set(parentKey, (childCounts.get(parentKey) || 0) + 1)
  })

  normalized.forEach((row) => {
    if (row.parentId === row.id) {
      // Root cause note: product rows returned after creation sometimes self-reference
      // parentId === id, forming a cycle that made the generic parent walk() recurse forever.
      row.parentId = null
    }
    const expectedLevel =
      row.rowType === 'project' ? 0 : row.rowType === 'product' ? 1 : row.rowType === 'task' ? 2 : row.level
    row.level = expectedLevel
    row.hasChildren =
      row.rowType !== 'task' && (childCounts.get(rowKey(row.rowType, row.id)) || 0) > 0
  })

  return normalized
}

const visibleRows = computed(() => {
  if (!rows.value.length) return []

  const projects = rows.value.filter((row) => row.rowType === 'project')
  const productsByProject = new Map()
  const tasksByProduct = new Map()

  rows.value.forEach((row) => {
    if (row.rowType === 'product') {
      const key = row.parentId ?? 'root'
      if (!productsByProject.has(key)) productsByProject.set(key, [])
      productsByProject.get(key).push(row)
    } else if (row.rowType === 'task') {
      const key = row.parentId ?? 'root'
      if (!tasksByProduct.has(key)) tasksByProduct.set(key, [])
      tasksByProduct.get(key).push(row)
    }
  })

  const output = []
  const visited = new Set()
  const walkTasks = (productId, depth) => {
    if (depth > MAX_TREE_DEPTH) return
    const tasks = tasksByProduct.get(productId) || []
    tasks.forEach((task) => {
      const nodeKey = `${task.rowType}:${task.id}`
      if (visited.has(nodeKey)) return
      visited.add(nodeKey)
      output.push(task)
    })
  }

  const walkProducts = (projectId, depth) => {
    if (depth > MAX_TREE_DEPTH) return
    const products = productsByProject.get(projectId) || []
    products.forEach((product) => {
      const nodeKey = `${product.rowType}:${product.id}`
      if (visited.has(nodeKey)) return
      visited.add(nodeKey)
      output.push(product)
      if (expandedMap.value.has(rowKey('product', product.id))) {
        walkTasks(product.id, depth + 1)
      }
    })
  }

  projects.forEach((project) => {
    const nodeKey = `${project.rowType}:${project.id}`
    if (visited.has(nodeKey)) return
    visited.add(nodeKey)
    output.push(project)
    if (expandedMap.value.has(rowKey('project', project.id))) {
      walkProducts(project.id, 1)
    }
  })

  return output
})

const getCurrentUser = () => {
  try {
    const raw = window.localStorage.getItem('innerai_user')
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const resolveCurrentUserId = () => {
  const user = getCurrentUser()
  const userMail = user?.mail
  if (!userMail) return null
  const matched = userOptions.value.find((entry) => entry.mail === userMail)
  return matched?.id ?? null
}

const formatTypeLabel = (type) => {
  switch (type) {
    case 'project':
      return '📚'
    case 'product':
      return '📦'
    case 'task':
      return '📋'
    default:
      return '⚠️'
  }
}

const depthPadding = (depth) => `${depth * 24}px`

const toggleExpanded = (row) => {
  if (!canToggle(row)) return
  const key = rowKey(row.rowType, row.id)
  const next = new Set(expandedMap.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedMap.value = next
}

const resetExpandedMap = (data) => {
  const next = new Set()
  if (hasActiveFilters.value) {
    data.forEach((row) => {
      if (row.rowType !== 'task') next.add(rowKey(row.rowType, row.id))
    })
  }
  expandedMap.value = next
}

const applyTreeResponse = (response, expandKeys = [], { preserveExpanded = false } = {}) => {
  rows.value = normalizeRows(response.rows || [])
  taskCount.value = response.taskCount || 0
  const next = preserveExpanded ? new Set(expandedMap.value) : new Set()
  if (!preserveExpanded) {
    resetExpandedMap(rows.value)
    expandedMap.value.forEach((key) => next.add(key))
  }
  expandKeys.forEach((key) => next.add(key))
  expandedMap.value = next
}

const buildFilterPayload = () => ({
  q: searchQuery.value.trim(),
  status: statusFilters.value,
  assignee: assigneeFilters.value,
  includeEmpty: true,
})

const loadTree = async ({ preserveExpanded = false } = {}) => {
  loading.value = true
  error.value = ''
  try {
    const response = await fetchProjectTree(buildFilterPayload())
    applyTreeResponse(response, [], { preserveExpanded })
  } catch (err) {
    error.value = err?.message || '載入失敗'
    rows.value = []
    taskCount.value = 0
  } finally {
    loading.value = false
  }
}

const loadMeta = async () => {
  metaError.value = ''
  try {
    const [statusResponse, userResponse] = await Promise.all([fetchStatuses(), fetchUsers()])
    statusOptions.value = statusResponse.statuses || []
    userOptions.value = userResponse.users || []
  } catch (err) {
    metaError.value = err?.message || '載入狀態或使用者資料失敗'
  }
}

const openAddModal = ({ type, parent }) => {
  addModalType.value = type
  addModalParent.value = parent || null
  addModalError.value = ''
  addModalVisible.value = true
}

const closeAddModal = () => {
  addModalVisible.value = false
  addModalParent.value = null
  addModalError.value = ''
  addModalLoading.value = false
}

const handleAddSubmit = async (name) => {
  addModalLoading.value = true
  addModalError.value = ''
  const user = getCurrentUser()
  const ownerMail = user?.mail || 'system'
  const createdBy = user?.username || user?.mail || 'system'
  try {
    let response = null
    let expandKeys = []
    if (addModalType.value === 'project') {
      response = await createProject({
        name,
        owner_mail: ownerMail,
        ...buildFilterPayload(),
      })
    } else if (addModalType.value === 'product') {
      const projectId = addModalParent.value?.id
      response = await createProduct({
        projectId,
        name,
        created_by: createdBy,
        ...buildFilterPayload(),
      })
      if (projectId) expandKeys = [rowKey('project', projectId)]
    } else if (addModalType.value === 'task') {
      const productId = addModalParent.value?.id
      response = await createTask({
        productId,
        title: name,
        status_id: defaultStatusId.value,
        created_by: createdBy,
        assignee_user_id: resolveCurrentUserId(),
        ...buildFilterPayload(),
      })
      const projectId = addModalParent.value?.parentId
      expandKeys = [
        productId ? rowKey('product', productId) : null,
        projectId ? rowKey('project', projectId) : null,
      ].filter(Boolean)
    }
    if (response) {
      applyTreeResponse(response, expandKeys, { preserveExpanded: true })
    }
    closeAddModal()
  } catch (err) {
    addModalError.value = err?.message || '新增失敗'
  } finally {
    addModalLoading.value = false
  }
}

const handleRowAdd = (row) => {
  if (row.rowType === 'project') {
    openAddModal({ type: 'product', parent: row })
  } else if (row.rowType === 'product') {
    openAddModal({ type: 'task', parent: row })
  }
}

const openTaskSteps = async (row) => {
  if (!row || row.rowType !== 'task') return
  modalVisible.value = true
  currentTask.value = row
  stepsLoading.value = true
  stepsError.value = ''
  stepsData.value = []
  stepSubmitError.value = ''
  activeMenuId.value = null
  try {
    const response = await fetchTaskSteps(row.id)
    stepsData.value = response.steps || []
  } catch (err) {
    stepsError.value = err?.message || '載入步驟失敗'
  } finally {
    stepsLoading.value = false
  }
}

const closeTaskSteps = () => {
  modalVisible.value = false
  currentTask.value = null
  stepsData.value = []
  stepsError.value = ''
  stepsLoading.value = false
  stepSubmitError.value = ''
  stepSubmitLoading.value = false
  activeMenuId.value = null
}

const openEditModal = (row) => {
  editModalRow.value = row
  editModalError.value = ''
  editModalVisible.value = true
}

const closeEditModal = () => {
  editModalVisible.value = false
  editModalRow.value = null
  editModalError.value = ''
  editModalLoading.value = false
}

const handleEditSubmit = async (name) => {
  if (!editModalRow.value) return
  editModalLoading.value = true
  editModalError.value = ''
  try {
    await updateRow({
      rowType: editModalRow.value.rowType,
      id: editModalRow.value.id,
      name,
    })
    closeEditModal()
    await loadTree({ preserveExpanded: true })
  } catch (err) {
    editModalError.value = err?.message || '更新失敗'
  } finally {
    editModalLoading.value = false
  }
}

const openMoreModal = (row) => {
  moreModalRow.value = row
  moreModalError.value = ''
  moreModalVisible.value = true
}

const closeMoreModal = () => {
  moreModalVisible.value = false
  moreModalRow.value = null
  moreModalError.value = ''
  moreModalLoading.value = false
}

const handleMoreDelete = async () => {
  if (!moreModalRow.value) return
  const confirmed = window.confirm('確定要刪除此筆資料？子階層資料也會一併刪除。')
  if (!confirmed) return
  moreModalLoading.value = true
  moreModalError.value = ''
  try {
    await deleteRow({
      rowType: moreModalRow.value.rowType,
      id: moreModalRow.value.id,
    })
    closeMoreModal()
    await loadTree({ preserveExpanded: true })
  } catch (err) {
    moreModalError.value = err?.message || '刪除失敗'
  } finally {
    moreModalLoading.value = false
  }
}

const handleMoreUpdate = async ({ status, assignee_user_id }) => {
  if (!moreModalRow.value) return
  moreModalLoading.value = true
  moreModalError.value = ''
  try {
    await updateRow({
      rowType: moreModalRow.value.rowType,
      id: moreModalRow.value.id,
      status,
      assignee_user_id,
    })
    closeMoreModal()
    await loadTree({ preserveExpanded: true })
  } catch (err) {
    moreModalError.value = err?.message || '更新失敗'
  } finally {
    moreModalLoading.value = false
  }
}

const handleAddStep = async ({ content, assignee_user_id }) => {
  const taskId = currentTask.value?.id
  if (!taskId) return
  stepSubmitLoading.value = true
  stepSubmitError.value = ''
  const user = getCurrentUser()
  try {
    const response = await createTaskStep({
      taskId,
      content,
      assignee_user_id,
      created_by: user?.username || user?.mail || 'system',
      status_id: defaultStatusId.value,
    })
    if (response?.step && currentTask.value?.id === taskId) {
      stepsData.value = [...stepsData.value, response.step]
    }
  } catch (err) {
    stepSubmitError.value = err?.message || '新增步驟失敗'
  } finally {
    stepSubmitLoading.value = false
  }
}

const handleStepStatusUpdate = async ({ step, status }) => {
  if (!step?.id || !status?.id) return
  try {
    const response = await updateTaskStepStatus({ stepId: step.id, status_id: status.id })
    if (response?.step) {
      stepsData.value = stepsData.value.map((item) => (item.id === step.id ? response.step : item))
    }
  } catch (err) {
    stepSubmitError.value = err?.message || '更新步驟狀態失敗'
  }
}

const handleStatusSelect = async (row, status) => {
  if (!row || row.rowType !== 'task') return
  try {
    await updateRow({
      rowType: row.rowType,
      id: row.id,
      status_id: status.id,
    })
    rows.value = rows.value.map((item) =>
      item.id === row.id && item.rowType === 'task'
        ? {
            ...item,
            status: status.name,
            status_id: status.id,
            status_color: status.color,
          }
        : item
    )
  } catch (err) {
    error.value = err?.message || '更新狀態失敗'
  }
}

const setActiveMenu = (menuId) => {
  activeMenuId.value = menuId
}

const handleStatusCreate = async ({ name, color }) => {
  try {
    const response = await createStatus({ name, color })
    if (response?.status) {
      statusOptions.value = [...statusOptions.value, response.status]
    }
  } catch (err) {
    error.value = err?.message || '新增狀態失敗'
  }
}

const handleAssigneeSelect = async (row, user) => {
  if (!row || row.rowType !== 'task') return
  try {
    await updateRow({
      rowType: row.rowType,
      id: row.id,
      assignee_user_id: user?.id ?? null,
    })
    rows.value = rows.value.map((item) =>
      item.id === row.id && item.rowType === 'task'
        ? {
            ...item,
            assignee_user_id: user?.id ?? null,
          }
        : item
    )
  } catch (err) {
    error.value = err?.message || '更新負責人失敗'
  }
}

const resetFilters = () => {
  searchQuery.value = ''
  statusFilterId.value = null
  assigneeFilterId.value = null
  activeMenuId.value = null
  loadTree()
}

let debounceTimer = null
watch([searchQuery, statusFilterId, assigneeFilterId], () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    loadTree()
  }, 300)
})

onMounted(() => {
  loadTree()
  loadMeta()
})
</script>

<template>
  <section class="create-project">
    <Toolbar />
    <div class="content">
      <div class="add-bar">
        <div class="add-bar__title">Project 管理</div>
        <button class="add-project-button" type="button" @click="openAddModal({ type: 'project' })">
          新增項目 / Add Project
        </button>
      </div>
      <div class="toolbar-row">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchQuery"
            class="search-input"
            type="search"
            placeholder="全局模糊搜尋"
          />
        </div>
        <div class="filter-group">
          <label class="filter-field">
            <span>狀態</span>
            <StatusDropdown
              :status-id="statusFilterId"
              :status-name="statusFilters[0] || '選擇狀態'"
              :status-color="
                statusOptions.find((entry) => String(entry.id) === String(statusFilterId))?.color
              "
              :statuses="statusOptions"
              :allow-create="false"
              :menu-id="'filter-status'"
              :active-menu-id="activeMenuId"
              @select="(status) => (statusFilterId = status.id)"
              @toggle="setActiveMenu"
            />
          </label>
          <label class="filter-field">
            <span>負責人</span>
            <AssigneeDropdown
              :assignee-id="assigneeFilterId"
              :users="userOptions"
              :menu-id="'filter-assignee'"
              :active-menu-id="activeMenuId"
              @select="(user) => (assigneeFilterId = user.id)"
              @toggle="setActiveMenu"
            />
          </label>
          <label class="filter-field">
            <button class="reset-button" type="button" @click="resetFilters" aria-label="清空搜尋">
            ⟲
            </button>
          </label>        
        </div>
        <div class="toolbar-actions">
          <div class="task-count">任務總數：{{ taskCount }}</div>
        </div>
      </div>

      <div v-if="loading" class="state-card">資料載入中...</div>
      <div v-else-if="error" class="state-card state-card--error">{{ error }}</div>
      <div v-else-if="visibleRows.length === 0" class="state-card">目前沒有資料。</div>
      <div v-else class="table">
        <div class="table-row table-row--header">
          <div>層級名稱</div>
          <div>狀態</div>
          <div>負責人</div>
          <div>更新時間</div>
          <div>建立時間</div>
        </div>
        <div v-if="loading" class="table-row table-row--empty">
          <div class="table-empty" :style="{ gridColumn: '1 / -1' }">資料載入中...</div>
        </div>
        <div v-else-if="error" class="table-row table-row--empty">
          <div class="table-empty" :style="{ gridColumn: '1 / -1' }">
            <span>{{ error }}</span>
            <button class="retry-button" type="button" @click="loadTree">重試</button>
          </div>
        </div>
        <div v-else-if="visibleRows.length === 0" class="table-row table-row--empty">
          <div class="table-empty" :style="{ gridColumn: '1 / -1' }">目前沒有資料。</div>
        </div>
        <template v-else>
          <div
            v-for="row in visibleRows"
            :key="`${row.rowType}-${row.id}`"
            class="table-row"
          >
            <div class="name-cell" :style="{ paddingLeft: depthPadding(row.level) }">
              <button
                v-if="canToggle(row)"
                class="toggle-button"
                type="button"
                @click.stop="toggleExpanded(row)"
              >
                {{ isExpanded(row) ? '▾' : '▸' }}
              </button>
              <span v-else class="toggle-spacer" aria-hidden="true"></span>
              <span class="type-tag" :class="`type-tag--${row.rowType}`">
                {{ formatTypeLabel(row.rowType) }}
              </span>
              <span class="node-name">{{ row.name }}</span>
              <div class="row-actions">
                <button
                  v-if="row.rowType === 'task'"
                  class="icon-button"
                  type="button"
                  @click.stop="openTaskSteps(row)"
                >
                  🔍
                  <span class="sr-only">查看步驟</span>
                </button>
                <button
                  v-if="row.rowType !== 'task'"
                  class="icon-button"
                  type="button"
                  @click.stop="handleRowAdd(row)"
                >
                  +
                  <span class="sr-only">新增</span>
                </button>
                <button class="icon-button" type="button" @click.stop="openEditModal(row)">
                  ✏️
                  <span class="sr-only">編輯</span>
                </button>
                <button class="icon-button" type="button" @click.stop="openMoreModal(row)">
                  ⋯
                  <span class="sr-only">更多</span>
                </button>
              </div>
            </div>
            <div class="status-cell">
              <StatusDropdown
                v-if="row.rowType === 'task'"
                :status-id="row.status_id"
                :status-name="row.status"
                :status-color="row.status_color"
                :statuses="statusOptions"
                :menu-id="`status-${row.id}`"
                :active-menu-id="activeMenuId"
                @select="(status) => handleStatusSelect(row, status)"
                @create="handleStatusCreate"
                @toggle="setActiveMenu"
              />
              <span v-else class="status-muted">-</span>
            </div>
            <div>
              <AssigneeDropdown
                v-if="row.rowType === 'task'"
                :assignee-id="row.assignee_user_id"
                :users="userOptions"
                :menu-id="`assignee-${row.id}`"
                :active-menu-id="activeMenuId"
                @select="(user) => handleAssigneeSelect(row, user)"
                @toggle="setActiveMenu"
              />
              <span v-else>-</span>
            </div>
            <div>{{ row.updated_at }}</div>
            <div>{{ row.created_at }}</div>
          </div>
        </template>
      </div>
    </div>

    <TaskStepsModal
      :visible="modalVisible"
      :task="currentTask"
      :steps="stepsData"
      :users="userOptions"
      :statuses="statusOptions"
      :active-menu-id="activeMenuId"
      :menu-id="stepAssigneeMenuId"
      :loading="stepsLoading"
      :error="stepsError"
      :submit-loading="stepSubmitLoading"
      :submit-error="stepSubmitError"
      @close="closeTaskSteps"
      @submit="handleAddStep"
      @update-step-status="handleStepStatusUpdate"
      @create-status="handleStatusCreate"
      @toggle="setActiveMenu"
    />
    <EditRowModal
      :visible="editModalVisible"
      :row="editModalRow"
      :loading="editModalLoading"
      :error="editModalError"
      @close="closeEditModal"
      @submit="handleEditSubmit"
    />
    <MoreRowModal
      :visible="moreModalVisible"
      :row="moreModalRow"
      :loading="moreModalLoading"
      :error="moreModalError"
      @close="closeMoreModal"
      @delete="handleMoreDelete"
      @update="handleMoreUpdate"
    />
    <AddNodeModal
      :visible="addModalVisible"
      :title="addModalConfig.title"
      :placeholder="addModalConfig.placeholder"
      :confirm-label="addModalConfig.confirmLabel"
      :loading="addModalLoading"
      :error="addModalError"
      @close="closeAddModal"
      @submit="handleAddSubmit"
    />
  </section>
</template>

<style scoped>
.create-project {
  min-height: 100vh;
  background: #f8fafc;
  display: flex;
  width: 100vw;
  font-family: 'Noto Sans TC', 'Segoe UI', sans-serif;
  --project-color: #1d4ed8;
  --product-color: #0f766e;
  --task-color: #7c3aed;
}

.content {
  flex: 1;
  min-width: 0;
  padding: 2.5rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

.add-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  padding: 1rem 1.5rem;
  border-radius: 12px;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
}

.add-bar__title {
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}

.add-project-button {
  border: none;
  background: #2563eb;
  color: #ffffff;
  padding: 0.6rem 1.2rem;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
}

.toolbar-row {
  display: grid;
  grid-template-columns: 1.2fr 2fr auto auto;
  gap: 1.5rem;
  align-items: center;
  background: #ffffff;
  padding: 1rem 1.5rem;
  border-radius: 12px;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: #f1f5f9;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
}

.search-input {
  border: none;
  background: transparent;
  width: 100%;
  font-size: 0.95rem;
}

.search-input:focus {
  outline: none;
}

.toolbar-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

.reset-button {
  border: none;
  background: #e2e8f0;
  color: #0f172a;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 0.95rem;
}

.reset-button:hover {
  background: #cbd5f5;
}

.filter-group {
  display:flex;
  justify-content: space-between;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  padding: 0 1rem;
  border-right: 1px solid #e2e8f0;
}

.filter-field {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: #475569;
}

.task-count {
  font-weight: 600;
  color: #0f172a;
  justify-self: end;
}

.table {
  background: #ffffff;
  border-radius: 12px;
  overflow: auto;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
  color: #1f2937;
  border: 1px solid #e2e8f0;
}

.table-row {
  display: grid;
  grid-template-columns: 2.2fr 1fr 1fr 1fr 1fr;
  gap: 1rem;
  padding: 0.9rem 1.5rem;
  border-bottom: 1px solid #f1f5f9;
  align-items: center;
  font-size: 0.95rem;
}

.table-row--empty {
  background: #f8fafc;
}

.table-row > div {
  border-right: 1px solid #e2e8f0;
  padding-right: 1rem;
}

.table-row > div:last-child {
  border-right: none;
  padding-right: 0;
}

.table-row--header {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.85rem;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.toggle-button {
  border: none;
  background: transparent;
  font-size: 1.2rem;
  width: 1.2rem;
  height: 1.2rem;
  line-height: 1.2rem;
  color: #64748b;
  cursor: pointer;
}

.toggle-spacer {
  display: inline-block;
  width: 1.2rem;
  height: 1.2rem;
}

.type-tag {
  font-size: 1.2rem;
  font-weight: 700;
  color: #0f172a;
  background: #e2e8f0;
  padding: 0.1rem 0.1rem;
  border-radius: 0.5rem;
}

.type-tag--project {
  background: rgba(29, 78, 216, 0.12);
  color: var(--project-color);
}

.type-tag--product {
  background: rgba(15, 118, 110, 0.12);
  color: var(--product-color);
}

.type-tag--task {
  margin-left:0.5rem;
  background: rgba(124, 58, 237, 0.12);
  color: var(--task-color);
}

.node-name {
  display: inline-block;
  font-weight: 600;
  margin-right: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: 0.4rem;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease;
}

.icon-button {
  border: none;
  background: #f1f5f9;
  border-radius: 8px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.table-row:hover .row-actions {
  opacity: 1;
  visibility: visible;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.table-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: #64748b;
  font-weight: 500;
  padding: 1.2rem 0;
}

.retry-button {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
}

.status-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  font-weight: 600;
}

.status-muted {
  color: #94a3b8;
}
</style>
