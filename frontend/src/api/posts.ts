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
  return request.get<PaginatedResponse<Post>>('/posts', { params })
}

// 搜索文章
export function searchPosts(params: { q: string; page?: number; page_size?: number }) {
  return request.get<PaginatedResponse<Post>>('/posts/search', { params })
}

// 获取文章详情
export function getPost(slug: string) {
  return request.get<Post>(`/posts/${slug}`)
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
