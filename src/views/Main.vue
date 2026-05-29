<script setup>
import { getCurrentInstance, onMounted, onUnmounted, ref } from 'vue'
import MainToolbar from '../components/MainToolbar.vue'
import JobPostsView from './JobPosts.vue'
import CvManagement from './CvManagement.vue'
import JobApplyView from './JobApply.vue'
import ScheduleView from './Schedule.vue'
import ArrangedInterviewsView from './ArrangedInterviews.vue'
import OnboardedPersonnelManagement from './OnboardedPersonnelManagement.vue'
import BlacklistManagement from './BlacklistManagement.vue'
import ProjectManagement from './ProjectManagement.vue'
import SettingsView from './Settings.vue'
import UserRoleManagement from './UserRoleManagement.vue'
import JobDictionaryPanel from '../components/job/JobDictionaryPanel.vue'

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
          <ScheduleView v-else-if="activePage === 'schedule'" :current-user="currentUser" />
          <ArrangedInterviewsView v-else-if="activePage === 'interviews'" :current-user="currentUser" />
          <OnboardedPersonnelManagement v-else-if="activePage === 'personnel'" />
          <BlacklistManagement v-else-if="activePage === 'blacklist'" />
          <ProjectManagement v-else-if="activePage === 'projects'" />
          <SettingsView
            v-else-if="activePage === 'settings-profile'"
            :user-profile="currentUser"
            @profile-updated="handleProfileUpdated"
          />
          <UserRoleManagement
            v-else-if="activePage === 'settings-user-roles'"
            :current-user="currentUser"
            @profile-updated="handleProfileUpdated"
          />
          <section v-else-if="activePage === 'settings-job-dictionary'" class="settings-dictionary-page">
            <header class="page-header">
              <div>
                <h2>職位字典配置</h2>
                <p>集中維護職位字典，職缺建立時會從這裡載入最新配置。</p>
              </div>
            </header>
            <JobDictionaryPanel />
          </section>
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
  height: 100dvh;
  min-height: 100vh;
  padding: 1rem;
  overflow: hidden;
}

.layout-grid {
  display: grid;
  grid-template-columns: minmax(240px, 272px) minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
  height: calc(100dvh - 2rem);
  min-height: 0;
  margin: 0 auto;
  overflow: hidden;
}

.nav-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  align-self: stretch;
}

.main-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.content-frame {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 1rem;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.settings-dictionary-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 1rem;
  min-height: 0;
  overflow: hidden;
}

.settings-dictionary-page :deep(.dictionary-card) {
  min-height: 0;
}

.content-frame :deep(.app-page),
.content-frame :deep(.settings-page),
.content-frame :deep(.job-post-page),
.content-frame :deep(.job-apply-page),
.content-frame :deep(.cv-page),
.content-frame :deep(.candidate-page),
.content-frame :deep(.schedule-page),
.content-frame :deep(.arranged-page),
.content-frame :deep(.project-page),
.content-frame :deep(.blacklist-page),
.content-frame :deep(.directory-page),
.content-frame :deep(.personnel-page),
.content-frame :deep(.user-role-page),
.content-frame :deep(.settings-dictionary-page) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

@media (max-width: 1024px) {
  .main-layout {
    padding: 0.9rem;
    overflow: auto;
  }

  .layout-grid {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    min-height: calc(100dvh - 1.8rem);
    overflow: visible;
  }

  .main-content,
  .content-frame {
    overflow: visible;
  }
}

@media (max-width: 720px) {
  .main-layout {
    padding: 0.75rem;
  }

  .layout-grid {
    min-height: calc(100dvh - 1.5rem);
  }
}
</style>
