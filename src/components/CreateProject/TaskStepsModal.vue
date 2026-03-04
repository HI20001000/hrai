<script setup>
import { computed, ref, watch } from 'vue'
import AssigneeDropdown from './AssigneeDropdown.vue'
import StatusDropdown from './StatusDropdown.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  task: {
    type: Object,
    default: null,
  },
  steps: {
    type: Array,
    default: () => [],
  },
  statuses: {
    type: Array,
    default: () => [],
  },
  users: {
    type: Array,
    default: () => [],
  },
  activeMenuId: {
    type: [String, null],
    default: null,
  },
  menuId: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
  submitLoading: {
    type: Boolean,
    default: false,
  },
  submitError: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'close',
  'submit',
  'delete-step',
  'toggle',
  'update-step-status',
  'create-status',
])

const contentInput = ref('')
const assigneeInput = ref(null)

const resetForm = () => {
  contentInput.value = ''
  assigneeInput.value = null
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) resetForm()
  }
)

const handleClose = () => {
  emit('close')
}

const handleSubmit = () => {
  emit('submit', {
    content: contentInput.value,
    assignee_user_id: assigneeInput.value ?? null,
  })
}

const resolveAssigneeLabel = (assigneeId) => {
  if (assigneeId == null) return '-'
  const user = props.users.find((entry) => String(entry.id) === String(assigneeId))
  return user?.username || user?.mail || assigneeId
}

const resolveStatus = (statusId) => {
  if (statusId == null) {
    return { name: '-', color: '#e2e8f0' }
  }
  const status = props.statuses.find((entry) => String(entry.id) === String(statusId))
  return status
    ? { name: status.name, color: status.color }
    : { name: '-', color: '#e2e8f0' }
}

const resolvedAssignees = computed(() => {
  return [...props.steps]
    .sort((a, b) => {
      const timeA = new Date(a?.created_at || 0).getTime() || 0
      const timeB = new Date(b?.created_at || 0).getTime() || 0
      return timeB - timeA
    })
    .map((step) => ({
      ...step,
      assigneeLabel: resolveAssigneeLabel(step.assignee_user_id),
      statusMeta: resolveStatus(step.status_id),
    }))
})
</script>

<template>
  <div v-if="visible" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal">
      <header class="modal-header">
        <div>
          <p class="modal-title">任務步驟</p>
          <p class="modal-subtitle">{{ task?.name || task?.title || '未選擇任務' }}</p>
        </div>
        <button class="close-button" type="button" @click="handleClose">✕</button>
      </header>

      <div class="modal-body">        
        <div v-if="loading" class="modal-state">正在載入步驟...</div>
        <div v-else-if="error" class="modal-state modal-state--error">{{ error }}</div>
        <div v-else-if="steps.length === 0" class="modal-state">目前沒有步驟資料。</div>
          <div v-else class="steps-grid">
          <div class="steps-row steps-row--head">
            <span>狀態</span>
            <span>負責人</span>
            <span>內容</span>
            <span>建立者</span>
            <span>建立時間</span>
            <span>操作</span>
          </div>
          <div v-for="step in resolvedAssignees" :key="step.id" class="steps-row">
            <span>
              <StatusDropdown
                :status-id="step.status_id"
                :status-name="step.statusMeta.name"
                :status-color="step.statusMeta.color"
                :statuses="statuses"
                :menu-id="`step-status-${step.id}`"
                :active-menu-id="activeMenuId"
                @select="(status) => emit('update-step-status', { step, status })"
                @create="(payload) => emit('create-status', payload)"
                @toggle="(value) => emit('toggle', value)"
              />
            </span>
            <span>{{ step.assigneeLabel }}</span>
            <span class="step-content">{{ step.content }}</span>
            <span>{{ step.created_by || '-' }}</span>
            <span>{{ step.created_at }}</span>
            <span class="steps-actions">
              <button
                class="steps-action-button steps-action-button--danger"
                type="button"
                @click.stop="emit('delete-step', step)"
              >
                刪除
              </button>
            </span>
          </div>
        </div>
        <section class="step-form">
          <div class="step-form__header">
            <div>
              <p class="step-form__title">新增步驟</p>
              <p class="step-form__subtitle">新增後可立即在上方列表查看。</p>
            </div>
            <button
              class="step-form__submit"
              type="button"
              :disabled="submitLoading || !contentInput.trim()"
              @click="handleSubmit"
            >
              {{ submitLoading ? '新增中...' : '新增步驟' }}
            </button>
          </div>
          <label class="step-form__field">
            <span>負責人</span>
            <AssigneeDropdown
              :assignee-id="assigneeInput"
              :users="users"
              :menu-id="menuId"
              :active-menu-id="activeMenuId"
              @select="(user) => (assigneeInput = user?.id ?? null)"
              @toggle="(value) => emit('toggle', value)"
            />
          </label>
          <label class="step-form__field step-form__field--full">
            <span>內容</span>
            <textarea v-model="contentInput" rows="3" placeholder="輸入步驟內容"></textarea>
          </label>
          <div class="step-form__actions">
            <span v-if="submitError" class="step-form__error">{{ submitError }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: grid;
  place-items: center;
  z-index: 20;
}

