<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  options: {
    type: Array,
    default: () => [],
  },
  placeholder: {
    type: String,
    default: '請選擇',
  },
  emptyText: {
    type: String,
    default: '目前沒有可選項目',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const rootRef = ref(null)
const triggerRef = ref(null)
const optionRefs = ref([])
const isOpen = ref(false)
const highlightedIndex = ref(-1)

const normalizedOptions = computed(() =>
  props.options.map((option) => {
    if (option && typeof option === 'object') {
      return {
        value: String(option.value ?? ''),
        label: String(option.label ?? option.value ?? ''),
      }
    }

    return {
      value: String(option ?? ''),
      label: String(option ?? ''),
    }
  })
)

const selectedIndex = computed(() =>
  normalizedOptions.value.findIndex((option) => option.value === String(props.modelValue ?? ''))
)

const selectedOption = computed(() =>
  selectedIndex.value >= 0 ? normalizedOptions.value[selectedIndex.value] : null
)

const focusOptionAt = async (index) => {
  await nextTick()
  const target = optionRefs.value[index]
  if (target && typeof target.focus === 'function') {
    target.focus()
  }
}

const openDropdown = async (index = selectedIndex.value >= 0 ? selectedIndex.value : 0) => {
  if (props.disabled || !normalizedOptions.value.length) return
  isOpen.value = true
  highlightedIndex.value = Math.max(0, Math.min(index, normalizedOptions.value.length - 1))
  await focusOptionAt(highlightedIndex.value)
}

const closeDropdown = async ({ focusTrigger = false } = {}) => {
  isOpen.value = false
  highlightedIndex.value = -1
  if (focusTrigger) {
    await nextTick()
    triggerRef.value?.focus()
  }
}

const toggleDropdown = async () => {
  if (isOpen.value) {
    await closeDropdown({ focusTrigger: true })
    return
  }
  await openDropdown()
}

const selectOption = async (value) => {
  emit('update:modelValue', String(value ?? ''))
  await closeDropdown({ focusTrigger: true })
}

const moveHighlight = async (direction) => {
  if (!normalizedOptions.value.length) return
  if (!isOpen.value) {
    await openDropdown()
    return
  }

  const baseIndex = highlightedIndex.value >= 0 ? highlightedIndex.value : Math.max(selectedIndex.value, 0)
  const nextIndex = (baseIndex + direction + normalizedOptions.value.length) % normalizedOptions.value.length
  highlightedIndex.value = nextIndex
  await focusOptionAt(nextIndex)
}

const handleTriggerKeydown = async (event) => {
  if (props.disabled) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    await moveHighlight(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    await moveHighlight(-1)
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    await toggleDropdown()
  }
}

const handleOptionKeydown = async (event, index, value) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    await moveHighlight(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    await moveHighlight(-1)
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    await selectOption(value)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    await closeDropdown({ focusTrigger: true })
    return
  }

  highlightedIndex.value = index
}

const handlePointerDown = async (event) => {
  if (!isOpen.value) return
  if (rootRef.value?.contains(event.target)) return
  await closeDropdown()
}

watch(
  () => props.disabled,
  async (value) => {
    if (value && isOpen.value) {
      await closeDropdown()
    }
  }
)

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handlePointerDown)
})
</script>

<template>
  <div ref="rootRef" class="app-select" :class="{ open: isOpen, disabled }">
    <button
      ref="triggerRef"
      type="button"
      class="app-select-trigger"
      :class="{ placeholder: !selectedOption }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="isOpen ? 'true' : 'false'"
      @click="toggleDropdown"
      @keydown="handleTriggerKeydown"
    >
      <span class="app-select-copy">
        <span class="app-select-value">{{ selectedOption?.label || placeholder }}</span>
      </span>
      <span class="app-select-icon" aria-hidden="true"></span>
    </button>

    <div v-if="isOpen" class="app-select-menu" role="listbox">
      <button
        v-for="(option, index) in normalizedOptions"
        :key="option.value"
        :ref="(el) => { optionRefs[index] = el }"
        type="button"
        class="app-select-option"
        :class="{
          selected: option.value === String(modelValue ?? ''),
          highlighted: index === highlightedIndex,
        }"
        role="option"
        :aria-selected="option.value === String(modelValue ?? '') ? 'true' : 'false'"
        @click="selectOption(option.value)"
        @focus="highlightedIndex = index"
        @keydown="handleOptionKeydown($event, index, option.value)"
      >
        <span class="app-select-option-copy">
          <span class="app-select-option-label">{{ option.label }}</span>
        </span>
        <span v-if="option.value === String(modelValue ?? '')" class="app-select-check" aria-hidden="true">✓</span>
      </button>

      <div v-if="!normalizedOptions.length" class="app-select-empty">
        {{ emptyText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
}

.app-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.9rem;
  width: 100%;
  min-height: 52px;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.96)),
    linear-gradient(135deg, rgba(47, 111, 237, 0.06), rgba(47, 111, 237, 0));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 10px 18px rgba(15, 23, 42, 0.04);
  text-align: left;
  color: var(--text-strong);
  cursor: pointer;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

.app-select-trigger:hover {
  border-color: rgba(47, 111, 237, 0.26);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.84),
    0 14px 26px rgba(47, 111, 237, 0.08);
  transform: translateY(-1px);
}

.app-select-trigger:focus-visible {
  outline: none;
  border-color: rgba(47, 111, 237, 0.42);
  box-shadow: var(--focus-ring);
}

.app-select.disabled .app-select-trigger {
  opacity: 0.58;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.app-select-copy {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.app-select-value,
.app-select-option-label {
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-strong);
  white-space: normal;
  word-break: break-word;
}

.app-select-trigger.placeholder .app-select-value,
.app-select-empty {
  color: var(--text-muted);
}

.app-select-icon {
  flex: none;
  width: 0.75rem;
  height: 0.75rem;
  border-right: 2px solid rgba(71, 85, 105, 0.8);
  border-bottom: 2px solid rgba(71, 85, 105, 0.8);
  transform: rotate(45deg);
  transition:
    transform 180ms ease,
    border-color 180ms ease;
}

.app-select.open .app-select-icon {
  transform: rotate(225deg) translate(-1px, -1px);
  border-color: rgba(47, 111, 237, 0.84);
}

.app-select-menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  right: 0;
  z-index: 30;
  display: grid;
  gap: 0.35rem;
  max-height: 290px;
  padding: 0.55rem;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.98));
  box-shadow:
    0 24px 54px rgba(15, 23, 42, 0.14),
    0 8px 20px rgba(47, 111, 237, 0.08);
  backdrop-filter: blur(18px);
}

.app-select-option {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.85rem;
  width: 100%;
  padding: 0.82rem 0.88rem;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.app-select-option:hover,
.app-select-option.highlighted {
  border-color: rgba(47, 111, 237, 0.14);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.08), rgba(47, 111, 237, 0.03));
  transform: translateY(-1px);
}

.app-select-option:focus-visible {
  outline: none;
  border-color: rgba(47, 111, 237, 0.28);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.app-select-option.selected {
  border-color: rgba(47, 111, 237, 0.18);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.12), rgba(255, 255, 255, 0.92));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.app-select-option-copy {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.app-select-check {
  flex: none;
  color: var(--accent);
  font-weight: 700;
  line-height: 1.2;
}

.app-select-empty {
  padding: 0.95rem 0.88rem;
  text-align: center;
}
</style>
