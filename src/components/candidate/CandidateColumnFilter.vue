<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { normalizeSearchText } from '../../scripts/searchNormalize.js'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  filterKey: {
    type: String,
    default: 'filter',
  },
  label: {
    type: String,
    default: '欄位',
  },
  options: {
    type: Array,
    default: () => [],
  },
  mode: {
    type: String,
    default: 'options',
  },
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const searchKeyword = ref('')
const searchInput = ref(null)
const menuStyle = ref({})
const filterInstanceId = `candidate-filter-${Math.random().toString(36).slice(2)}`

const isDateMode = computed(() => props.mode === 'date')
const selectedValue = computed(() => String(props.modelValue || ''))
const isActive = computed(() => Boolean(selectedValue.value))

const pad = (number) => String(number).padStart(2, '0')

const toDateKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const dateQuickOptions = computed(() => {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  return [
    { value: toDateKey(today), label: '今天' },
    { value: toDateKey(tomorrow), label: '明天' },
  ]
})

const selectedOption = computed(() =>
  props.options.find((option) => String(option?.value ?? '') === selectedValue.value)
)

const buttonLabel = computed(() => {
  if (!selectedValue.value) return `篩選${props.label}`
  if (isDateMode.value) return `${props.label}篩選：${selectedValue.value}`
  return `${props.label}篩選：${selectedOption.value?.label || selectedValue.value}`
})

const searchPlaceholder = computed(() => `搜尋${props.label}`)

const visibleOptions = computed(() => {
  const keyword = normalizeSearchText(searchKeyword.value)
  const options = props.options.filter((option) => String(option?.value ?? '') !== '')
  if (!keyword) return options

  return options.filter((option) =>
    [option.label, option.value]
      .map((item) => normalizeSearchText(item))
      .join(' ')
      .includes(keyword)
  )
})

const getOptionAvatarStyle = (option) => {
  const color = String(option?.avatarBgColor || '').trim()
  return { background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#64748b' }
}

const buildMenuStyle = (target) => {
  if (!target || typeof target.getBoundingClientRect !== 'function') return {}

  const anchor = target.closest?.('th') || target
  const rect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768
  const margin = 12
  const gap = 8
  const minWidth = isDateMode.value ? 260 : 180
  const width = Math.min(Math.max(rect.width, minWidth), Math.max(minWidth, viewportWidth - margin * 2))
  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, viewportWidth - width - margin)
  )
  const spaceBelow = viewportHeight - rect.bottom - gap - margin
  const spaceAbove = rect.top - gap - margin
  const openAbove = spaceBelow < 260 && spaceAbove > spaceBelow
  const maxHeight = Math.max(220, Math.min(460, openAbove ? spaceAbove : spaceBelow))

  return openAbove
    ? {
        left: `${left}px`,
        bottom: `${Math.max(margin, viewportHeight - rect.top + gap)}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
      }
    : {
        left: `${left}px`,
        top: `${Math.min(rect.bottom + gap, viewportHeight - margin)}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
      }
}

const closeFilter = () => {
  isOpen.value = false
  searchKeyword.value = ''
  menuStyle.value = {}
}

const toggleFilter = async (event = null) => {
  if (isOpen.value) {
    closeFilter()
    return
  }

  isOpen.value = true
  searchKeyword.value = ''
  menuStyle.value = buildMenuStyle(event?.currentTarget)
  await nextTick()
  if (!isDateMode.value) searchInput.value?.focus?.()
}

const selectOption = (value) => {
  const nextValue = String(value ?? '')
  emit('update:modelValue', selectedValue.value === nextValue ? '' : nextValue)
  closeFilter()
}

const selectDate = (value) => {
  emit('update:modelValue', String(value || '').slice(0, 10))
}

const clearDate = () => {
  emit('update:modelValue', '')
  closeFilter()
}

const updateSearchKeyword = (value) => {
  searchKeyword.value = String(value || '').trim()
}

const handlePointerDown = (event) => {
  if (!isOpen.value) return
  const ownerNode = event.target?.closest?.('[data-filter-owner]')
  if (ownerNode?.dataset?.filterOwner === filterInstanceId) return
  closeFilter()
}

const handleKeydown = (event) => {
  if (event.key === 'Escape') closeFilter()
}

const handleViewportChange = () => {
  if (isOpen.value) closeFilter()
}

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', handleViewportChange)
})

