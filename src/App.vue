<script setup>
import { onBeforeUnmount, onMounted } from 'vue'

let autocompleteObserver = null

const shouldSkipAutocompleteControl = (element) => {
  const type = String(element?.getAttribute?.('type') || '').trim().toLowerCase()
  return ['checkbox', 'radio', 'file', 'color', 'range', 'hidden'].includes(type)
}

const applyAutocompletePolicy = (root = document) => {
  root.querySelectorAll?.('form').forEach((form) => {
    form.setAttribute('autocomplete', 'off')
  })

  root.querySelectorAll?.('input, textarea').forEach((element) => {
    if (shouldSkipAutocompleteControl(element)) return
    const type = String(element.getAttribute('type') || '').trim().toLowerCase()
    element.setAttribute('autocomplete', type === 'password' ? 'new-password' : 'off')
    element.setAttribute('autocorrect', 'off')
    element.setAttribute('autocapitalize', 'off')
    element.setAttribute('spellcheck', 'false')
  })
}

onMounted(() => {
  document.title = 'HR系統'
  applyAutocompletePolicy()
  autocompleteObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) applyAutocompletePolicy(node)
      })
    }
  })
  autocompleteObserver.observe(document.body, { childList: true, subtree: true })
})

onBeforeUnmount(() => {
  autocompleteObserver?.disconnect()
  autocompleteObserver = null
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
