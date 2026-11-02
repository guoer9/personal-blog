import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { bindElementPlusApp } from './ui/element-plus'
import { initializeSentry } from './monitoring/sentry'

import './style.css'

const app = createApp(App)
bindElementPlusApp(app)

app.use(createPinia())
app.use(router)

void initializeSentry(app)
app.mount('#app')
