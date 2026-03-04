import { onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from './apiBaseUrl.js'

const rememberEmailKey = 'innerai_remember_email'

const parseJsonSafe = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export const useLoginForm = ({ router }) => {
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

  const clearAuthMessage = () => {
    authMessage.value = ''
  }

  const switchTab = (tab) => {
    activeTab.value = tab
    clearAuthMessage()
  }

  const handleLogin = async () => {
    authMessage.value = ''
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(loginEmail.value)) {
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
      if (data?.user) {
        window.localStorage.setItem('innerai_user', JSON.stringify(data.user))
      }
      if (data?.token && data?.expiresAt) {
        window.localStorage.setItem(
          'innerai_auth',
          JSON.stringify({ token: data.token, expiresAt: data.expiresAt })
        )
      }
      if (rememberMe.value && loginEmail.value) {
        window.localStorage.setItem(rememberEmailKey, loginEmail.value)
      } else {
        window.localStorage.removeItem(rememberEmailKey)
      }
      router?.push('/blank')
    } catch (error) {
      console.error(error)
      authMessage.value = '登入失敗'
    }
  }

  const requestCode = async () => {
    authMessage.value = ''
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(registerEmail.value)) {
      authMessage.value = '請輸入有效的電子郵件格式'
      return
    }
    if (!registerPassword.value || !registerPasswordConfirm.value) {
      authMessage.value = '請先填寫密碼與確認密碼'
      return
    }
    if (resendCooldown.value > 0) {
      return
    }
    try {
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
      authMessage.value = '驗證碼已送出，60 秒內可再發送'
      resendCooldown.value = 60
      if (resendTimer) {
        clearInterval(resendTimer)
      }
      resendTimer = window.setInterval(() => {
        resendCooldown.value -= 1
        if (resendCooldown.value <= 0) {
          clearInterval(resendTimer)
          resendTimer = null
        }
      }, 1000)
    } catch (error) {
      console.error(error)
      authMessage.value = '無法發送驗證碼'
    }
  }

  const handleRegister = async () => {
    authMessage.value = ''
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(registerEmail.value)) {
      authMessage.value = '請輸入有效的電子郵件格式'
      return
    }
    if (!registerCode.value) {
      authMessage.value = '請先輸入驗證碼'
      return
    }
    if (registerPassword.value !== registerPasswordConfirm.value) {
      authMessage.value = '密碼與確認密碼不一致'
      return
    }
    try {
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
    } catch (error) {
      console.error(error)
      authMessage.value = '註冊失敗'
    }
  }

  onMounted(() => {
    const rememberedEmail = window.localStorage.getItem(rememberEmailKey)
    if (rememberedEmail) {
      loginEmail.value = rememberedEmail
      rememberMe.value = true
    }
  })

  onUnmounted(() => {
    if (resendTimer) {
      clearInterval(resendTimer)
      resendTimer = null
    }
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
    switchTab,
    handleLogin,
    requestCode,
    handleRegister,
  }
}
