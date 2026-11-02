// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotionSync from './NotionSync.vue'

const api = vi.hoisted(() => ({
  getNotionConnections: vi.fn(), getNotionSources: vi.fn(), getNotionStatus: vi.fn(),
  inspectNotionSource: vi.fn(), importNotionSource: vi.fn(), syncNotionSource: vi.fn(),
  inspectNotionPage: vi.fn(), importNotionPage: vi.fn(), browseNotionWorkspace: vi.fn(),
}))
vi.mock('@/api/notion', () => api)
const counters = { queried: 3, published: 2, updated: 0, isolated: 1, archived: 0, unpublished: 0, skipped: 0, failed: 0 }
const status = { ready: true, source_configured: true, source_title: '公开笔记', status: 'success', last_started_at: null, last_finished_at: null, last_success_at: null, last_error: null, counters }
const source = { id: 8, connection_id: 'journal', connection_label: '个人博客', database_id: 'db', title: '公开笔记', source_url: 'https://notion.so/db', data_source_ids: ['ds'], last_import_at: null, last_success_at: null }
const preview = { title: '公开笔记', page_count: 3, data_source_count: 1, publishable_count: 2, isolated_count: 1, categories: ['技术'], isolation_reasons: { suspected_secret: 1 } }
const url = 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
let wrapper: ReturnType<typeof mount>
async function start() { wrapper = mount(NotionSync); await flushPromises() }
async function inspect() {
  await wrapper.get('#notion-connection').setValue('journal')
  await wrapper.get('#notion-database-url').setValue(url)
  await wrapper.get('[data-action="inspect-source"]').trigger('submit')
  await flushPromises()
}
describe('manual Notion multi-connection management', () => {
  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset())
    api.getNotionConnections.mockResolvedValue({ data: [{ id: 'journal', label: '个人博客', configured: true }, { id: 'docs', label: '技术文档', configured: true }] })
    api.getNotionSources.mockResolvedValue({ data: [source] })
    api.getNotionStatus.mockResolvedValue({ data: status })
    api.inspectNotionSource.mockResolvedValue({ data: preview })
    api.importNotionSource.mockResolvedValue({ data: status })
    api.syncNotionSource.mockResolvedValue({ data: status })
    api.inspectNotionPage.mockResolvedValue({ data: { ...preview, page_count: 1, publishable_count: 1, isolated_count: 0 } })
    api.importNotionPage.mockResolvedValue({ data: status })
    api.browseNotionWorkspace.mockResolvedValue({ data: { items: [{ id: 'page', kind: 'page', title: '工作空间页面', url, last_edited_at: null }], next_cursor: null } })
  })
  afterEach(() => wrapper?.unmount())
  it('lists connections and sources with an empty credential form without starting any Notion work', async () => {
    await start()
    expect(wrapper.findAll('#notion-connection option').map(item => item.text())).toContain('技术文档')
    expect(wrapper.text()).toContain('公开笔记')
    expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('')
    expect(api.inspectNotionSource).not.toHaveBeenCalled()
    expect(api.importNotionSource).not.toHaveBeenCalled()
    expect(api.syncNotionSource).not.toHaveBeenCalled()
    expect(api.browseNotionWorkspace).not.toHaveBeenCalled()
  })
  it('browses the selected connection and fills an explicit page selection without importing', async () => {
    await start(); await wrapper.get('#notion-connection').setValue('journal')
    await wrapper.get('.directory-search').trigger('submit'); await flushPromises()
    expect(wrapper.text()).toContain('工作空间页面')
    await wrapper.get('[data-action="choose-workspace-item"]').trigger('click')
    expect((wrapper.get('#notion-database-url').element as HTMLInputElement).value).toBe(url)
    expect(api.importNotionSource).not.toHaveBeenCalled()
    await wrapper.get('#notion-connection').setValue('docs')
    expect(wrapper.text()).not.toContain('工作空间页面')
  })
  it('requires explicit publication confirmation after inspecting before import', async () => {
    await start(); await inspect()
    expect(wrapper.get('[data-testid="source-preview"]').text()).toContain('2')
    expect(wrapper.get('[data-action="import-source"]').attributes('disabled')).toBeDefined()
    expect(api.importNotionSource).not.toHaveBeenCalled()
    await wrapper.get('#confirm-source').setValue(true)
    await wrapper.get('[data-action="import-source"]').trigger('click'); await flushPromises()
    expect(api.importNotionSource).toHaveBeenCalledWith({ connection_id: 'journal', url }, expect.any(AbortSignal))
    expect(wrapper.text()).toContain('操作完成')
  })
  it('clears directory pagination when the search query changes', async () => {
    api.browseNotionWorkspace.mockResolvedValue({ data: { items: [], next_cursor: 'alpha-cursor' } })
    await start(); await wrapper.get('#notion-connection').setValue('journal')
    await wrapper.get('#notion-directory-query').setValue('Alpha')
    await wrapper.get('.directory-search').trigger('submit'); await flushPromises()
    expect(wrapper.findAll('button').some(item => item.text() === '加载更多')).toBe(true)
    await wrapper.get('#notion-directory-query').setValue('Beta')
    expect(wrapper.findAll('button').some(item => item.text() === '加载更多')).toBe(false)
  })
  it.each(['#notion-connection', '#notion-database-url'])('invalidates preview after changing %s', async field => {
    await start(); await inspect(); await wrapper.get('#confirm-source').setValue(true)
    await wrapper.get(field).setValue(field.endsWith('connection') ? 'docs' : url + '?v=another')
    expect(wrapper.find('[data-testid="source-preview"]').exists()).toBe(false)
  })
  it('ignores a late inspection response after connection changes', async () => {
    let resolve!: (value: unknown) => void
    api.inspectNotionSource.mockReturnValue(new Promise(done => { resolve = done }))
    await start(); await inspect(); await wrapper.get('#notion-connection').setValue('docs')
    resolve({ data: preview }); await flushPromises()
    expect(wrapper.find('[data-testid="source-preview"]').exists()).toBe(false)
  })
  it('shows inspect failure and supports retry without importing', async () => {
    api.inspectNotionSource.mockRejectedValueOnce({ response: { data: { detail: '连接没有访问权限' } } })
    await start(); await inspect()
    expect(wrapper.get('[role="alert"]').text()).toContain('连接没有访问权限')
    await wrapper.get('[data-action="inspect-source"]').trigger('submit'); await flushPromises()
    expect(wrapper.find('[data-testid="source-preview"]').exists()).toBe(true)
    expect(api.importNotionSource).not.toHaveBeenCalled()
  })
  it('syncs only the chosen registered source', async () => {
    await start(); await wrapper.get('[data-action="sync-source"]').trigger('click'); await flushPromises()
    expect(api.syncNotionSource).toHaveBeenCalledWith(8, expect.any(AbortSignal))
    expect(wrapper.text()).toContain('操作完成')
  })
  it('inspects and imports a page under its source only after confirmation', async () => {
    await start(); await wrapper.get('[data-action="open-page"]').trigger('click')
    await wrapper.get('#notion-page-url').setValue(url)
    await wrapper.get('[data-action="inspect-page"]').trigger('submit'); await flushPromises()
    expect(api.inspectNotionPage).toHaveBeenCalledWith(8, url, expect.any(AbortSignal))
    expect(wrapper.get('[data-action="import-page"]').attributes('disabled')).toBeDefined()
    await wrapper.get('#confirm-page').setValue(true)
    await wrapper.get('[data-action="import-page"]').trigger('click'); await flushPromises()
    expect(api.importNotionPage).toHaveBeenCalledWith(8, url, expect.any(AbortSignal))
  })
  it('disables inspect and directs users to add a connection when none exist', async () => {
    api.getNotionConnections.mockResolvedValue({ data: [] }); await start()
    expect(wrapper.text()).toContain('请先在上方填写连接名称和密钥')
    expect(wrapper.get('[data-action="inspect-source"] button').attributes('disabled')).toBeDefined()
  })
})
