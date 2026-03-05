<script setup>
import { getCurrentInstance } from 'vue'
import { useLoginForm } from '../scripts/useLoginForm.js'

const instance = getCurrentInstance()

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
  canRequestCode,
  switchTab,
  handleLogin,
  requestCode,
  handleRegister,
} = useLoginForm({
  onLoginSuccess: () => instance?.proxy?.$router?.push('/main'),
})
</script>

<template>
  <div class="login-page">
    <aside class="login-hero">
      <div class="hero-glow hero-glow-left" aria-hidden="true"></div>
      <div class="hero-glow hero-glow-right" aria-hidden="true"></div>

      <div class="hero-stack">
        <span class="hero-pill">簡潔舒適的 HR 工作台</span>
        <div class="hero-copy">
          <h1>讓招聘流程更清晰、安定且高效。</h1>
          <p>
            從職缺建立、CV 解析、候選人投遞到匹配檢視，都能在同一個工作台完成。
          </p>
        </div>

        <div class="hero-panels">
          <section class="hero-panel">
            <strong>聚焦介面</strong>
            <p>降低視覺干擾，讓團隊更快閱讀、比較與處理候選人資料。</p>
          </section>
          <section class="hero-panel">
            <strong>流程清楚</strong>
            <p>從職缺設定到 CV 解析與提交，用更少步驟完成整個流程。</p>
          </section>
          <section class="hero-panel">
            <strong>舒適配色</strong>
            <p>柔和藍灰色系、寬鬆留白與乾淨層次，提供更舒服的企業操作體驗。</p>
          </section>
        </div>
      </div>
    </aside>

    <section class="login-panel">
      <div class="login-card">
        <header class="panel-header">
          <span class="panel-eyebrow">HR系統</span>
          <div>
            <h2>歡迎回來</h2>
            <p class="panel-subtitle">登入以繼續使用，或建立新帳號供團隊使用。</p>
          </div>
        </header>

        <div class="auth-tabs" role="tablist" aria-label="驗證分頁">
          <button
            type="button"
            class="auth-tab"
            :class="{ active: activeTab === 'login' }"
            @click="switchTab('login')"
          >
            登入
          </button>
          <button
            type="button"
            class="auth-tab"
            :class="{ active: activeTab === 'register' }"
            @click="switchTab('register')"
          >
            註冊
          </button>
        </div>

        <form v-if="activeTab === 'login'" class="login-form" @submit.prevent="handleLogin">
          <div class="form-grid">
            <label class="field">
              <span>電子郵件</span>
              <input v-model="loginEmail" type="email" placeholder="name@company.com" />
            </label>

            <label class="field">
              <span>密碼</span>
              <input v-model="loginPassword" type="password" placeholder="請輸入密碼" />
            </label>
          </div>

          <div class="helper-row">
            <label class="checkbox">
              <input v-model="rememberMe" type="checkbox" />
              <span>記住我</span>
            </label>
          </div>

          <button class="primary-button" type="submit">登入</button>
        </form>

        <form v-else class="login-form" @submit.prevent="handleRegister">
          <div class="form-grid">
            <label class="field">
              <span>電子郵件</span>
              <input v-model="registerEmail" type="email" placeholder="name@company.com" />
            </label>
            <label class="field">
              <span>密碼</span>
              <input v-model="registerPassword" type="password" placeholder="至少 6 個字元" />
            </label>
            <label class="field">
              <span>確認密碼</span>
              <input
                v-model="registerPasswordConfirm"
                type="password"
                placeholder="請再次輸入密碼"
              />
            </label>
            <label class="field">
              <span>驗證碼</span>
              <div class="code-row">
                <input v-model="registerCode" type="text" placeholder="請輸入驗證碼" />
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="!canRequestCode"
                  @click="requestCode"
                >
                  {{ resendCooldown > 0 ? `${resendCooldown} 秒` : '發送驗證碼' }}
                </button>
              </div>
            </label>
          </div>

          <button class="primary-button" type="submit">建立帳號</button>
        </form>

        <p v-if="authMessage" class="auth-message">{{ authMessage }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(420px, 0.92fr);
  min-height: 100vh;
}

