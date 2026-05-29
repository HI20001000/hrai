import { h, shallowRef } from 'vue'
import { getStoredAuth } from '../scripts/authState.js'
import LoginView from '../views/Login.vue'
import MainView from '../views/Main.vue'

const routeRecords = [
  { path: '/', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/main', name: 'main', component: MainView, meta: { requiresAuth: true } },
]

const routes = new Map(routeRecords.map((route) => [route.path, route.component]))

const resolveRoute = (path) => routeRecords.find((route) => route.path === path) || routeRecords[0]

const isAuthValid = () => {
  return !!getStoredAuth()
}

const normalizePath = (path) => {
  const nextPath = routes.has(path) ? path : '/'
  const route = resolveRoute(nextPath)
  if (!route.meta?.public && !isAuthValid()) return '/'
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

const syncCurrentRouteWithAuth = () => {
  const normalizedPath = normalizePath(window.location.pathname || '/')
  if (normalizedPath !== (window.location.pathname || '/')) {
    window.history.replaceState({}, '', normalizedPath)
  }
  if (normalizedPath === currentPath.value) return
  currentPath.value = normalizedPath
  currentRoute.value = { path: normalizedPath, matched: [resolveRoute(normalizedPath)] }
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
    window.addEventListener('popstate', syncCurrentRouteWithAuth)
    window.addEventListener('storage', (event) => {
      if (event.key === 'innerai_auth' || event.key === 'innerai_user') syncCurrentRouteWithAuth()
    })
    window.addEventListener('focus', syncCurrentRouteWithAuth)
  },
  getRoutes() {
    return routeRecords.map((route) => ({ ...route }))
  },
  push(path) {
    setRoute(path)
  },
  replace(path) {
    setRoute(path, { replace: true })
  },
}

export default router
