// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Documents from './Documents.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'
const api = vi.hoisted(() => ({ getDocuments: vi.fn() }))
vi.mock('@/api/documents', () => api)
const entry = { id: 8, slug: 'safe-note', title: '部署笔记', summary: '一份公开的资料', categories: ['技术'], author: { id: 1, username: 'guoer9' }, author_label: 'guoer9', view_count: 12, comment_count: 3, public_url: '/documents/safe-note', external_url: 'https://www.notion.so/11111111111111111111111111111111', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' }
const response = { items: [entry], total: 21, page: 1, page_size: 10, total_pages: 3 }
let wrapper: ReturnType<typeof mount>
async function start(path = '/documents') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/documents', component: Documents }, { path: '/documents/:slug', component: { template: '<div />' } }] })
  await router.push(path); await router.isReady()
  wrapper = mount(Documents, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises(); return router
}
beforeEach(() => { api.getDocuments.mockReset(); api.getDocuments.mockResolvedValue({ data: response }) })
afterEach(() => wrapper?.unmount())
describe('public documents list', () => {
  it('publishes library index state and remeasures anchors after async entries render', async () => {
    const runtime = { setPageState: vi.fn(), measureAnchors: vi.fn() }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/documents', component: Documents }] })
    await router.push('/documents?category=技术&page=2'); await router.isReady()
    wrapper = mount(Documents, { attachTo: document.body, global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: ref(runtime) } } })
    await flushPromises()

    expect(runtime.setPageState).toHaveBeenLastCalledWith('library', {
      mode: 'index', category: '技术', itemCount: 1, page: 2, readingProgress: 0,
    })
    expect(runtime.measureAnchors).toHaveBeenCalled()
  })

  it('loads shared search/category/page from the URL and links to independent document detail', async () => {
    await start('/documents?q=部署&category=技术&page=2')
    expect(api.getDocuments).toHaveBeenCalledWith({ q: '部署', category: '技术', page: 2, page_size: 10 }, expect.any(AbortSignal))
    expect(wrapper.get('a[href="/documents/safe-note"]').text()).toContain('部署笔记')
    expect(wrapper.text()).toContain('一份公开的资料')
    expect(wrapper.get('.card-article-meta').text()).toContain('guoer9')
    expect(wrapper.get('.card-article-meta').text()).toContain('12 次阅读')
    expect(wrapper.get('.card-article-meta').text()).toContain('3 条评论')
  })
  it('submits trimmed filters, resets page and supports URL pagination', async () => {
    const router = await start('/documents?page=2')
    await wrapper.get('#documents-query').setValue('  笔记  ')
    await wrapper.get('#documents-category').setValue(' 技术 ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ q: '笔记', category: '技术' })
    await wrapper.get('[data-action="next-page"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.page).toBe('2')
    expect((document.activeElement as HTMLElement)?.id).toBe('documents-results')
  })
  it('discards stale request results when filters change', async () => {
    let resolve!: (value: unknown) => void
    api.getDocuments.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const router = await start()
    const oldSignal = api.getDocuments.mock.calls[0]![1] as AbortSignal
    await router.push('/documents?q=new'); await flushPromises()
    resolve({ data: { ...response, items: [{ ...entry, title: '过期结果' }] } }); await flushPromises()
    expect(oldSignal.aborted).toBe(true)
    expect(wrapper.text()).not.toContain('过期结果')
    expect(wrapper.text()).toContain('部署笔记')
  })
  it('clears failed results and permits an inline retry', async () => {
    api.getDocuments.mockRejectedValueOnce(new Error('offline'))
    await start()
    expect(wrapper.get('[role="alert"]').text()).toContain('暂时无法读取')
    await wrapper.get('[data-action="retry"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('部署笔记')
  })
  it('normalizes invalid pages and shows a useful empty state', async () => {
    api.getDocuments.mockResolvedValue({ data: { items: [], total: 0, page: 1, page_size: 10, total_pages: 0 } })
    await start('/documents?page=-3')
    expect(api.getDocuments.mock.calls[0]![0].page).toBe(1)
    expect(wrapper.text()).toContain('没有找到')
    expect(wrapper.find('[data-action="next-page"]').exists()).toBe(false)
  })
})
