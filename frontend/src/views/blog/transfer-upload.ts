import { reactive } from 'vue'
import * as transfers from '@/api/transfers'
import type { TransferConfig, TransferCreate, TransferSession, TransferStatus } from '@/api/transfers'
import type { AxiosProgressEvent } from 'axios'

export const TRANSFER_UPLOAD_KEY = 'public-transfer-upload-v1'
export const MAX_TRANSFER_BYTES = 10 * 1024 ** 3
const MAX_CHUNK_BYTES = 8 * 1024 ** 2
interface SavedTransfer extends TransferSession { fingerprint: string; filename: string; size: number }
type UploadStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
interface UploadApi {
  getTransferConfig(signal?: AbortSignal): Promise<{ data: TransferConfig }>
  createTransferUpload(data: TransferCreate, signal?: AbortSignal): Promise<{ data: TransferSession }>
  getTransferUpload(id: string, token: string, signal?: AbortSignal): Promise<{ data: TransferStatus }>
  putTransferChunk(id: string, token: string, index: number, body: Blob, signal?: AbortSignal, progress?: (event: AxiosProgressEvent) => void): Promise<unknown>
  completeTransferUpload(id: string, token: string, signal?: AbortSignal): Promise<{ data: TransferStatus }>
  cancelTransferUpload(id: string, token: string, signal?: AbortSignal): Promise<unknown>
}
type Phase = 'idle' | 'checking' | 'fingerprinting' | 'uploading' | 'paused' | 'completing' | 'completed' | 'cancelling' | 'error'
const validChunk = (size: number) => Number.isSafeInteger(size) && size > 0 && size <= MAX_CHUNK_BYTES
const validDate = (value: string) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const responseStatus = (error: unknown) => (error as { response?: { status?: number } })?.response?.status

