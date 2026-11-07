import axios, { type AxiosProgressEvent, type InternalAxiosRequestConfig } from 'axios'

export interface TransferConfig {
  max_file_bytes: number
  chunk_bytes: number
  retention_seconds: number
}
export interface TransferCreate { filename: string; size: number; fingerprint: string }
export interface TransferSession {
  upload_id: string
  upload_token: string
  code: string
  chunk_bytes: number
  expires_at: string
}
export interface TransferStatus {
  received_bytes: number
  size: number
  status: string
  expires_at: string
}
export interface TransferLookup { filename: string; size: number; expires_at: string; download_url: string }

const transferRequest = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 30000,
  withCredentials: false,
})
transferRequest.interceptors.request.use(async config => {
  const { useUserStore } = await import('@/stores/user')
  const token = useUserStore().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
transferRequest.interceptors.response.use(response => response, async error => {
  const status = error?.response?.status
  const detail = error?.response?.data?.detail
  const config = error?.config as InternalAxiosRequestConfig | undefined
  if (status !== 401 || detail !== '未登录或登录已过期' || !config || config.transferAuthRetried) {
    return Promise.reject(error)
  }

  const { useUserStore } = await import('@/stores/user')
  const user = useUserStore()
  config.transferAuthRetried = true
  if (!user.refreshToken) {
    user.logout()
    return Promise.reject(error)
  }

  try {
    await user.refreshAccessToken()
    return transferRequest(config)
  } catch {
    user.logout()
    return Promise.reject(error)
  }
})

const uploadPath = (id: string) => `/transfers/uploads/${encodeURIComponent(id)}`
const management = (token: string, signal?: AbortSignal) => ({ signal, headers: { 'X-Upload-Token': token } })

export function getTransferConfig(signal?: AbortSignal) {
  return transferRequest.get<TransferConfig>('/transfers/config', { signal })
}
export function createTransferUpload(data: TransferCreate, signal?: AbortSignal) {
  return transferRequest.post<TransferSession>('/transfers/uploads', data, { signal })
}
export function getTransferUpload(id: string, token: string, signal?: AbortSignal) {
  return transferRequest.get<TransferStatus>(uploadPath(id), management(token, signal))
}
export function putTransferChunk(id: string, token: string, index: number, body: Blob, signal?: AbortSignal, onUploadProgress?: (event: AxiosProgressEvent) => void) {
  return transferRequest.put(`${uploadPath(id)}/chunks/${index}`, body, {
    ...management(token, signal),
    headers: { 'X-Upload-Token': token, 'Content-Type': 'application/octet-stream' },
    transformRequest: [(chunk: Blob) => chunk],
    timeout: 0,
    onUploadProgress,
  })
}
export function completeTransferUpload(id: string, token: string, signal?: AbortSignal) {
  return transferRequest.post<TransferStatus>(`${uploadPath(id)}/complete`, undefined, management(token, signal))
}
export function cancelTransferUpload(id: string, token: string, signal?: AbortSignal) {
  return transferRequest.delete(uploadPath(id), management(token, signal))
}
export function lookupTransfer(code: string, signal?: AbortSignal) {
  return transferRequest.post<TransferLookup>('/transfers/lookup', { code }, { signal, withCredentials: true })
}

export function transferErrorMessage(error: unknown, fallback = '连接未完成，请检查网络后重试。'): string {
  const status = (error as { response?: { status?: number } })?.response?.status
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (status === 401 && detail === '未登录或登录已过期') return '登录状态已失效，请重新登录后使用传输功能。'
  const messages: Record<number, string> = {
    400: '请求未被接受，请检查文件或取件码后重试。',
    401: '上传凭据已失效，请取消此上传后重新选择文件。',
    403: '上传凭据已失效，请取消此上传后重新选择文件。',
    404: '文件不存在、尚未上传完成或已过期，请核对取件码。',
    409: '上传状态已变化，请重新选择原文件核对进度后重试。',
    410: '文件已过期，请重新上传。',
    413: '文件或分片超过服务当前限制。',
    422: '文件信息或取件码无效，请检查后重试。',
    429: '当前传输较多，请稍后重试，已保存的上传可以续传。',
    507: '临时传输空间暂时不足，请稍后重试。',
  }
  if (status) return messages[status] || fallback
  if (axios.isAxiosError(error)) return fallback
  return error instanceof Error ? error.message : fallback
}

/** Resolve relative tickets against the API origin, never through a Blob fetch. */
export function transferDownloadUrl(value: string): string {
  const apiBase = new URL(import.meta.env.VITE_API_BASE_URL || '/api/v1', window.location.origin)
  const url = new URL(value, apiBase.origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== apiBase.origin || url.username || url.password || url.hash || url.search) {
    throw new Error('下载地址无效，请重新查找取件码。')
  }
  const prefix = `${apiBase.pathname.replace(/\/$/, '')}/transfers/download/`
  const ticket = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
  // The API signs tickets as two URL-safe segments separated by a dot.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) {
    throw new Error('下载地址无效，请重新查找取件码。')
  }
  return url.href
}
