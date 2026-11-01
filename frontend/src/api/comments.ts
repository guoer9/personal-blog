import request from '@/utils/request'

export interface CommentUser {
  id: number
  username: string
  avatar?: string
}

export interface Comment {
  id: number
  content: string
  post_id: number
  user: CommentUser
  parent_id?: number
  created_at: string
  replies: Comment[]
}

export interface CommentCreate {
  content: string
  post_id: number
  parent_id?: number
}

// 获取文章评论
export function getComments(postId: number) {
  return request.get<Comment[]>(`/comments/post/${postId}`, {
    suppressErrorToast: true,
  })
}

// 发表评论
export function createComment(data: CommentCreate) {
  return request.post<Comment>('/comments', data)
}

// 删除评论
export function deleteComment(id: number) {
  return request.delete(`/comments/${id}`)
}
