import request from '@/utils/request'
import type { Author, PaginatedResponse } from './posts'

export interface PublicDocumentSummary {
  id: number
  kind: 'post' | 'notion'
  slug: string; title: string; summary: string | null; categories: string[]
  created_at: string; updated_at: string
  icon?: string | null; cover_url?: string | null
  author: Author | null; author_label: string
  view_count: number; comment_count: number
  public_url: string; external_url: string | null
}
export interface NotionText { text: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; code: boolean; color: string; href: string | null }
export interface NotionBlock {
  id: string; type: string; text?: NotionText[]; children?: NotionBlock[]
  checked?: boolean; language?: string; color?: string; icon?: string; url?: string; caption?: NotionText[]
  is_toggleable?: boolean
  rows?: NotionText[][][]; has_column_header?: boolean; has_row_header?: boolean
}
export interface PublicDocument extends PublicDocumentSummary { content: string; blocks?: NotionBlock[] | null }
export interface DocumentQuery { page?: number; page_size?: number; category?: string; q?: string }
export const getDocuments = (params: DocumentQuery = {}, signal?: AbortSignal) => request.get<PaginatedResponse<PublicDocumentSummary>>('/documents', { params, signal, suppressErrorToast: true })
export const getDocument = (slug: string, signal?: AbortSignal) => request.get<PublicDocument>(`/documents/${encodeURIComponent(slug)}`, { signal, suppressErrorToast: true })
