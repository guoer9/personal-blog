<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { transferDownloadUrl, lookupTransfer, transferErrorMessage } from '@/api/transfers'
import type { TransferLookup } from '@/api/transfers'
import { createTransferUploader, MAX_TRANSFER_BYTES } from './transfer-upload'

const uploader = createTransferUploader()
const { state } = uploader
const selectedFile = ref<File | null>(null)
const lookupCode = ref('')
const lookupResult = ref<TransferLookup | null>(null)
const lookupError = ref('')
const lookupBusy = ref(false)
const copyMessage = ref('')
const downloadHref = ref('')
let lookupController: AbortController | null = null
const maxBytes = computed(() => state.config?.max_file_bytes ?? MAX_TRANSFER_BYTES)
const retentionSeconds = computed(() => state.config?.retention_seconds ?? 6 * 60 * 60)
const retentionLabel = computed(() => {
  const hours = retentionSeconds.value / 3600
  if (Number.isInteger(hours)) return `${hours} 小时`
  const minutes = retentionSeconds.value / 60
  if (Number.isInteger(minutes)) return `${minutes} 分钟`
  return `${retentionSeconds.value} 秒`
})
const progressPercent = computed(() => state.size > 0 ? Math.min(100, Math.floor(state.uploadedBytes / state.size * 100)) : 0)
const canSelectFile = computed(() => !state.busy && !!state.config && state.phase !== 'completed' && state.phase !== 'cancelling')
const canStart = computed(() => !!selectedFile.value && !state.busy && !!state.config && state.phase !== 'completed')
const canPause = computed(() => state.busy && !!state.saved && state.phase !== 'cancelling')
const canCancel = computed(() => !!state.saved && state.phase !== 'cancelling')
const formattedExpiry = computed(() => state.expiresAt && Number.isFinite(Date.parse(state.expiresAt))
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.expiresAt))
  : '')

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = -1
  do { value /= 1024; unit++ } while (value >= 1024 && unit < units.length - 1)
  return `${Number(value.toFixed(value >= 10 ? 0 : 1))} ${units[unit]}`
}
function formatDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('服务器返回的到期时间无效，请稍后重试。')
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}
function onFileChange(event: Event) {
  selectedFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
  copyMessage.value = ''
  state.error = ''
}
async function startUpload() {
  if (!selectedFile.value) return
  await uploader.start(selectedFile.value)
}
function pauseUpload() { uploader.pause() }
async function cancelUpload() {
  await uploader.cancel()
  if (state.phase === 'idle') selectedFile.value = null
}
async function copyCode() {
  if (!state.saved?.code) return
  try {
    if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持剪贴板，请手动选择并复制取件码。')
    await navigator.clipboard.writeText(state.saved.code)
    copyMessage.value = '取件码已复制。'
  } catch (error) {
    copyMessage.value = error instanceof Error ? error.message : '复制失败，请手动选择取件码。'
  }
}
function clearLookup() {
  lookupController?.abort()
  lookupController = null
  lookupBusy.value = false
  lookupResult.value = null
  downloadHref.value = ''
  lookupError.value = ''
}
watch(lookupCode, clearLookup)
async function findTransfer() {
  const code = lookupCode.value.trim()
  if (!code || lookupBusy.value) return
  clearLookup()
  const current = new AbortController()
  lookupController = current
  lookupBusy.value = true
  lookupError.value = ''
  try {
    const response = await lookupTransfer(code, current.signal)
    if (current.signal.aborted) return
    if (!response.data.filename || !Number.isSafeInteger(response.data.size) || response.data.size < 0) throw new Error('服务器返回的文件信息无效，请重新查找。')
    const href = transferDownloadUrl(response.data.download_url)
    formatDate(response.data.expires_at)
    lookupResult.value = response.data
    downloadHref.value = href
  } catch (error) {
    if (!current.signal.aborted) lookupError.value = transferErrorMessage(error, '暂时无法查找文件，请检查取件码后重试。')
  } finally {
    if (lookupController === current) {
      lookupController = null
      lookupBusy.value = false
    }
  }
}
function cancelLookup() {
  lookupController?.abort()
  lookupController = null
  lookupBusy.value = false
}