/** Resume identity only: metadata (including mtime) plus at most 192 KiB of sampled bytes. */
export async function fingerprintFile(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('文件校验需要 HTTPS 或 localhost 连接。')
  const length = Math.min(file.size, 65536)
  const offsets = [...new Set([0, Math.floor((file.size - length) / 2), file.size - length])]
  // Match Python json.dumps(..., separators=(',', ':')) used by the API helper.
  const serialized = JSON.stringify([file.name, file.size, file.lastModified, offsets])
    .replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const metadata = new TextEncoder().encode(serialized)
  const samples = await Promise.all(offsets.map(offset => file.slice(offset, offset + length).arrayBuffer()))
  const bytes = new Uint8Array(metadata.length + samples.reduce((total, sample) => total + sample.byteLength, 0))
  bytes.set(metadata)
  let cursor = metadata.length
  for (const sample of samples) { bytes.set(new Uint8Array(sample), cursor); cursor += sample.byteLength }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function createTransferUploader(options: { api?: UploadApi; storage?: UploadStorage } = {}) {
  const api = options.api ?? transfers
  let storage = options.storage
  try { storage ??= globalThis.localStorage } catch { /* Starting reports unavailable storage inline. */ }
  let saved: SavedTransfer | null = null
  try {
    const value = JSON.parse(storage?.getItem(TRANSFER_UPLOAD_KEY) ?? 'null')
    if (value && ['upload_id', 'upload_token', 'code', 'filename'].every(key => typeof value[key] === 'string' && value[key].length > 0)
      && /^sha256:[a-f0-9]{64}$/.test(value.fingerprint) && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= MAX_TRANSFER_BYTES
      && validChunk(value.chunk_bytes) && validDate(value.expires_at)) saved = value
  } catch { /* Malformed browser state cannot prevent a new upload. */ }
  const state = reactive({
    phase: (saved ? 'paused' : 'idle') as Phase,
    saved,
    config: null as TransferConfig | null,
    loadingConfig: false,
    configError: '',
    busy: false,
    name: saved?.filename ?? '',
    size: saved?.size ?? 0,
    receivedBytes: 0,
    uploadedBytes: 0,
    error: '',
    expiresAt: saved?.expires_at ?? '',
  })
  let controller: AbortController | null = null
  let task: Promise<void> | null = null
  let disposed = false

  function persist() {
    try { storage!.setItem(TRANSFER_UPLOAD_KEY, JSON.stringify(state.saved)) }
    catch { throw new Error('无法保存续传信息，请允许浏览器使用本地存储后重试；当前页面仍保留上传信息。') }
  }
  function forget() {
    storage?.removeItem(TRANSFER_UPLOAD_KEY)
    state.saved = null
  }
  async function loadConfig(signal: AbortSignal) {
    if (state.config) return
    state.loadingConfig = true
    state.configError = ''
    try {
      const { data } = await api.getTransferConfig(signal)
      signal.throwIfAborted()
      if (!Number.isSafeInteger(data.max_file_bytes) || data.max_file_bytes <= 0 || !validChunk(data.chunk_bytes)
        || !Number.isSafeInteger(data.retention_seconds) || data.retention_seconds <= 0) throw new Error('服务返回的传输限制无效，请稍后重试。')
      state.config = { ...data, max_file_bytes: Math.min(MAX_TRANSFER_BYTES, data.max_file_bytes) }
    } catch (error) {
      if (!signal.aborted) state.configError = transfers.transferErrorMessage(error, '暂时无法读取传输限制，请重试。')
      throw error
    } finally { if (!disposed) state.loadingConfig = false }
  }
  function applyStatus(result: TransferStatus) {
    const current = state.saved!
    if (result.size !== current.size || !Number.isSafeInteger(result.received_bytes) || result.received_bytes < 0 || result.received_bytes > current.size
      || (result.received_bytes !== current.size && result.received_bytes % current.chunk_bytes !== 0)
      || !['uploading', 'completed'].includes(result.status) || !validDate(result.expires_at)
      || (result.status === 'completed' && result.received_bytes !== current.size)) throw new Error('服务器返回的上传进度无效，请稍后核对原文件。')
    state.receivedBytes = result.received_bytes
    state.uploadedBytes = result.received_bytes
    state.expiresAt = result.expires_at
    current.expires_at = result.expires_at
    if (result.status === 'completed') state.phase = 'completed'
    persist()
  }
  function report(error: unknown, signal: AbortSignal) {
    if (disposed || signal.aborted) return
    if ([404, 410].includes(responseStatus(error) ?? 0) && state.saved) {
      try { forget() } catch { state.saved = null }
      state.error = '这次传输已过期或被删除，请重新选择文件上传。'
    } else state.error = transfers.transferErrorMessage(error, '上传中断，已保存的信息可用于续传，请重新选择原文件后重试。')
    state.phase = 'error'
    state.uploadedBytes = state.receivedBytes
  }
  function run(phase: Phase, operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (disposed || state.busy) return Promise.resolve()
    const current = new AbortController()
    controller = current
    state.busy = true
    state.error = ''
    state.phase = phase
    task = operation(current.signal).catch(error => report(error, current.signal)).finally(() => {
      state.busy = false
      if (controller === current) controller = null
      task = null
    })
    return task
  }
  function initialize(): Promise<void> {
    return run('checking', async signal => {
      await loadConfig(signal)
      if (state.saved) {
        const { data } = await api.getTransferUpload(state.saved.upload_id, state.saved.upload_token, signal)
        signal.throwIfAborted()
        applyStatus(data)
        if (state.phase !== 'completed') state.phase = 'paused'
      } else state.phase = 'idle'
    })
  }
  function start(file: File): Promise<void> {
    return run('fingerprinting', async signal => {
      await loadConfig(signal)
      if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > state.config!.max_file_bytes) throw new Error(`请选择非空文件，单文件不得超过 ${state.config!.max_file_bytes.toLocaleString('en-US')} 字节。`)
      const fingerprint = await fingerprintFile(file)
      signal.throwIfAborted()
      if (state.saved) {
        if (state.saved.fingerprint !== fingerprint || state.saved.filename !== file.name || state.saved.size !== file.size) throw new Error('文件不匹配，请重新选择原文件（文件内容和修改时间必须一致）。')
        const { data } = await api.getTransferUpload(state.saved.upload_id, state.saved.upload_token, signal)
        signal.throwIfAborted()
        applyStatus(data)
        if (state.phase === 'completed') return
      } else {
        if (!storage) throw new Error('无法保存续传信息，请允许浏览器使用本地存储。')
        try { storage.setItem(TRANSFER_UPLOAD_KEY, 'null'); storage.removeItem(TRANSFER_UPLOAD_KEY) }
        catch { throw new Error('无法保存续传信息，请允许浏览器使用本地存储。') }
        const { data } = await api.createTransferUpload({ filename: file.name, size: file.size, fingerprint }, signal)
        // Keep credentials before honoring a pause that arrived with the response.
        if (!data.upload_id || !data.upload_token || !data.code || !validChunk(data.chunk_bytes) || !validDate(data.expires_at)) throw new Error('服务返回的上传信息无效，请稍后重试。')
        state.saved = { ...data, filename: file.name, size: file.size, fingerprint }
        state.name = file.name
        state.size = file.size
        state.receivedBytes = 0
        state.uploadedBytes = 0
        state.expiresAt = data.expires_at
        persist()
        signal.throwIfAborted()
      }
      const current = state.saved!
      state.phase = 'uploading'
      for (let offset = state.receivedBytes; offset < file.size; offset += current.chunk_bytes) {
        signal.throwIfAborted()
        const body = file.slice(offset, Math.min(file.size, offset + current.chunk_bytes))
        await api.putTransferChunk(current.upload_id, current.upload_token, offset / current.chunk_bytes, body, signal, event => {
          if (!signal.aborted && !disposed) state.uploadedBytes = offset + Math.max(0, Math.min(body.size, event.loaded))
        })
        signal.throwIfAborted()
        state.receivedBytes = offset + body.size
        state.uploadedBytes = state.receivedBytes
      }
      state.phase = 'completing'
      const { data } = await api.completeTransferUpload(current.upload_id, current.upload_token, signal)
      signal.throwIfAborted()
      applyStatus(data)
      if (data.status !== 'completed') throw new Error('文件尚未完成，请重新选择原文件核对后重试。')
    })
  }
  function pause() {
    if (!state.busy || state.phase === 'cancelling') return
    state.phase = 'paused'
    state.uploadedBytes = state.receivedBytes
    controller?.abort()
  }
  async function cancel() {
    if (disposed || state.phase === 'cancelling') return
    state.phase = 'cancelling'
    controller?.abort()
    await task
    if (disposed) return
    return run('cancelling', async signal => {
      if (state.saved) {
        try { await api.cancelTransferUpload(state.saved.upload_id, state.saved.upload_token, signal) }
        catch (error) { if (![404, 410].includes(responseStatus(error) ?? 0)) throw error }
      }
      signal.throwIfAborted()
      forget()
      state.phase = 'idle'
      state.name = ''
      state.size = 0
      state.receivedBytes = 0
      state.uploadedBytes = 0
      state.expiresAt = ''
    })
  }
  function dispose() { disposed = true; controller?.abort() }
  return { state, initialize, start, pause, cancel, dispose }
}
