<script setup>
import { computed, ref } from 'vue'
import titleLogoUrl from '../assets/web_icon.png'

const props = defineProps({
  activePage: {
    type: String,
    default: 'reports',
  },
  userProfile: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['change-page'])

const isMobileMenuOpen = ref(false)

const pageItems = [
  { key: 'reports', label: '職缺管理', description: '管理職缺與投遞', icon: 'briefcase' },
  { key: 'cv', label: '候選人管理', description: '查看候選人資料', icon: 'document' },
  { key: 'files', label: '上傳候選人 CV', description: '上傳履歷與應徵', icon: 'tray' },
  { key: 'personnel', label: '已入職名單', description: '人員與項目安排', icon: 'users' },
  { key: 'blacklist', label: '黑名單', description: '候選人風險名單', icon: 'document' },
  { key: 'projects', label: '項目管理', description: '項目組與調動', icon: 'project' },
]

const settingsItem = {
  key: 'settings',
  label: '設定',
  description: '個人資料與職位字典',
  icon: 'gear',
}

const allItems = [...pageItems, settingsItem]

const activeItem = computed(
  () => allItems.find((item) => item.key === props.activePage) || pageItems[0]
)

const displayUserName = computed(() => {
  const name = String(props.userProfile?.username || '').trim()
  if (name) return name
  const mail = String(props.userProfile?.mail || '').trim()
  return mail.split('@')[0] || '使用者'
})

const displayAvatarText = computed(() => {
  const value = String(props.userProfile?.avatarText || '').trim()
  if (value) return value.slice(0, 6)
  const fallback = displayUserName.value.slice(0, 1).toUpperCase()
  return fallback || 'U'
})

const displayAvatarBgColor = computed(() => {
  const color = String(props.userProfile?.avatarBgColor || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#93a4bf'
})

const selectPage = (key) => {
  emit('change-page', key)
  isMobileMenuOpen.value = false
}
</script>

<template>
  <div class="toolbar-shell">
    <aside class="main-toolbar" aria-label="主要導覽">
      <div class="toolbar-brand">
        <img class="brand-logo" :src="titleLogoUrl" alt="HR 系統標誌" />
        <span class="brand-title">HR 系統</span>
      </div>

      <nav class="toolbar-nav" aria-label="頁面導覽">
        <button
          v-for="item in pageItems"
          :key="item.key"
          class="nav-button"
          :class="{ active: props.activePage === item.key }"
          type="button"
          @click="selectPage(item.key)"
        >
          <span class="nav-icon" aria-hidden="true">
            <svg v-if="item.icon === 'briefcase'" viewBox="0 0 24 24" fill="none">
              <path d="M8 7V5.8C8 4.806 8.806 4 9.8 4h4.4C15.194 4 16 4.806 16 5.8V7" />
              <path d="M4.5 9.5h15a1.5 1.5 0 0 1 1.5 1.5v6.3A2.7 2.7 0 0 1 18.3 20H5.7A2.7 2.7 0 0 1 3 17.3V11a1.5 1.5 0 0 1 1.5-1.5Z" />
              <path d="M3 12.5c2.2 1.3 4.93 2 9 2s6.8-.7 9-2" />
            </svg>
            <svg v-else-if="item.icon === 'document'" viewBox="0 0 24 24" fill="none">
              <path d="M8.2 3.5h5.5L19 8.8v10.1A1.6 1.6 0 0 1 17.4 20.5H8.2A3.2 3.2 0 0 1 5 17.3V6.7a3.2 3.2 0 0 1 3.2-3.2Z" />
              <path d="M13.5 3.8V8h4.2" />
              <path d="M8.7 11.3h6.5M8.7 14.6h6.5M8.7 17.9h4.3" />
            </svg>
            <svg v-else-if="item.icon === 'users'" viewBox="0 0 24 24" fill="none">
              <path d="M9 11.3A3.3 3.3 0 1 0 9 4.7A3.3 3.3 0 1 0 9 11.3Z" />
              <path d="M16.3 10.4A2.7 2.7 0 1 0 16.3 5A2.7 2.7 0 1 0 16.3 10.4Z" />
              <path d="M3.6 18.8a5.4 5.4 0 0 1 10.8 0" />
              <path d="M14.1 18.8a4.4 4.4 0 0 1 6.3-3.9A4.5 4.5 0 0 1 22 18.8" />
            </svg>
            <svg v-else-if="item.icon === 'project'" viewBox="0 0 24 24" fill="none">
              <path d="M5 6.5h5.5v5.5H5z" />
              <path d="M13.5 4.5H19V10h-5.5z" />
              <path d="M13.5 14H19v5.5h-5.5z" />
              <path d="M10.5 9.2h3M16.25 10v4" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none">
              <path d="M4.5 7.5h15A1.5 1.5 0 0 1 21 9v8.2a2.3 2.3 0 0 1-2.3 2.3H5.3A2.3 2.3 0 0 1 3 17.2V9a1.5 1.5 0 0 1 1.5-1.5Z" />
              <path d="M7.5 7.5V6.2A2.2 2.2 0 0 1 9.7 4h4.6a2.2 2.2 0 0 1 2.2 2.2v1.3" />
              <path d="M3 11.7h18" />
            </svg>
          </span>
          <span class="nav-copy">
            <strong>{{ item.label }}</strong>
            <span>{{ item.description }}</span>
          </span>
        </button>
      </nav>

      <button
        class="nav-button settings-button"
        :class="{ active: props.activePage === settingsItem.key }"
        type="button"
        @click="selectPage(settingsItem.key)"
      >
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 8.4A3.6 3.6 0 1 0 12 15.6A3.6 3.6 0 1 0 12 8.4Z" />
            <path d="M19.4 13.2v-2.4l-2-.4a5.7 5.7 0 0 0-.5-1.3l1.2-1.6-1.7-1.7-1.6 1.2a5.7 5.7 0 0 0-1.3-.5l-.4-2h-2.4l-.4 2a5.7 5.7 0 0 0-1.3.5L7.4 5.8 5.7 7.5l1.2 1.6a5.7 5.7 0 0 0-.5 1.3l-2 .4v2.4l2 .4a5.7 5.7 0 0 0 .5 1.3l-1.2 1.6 1.7 1.7 1.6-1.2c.42.22.86.38 1.3.5l.4 2h2.4l.4-2c.44-.12.88-.28 1.3-.5l1.6 1.2 1.7-1.7-1.2-1.6c.22-.42.38-.86.5-1.3l2-.4Z" />
          </svg>
        </span>
        <span class="nav-copy">
          <strong>{{ settingsItem.label }}</strong>
          <span>{{ settingsItem.description }}</span>
        </span>
      </button>
    </aside>

    <div class="mobile-toolbar">
      <div class="mobile-header">
        <div>
          <strong>HR 系統</strong>
          <p>{{ activeItem.label }}</p>
        </div>
        <div class="mobile-actions">
          <span class="mobile-avatar" :style="{ background: displayAvatarBgColor }">{{ displayAvatarText }}</span>
          <button
            type="button"
            class="mobile-menu-toggle"
            :aria-expanded="isMobileMenuOpen ? 'true' : 'false'"
            @click="isMobileMenuOpen = !isMobileMenuOpen"
          >
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      <nav class="mobile-nav" :class="{ open: isMobileMenuOpen }" aria-label="手機版頁面導覽">
        <button
          v-for="item in allItems"
          :key="item.key"
          class="mobile-nav-button"
          :class="{ active: props.activePage === item.key }"
          type="button"
          @click="selectPage(item.key)"
        >
          {{ item.label }}
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.toolbar-shell {
  position: fixed;
  top: 1rem;
  left: 1rem;
  display: flex;
  width: 272px;
  min-height: calc(100dvh - 2rem);
  margin-right: 1rem;
}

.main-toolbar {
  display: grid;
  align-content: start;
  gap: 1.25rem;
  width: 100%;
  min-height: calc(100dvh - 2rem);
  padding: 1.15rem;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.86) 0%, rgba(246, 249, 253, 0.94) 100%);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(22px);
}

