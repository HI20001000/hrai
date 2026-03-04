import { onMounted, onUnmounted } from 'vue'

export const useLoginAnimation = ({ heroRef, canvasRef }) => {
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

  let cleanupAnimation = null

  onMounted(() => {
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
}
