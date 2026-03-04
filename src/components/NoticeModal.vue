<template>
  <div v-if="open" class="notice-modal">
    <div class="notice-modal__backdrop" @click="handleClose"></div>
    <div class="notice-modal__card" role="dialog" aria-modal="true">
      <div class="notice-modal__header">
        <h3>{{ title }}</h3>
        <button type="button" class="notice-modal__close" @click="handleClose">✕</button>
      </div>
      <p v-if="message" class="notice-modal__message">{{ message }}</p>
      <div v-if="successItems.length || errorItems.length" class="notice-modal__lists">
        <div v-if="successItems.length" class="notice-modal__list">
          <div class="notice-modal__list-title notice-modal__list-title--success">成功</div>
          <ul>
            <li v-for="item in successItems" :key="`success-${item}`">{{ item }}</li>
          </ul>
        </div>
        <div v-if="errorItems.length" class="notice-modal__list">
          <div class="notice-modal__list-title notice-modal__list-title--error">失敗</div>
          <ul>
            <li v-for="item in errorItems" :key="`error-${item}`">{{ item }}</li>
          </ul>
        </div>
      </div>
      <div class="notice-modal__actions">
        <button type="button" class="notice-modal__confirm" @click="handleClose">確定</button>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
  message: {
    type: String,
    default: '',
  },
  successItems: {
    type: Array,
    default: () => [],
  },
  errorItems: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close'])

const handleClose = () => {
  emit('close')
}
</script>

<style scoped>
.notice-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notice-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
}

.notice-modal__card {
  position: relative;
  width: min(420px, 90vw);
  background: #ffffff;
  border-radius: 16px;
  padding: 1.25rem;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.25);
  z-index: 1;
}

.notice-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.notice-modal__header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.notice-modal__close {
  border: none;
  background: transparent;
  font-size: 1.1rem;
  cursor: pointer;
}

.notice-modal__message {
  margin: 0.75rem 0 0;
  color: #475569;
}

.notice-modal__lists {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.notice-modal__list {
  background: #f8fafc;
  border-radius: 12px;
  padding: 0.75rem;
}

.notice-modal__list-title {
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.notice-modal__list-title--success {
  color: #16a34a;
}

.notice-modal__list-title--error {
  color: #dc2626;
}

.notice-modal__list ul {
  margin: 0;
  padding-left: 1.2rem;
}

.notice-modal__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.notice-modal__confirm {
  border: none;
  background: #2563eb;
  color: #ffffff;
  border-radius: 10px;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  font-weight: 600;
}
</style>
