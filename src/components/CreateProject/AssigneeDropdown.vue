<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  assigneeId: {
    type: [String, Number, null],
    default: null,
  },
  users: {
    type: Array,
    default: () => [],
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

const emit = defineEmits(['select', 'toggle'])

const open = computed(() => props.activeMenuId === props.menuId)

const displayAssignee = computed(() => {
  const found = props.users.find((user) => String(user.id) === String(props.assigneeId))
  return found?.username || found?.mail || props.assigneeId || '-'
})

const toggleMenu = () => {
  emit('toggle', open.value ? null : props.menuId)
}

const handleSelect = (user) => {
  emit('select', user)
  emit('toggle', null)
}

const handleClickOutside = (event) => {
  if (!event.target.closest('.assignee-dropdown')) {
    emit('toggle', null)
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
  <div class="assignee-dropdown">
    <button class="assignee-pill" type="button" @click.stop="toggleMenu">
      {{ displayAssignee }}
    </button>
    <div v-if="open" class="assignee-menu">
      <button
        v-for="user in users"
        :key="user.id"
        class="assignee-option"
        type="button"
        @click.stop="handleSelect(user)"
      >
        <span class="assignee-avatar" :style="{ backgroundColor: user.icon_bg || '#e2e8f0' }">
          {{ user.icon || '🙂' }}
        </span>
        <span class="assignee-name">
          {{ user.username || user.mail }}
        </span>
        <span class="assignee-mail">{{ user.mail }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.assignee-dropdown {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.assignee-pill {
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
  background: #ffffff;
  cursor: pointer;
  font-weight: 600;
  color: #0f172a;
}

.assignee-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 10;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 0.5rem;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
  min-width: 220px;
  display: grid;
  gap: 0.35rem;
}

.assignee-option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem;
  align-items: center;
  border: none;
  background: transparent;
  padding: 0.35rem 0.4rem;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}

.assignee-option:hover {
  background: #f1f5f9;
}

.assignee-avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.9rem;
}

.assignee-name {
  font-weight: 600;
  color: #0f172a;
}

.assignee-mail {
  font-size: 0.75rem;
  color: #64748b;
}
</style>