.toolbar-brand,
.nav-button,
.mobile-header,
.mobile-actions {
  display: flex;
  align-items: center;
}

.toolbar-brand {
  gap: 0.8rem;
  padding: 0.45rem 0.35rem 1rem;
  border-bottom: 1px solid rgba(16, 24, 40, 0.08);
}

.nav-copy {
  display: grid;
}

.nav-copy strong,
.mobile-header strong {
  color: var(--text-strong);
  font-size: 0.95rem;
}

.nav-copy span,
.mobile-header p {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.brand-logo {
  width: 40px;
  height: 40px;
  object-fit: contain;
  flex-shrink: 0;
}

.brand-title {
  color: var(--text-strong);
  font-size: 1.22rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.mobile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 0.96rem;
  font-weight: 700;
}

.toolbar-nav {
  display: grid;
  gap: 0.72rem;
  align-content: start;
}

.nav-button {
  gap: 0.85rem;
  width: 100%;
  padding: 0.94rem 0.96rem;
  border: 1px solid transparent;
  border-radius: 24px;
  color: var(--text-base);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    transform 180ms ease,
    background-color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.nav-button:hover {
  transform: translateY(-1px);
  border-color: rgba(16, 24, 40, 0.08);
  background: rgba(255, 255, 255, 0.62);
}

.nav-button.active {
  border-color: rgba(47, 111, 237, 0.12);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.13), rgba(47, 111, 237, 0.06));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    0 10px 22px rgba(47, 111, 237, 0.08);
}

.nav-icon {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(16, 24, 40, 0.06);
  flex-shrink: 0;
}

.nav-icon svg {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.nav-button.active .nav-icon {
  color: var(--accent);
  background: rgba(255, 255, 255, 0.98);
}

.settings-button {
  margin-top: auto;
  padding-top: 1rem;
  border-top: 1px solid rgba(16, 24, 40, 0.08);
  border-radius: 0;
}

.mobile-toolbar {
  display: none;
}

.mobile-header {
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 24px;
  background: rgba(248, 250, 252, 0.88);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(20px);
}

.mobile-menu-toggle {
  display: inline-grid;
  gap: 0.28rem;
  padding: 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
}

.mobile-menu-toggle span {
  width: 16px;
  height: 2px;
  border-radius: 999px;
  background: var(--text-strong);
}

.mobile-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 220ms ease, opacity 220ms ease, margin-top 220ms ease;
}

.mobile-nav.open {
  max-height: 320px;
  opacity: 1;
  margin-top: 0.8rem;
}

.mobile-nav-button {
  min-height: 44px;
  padding: 0.72rem 0.9rem;
  border: 1px solid var(--border-default);
  border-radius: 18px;
  color: var(--text-base);
  background: rgba(255, 255, 255, 0.84);
  font-weight: 600;
  cursor: pointer;
}

.mobile-nav-button.active {
  color: var(--accent);
  border-color: rgba(47, 111, 237, 0.18);
  background: rgba(47, 111, 237, 0.1);
}

@media (max-width: 1024px) {
  .toolbar-shell {
    position: relative;
    top: auto;
    left: auto;
    width: 100%;
    min-height: auto;
  }

  .main-toolbar {
    display: none;
  }

  .mobile-toolbar {
    display: block;
  }
}
</style>
