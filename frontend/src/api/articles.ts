import request from '@/utils/request'
import type { Author } from './posts'
import type { Comment } from './comments'

export type ArticleKind = 'post' | 'notion'
export type ArticleStatus = 'published' | 'draft' | 'isolated' | 'archived'

export interface AdminArticle {
  id: number
  key: string
  kind: ArticleKind
  title: string
  slug: string
  summary: string | null
  status: ArticleStatus
  is_published: boolean
  author: Author | null
  author_label: string
  tags: string[]
  comment_count: number
  view_count: number
  public_url: string
  external_url: string | null
  source_label: string
  created_at: string
  updated_at: string
}

export interface AdminArticlePage {
  items: AdminArticle[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export const getAdminArticles = (params?: { page?: number; page_size?: number }) =>
  request.get<AdminArticlePage>('/admin/articles', { params })

export const unpublishAdminArticle = (kind: ArticleKind, id: number) =>
  request.post<AdminArticle>(`/admin/articles/${kind}/${id}/unpublish`)

export const getAdminArticleComments = (kind: ArticleKind, id: number) =>
  request.get<Comment[]>(`/admin/articles/${kind}/${id}/comments`)