onBeforeUnmount(() => {
  closeFilter()
  document.removeEventListener('pointerdown', handlePointerDown)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <span class="column-filter" :data-filter-owner="filterInstanceId">
    <button
      type="button"
      class="column-filter-btn"
      :class="{ active: isActive, open: isOpen }"
      :aria-label="buttonLabel"
      :title="buttonLabel"
      aria-haspopup="listbox"
      :aria-expanded="isOpen ? 'true' : 'false'"
      @click.stop="toggleFilter($event)"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 5h16l-6.2 7.1v5.1l-3.6 1.8v-6.9L4 5Z" />
      </svg>
    </button>
  </span>

  <Teleport to="body">
    <div
      v-if="isOpen"
      class="column-filter-menu is-floating"
      :class="{ 'date-filter-menu': isDateMode }"
      :style="menuStyle"
      :data-filter-owner="filterInstanceId"
      role="listbox"
      :aria-label="buttonLabel"
    >
      <template v-if="isDateMode">
        <label class="date-filter-field">
          <span>選擇日期</span>
          <input
            :value="selectedValue"
            type="date"
            autocomplete="off"
            @input="selectDate($event.target.value)"
          />
        </label>
        <div class="date-filter-shortcuts">
          <button
            v-for="option in dateQuickOptions"
            :key="option.value"
            type="button"
            class="date-filter-shortcut"
            :class="{ selected: option.value === selectedValue }"
            @click="selectDate(option.value)"
          >
            {{ option.label }}
          </button>
          <button type="button" class="date-filter-shortcut clear" @click="clearDate">清除</button>
        </div>
      </template>

      <template v-else>
        <label class="column-filter-search">
          <span class="sr-only">{{ searchPlaceholder }}</span>
          <input
            ref="searchInput"
            :value="searchKeyword"
            type="search"
            :placeholder="searchPlaceholder"
            autocomplete="off"
            @input="updateSearchKeyword($event.target.value)"
          />
        </label>

        <div class="column-filter-options">
          <button
            v-for="option in visibleOptions"
            :key="`${filterKey}-${option.value}`"
            type="button"
            class="column-filter-option"
            :class="{ selected: String(option.value) === selectedValue }"
            role="option"
            :aria-selected="String(option.value) === selectedValue ? 'true' : 'false'"
            @click="selectOption(option.value)"
          >
            <span
              v-if="option.avatarText"
              class="column-filter-avatar"
              :style="getOptionAvatarStyle(option)"
              aria-hidden="true"
            >
              {{ option.avatarText }}
            </span>
            <span class="column-filter-option-label">{{ option.label }}</span>
            <span
              v-if="String(option.value) === selectedValue"
              class="column-filter-check"
              aria-hidden="true"
            >
              ✓
            </span>
          </button>
        </div>
        <div v-if="!visibleOptions.length" class="column-filter-empty">沒有符合的選項</div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.column-filter {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.column-filter-btn {
  display: inline-grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.column-filter-btn:hover,
.column-filter-btn.open,
.column-filter-btn.active {
  border-color: rgba(47, 111, 237, 0.26);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.1);
}

.column-filter-btn:hover {
  transform: translateY(-1px);
}

.column-filter-btn:focus-visible {
  outline: none;
  border-color: rgba(47, 111, 237, 0.42);
  box-shadow: var(--focus-ring);
}

.column-filter-btn svg {
  width: 1rem;
  height: 1rem;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.column-filter-menu {
  position: fixed;
  z-index: 20050;
  display: grid;
  gap: 0.4rem;
  padding: 0.55rem;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 22px 48px rgba(15, 23, 42, 0.14),
    0 8px 20px rgba(47, 111, 237, 0.08);
  backdrop-filter: blur(18px);
}

.column-filter-search {
  display: block;
}

.column-filter-search input,
.date-filter-field input {
  width: 100%;
  min-height: 38px;
  padding: 0.52rem 0.68rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 9px;
  background: rgba(248, 250, 252, 0.96);
  color: var(--text-base);
  font: inherit;
  font-size: 0.84em;
}

.column-filter-search input:focus,
.date-filter-field input:focus {
  outline: none;
  border-color: rgba(47, 111, 237, 0.38);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.column-filter-options {
  display: grid;
  gap: 0.28rem;
}

.column-filter-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 38px;
  padding: 0.45rem 0.58rem;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-base);
  background: transparent;
  font: inherit;
  font-size: 0.84em;
  font-weight: 720;
  text-align: left;
  cursor: pointer;
}

.column-filter-option:hover,
.column-filter-option:focus-visible {
  outline: none;
  border-color: rgba(47, 111, 237, 0.14);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.08);
}

.column-filter-option.selected {
  border-color: rgba(47, 111, 237, 0.18);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.12);
}

.column-filter-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.55rem;
  height: 1.55rem;
  flex: 0 0 auto;
  border-radius: 999px;
  color: #ffffff;
  font-size: 0.68em;
  font-weight: 800;
}

.column-filter-option-label {
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  margin-right: auto;
}

.column-filter-check {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 900;
}

.column-filter-empty {
  padding: 0.75rem 0.62rem;
  color: var(--text-muted);
  text-align: center;
  font-size: 0.84em;
  font-weight: 700;
}

.date-filter-menu {
  gap: 0.65rem;
}

.date-filter-field {
  display: grid;
  gap: 0.35rem;
}

.date-filter-field span {
  color: var(--text-muted);
  font-size: 0.78em;
  font-weight: 800;
}

.date-filter-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.42rem;
}

.date-filter-shortcut {
  min-height: 32px;
  padding: 0.38rem 0.58rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  color: var(--text-base);
  background: #ffffff;
  font: inherit;
  font-size: 0.8em;
  font-weight: 760;
  cursor: pointer;
}

.date-filter-shortcut:hover,
.date-filter-shortcut:focus-visible,
.date-filter-shortcut.selected {
  outline: none;
  border-color: rgba(47, 111, 237, 0.2);
  color: var(--accent);
  background: rgba(47, 111, 237, 0.09);
}

.date-filter-shortcut.clear {
  color: #64748b;
}
</style>
