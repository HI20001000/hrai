<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  document.title = 'HR系統'
})
</script>

<template>
  <main class="app-shell">
    <RouterView />
  </main>
</template>

<style scoped>
.app-shell {
  position: relative;
  min-height: 100vh;
}
</style>
