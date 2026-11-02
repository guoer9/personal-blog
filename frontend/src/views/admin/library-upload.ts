import { reactive } from 'vue'
import * as library from '@/api/library'
import type { AxiosProgressEvent } from 'axios'
import type { LibraryEntry, UploadCreate, UploadSession } from '@/api/library'

export const LIBRARY_UPLOAD_KEY = 'private-library-upload-v1'
interface SavedUpload { id: string; fingerprint: string }
type UploadStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
interface UploadApi {
  createUploadSession(data: UploadCreate, signal?: AbortSignal): Promise<{ data: UploadSession }>
  getUploadSession(id: string, signal?: AbortSignal): Promise<{ data: UploadSession }>
  putUploadPart(id: string, index: number, body: Blob, signal?: AbortSignal, progress?: (event: AxiosProgressEvent) => void): Promise<unknown>
  completeUpload(id: string, signal?: AbortSignal): Promise<{ data: LibraryEntry }>
  cancelUpload(id: string, signal?: AbortSignal): Promise<unknown>
}

/** Resume identity: metadata plus SHA-256 of up to three 64 KiB samples, not a full-file checksum. */
export async function fingerprintFile(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('文件校验需要 HTTPS 或 localhost 安全连接')
  const sampleSize = Math.min(file.size, 65536)
  const offsets = [...new Set([0, Math.max(0, Math.floor((file.size - sampleSize) / 2)), Math.max(0, file.size - sampleSize)])]
  const metadata = new TextEncoder().encode(JSON.stringify([file.name, file.size, file.lastModified, file.type, offsets]))
  const samples = await Promise.all(offsets.map(offset => file.slice(offset, offset + sampleSize).arrayBuffer()))
  const bytes = new Uint8Array(metadata.length + samples.reduce((size, sample) => size + sample.byteLength, 0))
  bytes.set(metadata)
  let cursor = metadata.length
  for (const sample of samples) {
    bytes.set(new Uint8Array(sample), cursor)
    cursor += sample.byteLength
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function createLibraryUploader(options: {
  api?: UploadApi
  storage?: UploadStorage
  onComplete?: (entry: LibraryEntry) => void
} = {}) {
  const api = options.api ?? library
  let storage: UploadStorage | undefined = options.storage
  try { storage ??= globalThis.localStorage } catch { /* Report storage access failure when starting. */ }
  let saved: SavedUpload | null = null
  try {
    const value = JSON.parse(storage?.getItem(LIBRARY_UPLOAD_KEY) ?? 'null')
    if (typeof value?.id === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.fingerprint)) saved = { id: value.id, fingerprint: value.fingerprint }
  } catch { /* A malformed local record must not crash the file browser. */ }
  const state = reactive({
    phase: saved ? 'paused' : 'idle',
    saved,
    busy: false,
    name: '',
    size: 0,
    uploadedBytes: 0,
    error: '',
    expiresAt: '',
  })
  let controller: AbortController | null = null
  let task: Promise<void> | null = null
  let disposed = false

  function forget() {
    storage?.removeItem(LIBRARY_UPLOAD_KEY)
    state.saved = null
  }

  async function transfer(file: File, parentId: string | null, signal: AbortSignal) {
    try {
      const fingerprint = await fingerprintFile(file)
      signal.throwIfAborted()
      if (!storage) throw new Error('浏览器无法保存续传信息，请允许本地存储')
      let session: UploadSession
      if (state.saved) {
        if (state.saved.fingerprint !== fingerprint) throw new Error('文件指纹不匹配，请重新选择原文件；取消旧上传后才能上传其他文件')
        session = (await api.getUploadSession(state.saved.id, signal)).data
        if (session.id !== state.saved.id) throw new Error('服务器返回的上传会话不匹配')
      } else {
        // Check that storage is writable before creating a remote session.
        storage.setItem(LIBRARY_UPLOAD_KEY, 'null')
        storage.removeItem(LIBRARY_UPLOAD_KEY)
        session = (await api.createUploadSession({ name: file.name, size: file.size, mime_type: file.type || null, parent_id: parentId }, signal)).data
        state.saved = { id: session.id, fingerprint }
        storage.setItem(LIBRARY_UPLOAD_KEY, JSON.stringify(state.saved))
      }
      signal.throwIfAborted()
      if (!Number.isSafeInteger(session.chunk_size) || session.chunk_size <= 0) throw new Error('服务器返回的分片大小无效')
      const count = Math.ceil(file.size / session.chunk_size)
      if (!Array.isArray(session.received_parts) || session.received_parts.some(index => !Number.isSafeInteger(index) || index < 0 || index >= count)) throw new Error('服务器返回的已接收分片无效')
      const received = new Set(session.received_parts)
      state.name = file.name
      state.size = file.size
      state.expiresAt = session.expires_at
      let confirmed = [...received].reduce((total, index) => total + Math.min(session.chunk_size, file.size - index * session.chunk_size), 0)
      state.uploadedBytes = confirmed
      state.phase = 'uploading'
      for (let index = 0; index < count; index++) {
        signal.throwIfAborted()
        if (received.has(index)) continue
        const body = file.slice(index * session.chunk_size, Math.min(file.size, (index + 1) * session.chunk_size))
        await api.putUploadPart(session.id, index, body, signal, event => {
          if (!signal.aborted) state.uploadedBytes = confirmed + Math.max(0, Math.min(event.loaded, body.size))
        })
        signal.throwIfAborted()
        confirmed += body.size
        state.uploadedBytes = confirmed
      }
      signal.throwIfAborted()
      state.phase = 'completing'
      const result = (await api.completeUpload(session.id, signal)).data
      signal.throwIfAborted()
      forget()
      state.phase = 'completed'
      options.onComplete?.(result)
    } catch (error) {
      if (!signal.aborted) {
        state.error = library.libraryErrorMessage(error, '上传失败，已保留续传会话，请重新选择原文件重试')
        state.phase = 'error'
      }
    }
  }

  function start(file: File, parentId: string | null): Promise<void> {
    if (disposed || state.busy) return Promise.resolve()
    state.busy = true
    state.error = ''
    state.phase = 'fingerprinting'
    controller = new AbortController()
    const signal = controller.signal
    task = transfer(file, parentId, signal).finally(() => {
      state.busy = false
      controller = null
      task = null
    })
    return task
  }

  function pause() {
    if (!state.busy || state.phase === 'cancelling') return
    state.phase = 'paused'
    controller?.abort()
  }

  async function cancel() {
    if (disposed || state.phase === 'cancelling') return
    state.phase = 'cancelling'
    controller?.abort()
    await task
    if (disposed) return
    state.busy = true
    state.error = ''
    controller = new AbortController()
    try {
      if (state.saved) await api.cancelUpload(state.saved.id, controller.signal)
      controller.signal.throwIfAborted()
      forget()
      state.phase = 'idle'
      state.uploadedBytes = 0
      state.size = 0
      state.name = ''
    } catch (error) {
      if (!controller.signal.aborted) {
        if ((error as { response?: { status?: number } }).response?.status === 409 && state.saved) {
          try {
            const result = (await api.completeUpload(state.saved.id, controller.signal)).data
            controller.signal.throwIfAborted()
            forget()
            state.phase = 'completed'
            options.onComplete?.(result)
            return
          } catch { /* Only a confirmed completion may release the saved session. */ }
        }
        state.phase = 'error'
        state.error = library.libraryErrorMessage(error, '取消失败，续传会话已保留，请重试取消')
      }
    } finally {
      state.busy = false
      controller = null
    }
  }

  function dispose() {
    disposed = true
    controller?.abort()
  }

  return { state, start, pause, cancel, dispose }
}
