<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createLibraryFolder, deleteLibraryEntry, downloadLibraryEntry, getLibraryEntries,
  getLibraryStatus, libraryErrorMessage, restoreLibraryEntry, updateLibraryEntry,
  type LibraryEntry, type LibraryStatus,
} from '@/api/library'
import { formatFileSize } from '@/utils/format'
import { createLibraryUploader } from './library-upload'

interface Crumb { id: string | null; name: string }
type Modal = 'create' | 'rename' | 'move' | 'delete' | null
const root: Crumb = { id: null, name: '全部文件' }
const trail = ref<Crumb[]>([root])
const trash = ref(false)
const parentId = computed(() => trail.value[trail.value.length - 1]!.id)
const items = ref<LibraryEntry[]>([])
const status = ref<LibraryStatus | null>(null)
const loading = ref(false)
const statusLoading = ref(false)
const error = ref('')
const statusError = ref('')
const notice = ref('')
const actionBusy = ref(false)
const downloading = ref<string | null>(null)
const modal = ref<Modal>(null)
const modalElement = ref<HTMLElement>()
const editEntry = ref<LibraryEntry | null>(null)
const name = ref('')
const modalError = ref('')
const pickerTrail = ref<Crumb[]>([root])
const pickerFolders = ref<LibraryEntry[]>([])
const pickerLoading = ref(false)
const pickerReady = ref(false)
const pickerParent = computed(() => pickerTrail.value[pickerTrail.value.length - 1]!.id)
const dialogTitle = computed(() => ({ create: '新建文件夹', rename: '重命名', move: '移动', delete: '移入回收站' })[modal.value ?? 'create'])
const quotaPercent = computed(() => status.value && status.value.quota_bytes > 0 ? Math.min(100, status.value.used_bytes / status.value.quota_bytes * 100) : 0)
const uploadLocation = ref('')
let opener: HTMLElement | null = null
let listController: AbortController | null = null
let pickerController: AbortController | null = null
let downloadController: AbortController | null = null
const lifecycle = new AbortController()
const uploader = createLibraryUploader({
  onComplete(entry) {
    notice.value = `已上传 ${entry.name}`
    void refresh()
  },
})
const upload = uploader.state
const uploadPercent = computed(() => upload.phase === 'completed' ? 100 : upload.size > 0 ? Math.min(100, Math.floor(upload.uploadedBytes / upload.size * 100)) : 0)
const uploadLabel = computed(() => ({ idle: '等待上传', fingerprinting: '正在校验文件采样指纹', uploading: '正在上传', completing: '正在完成入库', paused: '已暂停，请重新选择原文件继续', error: '上传未完成，续传会话已保留', cancelling: '正在取消并清理分片', completed: '上传完成' })[upload.phase] ?? upload.phase)

