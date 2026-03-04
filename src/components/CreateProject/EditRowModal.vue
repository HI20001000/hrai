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

const emit = defineEmits(['close', 'submit'])

const nameInput = ref('')

const titleText = computed(() => {
  switch (props.row?.rowType) {
    case 'project':
      return '編輯專案'
    case 'product':
      return '編輯產品'
    case 'task':
      return '編輯任務'
    default:
      return '編輯'
  }
})

const fieldLabel = computed(() => (props.row?.rowType === 'task' ? '任務標題' : '名稱'))

watch(
  () => props.visible,
  (visible) => {
    if (visible) nameInput.value = props.row?.name || ''
  }
)

const handleClose = () => emit('close')

const handleSubmit = () => {
  emit('submit', nameInput.value)
}
</script>

<template>
  <div v-if="visible" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal">
      <header class="modal-header">
        <p class="modal-title">{{ titleText }}</p>
        <button class="close-button" type="button" @click="handleClose">✕</button>
      </header>
      <div class="modal-body">
        <label class="form-field">
          <span>{{ fieldLabel }}</span>
          <input v-model="nameInput" type="text" placeholder="請輸入內容" />
        </label>
        <p v-if="error" class="form-error">{{ error }}</p>
        <div class="form-actions">
          <button class="ghost-button" type="button" @click="handleClose">取消</button>
          <button
            class="primary-button"
            type="button"
            :disabled="loading || !nameInput.trim()"
            @click="handleSubmit"
          >
            {{ loading ? '儲存中...' : '儲存' }}
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
  width: min(520px, 92vw);
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

.form-field {
  display: grid;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #475569;
}

.form-field input {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.6rem 0.8rem;
  font-size: 0.95rem;
}

.form-error {
  margin: 0;
  color: #b91c1c;
  font-size: 0.85rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.ghost-button {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 999px;
  padding: 0.5rem 1.1rem;
  cursor: pointer;
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
