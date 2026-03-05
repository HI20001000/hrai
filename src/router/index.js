import { h, shallowRef } from 'vue'
import LoginView from '../views/Login.vue'
import MainView from '../views/Main.vue'

const routeRecords = [
  { path: '/', name: 'login', component: LoginView },
  { path: '/main', name: 'main', component: MainView },
]

const routes = new Map(routeRecords.map((route) => [route.path, route.component]))

const resolveRoute = (path) => routeRecords.find((route) => route.path === path) || routeRecords[0]

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

const clearAuthState = () => {
  window.localStorage.removeItem('innerai_auth')
  window.localStorage.removeItem('innerai_user')
}

const isAuthValid = () => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  if (!token) return false

  const expiresAtMs = Date.parse(String(auth?.expiresAt || ''))
  if (!Number.isFinite(expiresAtMs)) return false
  if (Date.now() >= expiresAtMs) {
    clearAuthState()
    return false
  }

  return true
}

const normalizePath = (path) => {
  const nextPath = routes.has(path) ? path : '/'
  if (nextPath === '/main' && !isAuthValid()) return '/'
  return nextPath
}

const initialRawPath = window.location.pathname || '/'
const initialPath = normalizePath(initialRawPath)
if (initialPath !== initialRawPath) {
  window.history.replaceState({}, '', initialPath)
}

const currentPath = shallowRef(initialPath)
const currentRoute = shallowRef({ path: currentPath.value, matched: [resolveRoute(currentPath.value)] })

const setRoute = (path, { replace = false } = {}) => {
  const nextPath = normalizePath(path)
  if (nextPath === currentPath.value) return
  currentPath.value = nextPath
  currentRoute.value = { path: nextPath, matched: [resolveRoute(nextPath)] }
  if (replace) {
    window.history.replaceState({}, '', nextPath)
  } else {
    window.history.pushState({}, '', nextPath)
  }
}

const RouterView = {
  name: 'RouterView',
  setup() {
    return () => {
      const component = routes.get(currentPath.value)
      return component ? h(component) : null
    }
  },
}

const router = {
  currentRoute,
  options: {
    history: { base: '/', location: currentPath, state: {} },
    routes: routeRecords,
  },
  install(app) {
    app.component('RouterView', RouterView)
    app.config.globalProperties.$router = router
    app.config.globalProperties.$route = currentRoute
    window.addEventListener('popstate', () => {
      const path = normalizePath(window.location.pathname || '/')
      if (path !== (window.location.pathname || '/')) {
        window.history.replaceState({}, '', path)
      }
      currentPath.value = path
      currentRoute.value = { path, matched: [resolveRoute(path)] }
    })
  },
  getRoutes() {
    return routeRecords.map((route) => ({ ...route }))
  },
  push(path) {
    setRoute(path)
  },
}

export default router
