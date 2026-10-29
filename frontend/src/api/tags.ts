import request from '@/utils/request'
import type { Tag } from './posts'

export type { Tag } from './posts'

export interface TagCreate {
  name: string
}

// 获取所有标签
export function getTags() {
  return request.get<Tag[]>('/tags')
}

// 创建标签
export function createTag(data: TagCreate) {
  return request.post<Tag>('/tags', data)
}

// 删除标签
export function deleteTag(id: number) {
  return request.delete(`/tags/${id}`)
}