.modal {
  width: min(900px, 92vw);
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.2);
  overflow: hidden;
  color: black;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.modal-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #0f172a;
}

.modal-subtitle {
  margin: 0.25rem 0 0;
  color: #64748b;
}

.close-button {
  border: none;
  background: #f1f5f9;
  border-radius: 10px;
  width: 36px;
  height: 36px;
  cursor: pointer;
}

.modal-body {
  padding: 1.5rem;
}

.step-form {
  display: grid;
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 16px;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
  border: 1px solid #e2e8f0;
  margin-top: 1.5rem;
}

.step-form__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.step-form__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}

.step-form__subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: #64748b;
}

.step-form__field {
  display: grid;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #475569;
}

.step-form__field input,
.step-form__field textarea {
  border: 1px solid #cbd5f5;
  border-radius: 12px;
  padding: 0.6rem 0.9rem;
  font-size: 0.9rem;
  font-family: inherit;
  background: #ffffff;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.step-form__field input:focus,
.step-form__field textarea:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.step-form__field--full {
  grid-column: 1 / -1;
}

.step-form__actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 1rem;
}

.step-form__error {
  color: #b91c1c;
  font-size: 0.85rem;
}

.step-form__submit {
  border: none;
  background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
  color: #ffffff;
  padding: 0.55rem 1.4rem;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
  box-shadow: 0 12px 20px rgba(37, 99, 235, 0.2);
}

.step-form__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.modal-state {
  padding: 1rem;
  border-radius: 10px;
  background: #f8fafc;
  color: #475569;
}

.modal-state--error {
  background: #fee2e2;
  color: #b91c1c;
}

.steps-grid {
  display: grid;
  gap: 0.75rem;
  overflow: auto;
  max-height: 300px;
}

.steps-row {
  display: grid;
  grid-template-columns: 1fr 1fr 2.2fr 1fr 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 0.5rem;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.9rem;
}

.steps-row--head {
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-radius: 10px;
  border-bottom: none;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #e2e8f0;
  color: #0f172a;
  font-weight: 600;
  width: fit-content;
}

.step-content {
  color: #0f172a;
}

.steps-actions {
  display: inline-flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.steps-action-button {
  border: 1px solid #cbd5f5;
  border-radius: 999px;
  padding: 0.2rem 0.75rem;
  font-size: 0.8rem;
  background: #ffffff;
  color: #1e293b;
  cursor: pointer;
  transition: all 0.2s ease;
}

.steps-action-button:hover {
  border-color: #6366f1;
  color: #4338ca;
  background: #eef2ff;
}

.steps-action-button--danger {
  border-color: #fecaca;
  color: #b91c1c;
}

.steps-action-button--danger:hover {
  border-color: #f87171;
  background: #fee2e2;
  color: #b91c1c;
}
</style>
