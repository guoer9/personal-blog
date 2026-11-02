import request from '@/utils/request'
import { useUserStore } from '@/stores/user'
import type { AxiosProgressEvent } from 'axios'

export interface LibraryEntry {
  id: string
  name: string
  kind: 'file' | 'folder'
  parent_id: string | null
  size: number
  mime_type: string | null
  created_at: string
  deleted_at: string | null
}

export interface LibraryStatus {
  used_bytes: number
  quota_bytes: number
  max_file_bytes: number
  chunk_size: number
}

export interface UploadSession {
  id: string
  chunk_size: number
  received_parts: number[]
  expires_at: string
}

export interface UploadCreate {
  name: string
  size: number
  mime_type: string | null
  parent_id: string | null
}

const config = (signal?: AbortSignal) => ({ signal, suppressErrorToast: true })
const entryPath = (id: string) => `/library/entries/${encodeURIComponent(id)}`
const uploadPath = (id: string) => `/library/uploads/${encodeURIComponent(id)}`

export function getLibraryEntries(parentId: string | null = null, trash = false, signal?: AbortSignal) {
  return request.get<{ items: LibraryEntry[] }>('/library/entries', {
    ...config(signal),
    params: { ...(parentId === null ? {} : { parent_id: parentId }), trash },
  })
}

export function getLibraryStatus(signal?: AbortSignal) {
  return request.get<LibraryStatus>('/library/status', config(signal))
}

export function createLibraryFolder(data: { name: string; parent_id: string | null }, signal?: AbortSignal) {
  return request.post<LibraryEntry>('/library/folders', data, config(signal))
}

export function updateLibraryEntry(id: string, data: { name?: string; parent_id?: string | null }, signal?: AbortSignal) {
  return request.patch<LibraryEntry>(entryPath(id), data, config(signal))
}

export function deleteLibraryEntry(id: string, signal?: AbortSignal) {
  return request.delete(entryPath(id), config(signal))
}

export function restoreLibraryEntry(id: string, signal?: AbortSignal) {
  return request.post<LibraryEntry>(`${entryPath(id)}/restore`, undefined, config(signal))
}

export function createUploadSession(data: UploadCreate, signal?: AbortSignal) {
  return request.post<UploadSession>('/library/uploads', data, config(signal))
}

export function getUploadSession(id: string, signal?: AbortSignal) {
  return request.get<UploadSession>(uploadPath(id), config(signal))
}

export function putUploadPart(id: string, index: number, body: Blob, signal?: AbortSignal, onUploadProgress?: (event: AxiosProgressEvent) => void) {
  return request.put(`${uploadPath(id)}/parts/${index}`, body, {
    ...config(signal),
    headers: { 'Content-Type': 'application/octet-stream' },
    transformRequest: [(data: Blob) => data],
    onUploadProgress,
    timeout: 0,
  })
}

export function completeUpload(id: string, signal?: AbortSignal) {
  return request.post<LibraryEntry>(`${uploadPath(id)}/complete`, undefined, { ...config(signal), timeout: 0 })
}

export function cancelUpload(id: string, signal?: AbortSignal) {
  return request.delete(uploadPath(id), config(signal))
}

const BLOB_DOWNLOAD_LIMIT = 128 * 1024 * 1024
const largeDownloadMessage = '当前浏览器的普通下载上限为 128 MiB。大文件请在 HTTPS 或 localhost 下使用支持流式保存的 Chrome / Edge。'
type DownloadEntry = Pick<LibraryEntry, 'id' | 'name' | 'size'>
type SaveFilePicker = (options: { suggestedName: string }) => Promise<FileSystemFileHandle>

async function fetchLibraryDownload(entry: DownloadEntry, signal?: AbortSignal) {
  const user = useUserStore()
  const send = () => {
    signal?.throwIfAborted()
    if (!user.token) throw new Error('登录已失效，请重新登录后下载')
    return fetch(request.getUri({ url: `${entryPath(entry.id)}/download` }), {
      headers: { Authorization: `Bearer ${user.token}` },
      signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
  }
  let response = await send()
  if (response.status === 401 && user.refreshToken) {
    await response.body?.cancel()
    await user.refreshAccessToken()
    response = await send()
  }
  return response
}

async function streamLibraryDownload(entry: DownloadEntry, picker: SaveFilePicker, signal?: AbortSignal) {
  // Invoke the picker before any await so the original click still authorizes it.
  const handle = await picker.call(window, { suggestedName: entry.name })
  let writable: FileSystemWritableFileStream | undefined
  let response: Response | undefined
  try {
    signal?.throwIfAborted()
    writable = await handle.createWritable()
    signal?.throwIfAborted()
    response = await fetchLibraryDownload(entry, signal)
    if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请刷新页面后重试下载' : `下载失败（HTTP ${response.status}）`)
    if (!response.body) throw new Error('浏览器未提供下载数据流，请更换浏览器后重试')
    // pipeTo propagates backpressure; only close after successful transfer.
    await response.body.pipeTo(writable, { signal, preventClose: true })
    signal?.throwIfAborted()
    await writable.close()
  } catch (cause) {
    // pipeTo has released its locks here. Abort also discards the temporary file.
    await Promise.allSettled([response?.body?.cancel(cause), writable?.abort(cause)])
    throw cause
  }
}

async function downloadSmallLibraryBlob(entry: DownloadEntry, signal?: AbortSignal) {
  if (entry.size > BLOB_DOWNLOAD_LIMIT) throw new Error(largeDownloadMessage)
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let oversized = false
  try {
    const response = await request.get<Blob>(`${entryPath(entry.id)}/download`, {
      ...config(controller.signal), responseType: 'blob', timeout: 0,
      onDownloadProgress(event) {
        if (event.loaded > BLOB_DOWNLOAD_LIMIT || (event.total ?? 0) > BLOB_DOWNLOAD_LIMIT) {
          oversized = true
          controller.abort()
        }
      },
    })
    signal?.throwIfAborted()
    if (oversized || response.data.size > BLOB_DOWNLOAD_LIMIT) throw new Error(largeDownloadMessage)
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    try {
      anchor.href = url
      anchor.download = entry.name
      document.body.append(anchor)
      anchor.click()
    } finally {
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  } catch (cause) {
    if (oversized) throw new Error(largeDownloadMessage)
    throw cause
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export async function downloadLibraryEntry(entry: DownloadEntry, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('文件大小无效，请刷新文件列表后重试')
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (typeof picker === 'function') return streamLibraryDownload(entry, picker, signal)
  return downloadSmallLibraryBlob(entry, signal)
}

export function libraryErrorMessage(error: unknown, fallback = '操作失败，请重试'): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  return error instanceof Error ? error.message : fallback
}
