import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import {
  ArrowLeft,
  ChatDotRound,
  DataBoard,
  Document,
  FolderOpened,
  Plus,
  PriceTag,
  Upload,
  View,
} from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

import App from './App.vue'
import router from './router'

import './style.css'

const app = createApp(App)

// 仅注册管理后台使用的图标，避免把整套图标带进公共博客首包。
for (const [name, component] of Object.entries({
  ArrowLeft,
  ChatDotRound,
  DataBoard,
  Document,
  FolderOpened,
  Plus,
  PriceTag,
  Upload,
  View,
})) {
  app.component(name, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
