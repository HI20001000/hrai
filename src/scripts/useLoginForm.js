import { computed, onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from './apiBaseUrl.js'

const rememberEmailKey = 'innerai_remember_email'
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const parseJsonSafe = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export const useLoginForm = ({ onLoginSuccess } = {}) => {
  const activeTab = ref('login')
  const loginEmail = ref('')
  const loginPassword = ref('')
  const rememberMe = ref(false)
  const registerEmail = ref('')
  const registerPassword = ref('')
  const registerPasswordConfirm = ref('')
  const registerCode = ref('')
  const authMessage = ref('')
  const resendCooldown = ref(0)
  let resendTimer = null

  const isRegisterEmailValid = computed(() => emailPattern.test(registerEmail.value.trim()))
  const isRegisterPasswordValid = computed(() => registerPassword.value.trim().length > 0)
  const isRegisterPasswordConfirmValid = computed(() => registerPasswordConfirm.value.trim().length > 0)
  const isRegisterPasswordMatched = computed(
    () =>
      isRegisterPasswordValid.value &&
      isRegisterPasswordConfirmValid.value &&
      registerPassword.value === registerPasswordConfirm.value
  )

  const canRequestCode = computed(
    () => isRegisterEmailValid.value && isRegisterPasswordMatched.value && resendCooldown.value <= 0
  )

  const switchTab = (tab) => {
    activeTab.value = tab
    authMessage.value = ''
  }

  const handleLogin = async () => {
    authMessage.value = ''
    if (!emailPattern.test(loginEmail.value)) {
      authMessage.value = '請輸入有效的電子郵件格式'
      return
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.value, password: loginPassword.value }),
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) {
        authMessage.value = data.message || '登入失敗'
        return
      }
      if (data?.user) window.localStorage.setItem('innerai_user', JSON.stringify(data.user))
      if (data?.token && data?.expiresAt) {
        window.localStorage.setItem('innerai_auth', JSON.stringify({ token: data.token, expiresAt: data.expiresAt }))
      }
      if (rememberMe.value && loginEmail.value) {
        window.localStorage.setItem(rememberEmailKey, loginEmail.value)
      } else {
        window.localStorage.removeItem(rememberEmailKey)
      }
      authMessage.value = '登入成功'
      onLoginSuccess?.()
    } catch {
      authMessage.value = '登入失敗'
    }
  }

  const requestCode = async () => {
    authMessage.value = ''
    if (!isRegisterEmailValid.value) {
      authMessage.value = '請輸入有效的電子郵件格式'
      return
    }
    if (!isRegisterPasswordValid.value || !isRegisterPasswordConfirmValid.value) {
      authMessage.value = '請先輸入密碼與確認密碼'
      return
    }
    if (!isRegisterPasswordMatched.value) {
      authMessage.value = '密碼與確認密碼不一致'
      return
    }
    if (resendCooldown.value > 0) return

    const response = await fetch(`${apiBaseUrl}/api/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registerEmail.value }),
    })
    const data = await parseJsonSafe(response)
    if (!response.ok) {
      authMessage.value = data.message || '無法發送驗證碼'
      return
    }
    authMessage.value = '驗證碼已送出，請查看後端日誌'
    resendCooldown.value = 60
    if (resendTimer) clearInterval(resendTimer)
    resendTimer = window.setInterval(() => {
      resendCooldown.value -= 1
      if (resendCooldown.value <= 0) {
        clearInterval(resendTimer)
        resendTimer = null
      }
    }, 1000)
  }

  const handleRegister = async () => {
    authMessage.value = ''
    if (!isRegisterEmailValid.value) {
      authMessage.value = '請輸入有效的電子郵件格式'
      return
    }
    if (!isRegisterPasswordMatched.value) {
      authMessage.value = '密碼與確認密碼不一致'
      return
    }
    const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: registerEmail.value,
        password: registerPassword.value,
        code: registerCode.value,
      }),
    })
    const data = await parseJsonSafe(response)
    if (!response.ok) {
      authMessage.value = data.message || '註冊失敗'
      return
    }
    authMessage.value = '註冊成功，請登入'
    loginEmail.value = registerEmail.value
    activeTab.value = 'login'
  }

  onMounted(() => {
    const rememberedEmail = window.localStorage.getItem(rememberEmailKey)
    if (rememberedEmail) {
      loginEmail.value = rememberedEmail
      rememberMe.value = true
    }
  })

  onUnmounted(() => {
    if (resendTimer) clearInterval(resendTimer)
  })

  return {
    activeTab,
    loginEmail,
    loginPassword,
    rememberMe,
    registerEmail,
    registerPassword,
    registerPasswordConfirm,
    registerCode,
    authMessage,
    resendCooldown,
    canRequestCode,
    switchTab,
    handleLogin,
    requestCode,
    handleRegister,
  }
}
