import request from '@/utils/request'

export interface Tag {
  id: number
  name: string
  slug: string
}

export interface Author {
  id: number
  username: string
  avatar?: string
}

export interface Post {
  id: number
  title: string
  slug: string
  content?: string
  summary?: string
  cover_image?: string
  is_published: boolean
  view_count: number
  author: Author
  tags: Tag[]
  created_at: string
  updated_at: string
}

export type ArticleTag = Pick<Tag, 'name' | 'slug'>

// Public lists share one index while keeping the canonical body/reading page.
export interface PublicArticle extends Omit<Post, 'author' | 'tags' | 'content'> {
  key: string
  kind: 'post' | 'notion'
  public_url: string
  author: Author | null
  tags: ArticleTag[]
}

export interface PostCreate {
  title: string
  content: string
  summary?: string
  cover_image?: string
  is_published?: boolean
  tag_ids?: number[]
}

export interface PostUpdate extends Partial<PostCreate> {}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// 获取文章列表
export function getPosts(params?: { page?: number; page_size?: number; tag?: string }) {
  return request.get<PaginatedResponse<PublicArticle>>('/posts', { params })
}

export function getArticleTags() {
  return request.get<ArticleTag[]>('/posts/topics/list')
}

// 管理员文章列表（包含草稿），与公开列表分开。
export function getAdminPosts(params?: { page?: number; page_size?: number }) {
  return request.get<PaginatedResponse<Post>>('/posts/admin/list', { params })
}

// 搜索文章。搜索页已提供固定的页面内错误状态，避免与全局 toast 重复通知。
export function searchPosts(params: { q: string; page?: number; page_size?: number }) {
  return request.get<PaginatedResponse<PublicArticle>>('/posts/search', {
    params,
    suppressErrorToast: true,
  })
}

export function getArticleTags() {
  return request.get<ArticleTag[]>('/posts/topics/list')
}

// 管理员按 ID 获取文章（包含草稿）
export function getPostById(id: number) {
  return request.get<Post>(`/posts/id/${id}`)
}

// 创建文章
export function createPost(data: PostCreate) {
  return request.post<Post>('/posts', data)
}

// 更新文章
export function updatePost(id: number, data: PostUpdate) {
  return request.put<Post>(`/posts/${id}`, data)
}

// 删除文章
export function deletePost(id: number) {
  return request.delete(`/posts/${id}`)
}
