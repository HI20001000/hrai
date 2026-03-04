<script setup>
const props = defineProps({
  activePage: {
    type: String,
    default: 'home',
  },
})

const emit = defineEmits(['change-page'])

const pageItems = [
  { key: 'home', label: '首頁', icon: '🏠' },
  { key: 'reports', label: '報表', icon: '📊' },
  { key: 'files', label: '檔案', icon: '📁' },
]

const selectPage = (key) => {
  emit('change-page', key)
}
</script>

<template>
  <aside class="main-toolbar" aria-label="Main toolbar">
    <div class="toolbar-top">
      <button class="icon-button" type="button" aria-label="使用者">
        <span aria-hidden="true">👤</span>
      </button>
    </div>

    <nav class="toolbar-middle" aria-label="頁面切換">
      <button
        v-for="item in pageItems"
        :key="item.key"
        class="icon-button"
        :class="{ active: props.activePage === item.key }"
        type="button"
        :aria-label="item.label"
        @click="selectPage(item.key)"
      >
        <span aria-hidden="true">{{ item.icon }}</span>
      </button>
    </nav>

    <div class="toolbar-bottom">
      <button class="icon-button" type="button" aria-label="設定">
        <span aria-hidden="true">⚙️</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.main-toolbar {
  position: fixed;
  left: 0;
  top: 0;
  width: 80px;
  height: 100vh;
  background: #0f172a;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;
  box-sizing: border-box;
}

.toolbar-top,
.toolbar-middle,
.toolbar-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.icon-button {
  width: 48px;
  height: 48px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 14px;
  background: transparent;
  color: inherit;
  font-size: 1.2rem;
  cursor: pointer;
}

.icon-button.active {
  background: rgba(59, 130, 246, 0.24);
  border-color: rgba(96, 165, 250, 0.8);
}
</style>
