<script setup>
import { getCurrentInstance, onMounted, onUnmounted, ref } from 'vue'
import MainToolbar from '../components/MainToolbar.vue'
import JobPostsView from './JobPosts.vue'
import CvManagement from './CvManagement.vue'
import JobApplyView from './JobApply.vue'
import DirectoryManagement from './DirectoryManagement.vue'
import ProjectManagement from './ProjectManagement.vue'
import SettingsView from './Settings.vue'

const activePage = ref('reports')
const currentUser = ref(null)
const instance = getCurrentInstance()
let sessionGuardTimer = null

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

const loadUserFromStorage = () => {
  const user = parseJsonSafe(window.localStorage.getItem('innerai_user'))
  currentUser.value = user && typeof user === 'object' ? user : null
}

const isSessionValid = () => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  if (!token) return false

  const expiresAtMs = Date.parse(String(auth?.expiresAt || ''))
  if (!Number.isFinite(expiresAtMs)) return false
  return Date.now() < expiresAtMs
}

const redirectToLoginIfExpired = () => {
  if (isSessionValid()) return
  window.localStorage.removeItem('innerai_auth')
  window.localStorage.removeItem('innerai_user')
  instance?.proxy?.$router?.push('/')
}

const handleProfileUpdated = (user) => {
  currentUser.value = user && typeof user === 'object' ? user : null
  if (currentUser.value) {
    window.localStorage.setItem('innerai_user', JSON.stringify(currentUser.value))
  }
}

onMounted(() => {
  loadUserFromStorage()
  redirectToLoginIfExpired()
  sessionGuardTimer = window.setInterval(redirectToLoginIfExpired, 1000)
})

onUnmounted(() => {
  if (sessionGuardTimer) window.clearInterval(sessionGuardTimer)
})
</script>

<template>
  <div class="main-layout">
    <div class="layout-grid">
      <div class="nav-column">
        <MainToolbar
          :active-page="activePage"
          :user-profile="currentUser"
          @change-page="activePage = $event"
        />
      </div>

      <main class="main-content">
        <div class="content-frame">
          <JobPostsView v-if="activePage === 'reports'" />
          <CvManagement v-else-if="activePage === 'cv'" />
          <JobApplyView v-else-if="activePage === 'files'" />
          <DirectoryManagement v-else-if="activePage === 'directory'" />
          <ProjectManagement v-else-if="activePage === 'projects'" />
          <SettingsView
            v-else-if="activePage === 'settings'"
            :user-profile="currentUser"
            @profile-updated="handleProfileUpdated"
          />
          <section class="page-header" v-else>
            <div>
              <h2>Workspace</h2>
              <p>Select a page from the navigation.</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.main-layout {
  min-height: 100vh;
  padding: 1rem;
}

.layout-grid {
  display: grid;
  grid-template-columns: minmax(240px, 272px) minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
  min-height: calc(100vh - 2rem);
  margin: 0 auto;
}

.nav-column {
  min-width: 0;
  min-height: 100%;
  display: flex;
  align-self: stretch;
}

.main-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100%;
}

.content-frame {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 1rem;
  min-width: 0;
  min-height: 100%;
}

@media (max-width: 1024px) {
  .main-layout {
    padding: 0.9rem;
  }

  .layout-grid {
    grid-template-columns: minmax(0, 1fr);
    min-height: calc(100vh - 1.8rem);
  }
}

@media (max-width: 720px) {
  .main-layout {
    padding: 0.75rem;
  }

  .layout-grid {
    min-height: calc(100vh - 1.5rem);
  }
}
</style>
