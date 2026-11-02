import { beforeEach, expect, it, vi } from 'vitest'
import request from '@/utils/request'
import { getAdminArticles, unpublishAdminArticle } from './articles'

vi.mock('@/utils/request', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

beforeEach(() => vi.clearAllMocks())

it('loads the unified administrator article list', async () => {
  await getAdminArticles({ page: 1, page_size: 50 })
  expect(request.get).toHaveBeenCalledWith('/admin/articles', { params: { page: 1, page_size: 50 } })
})

it('unpublishes an article through the shared source-aware endpoint', async () => {
  await unpublishAdminArticle('notion', 9)
  expect(request.post).toHaveBeenCalledWith('/admin/articles/notion/9/unpublish')
})
