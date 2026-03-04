<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '新增項目',
  },
  placeholder: {
    type: String,
    default: '請輸入名稱',
  },
  confirmLabel: {
    type: String,
    default: '確認',
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
const localError = ref('')

const resetState = () => {
  nameInput.value = ''
  localError.value = ''
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      resetState()
    }
  }
)

const handleClose = () => {
  emit('close')
}

const handleSubmit = () => {
  const trimmed = nameInput.value.trim()
  if (!trimmed) {
    localError.value = '名稱不能為空'
    return
  }
  if (trimmed.length > 100) {
    localError.value = '名稱長度不可超過 100 字'
    return
  }
  localError.value = ''
  emit('submit', trimmed)
}
</script>

<template>
  <div v-if="visible" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal">
      <header class="modal-header">
        <div class="modal-title">{{ title }}</div>
        <button class="close-button" type="button" @click="handleClose">✕</button>
      </header>
      <div class="modal-body">
        <label class="field">
          <span>名稱</span>
          <input v-model="nameInput" type="text" :placeholder="placeholder" />
        </label>
        <p v-if="localError" class="error-text">{{ localError }}</p>
        <p v-else-if="error" class="error-text">{{ error }}</p>
      </div>
      <footer class="modal-footer">
        <button class="secondary" type="button" :disabled="loading" @click="handleClose">
          取消
        </button>
        <button class="primary" type="button" :disabled="loading" @click="handleSubmit">
          {{ loading ? '處理中...' : confirmLabel }}
        </button>
      </footer>
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
  font-size: 1.05rem;
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
  gap: 0.75rem;
}

.field {
  display: grid;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #475569;
}

.field input {
  border: 1px solid #e2e8f0;
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  font-size: 0.95rem;
}

.error-text {
  margin: 0;
  color: #b91c1c;
  background: #fee2e2;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  font-size: 0.85rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem 1.5rem;
}

.modal-footer button {
  border-radius: 10px;
  padding: 0.6rem 1.2rem;
  font-size: 0.9rem;
  cursor: pointer;
}

.modal-footer .secondary {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #475569;
}

.modal-footer .primary {
  border: none;
  background: #2563eb;
  color: #ffffff;
}

.modal-footer button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
