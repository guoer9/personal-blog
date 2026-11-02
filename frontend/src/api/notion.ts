import request from '@/utils/request'

export interface NotionSyncCounters {
  queried: number
  published: number
  updated: number
  unpublished: number
  skipped: number
  failed: number
}

export interface NotionSyncStatus {
  ready: boolean
  enabled: boolean
  interval_seconds: number
  last_started_at?: string | null
  last_finished_at?: string | null
  last_success_at?: string | null
  last_error?: string | null
  counters: NotionSyncCounters
}

export function getNotionSyncStatus(signal?: AbortSignal) {
  return request.get<NotionSyncStatus>('/admin/notion/legacy/status', { signal })
}

export function runNotionSync(signal?: AbortSignal) {
  return request.post<NotionSyncStatus>('/admin/notion/sync', undefined, { signal })
}

export interface NotionConnection { id: string; label: string; configured: boolean }
export interface NotionSource {
  id: number; connection_id: string; connection_label: string | null
  database_id: string; title: string; source_url: string; data_source_ids: string[]
  source_type: 'database' | 'page'
  last_import_at: string | null; last_success_at: string | null
}
export interface NotionPreview {
  import_scope?: 'database' | 'page'
  source_type: 'database' | 'page'
  title: string; page_count: number; data_source_count: number
  publishable_count: number; isolated_count: number; categories: string[]
  isolation_reasons: Record<string, number>
}
export interface NotionLibraryStatus {
  ready: boolean; source_configured: boolean; source_title: string | null
  status: 'never' | 'running' | 'success' | 'error'
  last_started_at: string | null; last_finished_at: string | null
  last_success_at: string | null; last_error: string | null
  counters: NotionSyncCounters & { isolated: number; archived: number }
}
export interface NotionLink { connection_id: string; url: string }
const base = '/admin/notion'
const options = (signal?: AbortSignal) => ({ signal, suppressErrorToast: true })
// Full source traversal can take several minutes; the server remains authoritative
// if the browser disconnects. Refresh status before retrying an interrupted import.
const operationOptions = (signal?: AbortSignal) => ({ ...options(signal), timeout: 600000 })
export const getNotionConnections = (signal?: AbortSignal) => request.get<NotionConnection[]>(`${base}/connections`, options(signal))
export const getNotionSources = (signal?: AbortSignal) => request.get<NotionSource[]>(`${base}/sources`, options(signal))
export const getNotionStatus = (signal?: AbortSignal) => request.get<NotionLibraryStatus>(`${base}/status`, options(signal))
export interface NotionWorkspaceItem { id: string; kind: 'page' | 'database'; title: string; url: string; last_edited_at: string | null }
export const browseNotionWorkspace = (id: string, params: { q?: string; cursor?: string }, signal?: AbortSignal) => request.get<{ items: NotionWorkspaceItem[]; next_cursor: string | null }>(`${base}/connections/${encodeURIComponent(id)}/workspace`, { ...operationOptions(signal), params })
export const inspectNotionSource = (link: NotionLink, signal?: AbortSignal) => request.post<NotionPreview>(`${base}/sources/inspect`, link, operationOptions(signal))
export const importNotionSource = (link: NotionLink, signal?: AbortSignal) => request.post<NotionLibraryStatus>(`${base}/sources`, link, operationOptions(signal))
export const syncNotionSource = (id: number, signal?: AbortSignal) => request.post<NotionLibraryStatus>(`${base}/sources/${id}/sync`, undefined, operationOptions(signal))
export const inspectNotionPage = (id: number, url: string, signal?: AbortSignal) => request.post<NotionPreview>(`${base}/sources/${id}/pages/inspect`, { url }, operationOptions(signal))
export const importNotionPage = (id: number, url: string, signal?: AbortSignal) => request.post<NotionLibraryStatus>(`${base}/sources/${id}/pages/import`, { url }, operationOptions(signal))
