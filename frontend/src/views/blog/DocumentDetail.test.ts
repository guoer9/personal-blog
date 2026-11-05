// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentDetail from './DocumentDetail.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'
const api = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('@/api/documents', () => api)
const commentsApi = vi.hoisted(() => ({ getNotionComments: vi.fn(), createComment: vi.fn(), deleteComment: vi.fn() }))
vi.mock('@/api/comments', () => commentsApi)
const user = vi.hoisted(() => ({ isLoggedIn: false, isAdmin: false, userInfo: null as { id: number; username: string } | null }))
vi.mock('@/stores/user', () => ({ useUserStore: () => user }))
vi.mock('@/ui/feedback', () => ({ showSuccess: vi.fn(), showError: vi.fn(), confirmAction: vi.fn().mockResolvedValue(true) }))
const entry = { id: 8, slug: 'note', title: '公开资料', content: '## 正文\n\n**安全**内容', summary: null, categories: ['技术'], author: { id: 1, username: 'guoer9' }, author_label: 'guoer9', view_count: 12, comment_count: 0, public_url: '/documents/note', external_url: 'https://www.notion.so/11111111111111111111111111111111', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' }
let wrapper: ReturnType<typeof mount>
async function start() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/documents', component: { template: '<div />' } }, { path: '/documents/:slug', component: DocumentDetail }] })
  await router.push('/documents/note'); await router.isReady()
  wrapper = mount(DocumentDetail, { global: { plugins: [router] } }); await flushPromises(); return router
}
beforeEach(() => {
  api.getDocument.mockReset(); api.getDocument.mockResolvedValue({ data: entry })
  commentsApi.getNotionComments.mockReset(); commentsApi.getNotionComments.mockResolvedValue({ data: [] })
  commentsApi.createComment.mockReset(); commentsApi.createComment.mockResolvedValue({ data: {} })
  user.isLoggedIn = false; user.isAdmin = false; user.userInfo = null
})
afterEach(() => wrapper?.unmount())
describe('document detail', () => {
  it('publishes library detail state and remeasures anchors after content loads', async () => {
    const runtime = { setPageState: vi.fn(), measureAnchors: vi.fn() }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/documents/:slug', component: DocumentDetail }] })
    await router.push('/documents/note'); await router.isReady()
    wrapper = mount(DocumentDetail, { attachTo: document.body, global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: ref(runtime) } } })
    await flushPromises()

    expect(runtime.setPageState).toHaveBeenLastCalledWith('library', {
      mode: 'detail', category: '技术', itemCount: 1, page: 1, readingProgress: 0,
    })
    expect(runtime.measureAnchors).toHaveBeenCalled()
  })

  it('renders Markdown, category navigation and an anonymous discussion', async () => {
    await start()
    expect(wrapper.get('h1').text()).toBe('公开资料')
    expect(wrapper.get('.document-content h2').text()).toBe('正文')
    expect(wrapper.get('.document-content strong').text()).toBe('安全')
    expect(wrapper.get('a[href="/documents?category=%E6%8A%80%E6%9C%AF"]').text()).toBe('技术')
    expect(document.title).toContain('公开资料')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })
  it('shows the article author, views, comment count and source link', async () => {
    await start()
    expect(wrapper.get('.document-meta').text()).toContain('guoer9')
    expect(wrapper.get('.document-meta').text()).toContain('12 次阅读')
    expect(wrapper.get('.document-meta').text()).toContain('0 条评论')
    expect(wrapper.get(`a[href="${entry.external_url}"]`).text()).toContain('Notion 原文')
    expect(wrapper.get('#discussion').text()).toContain('还没有评论')
  })
  it('publishes a Notion comment and updates the displayed discussion count', async () => {
    user.isLoggedIn = true; user.isAdmin = true; user.userInfo = { id: 1, username: 'guoer9' }
    await start()
    commentsApi.getNotionComments.mockResolvedValue({ data: [{ id: 31, notion_document_id: 8, post_id: null, content: '导入文章也可以评论', user: user.userInfo, parent_id: null, replies: [], created_at: entry.updated_at }] })
    await wrapper.get('textarea').setValue('导入文章也可以评论')
    await wrapper.get('.comment-form').trigger('submit'); await flushPromises()
    expect(commentsApi.createComment).toHaveBeenCalledWith({ notion_document_id: 8, content: '导入文章也可以评论', parent_id: undefined })
    expect(wrapper.get('#discussion').text()).toContain('导入文章也可以评论')
    expect(wrapper.get('.document-meta').text()).toContain('1 条评论')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
  it('escapes imported HTML and rejects dangerous Markdown link schemes', async () => {
    api.getDocument.mockResolvedValue({ data: { ...entry, content: '<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n[正常](https://example.com)' } })
    await start()
    expect(wrapper.find('.document-content script').exists()).toBe(false)
    expect(wrapper.find('.document-content img').exists()).toBe(false)
    expect(wrapper.find('.document-content a[href^="javascript:"]').exists()).toBe(false)
    expect(wrapper.get('.document-content a').attributes('href')).toBe('https://example.com')
  })
  it('separates missing documents from temporary failures and allows retry', async () => {
    api.getDocument.mockRejectedValueOnce({ response: { status: 404 } })
    await start(); expect(wrapper.text()).toContain('资料未找到')
    expect(wrapper.find('[data-action="retry"]').exists()).toBe(false)
    wrapper.unmount()
    api.getDocument.mockRejectedValueOnce({ response: { status: 503 } })
    await start(); expect(wrapper.get('[role="alert"]').text()).toContain('暂时无法读取')
    await wrapper.get('[data-action="retry"]').trigger('click'); await flushPromises()
    expect(wrapper.get('h1').text()).toBe('公开资料')
  })
  it('clears old content while changing slug and ignores late results', async () => {
    const router = await start()
    let resolve!: (value: unknown) => void
    api.getDocument.mockReturnValueOnce(new Promise(done => { resolve = done }))
    await router.push('/documents/slow'); await flushPromises()
    expect(wrapper.text()).not.toContain('公开资料')
    await router.push('/documents/latest'); await flushPromises()
    resolve({ data: { ...entry, title: '过期内容' } }); await flushPromises()
    expect(wrapper.text()).not.toContain('过期内容')
  })
})
