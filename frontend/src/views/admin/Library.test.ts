// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Library from './Library.vue'
import type { LibraryEntry } from '@/api/library'

const api = vi.hoisted(() => ({
  getLibraryEntries: vi.fn(), getLibraryStatus: vi.fn(), createLibraryFolder: vi.fn(),
  updateLibraryEntry: vi.fn(), deleteLibraryEntry: vi.fn(), restoreLibraryEntry: vi.fn(),
  downloadLibraryEntry: vi.fn(), createUploadSession: vi.fn(), getUploadSession: vi.fn(),
  putUploadPart: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn(),
}))
vi.mock('@/api/library', () => ({ ...api, libraryErrorMessage: (error: unknown) => error instanceof Error ? error.message : '请求失败' }))
const folder: LibraryEntry = { id: 'folder', name: '素材', kind: 'folder', parent_id: null, size: 0, mime_type: null, created_at: '2026-11-01T00:00:00Z', deleted_at: null }
const file: LibraryEntry = { ...folder, id: 'file', name: '原片.mov', kind: 'file', size: 1024, mime_type: 'video/quicktime' }
let wrapper: VueWrapper | undefined
async function render() {
  wrapper = mount(Library, { attachTo: document.body })
  await flushPromises()
  return wrapper
}
async function click(text: string) {
  const button = wrapper!.findAll('button').find(button => button.text() === text)
  expect(button, `button ${text}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  api.getLibraryEntries.mockImplementation(async (parent, trash) => ({ data: { items: trash ? [{ ...file, deleted_at: '2026-11-01T01:00:00Z' }] : parent === null ? [folder, file] : [] } }))
  api.getLibraryStatus.mockResolvedValue({ data: { used_bytes: 1024, quota_bytes: 10240, max_file_bytes: 2048, chunk_size: 8388608 } })
  api.createLibraryFolder.mockResolvedValue({ data: folder })
  api.updateLibraryEntry.mockResolvedValue({ data: file })
  api.deleteLibraryEntry.mockResolvedValue({ data: undefined })
  api.restoreLibraryEntry.mockResolvedValue({ data: file })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = '' })

describe('Library file browser', () => {
  it('shows quota, opens a folder with a current breadcrumb and creates inside that folder', async () => {
    await render()
    expect(wrapper!.text()).toContain('1 KB / 10 KB')
    await click('素材')
    expect(wrapper!.get('[aria-label="当前文件夹"]').text()).toContain('素材')
    expect(api.getLibraryEntries).toHaveBeenLastCalledWith('folder', false, expect.any(AbortSignal))
    await click('新建文件夹')
    await wrapper!.get('input[aria-label="文件夹名称"]').setValue('照片')
    await wrapper!.get('form[aria-label="新建文件夹"]').trigger('submit')
    await flushPromises()
    expect(api.createLibraryFolder).toHaveBeenCalledWith({ name: '照片', parent_id: 'folder' }, expect.any(AbortSignal))
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  })

  it('renames and moves through a folder picker while excluding the moved folder itself', async () => {
    await render()
    await wrapper!.get('button[aria-label="重命名 原片.mov"]').trigger('click')
    await wrapper!.get('input[aria-label="新名称"]').setValue('剪辑.mov')
    await wrapper!.get('form[aria-label="重命名"]').trigger('submit')
    await flushPromises()
    expect(api.updateLibraryEntry).toHaveBeenCalledWith('file', { name: '剪辑.mov' }, expect.any(AbortSignal))
    await wrapper!.get('button[aria-label="移动 原片.mov"]').trigger('click')
    await flushPromises()
    await wrapper!.get('[aria-label="目标文件夹"] button[aria-label="打开目标文件夹 素材"]').trigger('click')
    await flushPromises()
    await click('移动到此文件夹')
    expect(api.updateLibraryEntry).toHaveBeenCalledWith('file', { parent_id: 'folder' }, expect.any(AbortSignal))
    await wrapper!.get('button[aria-label="移动 素材"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[aria-label="打开目标文件夹 素材"]').exists()).toBe(false)
  })

  it('requires confirmation for soft delete and offers restore in trash', async () => {
    await render()
    await wrapper!.get('button[aria-label="移入回收站 原片.mov"]').trigger('click')
    expect(api.deleteLibraryEntry).not.toHaveBeenCalled()
    expect(wrapper!.get('[role="dialog"]').text()).toContain('原片.mov')
    await click('确认移入回收站')
    expect(api.deleteLibraryEntry).toHaveBeenCalledWith('file', expect.any(AbortSignal))
    await click('回收站')
    expect(api.getLibraryEntries).toHaveBeenLastCalledWith(null, true, expect.any(AbortSignal))
    expect(wrapper!.find('button[aria-label="下载 原片.mov"]').exists()).toBe(false)
    await wrapper!.get('button[aria-label="恢复 原片.mov"]').trigger('click')
    await flushPromises()
    expect(api.restoreLibraryEntry).toHaveBeenCalledWith('file', expect.any(AbortSignal))
  })

  it('starts an authenticated download and aborts it on unmount', async () => {
    api.downloadLibraryEntry.mockImplementation((_entry, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    await render()
    await wrapper!.get('button[aria-label="下载 原片.mov"]').trigger('click')
    const signal = api.downloadLibraryEntry.mock.calls[0]![1] as AbortSignal
    wrapper!.unmount()
    wrapper = undefined
    await flushPromises()
    expect(signal.aborted).toBe(true)
  })

  it('allows cancelling an active streamed download without reporting an operation error', async () => {
    api.downloadLibraryEntry.mockImplementation((_entry, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    await render()
    await wrapper!.get('button[aria-label="下载 原片.mov"]').trigger('click')
    await click('取消下载')
    expect((api.downloadLibraryEntry.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper!.text()).toContain('已取消下载')
    expect(wrapper!.text()).toContain('128 MiB')
    expect(wrapper!.text()).toContain('采样指纹')
  })

  it('renders a retriable inline request error without leaving stale entries visible', async () => {
    await render()
    api.getLibraryEntries.mockRejectedValueOnce(new Error('读取失败'))
    await click('刷新')
    expect(wrapper!.get('[role="alert"]').text()).toContain('读取失败')
    expect(wrapper!.find('button[aria-label="下载 原片.mov"]').exists()).toBe(false)
    await click('刷新')
    expect(wrapper!.find('button[aria-label="下载 原片.mov"]').exists()).toBe(true)
  })
})