onMounted(() => { void uploader.initialize() })
onBeforeUnmount(() => {
  lookupController?.abort()
  uploader.dispose()
})
</script>

<template>
  <div class="transfer-page page-stage page-shell">
    <header class="simple-page-header">
      <router-link to="/" class="back-link">← 返回首页 / HOME</router-link>
      <p class="section-kicker">A small bridge / 临时传输</p>
      <h1>Send a file.<br /><em>Keep it moving.</em></h1>
      <p class="page-lede">上传后分享取件码。传输完成后文件限时保留，任何人都不能浏览公开文件列表。</p>
    </header>

    <div class="transfer-policy" aria-label="传输限制">
      <p><span>单文件上限</span><strong>最多 10 GiB（10 × 1024³ = 10,737,418,240 字节）</strong><small>当前服务限制：{{ formatBytes(maxBytes) }}（{{ maxBytes.toLocaleString('en-US') }} 字节）</small></p>
      <p><span>保留时间</span><strong>完成后 {{ retentionLabel }}</strong><small>请及时把取件码交给接收者。</small></p>
      <p><span>分片传输</span><strong>最多 8 MiB 一片</strong><small>浏览器逐片读取，可暂停并在刷新后续传。</small></p>
    </div>

    <div v-if="state.configError" class="transfer-error transfer-config-error" role="alert">
      <p>{{ state.configError }}</p>
      <button class="text-action" type="button" :disabled="state.busy" @click="uploader.initialize">重试读取限制</button>
    </div>
    <p v-else-if="state.loadingConfig" class="transfer-status" role="status" aria-live="polite">正在读取当前传输限制…</p>

    <div class="transfer-grid">
      <section class="transfer-panel" aria-labelledby="upload-title">
        <div class="panel-heading">
          <p class="eyebrow">01 / SEND</p>
          <h2 id="upload-title">发送文件</h2>
          <p>选择文件后开始上传。刷新页面后，重新选择同一文件即可继续。</p>
        </div>
        <form aria-label="上传文件" @submit.prevent="startUpload">
          <label class="file-picker" for="transfer-file">
            <span class="file-picker-mark" aria-hidden="true">＋</span>
            <span><strong>{{ selectedFile?.name || '选择一个文件' }}</strong><small>{{ selectedFile ? formatBytes(selectedFile.size) : '单个文件，不超过当前服务上限' }}</small></span>
          </label>
          <input id="transfer-file" class="file-input" type="file" :disabled="!canSelectFile" aria-describedby="file-help" @change="onFileChange" />
          <p id="file-help" class="field-help">上传过程中可以暂停。浏览器会用文件内容样本和修改时间核对续传文件。</p>
          <p v-if="state.error" class="transfer-error" role="alert">{{ state.error }}</p>
          <div v-if="state.size > 0 && (state.busy || state.phase === 'paused' || state.phase === 'error' || state.phase === 'completed')" class="upload-progress">
            <div class="progress-label"><span role="status" aria-live="polite">{{ state.phase === 'completed' ? '传输完成' : state.phase === 'paused' ? '已暂停' : state.phase === 'completing' ? '正在完成传输…' : state.phase === 'fingerprinting' ? '正在核对文件…' : state.phase === 'checking' ? '正在检查续传…' : state.phase === 'cancelling' ? '正在取消…' : '正在上传' }}</span><span>{{ progressPercent }}%</span></div>
            <progress aria-label="上传进度" :value="state.uploadedBytes" :max="state.size" />
            <p class="progress-detail">已确认 {{ formatBytes(state.receivedBytes) }} / {{ formatBytes(state.size) }}<template v-if="state.expiresAt"> · 到期 {{ formattedExpiry }}</template></p>
          </div>
          <div class="upload-actions">
            <button class="editorial-button editorial-button--acid" type="submit" :disabled="!canStart">{{ state.saved ? '继续上传' : '开始上传' }} <span aria-hidden="true">↗</span></button>
            <button v-if="canPause" class="text-action" type="button" @click="pauseUpload">暂停上传</button>
            <button v-if="canCancel" class="text-action cancel-action" type="button" :disabled="state.phase === 'cancelling'" @click="cancelUpload">取消并删除</button>
          </div>
        </form>

        <div v-if="state.phase === 'completed' && state.saved" class="completion-card" aria-labelledby="completion-title">
          <p class="eyebrow">READY TO SHARE</p>
          <h3 id="completion-title">取件码已准备好</h3>
          <label for="transfer-share-code">请把这段取件码发给接收者</label>
          <div class="code-row">
            <input id="transfer-share-code" aria-label="取件码" type="text" :value="state.saved.code" readonly @focus="($event.target as HTMLInputElement).select()" />
            <button class="editorial-button" type="button" @click="copyCode">复制取件码</button>
          </div>
          <p class="expiry-note">文件保留至 <time :datetime="state.expiresAt">{{ formattedExpiry }}</time>。</p>
          <p class="copy-status" role="status" aria-live="polite">{{ copyMessage }}</p>
        </div>
      </section>

      <section class="transfer-panel lookup-panel" aria-labelledby="lookup-title">
        <div class="panel-heading">
          <p class="eyebrow">02 / RECEIVE</p>
          <h2 id="lookup-title">接收文件</h2>
          <p>输入分享者给你的取件码。查找成功后会跳转到浏览器原生下载。</p>
        </div>
        <form aria-label="取件" @submit.prevent="findTransfer">
          <label class="field-label" for="transfer-code">取件码</label>
          <input id="transfer-code" v-model="lookupCode" class="code-entry" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="输入取件码" placeholder="输入取件码" />
          <p v-if="lookupError" class="transfer-error" role="alert">{{ lookupError }}</p>
          <div class="lookup-actions">
            <button class="editorial-button editorial-button--acid" type="submit" :disabled="!lookupCode.trim() || lookupBusy">{{ lookupBusy ? '正在查找…' : '查找文件' }} <span aria-hidden="true">↗</span></button>
            <button v-if="lookupBusy" class="text-action" type="button" @click="cancelLookup">取消查找</button>
          </div>
        </form>
        <div v-if="lookupResult && downloadHref" class="lookup-result" role="status" aria-live="polite">
          <p class="eyebrow">FILE READY</p>
          <h3>{{ lookupResult.filename }}</h3>
          <p>{{ formatBytes(lookupResult.size) }} · 到期 {{ formatDate(lookupResult.expires_at) }}</p>
          <a class="editorial-button editorial-button--acid" :href="downloadHref" :download="lookupResult.filename" referrerpolicy="no-referrer">下载文件 <span aria-hidden="true">↓</span></a>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.transfer-page { padding-bottom: 8px; }
