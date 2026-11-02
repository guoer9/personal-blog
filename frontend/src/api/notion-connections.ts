import request from '@/utils/request'
import type { NotionConnection } from '@/api/notion'

export interface CreateNotionConnection { label: string; token: string }

export class NotionConnectionCreateError extends Error {
  constructor(public readonly status?: number) {
    const messages: Record<number, string> = {
      400: 'Notion 密钥无效或没有访问权限',
      401: '请先登录管理员账号',
      403: '需要管理员权限',
      409: '此 Notion 密钥已经配置连接，请选择已有连接',
      413: '连接请求过大',
      422: '请检查连接名称和 Notion 密钥',
      503: '连接暂时无法保存，请检查服务器连接文件配置',
      504: 'Notion 连接验证超时，请稍后重试',
    }
    super(messages[status ?? 0] ?? '添加连接失败，请稍后重试')
    this.name = 'NotionConnectionCreateError'
  }
}

export async function createNotionConnection(payload: CreateNotionConnection, signal?: AbortSignal) {
  try {
    const response = await request.post<NotionConnection>('/admin/notion/connections', payload, {
      signal, timeout: 30000, suppressErrorToast: true,
    })
    const { id, label, configured } = response.data
    return { id, label, configured }
  } catch (error: unknown) {
    // Axios errors retain config.data. Never pass them to rendering or telemetry.
    const status = (error as { response?: { status?: number } } | null)?.response?.status
    throw new NotionConnectionCreateError(status)
  }
}
