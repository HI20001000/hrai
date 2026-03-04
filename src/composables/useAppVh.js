import { onBeforeUnmount, onMounted } from 'vue'

export const useAppVh = () => {
  const setVh = () => {
    document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`)
  }

  onMounted(() => {
    setVh()
    window.addEventListener('resize', setVh)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', setVh)
  })
}
