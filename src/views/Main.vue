<script setup>
import { computed, ref } from 'vue'
import MainToolbar from '../components/MainToolbar.vue'

const activePage = ref('home')

const pageTitle = computed(() => {
  if (activePage.value === 'reports') return '報表頁'
  if (activePage.value === 'files') return '檔案頁'
  if (activePage.value === 'settings') return '設定頁'
  return '首頁'
})
</script>

<template>
  <div class="main-layout">
    <MainToolbar :active-page="activePage" @change-page="activePage = $event" />

    <main class="main-content">
      <h1>{{ pageTitle }}</h1>
      <p>這是 main view 內容區。</p>
    </main>
  </div>
</template>

<style scoped>
.main-layout {
  min-height: 100vh;
}

.main-content {
  margin-left: 80px;
  padding: 2rem;
}
</style>
