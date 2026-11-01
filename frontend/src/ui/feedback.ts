import {
  getElementPlusApp,
  installElementPlus,
  waitForElementPlusApp,
} from './element-plus'

type MessageKind = 'success' | 'warning' | 'info' | 'error'
let installationPromise: Promise<void> | null = null
let elementPlusPromise: Promise<typeof import('element-plus')> | null = null

function loadElementPlus() {
  if (!elementPlusPromise) elementPlusPromise = import('element-plus')
  return elementPlusPromise
}

async function ensureInstalled() {
  if (!installationPromise) {
    installationPromise = (async () => {
      const app = getElementPlusApp() || await waitForElementPlusApp()
      await installElementPlus(app)
    })()
  }
  try {
    await installationPromise
  } catch (error) {
    installationPromise = null
    throw error
  }
}

export async function showMessage(kind: MessageKind, message: string): Promise<void> {
  await ensureInstalled()
  const { ElMessage } = await loadElementPlus()
  ElMessage[kind](message)
}

export function showSuccess(message: string): Promise<void> {
  return showMessage('success', message)
}

export function showWarning(message: string): Promise<void> {
  return showMessage('warning', message)
}

export function showInfo(message: string): Promise<void> {
  return showMessage('info', message)
}

export function showError(message: string): Promise<void> {
  return showMessage('error', message)
}

export async function confirmAction(message: string, title: string): Promise<boolean> {
  await ensureInstalled()
  const { ElMessageBox } = await loadElementPlus()
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    return true
  } catch (error) {
    if (error === 'cancel' || error === 'close') return false
    throw error
  }
}