.transfer-page .simple-page-header h1 em { color: var(--electric-blue); font-weight: 400; }
.transfer-policy { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--line); }
.transfer-policy > p { display: grid; gap: 5px; min-width: 0; padding: 22px 20px 22px 0; margin: 0; }
.transfer-policy > p + p { padding-left: 20px; border-left: 1px solid var(--line); }
.transfer-policy span, .transfer-policy small, .field-help, .progress-detail, .expiry-note, .lookup-result > p:not(.eyebrow) { color: var(--muted); font-size: .77rem; }
.transfer-policy span, .transfer-panel .eyebrow { font: .62rem var(--mono-font); letter-spacing: .08em; text-transform: uppercase; }
.transfer-policy strong { font-size: .88rem; }
.transfer-policy small { overflow-wrap: anywhere; }
.transfer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; padding-top: 40px; }
.transfer-panel { min-width: 0; padding: clamp(21px, 3.5vw, 38px); border: 1px solid var(--line); }
.panel-heading { padding-bottom: 24px; border-bottom: 1px solid var(--line); }
.panel-heading .eyebrow, .completion-card .eyebrow, .lookup-result .eyebrow { margin-bottom: 12px; color: var(--muted); }
.panel-heading h2 { margin-bottom: 8px; font: 400 clamp(2rem, 4vw, 2.8rem)/1 var(--display-font); letter-spacing: -.045em; }
.panel-heading > p:last-child { max-width: 440px; margin-bottom: 0; color: var(--muted); font-size: .85rem; }
.file-picker { display: flex; align-items: center; gap: 16px; min-height: 92px; margin-top: 24px; padding: 16px; border: 1px dashed var(--line); cursor: pointer; }
.file-picker:hover { background: var(--paper-soft); }
.file-picker-mark { display: grid; place-items: center; flex: 0 0 42px; width: 42px; height: 42px; border: 1px solid var(--line); font: 1.5rem var(--body-font); }
.file-picker strong, .file-picker small { display: block; overflow-wrap: anywhere; }
.file-picker small { margin-top: 3px; color: var(--muted); font-size: .75rem; }
.file-input { display: block; width: 100%; min-height: 44px; margin-top: 10px; color: var(--ink); font-size: .75rem; }
.file-input::file-selector-button { min-height: 42px; margin-right: 12px; padding: 0 14px; border: 1px solid var(--ink); background: transparent; color: var(--ink); font: .66rem var(--mono-font); cursor: pointer; }
.file-input:disabled { opacity: .55; }
.field-help { margin: 9px 0 0; }
.transfer-error { color: #9a2d18; font-size: .85rem; }
.transfer-config-error { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 0; border-bottom: 1px solid var(--line); }
.transfer-config-error p { margin: 0; }
.transfer-status { padding: 15px 0; color: var(--muted); }
.upload-progress { margin-top: 22px; }
.progress-label { display: flex; justify-content: space-between; gap: 12px; font-size: .77rem; }
.progress-label > span:last-child { font-family: var(--mono-font); }
.upload-progress progress { display: block; width: 100%; height: 8px; margin-top: 10px; accent-color: var(--electric-blue); }
.progress-detail { margin: 8px 0 0; }
.upload-actions, .lookup-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 22px; }
.upload-actions .editorial-button, .lookup-actions .editorial-button { min-height: 48px; }
.text-action { color: var(--ink); cursor: pointer; }
.text-action:disabled { opacity: .6; cursor: wait; }
.cancel-action { color: #87341f; }
.completion-card, .lookup-result { margin-top: 28px; padding: 22px; border: 1px solid var(--line); background: rgba(233, 230, 223, .58); }
.completion-card h3, .lookup-result h3 { margin: 0 0 14px; font: 400 1.65rem/1.15 var(--display-font); overflow-wrap: anywhere; }
.completion-card > label, .field-label { display: block; margin-bottom: 8px; color: var(--muted); font-size: .77rem; }
.code-row { display: flex; align-items: stretch; gap: 8px; }
.code-row input, .code-entry { min-width: 0; min-height: 48px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink); font: .88rem var(--mono-font); }
.code-row input { flex: 1; font-weight: 700; letter-spacing: .08em; }
.code-row .editorial-button { padding: 0 13px; white-space: nowrap; cursor: pointer; }
.expiry-note { margin: 12px 0 0; }
.expiry-note time { color: var(--ink); }
.copy-status { min-height: 1.5em; margin: 5px 0 0; color: var(--muted); font-size: .77rem; }
.code-entry { display: block; width: 100%; }
.lookup-result > p:not(.eyebrow) { overflow-wrap: anywhere; }
.lookup-result > .editorial-button { width: fit-content; margin-top: 6px; }
@media (max-width: 760px) {
  .transfer-policy { grid-template-columns: 1fr; }
  .transfer-policy > p { padding: 15px 0; }
  .transfer-policy > p + p { padding-left: 0; border-top: 1px solid var(--line); border-left: 0; }
  .transfer-grid { grid-template-columns: 1fr; gap: 16px; padding-top: 24px; }
  .transfer-panel { padding: 20px; }
}
@media (max-width: 440px) {
  .code-row { flex-direction: column; }
  .code-row .editorial-button { width: 100%; }
  .upload-actions { align-items: flex-start; flex-direction: column; gap: 13px; }
  .transfer-config-error { align-items: flex-start; flex-direction: column; }
}
</style>