.login-hero,
.login-panel {
  position: relative;
  min-width: 0;
}

.login-hero {
  overflow: hidden;
  padding: clamp(2.5rem, 2rem + 2vw, 4.5rem);
  background:
    linear-gradient(180deg, rgba(248, 251, 255, 0.98) 0%, rgba(236, 242, 249, 0.98) 100%);
}

.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(10px);
}

.hero-glow-left {
  left: -8%;
  top: -6%;
  width: 280px;
  height: 280px;
  background: rgba(103, 140, 255, 0.22);
}

.hero-glow-right {
  right: 6%;
  bottom: 8%;
  width: 220px;
  height: 220px;
  background: rgba(129, 221, 255, 0.22);
}

.hero-stack {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 2rem;
  align-content: center;
  min-height: 100%;
  max-width: 640px;
  margin: 0 auto;
}

.hero-pill,
.panel-eyebrow {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 34px;
  padding: 0.35rem 0.8rem;
  border: 1px solid rgba(47, 111, 237, 0.14);
  border-radius: 999px;
  color: var(--accent);
  background: rgba(255, 255, 255, 0.68);
  font-size: 0.84rem;
  font-weight: 600;
}

.hero-copy {
  display: grid;
  gap: 1rem;
}

.hero-copy h1 {
  max-width: 9ch;
  font-size: clamp(2.6rem, 2rem + 2.2vw, 4.5rem);
  line-height: 0.96;
}

.hero-copy p {
  max-width: 50ch;
  font-size: 1rem;
  color: var(--text-muted);
}

.hero-panels {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.hero-panel {
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(18px);
}

.hero-panel strong {
  color: var(--text-strong);
}

.hero-panel p {
  color: var(--text-muted);
  font-size: 0.92rem;
}

.login-panel {
  display: grid;
  place-items: center;
  padding: clamp(1.5rem, 1rem + 2vw, 3rem);
}

.login-card {
  width: min(100%, 480px);
  display: grid;
  gap: 1.35rem;
  padding: clamp(1.35rem, 1.1rem + 1vw, 2rem);
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(22px);
}

.panel-header {
  display: grid;
  gap: 0.9rem;
}

.panel-header h2 {
  font-size: 2rem;
}

.auth-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  padding: 0.4rem;
  border-radius: 999px;
  background: rgba(237, 242, 248, 0.9);
}

.auth-tab {
  min-height: 46px;
  padding: 0.7rem 1rem;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--text-muted);
  font-weight: 600;
  cursor: pointer;
  transition: all 180ms ease;
}

.auth-tab.active {
  color: var(--text-strong);
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(16, 24, 40, 0.06);
  box-shadow: var(--shadow-xs);
}

.login-form,
.form-grid {
  display: grid;
  gap: 1rem;
}

.helper-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--text-base);
}

.checkbox input {
  width: 16px;
  height: 16px;
}

.code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
}

.primary-button,
.secondary-button {
  min-height: 48px;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease,
    opacity 180ms ease;
}

.primary-button {
  color: #ffffff;
  background: linear-gradient(180deg, #4b84ff 0%, var(--accent) 100%);
  box-shadow: 0 14px 28px rgba(47, 111, 237, 0.18);
}

.primary-button:hover {
  transform: translateY(-1px);
  background: linear-gradient(180deg, #3f79f8 0%, var(--accent-hover) 100%);
}

.secondary-button {
  padding: 0 1rem;
  color: var(--text-strong);
  border: 1px solid var(--border-default);
  background: rgba(255, 255, 255, 0.92);
}

.secondary-button:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.auth-message {
  padding: 0.78rem 0.92rem;
  border-radius: 18px;
  color: var(--accent-hover);
  background: rgba(47, 111, 237, 0.08);
  border: 1px solid rgba(47, 111, 237, 0.12);
}

@media (max-width: 1180px) {
  .login-page {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero-panels {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .login-panel {
    padding-top: 0;
  }

  .login-card {
    border-radius: 28px;
  }

  .code-row {
    grid-template-columns: 1fr;
  }
}
</style>
