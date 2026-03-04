import { ref } from 'vue'

const DEFAULT_USER = {
  icon: '👤',
  icon_bg: '#2563eb',
}

export const useUserInfo = () => {
  const icon = ref(DEFAULT_USER.icon)
  const iconBg = ref(DEFAULT_USER.icon_bg)

  const loadUserInfo = () => {
    const raw = window.localStorage.getItem('innerai_user')
    if (!raw) {
      icon.value = DEFAULT_USER.icon
      iconBg.value = DEFAULT_USER.icon_bg
      return
    }
    try {
      const data = JSON.parse(raw)
      icon.value = data?.icon || DEFAULT_USER.icon
      iconBg.value = data?.icon_bg || DEFAULT_USER.icon_bg
    } catch {
      icon.value = DEFAULT_USER.icon
      iconBg.value = DEFAULT_USER.icon_bg
    }
  }

  return {
    icon,
    iconBg,
    loadUserInfo,
  }
}
