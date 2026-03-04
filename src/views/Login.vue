<script setup>
import { getCurrentInstance, onMounted, onUnmounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'

const heroRef = ref(null)
const canvasRef = ref(null)
const router = getCurrentInstance().appContext.config.globalProperties.$router
const loginEmail = ref('')
const loginPassword = ref('')
const rememberMe = ref(false)
const authMessage = ref('')
const rememberEmailKey = 'innerai_remember_email'
let cleanupAnimation = null

const parseJsonSafe = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
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

const mouse = {
  x: 0,
  y: 0,
  active: false,
}

const createParticle = (width, height, { edge = false } = {}) => {
  let baseVx = (Math.random() - 0.5) * 0.6
  let baseVy = (Math.random() - 0.5) * 0.6
  const radius = 1.6 + Math.random() * 1.4
  let x = Math.random() * width
  let y = Math.random() * height

  if (edge) {
    const side = Math.floor(Math.random() * 4)
    if (side === 0) {
      x = 0
      y = Math.random() * height
      baseVx = Math.abs(baseVx)
      baseVy = (Math.random() - 0.5) * 0.6
    } else if (side === 1) {
      x = width
      y = Math.random() * height
      baseVx = -Math.abs(baseVx)
      baseVy = (Math.random() - 0.5) * 0.6
    } else if (side === 2) {
      x = Math.random() * width
      y = 0
      baseVy = Math.abs(baseVy)
      baseVx = (Math.random() - 0.5) * 0.6
    } else {
      x = Math.random() * width
      y = height
      baseVy = -Math.abs(baseVy)
      baseVx = (Math.random() - 0.5) * 0.6
    }
  }

  return {
    x,
    y,
    vx: baseVx,
    vy: baseVy,
    baseVx,
    baseVy,
    radius,
  }
}

const createParticles = (count, width, height) =>
  Array.from({ length: count }, () => createParticle(width, height))

onMounted(() => {
  const rememberedEmail = window.localStorage.getItem(rememberEmailKey)
  if (rememberedEmail) {
    loginEmail.value = rememberedEmail
    rememberMe.value = true
  }
  const heroEl = heroRef.value
  const canvas = canvasRef.value
  if (!heroEl || !canvas) {
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  const state = {
    animationId: 0,
    particles: [],
    width: 0,
    height: 0,
    ratio: window.devicePixelRatio || 1,
  }

  const particleCount = 100
  const resetParticleAtEdge = (particle) => {
    Object.assign(particle, createParticle(state.width, state.height, { edge: true }))
  }

  const resize = () => {
    state.ratio = window.devicePixelRatio || 1
    state.width = heroEl.clientWidth
    state.height = heroEl.clientHeight
    canvas.width = state.width * state.ratio
    canvas.height = state.height * state.ratio
    canvas.style.width = `${state.width}px`
    canvas.style.height = `${state.height}px`
    ctx.setTransform(state.ratio, 0, 0, state.ratio, 0, 0)
    state.particles = createParticles(particleCount, state.width, state.height)
  }

  let lastMouseX = 0
  let lastMouseY = 0
  let mouseVelocityX = 0
  let mouseVelocityY = 0
  const handleMouseMove = (event) => {
    if (mouse.active) {
      mouseVelocityX = event.clientX - lastMouseX
      mouseVelocityY = event.clientY - lastMouseY
    }
    lastMouseX = event.clientX
    lastMouseY = event.clientY
    mouse.x = event.clientX
    mouse.y = event.clientY
    mouse.active = true
  }

  const handleMouseLeave = () => {
    mouse.active = false
  }

  const tick = () => {
    ctx.clearRect(0, 0, state.width, state.height)

    const rect = heroEl.getBoundingClientRect()
    const localMouse = {
      x: mouse.x - rect.left,
      y: mouse.y - rect.top,
      active:
        mouse.active &&
        mouse.x >= rect.left &&
        mouse.x <= rect.right &&
        mouse.y >= rect.top &&
        mouse.y <= rect.bottom,
    }
    const innerRadius = 70
    const outerRadius = 160
    mouseVelocityX *= 0.9
    mouseVelocityY *= 0.9

    for (const particle of state.particles) {
      particle.x += particle.vx
      particle.y += particle.vy

      if (
        particle.x <= 0 ||
        particle.x >= state.width ||
        particle.y <= 0 ||
        particle.y >= state.height
      ) {
        resetParticleAtEdge(particle)
        continue
      }

      if (localMouse.active) {
        const dx = particle.x - localMouse.x
        const dy = particle.y - localMouse.y
        const distance = Math.hypot(dx, dy)
        if (distance > 0 && distance <= innerRadius) {
          const nx = dx / distance
          const ny = dy / distance
          particle.x = localMouse.x + nx * innerRadius
          particle.y = localMouse.y + ny * innerRadius
          particle.vx = mouseVelocityX * 0.4 + particle.baseVx * 0.2
          particle.vy = mouseVelocityY * 0.4 + particle.baseVy * 0.2
        } else if (distance > innerRadius && distance < outerRadius) {
          const nx = dx / distance
          const ny = dy / distance
          const targetX = localMouse.x + nx * innerRadius
          const targetY = localMouse.y + ny * innerRadius
          const attraction = (outerRadius - distance) / outerRadius
          particle.vx += (targetX - particle.x) * 0.002 * attraction
          particle.vy += (targetY - particle.y) * 0.002 * attraction
        } else {
          particle.vx += (particle.baseVx - particle.vx) * 0.02
          particle.vy += (particle.baseVy - particle.vy) * 0.02
        }
      } else {
        particle.vx += (particle.baseVx - particle.vx) * 0.015
        particle.vy += (particle.baseVy - particle.vy) * 0.015
      }
    }

    if (localMouse.active) {
      const glowRadius = 140
      const glow = ctx.createRadialGradient(
        localMouse.x,
        localMouse.y,
        0,
        localMouse.x,
        localMouse.y,
        glowRadius
      )
      glow.addColorStop(0, 'rgba(129, 140, 248, 0.18)')
      glow.addColorStop(0.5, 'rgba(59, 130, 246, 0.08)')
      glow.addColorStop(1, 'rgba(15, 23, 42, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(localMouse.x, localMouse.y, glowRadius, 0, Math.PI * 2)
      ctx.fill()
    }

    for (let i = 0; i < state.particles.length; i += 1) {
      const p1 = state.particles[i]
      for (let j = i + 1; j < state.particles.length; j += 1) {
        const p2 = state.particles[j]
        const dx = p1.x - p2.x
        const dy = p1.y - p2.y
        const distance = Math.hypot(dx, dy)
        if (distance < 110) {
          const opacity = 1 - distance / 110
          ctx.strokeStyle = `rgba(99, 102, 241, ${opacity * 0.35})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
        }
      }
    }

    for (const particle of state.particles) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.9)'
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      ctx.fill()
    }

    state.animationId = window.requestAnimationFrame(tick)
  }

  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseleave', handleMouseLeave)
  window.addEventListener('blur', handleMouseLeave)

  state.animationId = window.requestAnimationFrame(tick)

  cleanupAnimation = () => {
    window.removeEventListener('resize', resize)
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseleave', handleMouseLeave)
    window.removeEventListener('blur', handleMouseLeave)
    window.cancelAnimationFrame(state.animationId)
  }
})

onUnmounted(() => {
  cleanupAnimation?.()
})
</script>

<template>
  <div class="login-page">
    <aside class="login-hero" ref="heroRef">
      <canvas class="hero-canvas" ref="canvasRef" aria-hidden="true"></canvas>
      <div class="hero-content">
        <div class="hero-title-row">
          <img class="logo-image" src="/src/imgs/web_icon.png" alt="InnerAI" />
          <p class="hero-title">AI 業務平台</p>
        </div>
        <p class="hero-subtitle">請使用您的帳號登入系統。</p>
      </div>
    </aside>

    <section class="login-panel">
      <header class="panel-header">
        <p class="panel-title">歡迎回來</p>
        <p class="panel-subtitle">請輸入你的帳號資訊以繼續。</p>
      </header>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-grid">
          <label class="field">
            <span>電子郵件</span>
            <input
              v-model="loginEmail"
              type="email"
              placeholder="name@company.com"
            />
          </label>

          <label class="field">
            <span>密碼</span>
            <input v-model="loginPassword" type="password" placeholder="••••••••" />
          </label>
        </div>

        <div class="helper-row">
          <label class="checkbox">
            <input v-model="rememberMe" type="checkbox" />
            <span>記住我</span>
          </label>
          <a class="link" href="#">忘記密碼？</a>
        </div>

        <button class="primary-button" type="submit">登入帳號</button>
      </form>

      <p v-if="authMessage" class="auth-message">{{ authMessage }}</p>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  background: #f6f7fb;
}

.login-hero {
  position: relative;
  background: #0b1220;
  color: #fff;
  padding: 5rem 8vw;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  overflow: hidden;
}

.hero-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.9;
}

.hero-content {
  max-width: 520px;
  display: grid;
  gap: 1.25rem;
  text-align: left;
  position: relative;
  z-index: 2;
}

.hero-title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
}

.logo-image {
  width: 52px;
  height: 52px;
  border-radius: 18px;
  object-fit: cover;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.35);
}

.hero-title {
  font-size: 2.4rem;
  font-weight: 600;
  margin: 0;
}

.hero-subtitle {
  margin: 0;
  color: rgba(255, 255, 255, 0.7);
  font-size: 1rem;
  line-height: 1.6;
}

.login-panel {
  background: #ffffff;
  padding: 4.5rem 10vw;
  display: grid;
  align-content: center;
}

.panel-header {
  margin-bottom: 2rem;
}

.panel-title {
  font-size: 1.7rem;
  font-weight: 600;
  margin: 0;
  color: #0f172a;
}

.panel-subtitle {
  margin: 0.5rem 0 0;
  color: #64748b;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.form-grid {
  display: grid;
  gap: 1.1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-weight: 500;
  color: #111827;
}

.field span {
  font-size: 0.9rem;
  color: #475569;
}

.field input {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 0.85rem 1rem;
  font-size: 0.95rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  background: #fff;
}

.field input::placeholder {
  color: #94a3b8;
}

.field input:focus {
  outline: none;
  border-color: #5b8cff;
  box-shadow: 0 0 0 4px rgba(91, 140, 255, 0.15);
  background: #fff;
}

.helper-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
  color: #6b7280;
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.link {
  color: #5b8cff;
  text-decoration: none;
  font-weight: 500;
}

.primary-button {
  background: #1f2937;
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.primary-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 30px rgba(15, 23, 42, 0.25);
}

.auth-message {
  margin-top: 1.5rem;
  text-align: center;
  color: #2563eb;
  font-weight: 500;
}

@media (min-width: 960px) {
  .login-page {
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  }
}

@media (max-width: 640px) {
  .login-page {
    grid-template-columns: minmax(0, 1fr);
  }

  .login-hero {
    padding: 3rem 8vw 2.5rem;
  }

  .login-panel {
    padding: 2.5rem 8vw 3rem;
  }
}
</style>
