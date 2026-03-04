import { h, shallowRef } from 'vue'
import LoginView from '../views/Login.vue'

const routeRecords = [{ path: '/', name: 'login', component: LoginView }]
const routes = new Map(routeRecords.map((route) => [route.path, route.component]))

const currentPath = shallowRef('/')
const currentRoute = shallowRef({ path: '/', matched: [routeRecords[0]] })

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
  },
  getRoutes() {
    return routeRecords.map((route) => ({ ...route }))
  },
  push() {},
}

export default router
