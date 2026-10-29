import request from '@/utils/request'

export interface FileInfo {
  id: number
  filename: string
  original_name: string
  file_path: string
  size: number
  mime_type?: string
  uploader?: {
    id: number
    username: string
    avatar?: string
  }
  created_at: string
}

export interface FileUploadResponse {
  id: number
  filename: string
  original_name: string
  url: string
  size: number
  mime_type?: string
}

export interface FilePaginatedResponse {
  items: FileInfo[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// 上传文件
export function uploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post<FileUploadResponse>('/files/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

// 获取文件列表
export function getFiles(params?: { page?: number; page_size?: number }) {
  return request.get<FilePaginatedResponse>('/files/list', { params })
}

// 删除文件
export function deleteFile(id: number) {
  return request.delete(`/files/${id}`)
}
