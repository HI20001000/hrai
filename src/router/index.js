import { h, shallowRef } from 'vue'
import LoginView from '../views/Login.vue'
import BlankView from '../views/Blank.vue'

const routeRecords = [
  { path: '/', name: 'login', component: LoginView },
  { path: '/blank', name: 'blank', component: BlankView },
]

const routes = new Map(routeRecords.map((route) => [route.path, route.component]))
const normalizePath = (path) => (path === '/login' ? '/' : path)

const getAuthState = () => {
  const raw = window.localStorage.getItem('innerai_auth')
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!data?.token || !data?.expiresAt) return null
    if (Date.now() >= Date.parse(data.expiresAt)) {
      window.localStorage.removeItem('innerai_auth')
      return null
    }
    return data
  } catch {
    window.localStorage.removeItem('innerai_auth')
    return null
  }
}

const enforceAuth = (path) => {
  const authed = Boolean(getAuthState())
  if (!authed && path !== '/') return '/'
  if (!routes.has(path)) return authed ? '/blank' : '/'
  return path
}

const currentPath = shallowRef(
  enforceAuth(normalizePath(window.location.pathname || '/'))
)

const resolveRoute = (path) => {
  const record = routeRecords.find((route) => route.path === path)
  return {
    path,
    matched: record ? [record] : [],
  }
}

const currentRoute = shallowRef(resolveRoute(currentPath.value))

const updatePath = (path) => {
  const nextPath = enforceAuth(normalizePath(path))
  if (nextPath === currentPath.value) return
  currentPath.value = nextPath
  currentRoute.value = resolveRoute(nextPath)
}

window.addEventListener('popstate', () => {
  updatePath(window.location.pathname || '/')
})

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
    history: {
      base: '/',
      location: currentPath,
      state: {},
    },
    routes: routeRecords,
  },
  install(app) {
    app.component('RouterView', RouterView)
    app.config.globalProperties.$router = router
    app.config.globalProperties.$route = currentRoute
  },
  getRoutes() {
    return routeRecords.map((route) => ({ ...route }))
  },
  push(path) {
    const nextPath = enforceAuth(normalizePath(path))
    if (nextPath === currentPath.value) return
    window.history.pushState({}, '', nextPath)
    updatePath(nextPath)
  },
}

export default router