async function loadEntries() {
  listController?.abort()
  const controller = new AbortController()
  listController = controller
  loading.value = true
  error.value = ''
  items.value = []
  try {
    const response = await getLibraryEntries(trash.value ? null : parentId.value, trash.value, controller.signal)
    if (!controller.signal.aborted) items.value = response.data.items
  } catch (cause) {
    if (!controller.signal.aborted) error.value = libraryErrorMessage(cause, '无法读取文件，请刷新重试')
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

async function loadStatus() {
  statusLoading.value = true
  statusError.value = ''
  try {
    status.value = (await getLibraryStatus(lifecycle.signal)).data
  } catch (cause) {
    if (!lifecycle.signal.aborted) statusError.value = libraryErrorMessage(cause, '无法读取存储配额')
  } finally { statusLoading.value = false }
}

async function refresh() { await Promise.all([loadEntries(), loadStatus()]) }
function openFolder(entry: LibraryEntry) {
  trail.value.push({ id: entry.id, name: entry.name })
  void loadEntries()
}
function navigate(index: number) {
  trail.value = trail.value.slice(0, index + 1)
  void loadEntries()
}
function switchTrash(value: boolean) {
  trash.value = value
  void loadEntries()
}

async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // Reselecting the same file must fire change after a pause.
  if (!file || upload.busy || upload.phase === 'cancelling') return
  error.value = ''
  notice.value = ''
  if (!upload.saved) {
    if (!status.value || statusError.value) { error.value = '请先刷新并读取存储配额'; return }
    if (file.size > status.value.max_file_bytes) { error.value = `文件超过单文件限制 ${formatFileSize(status.value.max_file_bytes)}`; return }
    if (file.size > Math.max(0, status.value.quota_bytes - status.value.used_bytes)) { error.value = '剩余存储空间不足'; return }
    uploadLocation.value = trail.value.map(crumb => crumb.name).join(' / ')
  }
  await uploader.start(file, parentId.value)
}

async function download(entry: LibraryEntry) {
  if (downloading.value) return
  downloading.value = entry.id
  downloadController = new AbortController()
  error.value = ''
  try { await downloadLibraryEntry(entry, downloadController.signal) }
  catch (cause) {
    if (!lifecycle.signal.aborted) {
      if (downloadController.signal.aborted || (cause as { name?: string })?.name === 'AbortError') notice.value = '已取消下载'
      else error.value = libraryErrorMessage(cause, '下载失败，请重试')
    }
  }
  finally { downloading.value = null; downloadController = null }
}
function cancelDownload() { downloadController?.abort() }

async function loadPicker() {
  pickerController?.abort()
  const controller = new AbortController()
  pickerController = controller
  pickerLoading.value = true
  pickerReady.value = false
  pickerFolders.value = []
  modalError.value = ''
  try {
    const response = await getLibraryEntries(pickerParent.value, false, controller.signal)
    if (!controller.signal.aborted) {
      pickerFolders.value = response.data.items.filter(entry => entry.kind === 'folder' && entry.id !== editEntry.value?.id)
      pickerReady.value = true
    }
  } catch (cause) {
    if (!controller.signal.aborted) modalError.value = libraryErrorMessage(cause, '无法读取目标文件夹')
  } finally { if (!controller.signal.aborted) pickerLoading.value = false }
}

async function openModal(type: Exclude<Modal, null>, entry?: LibraryEntry) {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  modal.value = type
  editEntry.value = entry ?? null
  name.value = type === 'rename' ? entry!.name : ''
  modalError.value = ''
  if (type === 'move') {
    pickerTrail.value = [root]
    void loadPicker()
  }
  await nextTick()
  const focusTarget = modalElement.value?.querySelector<HTMLElement>('input, button')
  focusTarget?.focus()
}

function closeModal() {
  if (actionBusy.value) return
  pickerController?.abort()
  modal.value = null
  opener?.focus()
}
function modalKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeModal() }
  if (event.key !== 'Tab') return
  const controls = modalElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')
  const first = controls?.[0]
  const last = controls?.[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function pickerOpen(entry: LibraryEntry) {
  pickerTrail.value.push({ id: entry.id, name: entry.name })
  void loadPicker()
}
function pickerNavigate(index: number) {
  pickerTrail.value = pickerTrail.value.slice(0, index + 1)
  void loadPicker()
}

async function submitModal() {
  if (actionBusy.value || !modal.value) return
  const type = modal.value
  const entry = editEntry.value
  const value = name.value.trim()
  if ((type === 'create' || type === 'rename') && !value) { modalError.value = '名称不能为空'; return }
  if (type === 'move' && (!pickerReady.value || pickerLoading.value || pickerParent.value === entry?.parent_id)) return
  actionBusy.value = true
  modalError.value = ''
  try {
    if (type === 'create') await createLibraryFolder({ name: value, parent_id: parentId.value }, lifecycle.signal)
    else if (type === 'rename') await updateLibraryEntry(entry!.id, { name: value }, lifecycle.signal)
    else if (type === 'move') await updateLibraryEntry(entry!.id, { parent_id: pickerParent.value }, lifecycle.signal)
    else await deleteLibraryEntry(entry!.id, lifecycle.signal)
    actionBusy.value = false
    closeModal()
    notice.value = type === 'delete' ? '已移入回收站，可在回收站恢复' : '操作成功'
    await refresh()
  } catch (cause) {
    if (!lifecycle.signal.aborted) modalError.value = libraryErrorMessage(cause)
  } finally { actionBusy.value = false }
}

async function restore(entry: LibraryEntry) {
  if (actionBusy.value) return
  actionBusy.value = true
  error.value = ''
  try {
    await restoreLibraryEntry(entry.id, lifecycle.signal)
    notice.value = `已恢复 ${entry.name}`
    await refresh()
  } catch (cause) { if (!lifecycle.signal.aborted) error.value = libraryErrorMessage(cause, '恢复失败') }
  finally { actionBusy.value = false }
}
function displayDate(value: string) { return new Date(value).toLocaleString('zh-CN') }

onMounted(refresh)
onBeforeUnmount(() => {
  lifecycle.abort()
  listController?.abort()
  pickerController?.abort()
  downloadController?.abort()
  uploader.dispose()
})
</script>

<template>
  <section class="library-page" aria-labelledby="library-heading">
    <header class="library-header">
      <div><h1 id="library-heading">私有文件库</h1><p>管理原件与素材，仅管理员可访问。</p></div>
      <button type="button" :disabled="loading || statusLoading" @click="refresh">刷新</button>
    </header>

    <section class="library-card storage-status" aria-label="存储配额">
      <template v-if="status">
        <div class="quota-heading"><strong>{{ formatFileSize(status.used_bytes) }} / {{ formatFileSize(status.quota_bytes) }}</strong><span>已用空间（含回收站）</span></div>
        <progress aria-label="存储使用率" :value="quotaPercent" max="100" />
        <p>单文件上限 {{ formatFileSize(status.max_file_bytes) }} · 分片 {{ formatFileSize(status.chunk_size) }}</p>
      </template>
      <p v-else>正在读取存储配额…</p>
      <p v-if="statusError" role="alert" class="error">{{ statusError }}</p>
    </section>

    <section class="library-card upload-card" aria-label="文件上传">
      <div class="upload-heading">
        <div><h2>上传文件</h2><p>{{ upload.saved ? '已保存续传会话；选择原文件核对采样指纹后继续，目标沿用原会话文件夹。' : `上传到：${trail.map(crumb => crumb.name).join(' / ')}` }}</p></div>
        <label class="file-select" :class="{ disabled: upload.busy || trash || upload.phase === 'cancelling' }">
          <span>{{ upload.saved ? '重新选择原文件并续传' : '选择文件上传' }}</span>
          <input type="file" :aria-label="upload.saved ? '重新选择原文件并续传' : '选择文件上传'" :disabled="upload.busy || trash || upload.phase === 'cancelling' || (!upload.saved && (!status || !!statusError))" @change="selectFile" />
        </label>
      </div>
      <p class="muted">续传使用文件名、大小、修改时间与 SHA-256 采样指纹识别原文件。</p>
      <template v-if="upload.phase !== 'idle' || upload.saved">
        <p role="status" aria-live="polite">{{ uploadLabel }}<span v-if="upload.name"> · {{ upload.name }}</span></p>
        <p v-if="uploadLocation" class="muted">本次上传位置：{{ uploadLocation }}</p>
        <progress aria-label="上传进度" :value="uploadPercent" max="100" />
        <p>{{ uploadPercent }}% · {{ formatFileSize(upload.uploadedBytes) }} / {{ formatFileSize(upload.size) }}</p>
        <p v-if="upload.expiresAt" class="muted">会话有效期至 {{ displayDate(upload.expiresAt) }}</p>
        <div class="upload-actions">
          <button v-if="upload.busy && upload.phase !== 'cancelling'" type="button" @click="uploader.pause">暂停上传</button>
          <button v-if="upload.saved || (upload.busy && upload.phase !== 'cancelling')" type="button" :disabled="upload.phase === 'cancelling'" @click="uploader.cancel">取消上传并清理</button>
        </div>
      </template>
      <p v-if="upload.error" role="alert" class="error">{{ upload.error }}</p>
    </section>

    <section class="library-card file-browser" :aria-busy="loading" aria-label="文件浏览器">
      <div class="browser-toolbar">
        <nav aria-label="文件库视图" class="view-switch">
          <button type="button" :aria-pressed="!trash" @click="switchTrash(false)">文件库</button>
          <button type="button" :aria-pressed="trash" @click="switchTrash(true)">回收站</button>
        </nav>
        <button v-if="!trash" type="button" :disabled="loading || !!error || actionBusy" @click="openModal('create')">新建文件夹</button>
      </div>
      <nav v-if="!trash" aria-label="当前文件夹" class="breadcrumbs">
        <template v-for="(crumb, index) in trail" :key="crumb.id ?? 'root'">
          <span v-if="index" aria-hidden="true">/</span>
          <button v-if="index < trail.length - 1" type="button" @click="navigate(index)">{{ crumb.name }}</button>
          <span v-else aria-current="page">{{ crumb.name }}</span>
        </template>
      </nav>
      <p v-else class="muted">删除的文件和文件夹仍占用配额。恢复后回到原文件夹。</p>
      <p class="muted">支持流式保存时，选择保存位置后直接写入磁盘；其余浏览器仅支持不超过 128 MiB 的普通下载。</p>
      <button v-if="downloading" type="button" @click="cancelDownload">取消下载</button>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status" aria-live="polite" class="notice">{{ notice }}</p>
      <p v-if="loading" role="status">正在加载…</p>
      <p v-else-if="!items.length && !error" class="empty">{{ trash ? '回收站为空' : '当前文件夹为空' }}</p>
      <div v-if="items.length" class="table-scroll">
        <table>
          <caption class="sr-only">{{ trash ? '回收站项目' : '当前文件夹项目' }}</caption>
          <thead><tr><th scope="col">名称</th><th scope="col">大小</th><th scope="col">{{ trash ? '删除时间' : '创建时间' }}</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="entry in items" :key="entry.id">
              <td class="entry-name"><span class="kind">{{ entry.kind === 'folder' ? '文件夹' : '文件' }}</span><button v-if="entry.kind === 'folder' && !trash" type="button" class="folder-link" @click="openFolder(entry)">{{ entry.name }}</button><span v-else>{{ entry.name }}</span></td>
              <td>{{ entry.kind === 'folder' ? '—' : formatFileSize(entry.size) }}</td>
              <td>{{ displayDate((trash ? entry.deleted_at : entry.created_at) ?? entry.created_at) }}</td>
              <td><div class="entry-actions">
                <button v-if="trash" type="button" :aria-label="`恢复 ${entry.name}`" :disabled="actionBusy" @click="restore(entry)">恢复</button>
                <template v-else>
                  <button v-if="entry.kind === 'file'" type="button" :aria-label="`下载 ${entry.name}`" :disabled="!!downloading" @click="download(entry)">{{ downloading === entry.id ? '下载中…' : '下载' }}</button>
                  <button type="button" :aria-label="`重命名 ${entry.name}`" :disabled="actionBusy" @click="openModal('rename', entry)">重命名</button>
                  <button type="button" :aria-label="`移动 ${entry.name}`" :disabled="actionBusy" @click="openModal('move', entry)">移动</button>
                  <button type="button" class="danger" :aria-label="`移入回收站 ${entry.name}`" :disabled="actionBusy" @click="openModal('delete', entry)">移入回收站</button>
                </template>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="modal" class="modal-backdrop" @click.self="closeModal">
      <section ref="modalElement" class="library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-dialog-title" @keydown="modalKeys">
        <h2 id="library-dialog-title">{{ dialogTitle }}</h2>
        <form :aria-label="dialogTitle" @submit.prevent="submitModal">
          <template v-if="modal === 'create' || modal === 'rename'">
            <label for="library-name">{{ modal === 'create' ? '文件夹名称' : '新名称' }}</label>
            <input id="library-name" v-model="name" :aria-label="modal === 'create' ? '文件夹名称' : '新名称'" maxlength="255" required :disabled="actionBusy" />
          </template>
          <div v-else-if="modal === 'move'" aria-label="目标文件夹">
            <p>移动「{{ editEntry?.name }}」到：</p>
            <nav aria-label="目标文件夹路径" class="breadcrumbs"><template v-for="(crumb, index) in pickerTrail" :key="crumb.id ?? 'root'"><span v-if="index" aria-hidden="true">/</span><button type="button" :disabled="actionBusy" @click="pickerNavigate(index)">{{ crumb.name }}</button></template></nav>
            <p v-if="pickerLoading" role="status">正在加载文件夹…</p>
            <ul v-else class="picker-list"><li v-for="folder in pickerFolders" :key="folder.id"><button type="button" :aria-label="`打开目标文件夹 ${folder.name}`" :disabled="actionBusy" @click="pickerOpen(folder)">{{ folder.name }} /</button></li></ul>
            <p v-if="pickerReady && !pickerFolders.length" class="muted">此处没有子文件夹，可以选择当前位置。</p>
            <button v-if="!pickerReady && !pickerLoading" type="button" @click="loadPicker">重试读取文件夹</button>
          </div>
          <p v-else>确定将「{{ editEntry?.name }}」{{ editEntry?.kind === 'folder' ? '及其内容' : '' }}移入回收站？之后可以恢复。</p>
          <p v-if="modalError" role="alert" class="error">{{ modalError }}</p>
          <div class="dialog-actions">
            <button type="button" :disabled="actionBusy" @click="closeModal">取消</button>
            <button type="submit" class="primary" :disabled="actionBusy || (modal === 'move' && (!pickerReady || pickerLoading || pickerParent === editEntry?.parent_id))">{{ actionBusy ? '正在保存…' : modal === 'delete' ? '确认移入回收站' : modal === 'move' ? '移动到此文件夹' : '保存' }}</button>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>

<style scoped>
.library-page { max-width: 1280px; color: #303133; }
.library-header, .upload-heading, .browser-toolbar, .quota-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.library-header { margin-bottom: 24px; }
h1 { margin: 0; font-size: 24px; font-weight: 600; }
h2 { margin: 0 0 8px; font-size: 17px; }
p { margin: 8px 0; line-height: 1.6; }
.library-header p, .upload-heading p, .storage-status p, .muted { color: #606266; font-size: 13px; }
.library-card { padding: 20px; margin-bottom: 20px; background: #fff; border: 1px solid #dcdfe6; border-radius: 8px; }
button, .file-select { min-height: 36px; padding: 7px 12px; color: #303133; background: #fff; border: 1px solid #c0c4cc; border-radius: 5px; font: inherit; font-size: 14px; cursor: pointer; }
button:hover:not(:disabled), .file-select:hover:not(.disabled) { color: #1765b0; border-color: #409eff; background: #ecf5ff; }
button:disabled, .disabled { color: #606266; background: #f5f7fa; cursor: not-allowed; }
button:focus-visible, input:focus-visible, .file-select:focus-within { outline: 3px solid #409eff; outline-offset: 3px; }
.primary, .file-select { background: #1765b0; color: white; border-color: #1765b0; }
.file-select { position: relative; display: inline-flex; align-items: center; overflow: hidden; }
.file-select input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.file-select input:disabled { cursor: not-allowed; }
progress { display: block; width: 100%; height: 12px; accent-color: #1765b0; margin: 12px 0; }
.quota-heading span { color: #606266; font-size: 13px; }
.upload-actions, .entry-actions, .view-switch, .dialog-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.view-switch [aria-pressed="true"] { background: #ecf5ff; color: #1765b0; border-color: #1765b0; }
.breadcrumbs { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 18px 0; overflow-wrap: anywhere; }
.breadcrumbs button, .folder-link { padding: 4px 6px; background: transparent; border-color: transparent; color: #1765b0; }
.table-scroll { overflow-x: auto; }
table { width: 100%; min-width: 650px; border-collapse: collapse; font-size: 14px; }
th, td { padding: 14px 10px; text-align: left; border-bottom: 1px solid #ebeef5; }
th { color: #606266; font-weight: 600; background: #f5f7fa; }
.entry-name { min-width: 180px; max-width: 360px; overflow-wrap: anywhere; }
.kind { display: block; font-size: 12px; color: #606266; margin-bottom: 4px; }
.entry-actions { min-width: 220px; }
.entry-actions button { min-height: 32px; padding: 4px 8px; font-size: 13px; }
.danger, .error { color: #b42318; }
.error { padding: 10px 12px; background: #fff1f0; border-radius: 5px; overflow-wrap: anywhere; }
.notice { color: #206625; }
.empty { padding: 36px 0; color: #606266; text-align: center; }
.modal-backdrop { position: fixed; inset: 0; z-index: 2100; background: #0006; display: flex; justify-content: center; align-items: center; padding: 20px; }
.library-dialog { width: min(100%, 520px); max-height: 85vh; overflow: auto; padding: 24px; background: white; border-radius: 10px; box-shadow: 0 12px 40px #0003; }
.library-dialog h2 { margin-bottom: 20px; }
.library-dialog label { display: block; margin-bottom: 8px; }
.library-dialog input { box-sizing: border-box; width: 100%; padding: 10px; border: 1px solid #c0c4cc; border-radius: 5px; font: inherit; }
.dialog-actions { justify-content: flex-end; margin-top: 24px; }
.picker-list { list-style: none; padding: 0; margin: 12px 0; max-height: 250px; overflow: auto; }
.picker-list button { width: 100%; text-align: left; margin-bottom: 6px; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 600px) { .library-card { padding: 14px; } .library-header { align-items: flex-start; } .upload-heading { align-items: flex-start; } .file-select { width: 100%; justify-content: center; } .library-dialog { padding: 20px; } }
</style>
