import type { App } from 'vue'

type ElementPlusApp = App

let boundApp: ElementPlusApp | null = null
let appReady: Promise<ElementPlusApp> | null = null
let resolveAppReady: ((app: ElementPlusApp) => void) | null = null
let installPromise: Promise<void> | null = null

function createAppReadyPromise() {
  if (!appReady) {
    appReady = new Promise<ElementPlusApp>((resolve) => {
      resolveAppReady = resolve
    })
  }
  return appReady
}

export function bindElementPlusApp(app: ElementPlusApp): void {
  if (boundApp && boundApp !== app) {
    throw new Error('Element Plus is already bound to a different Vue app')
  }
  boundApp = app
  resolveAppReady?.(app)
  resolveAppReady = null
  appReady = Promise.resolve(app)
}

export function getElementPlusApp(): ElementPlusApp | null {
  return boundApp
}

export function waitForElementPlusApp(): Promise<ElementPlusApp> {
  return boundApp ? Promise.resolve(boundApp) : createAppReadyPromise()
}

export async function installElementPlus(app?: ElementPlusApp): Promise<void> {
  const target = app || boundApp
  if (!target) {
    throw new Error('Element Plus must be bound to the Vue app before installation')
  }
  if (boundApp && target !== boundApp) {
    throw new Error('Element Plus installer received a different Vue app')
  }
  if (!boundApp) bindElementPlusApp(target)
  if (installPromise) return installPromise

  installPromise = (async () => {
    const [{ default: ElementPlus }, , { default: zhCn }, { default: icons }] = await Promise.all([
      import('element-plus'),
      import('element-plus/dist/index.css'),
      import('element-plus/es/locale/lang/zh-cn'),
      import('./admin-icons'),
    ])
    for (const [name, icon] of Object.entries(icons)) {
      target.component(name, icon)
    }
    target.use(ElementPlus, { locale: zhCn })
  })()

  try {
    await installPromise
  } catch (error) {
    installPromise = null
    throw error
  }
}

export async function installElementPlusForRoute(path: string): Promise<void> {
  if (path.startsWith('/admin')) {
    await Promise.all([installElementPlus(), import('@/styles/admin-theme.css')])
    return
  }
  if (path === '/login' || path === '/register') {
    return installElementPlus()
  }
  return Promise.resolve()
}
