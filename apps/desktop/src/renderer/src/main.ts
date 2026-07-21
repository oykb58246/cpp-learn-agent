import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@cpp-pet/ui-kit/tokens.css'
import './styles/app.css'
import App from './App.vue'
import PetApp from './PetApp.vue'
import ScreenshotApp from './ScreenshotApp.vue'
import { router } from './router'

const view = new URLSearchParams(window.location.search).get('view')
const isPetView = view === 'pet'
const isScreenshotView = view === 'screenshot'
const rootComponent = isPetView ? PetApp : isScreenshotView ? ScreenshotApp : App
const app = createApp(rootComponent).use(createPinia()).use(ElementPlus)
if (!isPetView && !isScreenshotView) app.use(router)
app.mount('#app')
