<script setup>
import { getCurrentInstance } from 'vue'
import { useLoginForm } from '../scripts/useLoginForm.js'

const router = getCurrentInstance().appContext.config.globalProperties.$router
const {
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
} = useLoginForm({ router })
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <h1>HRAI 身份驗證</h1>
      <div class="tabs">
        <button :class="{ active: activeTab === 'login' }" @click="switchTab('login')">登入</button>
        <button :class="{ active: activeTab === 'register' }" @click="switchTab('register')">註冊</button>
      </div>

      <form v-if="activeTab === 'login'" class="form" @submit.prevent="handleLogin">
        <input v-model.trim="loginEmail" type="email" placeholder="Email" required />
        <input v-model="loginPassword" type="password" placeholder="密碼" required />
        <label class="checkbox"><input v-model="rememberMe" type="checkbox" />記住帳號</label>
        <button type="submit">登入</button>
      </form>

      <form v-else class="form" @submit.prevent="handleRegister">
        <input v-model.trim="registerEmail" type="email" placeholder="Email" required />
        <div class="inline">
          <input v-model.trim="registerCode" type="text" placeholder="驗證碼" required />
          <button type="button" @click="requestCode" :disabled="resendCooldown > 0">
            {{ resendCooldown > 0 ? `${resendCooldown}s` : '發送驗證碼' }}
          </button>
        </div>
        <input v-model="registerPassword" type="password" placeholder="密碼" required />
        <input v-model="registerPasswordConfirm" type="password" placeholder="確認密碼" required />
        <button type="submit">註冊</button>
      </form>

      <p v-if="authMessage" class="message">{{ authMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.auth-shell { min-height: 100vh; display: grid; place-items: center; background: #f3f4f6; }
.auth-card { width: min(420px, 90vw); background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.08); }
.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
.tabs button, .form button { border: 0; border-radius: 8px; padding: 10px; cursor: pointer; }
.tabs .active { background: #111827; color: #fff; }
.form { display: grid; gap: 12px; }
input { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
.inline { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.checkbox { display: flex; align-items: center; gap: 6px; color: #4b5563; font-size: 14px; }
.message { margin-top: 12px; color: #2563eb; font-size: 14px; }
</style>
