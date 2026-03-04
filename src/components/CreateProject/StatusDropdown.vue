<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  statusId: {
    type: [Number, String, null],
    default: null,
  },
  statusName: {
    type: String,
    default: '-',
  },
  statusColor: {
    type: String,
    default: '#e2e8f0',
  },
  statuses: {
    type: Array,
    default: () => [],
  },
  allowCreate: {
    type: Boolean,
    default: true,
  },
  menuId: {
    type: String,
    default: '',
  },
  activeMenuId: {
    type: [String, null],
    default: null,
  },
})

const emit = defineEmits(['select', 'create', 'toggle'])

const open = computed(() => props.activeMenuId === props.menuId)
const showCreate = ref(false)
const newName = ref('')
const newColor = ref('#e2e8f0')

const displayName = computed(() => props.statusName || '-')

const resetCreate = () => {
  showCreate.value = false
  newName.value = ''
  newColor.value = '#e2e8f0'
}

const toggleMenu = () => {
  if (open.value) {
    emit('toggle', null)
    resetCreate()
    return
  }
  emit('toggle', props.menuId)
}

const handleSelect = (status) => {
  emit('select', status)
  emit('toggle', null)
  resetCreate()
}

const handleCreateToggle = () => {
  showCreate.value = true
}

const handleCreate = () => {
  if (!newName.value.trim()) return
  emit('create', { name: newName.value.trim(), color: newColor.value })
  emit('toggle', null)
  resetCreate()
}

const handleClickOutside = (event) => {
  if (!event.target.closest('.status-dropdown')) {
    emit('toggle', null)
    resetCreate()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="status-dropdown">
    <button
      class="status-pill status-pill--clickable"
      type="button"
      :style="{ backgroundColor: statusColor }"
      @click.stop="toggleMenu"
    >
      {{ displayName }}
    </button>
    <div v-if="open" class="status-menu">
      <button
        v-for="status in statuses"
        :key="status.id"
        class="status-option"
        type="button"
        @click.stop="handleSelect(status)"
      >
        <span class="status-dot" :style="{ backgroundColor: status.color }"></span>
        <span>{{ status.name }}</span>
      </button>
      <template v-if="allowCreate">
        <div class="status-divider"></div>
        <button
          v-if="!showCreate"
          class="status-add"
          type="button"
          @click.stop="handleCreateToggle"
        >
          新增更多狀態
        </button>
        <div v-else class="status-create">
          <input v-model="newName" type="text" placeholder="狀態名稱" />
          <input v-model="newColor" type="color" />
          <button class="status-create__button" type="button" @click.stop="handleCreate">
            新增
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.status-dropdown {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  color: #0f172a;
  font-weight: 600;
  border: 1px solid rgba(15, 23, 42, 0.1);
}

.status-pill--clickable {
  cursor: pointer;
  background: #e2e8f0;
}

.status-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 10;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 0.5rem;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
  min-width: 180px;
  display: grid;
  gap: 0.35rem;
}

.status-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
  background: transparent;
  padding: 0.35rem 0.4rem;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}

.status-option:hover {
  background: #f1f5f9;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.1);
}

.status-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 0.25rem 0;
}

.status-add {
  border: none;
  background: #eef2ff;
  color: #4338ca;
  font-weight: 600;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
}

.status-create {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.4rem;
  align-items: center;
}

.status-create input[type='text'] {
  border: 1px solid #cbd5f5;
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
}

.status-create input[type='color'] {
  width: 36px;
  height: 32px;
  padding: 0;
  border: none;
  background: transparent;
}

.status-create__button {
  border: none;
  background: #2563eb;
  color: #ffffff;
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  cursor: pointer;
  font-weight: 600;
}
</style>
