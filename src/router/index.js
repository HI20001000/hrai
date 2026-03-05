import { h, shallowRef } from 'vue'
import LoginView from '../views/Login.vue'
import MainView from '../views/Main.vue'

const routeRecords = [
  { path: '/', name: 'login', component: LoginView },
  { path: '/main', name: 'main', component: MainView },
]

const routes = new Map(routeRecords.map((route) => [route.path, route.component]))

const resolveRoute = (path) => routeRecords.find((route) => route.path === path) || routeRecords[0]
const normalizePath = (path) => (routes.has(path) ? path : '/')

const currentPath = shallowRef(normalizePath(window.location.pathname || '/'))
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
