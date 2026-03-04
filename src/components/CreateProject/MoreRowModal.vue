<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  row: {
    type: Object,
    default: null,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close', 'delete', 'update'])

const statusInput = ref('')
const assigneeInput = ref('')
const editingStatus = ref(false)
const editingAssignee = ref(false)

const isTask = computed(() => props.row?.rowType === 'task')

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    statusInput.value = props.row?.status || ''
    assigneeInput.value = props.row?.assignee_user_id || ''
    editingStatus.value = false
    editingAssignee.value = false
  }
)

const handleClose = () => emit('close')
const handleDelete = () => emit('delete')

const startEditStatus = () => {
  if (!isTask.value) return
  editingStatus.value = true
}

const startEditAssignee = () => {
  if (!isTask.value) return
  editingAssignee.value = true
}

const handleUpdate = () => {
  if (!isTask.value) return
  emit('update', {
    status: statusInput.value,
    assignee_user_id: assigneeInput.value.trim() || null,
  })
  editingStatus.value = false
  editingAssignee.value = false
}
</script>

<template>
  <div v-if="visible" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal">
      <header class="modal-header">
        <div>
          <p class="modal-title">更多操作</p>
          <p class="modal-subtitle">{{ row?.name || '-' }}</p>
        </div>
        <div class="header-actions">
          <button class="danger-button" type="button" :disabled="loading" @click="handleDelete">
            刪除
          </button>
          <button class="close-button" type="button" @click="handleClose">✕</button>
        </div>
      </header>
      <div class="modal-body">
        <div class="info-row">
          <span class="info-label">狀態</span>
          <div class="info-value">
            <button
              v-if="!editingStatus"
              class="value-button"
              type="button"
              :disabled="!isTask"
              @click="startEditStatus"
            >
              {{ row?.status || '-' }}
            </button>
            <input
              v-else
              v-model="statusInput"
              type="text"
              class="value-input"
              placeholder="更新狀態"
            />
          </div>
        </div>
        <div class="info-row">
          <span class="info-label">負責人</span>
          <div class="info-value">
            <button
              v-if="!editingAssignee"
              class="value-button"
              type="button"
              :disabled="!isTask"
              @click="startEditAssignee"
            >
              {{ row?.assignee_user_id || '-' }}
            </button>
            <input
              v-else
              v-model="assigneeInput"
              type="text"
              class="value-input"
              placeholder="更新負責人"
            />
          </div>
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
        <div class="modal-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="loading || (!editingStatus && !editingAssignee)"
            @click="handleUpdate"
          >
            {{ loading ? '更新中...' : '更新' }}
          </button>
        </div>
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
  z-index: 30;
}

.modal {
  width: min(560px, 92vw);
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.2);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}

.modal-subtitle {
  margin: 0.25rem 0 0;
  color: #64748b;
  font-size: 0.85rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.danger-button {
  border: none;
  background: #fee2e2;
  color: #b91c1c;
  border-radius: 999px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
  font-weight: 600;
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
  display: grid;
  gap: 1rem;
}

.info-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 1rem;
}

.info-label {
  font-size: 0.9rem;
  color: #475569;
}

.value-button {
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 999px;
  padding: 0.35rem 0.8rem;
  cursor: pointer;
  text-align: left;
}

.value-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.value-input {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.4rem 0.7rem;
  font-size: 0.9rem;
  width: 100%;
}

.form-error {
  margin: 0;
  color: #b91c1c;
  font-size: 0.85rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
}

.primary-button {
  border: none;
  background: #2563eb;
  color: #ffffff;
  border-radius: 999px;
  padding: 0.5rem 1.2rem;
  cursor: pointer;
  font-weight: 600;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
