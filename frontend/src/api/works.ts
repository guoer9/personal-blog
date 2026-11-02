import request from '@/utils/request'
import type { Work, WorkCategory } from '@/data/works'

export function getWorks(params?: { category?: WorkCategory; featured?: boolean }, signal?: AbortSignal) {
  return request.get<{ items: Work[] }>('/works', { params, signal, suppressErrorToast: true })
}
export function getWork(slug: string, signal?: AbortSignal) {
  return request.get<Work>(`/works/${encodeURIComponent(slug)}`, { signal, suppressErrorToast: true })
}
export interface WorkDraft {
  title: string
  category: WorkCategory
  caption: string
  description: string
  tags: string[]
  accent: 'lime' | 'blue' | 'paper'
  repository: string | null
  externalWatch: string | null
  notes: string[]
  featured: boolean
  sort_order: number
  cover_asset_id: string | null
  video_asset_id: string | null
  audio_asset_id: string | null
}
export interface AdminWork {
  id: string
  slug: string
  draft: WorkDraft
  published: WorkDraft | null
  version: number
  created_at: string
  updated_at: string
  published_at: string | null
}
const admin = '/admin/works'
const options = { suppressErrorToast: true }
export const getAdminWorks = () => request.get<{ items: AdminWork[] }>(admin, options)
export const getAdminWork = (id: string) => request.get<AdminWork>(`${admin}/${id}`, options)
export const createWork = (slug: string, draft: WorkDraft) => request.post<AdminWork>(admin, { slug, ...draft }, options)
export const saveWork = (id: string, version: number, draft: WorkDraft) => request.put<AdminWork>(`${admin}/${id}`, { version, ...draft }, options)
export const publishWork = (id: string, version: number) => request.post<AdminWork>(`${admin}/${id}/publish`, { version }, options)
export const unpublishWork = (id: string, version: number) => request.post<AdminWork>(`${admin}/${id}/unpublish`, { version }, options)
export const previewWork = (id: string) => request.get<Work>(`${admin}/${id}/preview`, options)
export const openPreviewSession = () => request.post('/admin/work-assets/preview-session', null, options)
export const closePreviewSession = () => request.delete('/admin/work-assets/preview-session', options)
export interface WorkAssetStorage { used_bytes: number; quota_bytes: number }
export const getWorkAssetStorage = () => request.get<WorkAssetStorage>('/admin/work-assets/storage', options)
export const cleanupWorkAssets = () => request.post<WorkAssetStorage & { removed: number }>('/admin/work-assets/cleanup', null, options)
export const prepareWorkAsset = (entry_id: string, role: 'cover' | 'video' | 'audio') => request.post<{ id: string }>('/admin/work-assets', { entry_id, role }, { ...options, timeout: 120000 })
