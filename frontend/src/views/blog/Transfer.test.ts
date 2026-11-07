// @vitest-environment happy-dom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Transfer from './Transfer.vue'

const api = vi.hoisted(() => ({
  getTransferConfig: vi.fn(), createTransferUpload: vi.fn(), getTransferUpload: vi.fn(),
  putTransferChunk: vi.fn(), completeTransferUpload: vi.fn(), cancelTransferUpload: vi.fn(), lookupTransfer: vi.fn(),
}))
vi.mock('@/api/transfers', async importOriginal => ({ ...await importOriginal<object>(), ...api }))
let wrapper: VueWrapper | undefined
const config = { max_file_bytes: 10737418240, chunk_bytes: 8388608, retention_seconds: 21600 }
const status = { received_bytes: 3, size: 3, status: 'completed', expires_at: '2026-11-02T12:00:00Z' }
async function render() {
  wrapper = mount(Transfer, { attachTo: document.body, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  await flushPromises()
  return wrapper
}
async function click(label: string) {
  const button = wrapper!.findAll('button').find(item => item.text().trim().startsWith(label))
  expect(button, label).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
async function selectFile() {
  const input = wrapper!.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['abc'], '片段.mov', { lastModified: 123 })] })
  await input.trigger('change')
  await flushPromises()
}
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  api.getTransferConfig.mockResolvedValue({ data: config })
  api.createTransferUpload.mockResolvedValue({ data: { upload_id: 'id', upload_token: 'NEVER-RENDER-TOKEN', code: 'COPY-CODE', chunk_bytes: 8388608, expires_at: '2026-11-02T06:00:00Z' } })
  api.putTransferChunk.mockResolvedValue({ data: {} })
  api.completeTransferUpload.mockResolvedValue({ data: status })
  api.getTransferUpload.mockResolvedValue({ data: status })
  api.cancelTransferUpload.mockResolvedValue({ data: {} })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('authenticated transfer page', () => {
  it('shows explicit byte limits, six-hour retention and an accessible completed code that can be copied', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    await render()
    expect(wrapper!.text()).toContain('10 GiB')
    expect(wrapper!.text()).toContain('10,737,418,240')
    expect(wrapper!.text()).toContain('6 小时')
    expect(wrapper!.get('input[type="file"]').attributes('aria-describedby')).toBeTruthy()
    await selectFile()
    await click('开始上传')
    await vi.waitFor(() => expect(wrapper!.find('[aria-label="取件码"]').exists()).toBe(true))
    expect(wrapper!.get('[aria-label="取件码"]').element).toBeInstanceOf(HTMLInputElement)
    expect((wrapper!.get('[aria-label="取件码"]').element as HTMLInputElement).value).toBe('COPY-CODE')
    expect(wrapper!.text()).toContain('到期')
    expect(wrapper!.get('time').attributes('datetime')).toBe('2026-11-02T12:00:00Z')
    expect(wrapper!.html()).not.toContain('NEVER-RENDER-TOKEN')
    expect(wrapper!.get('progress').attributes('aria-label')).toBe('上传进度')
    await click('复制取件码')
    expect(copy).toHaveBeenCalledWith('COPY-CODE')
    expect(wrapper!.text()).toContain('已复制')
  })

  it('does a POST lookup and exposes a native ticket download link without fetching the file body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    api.lookupTransfer.mockResolvedValue({ data: { filename: '片段.mov', size: 10737418240, expires_at: status.expires_at, download_url: '/api/v1/transfers/download/ticket.signature_456' } })
    await render()
    await wrapper!.get('input[aria-label="输入取件码"]').setValue('  MY-CODE  ')
    await wrapper!.get('form[aria-label="取件"]').trigger('submit')
    await flushPromises()
    expect(api.lookupTransfer).toHaveBeenCalledWith('MY-CODE', expect.any(AbortSignal))
    const link = wrapper!.get('a[download]')
    expect(link.attributes('href')).toContain('/api/v1/transfers/download/ticket.signature_456')
    expect(link.attributes('download')).toBe('片段.mov')
    expect(link.attributes('referrerpolicy')).toBe('no-referrer')
    expect(wrapper!.text()).toContain('10 GiB')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    await wrapper!.get('input[aria-label="输入取件码"]').setValue('OTHER')
    expect(wrapper!.find('a[download]').exists()).toBe(false)
  })

  it('renders retriable config errors and keeps uploading disabled until limits are available', async () => {
    api.getTransferConfig.mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(wrapper!.get('[role="alert"]').text()).toBeTruthy()
    expect(wrapper!.get('input[type="file"]').attributes('disabled')).toBeDefined()
    await click('重试读取限制')
    expect(wrapper!.get('input[type="file"]').attributes('disabled')).toBeUndefined()
  })

  it('keeps the recovery flow after refresh and displays a wrong-file error inline', async () => {
    api.putTransferChunk.mockRejectedValueOnce(new Error('offline'))
    await render()
    await selectFile()
    await click('开始上传')
    await vi.waitFor(() => { expect(api.putTransferChunk).toHaveBeenCalledOnce(); expect(wrapper!.find('[role="alert"]').exists()).toBe(true) })
    const request = api.createTransferUpload.mock.calls[0]![0] as { filename: string; size: number; fingerprint: string }
    expect(request).toMatchObject({ filename: '片段.mov', size: 3 })
    expect(request.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    wrapper!.unmount()
    wrapper = undefined
    api.getTransferUpload.mockResolvedValue({ data: { received_bytes: 0, size: 3, status: 'uploading', expires_at: '2026-11-02T12:00:00Z' } })
    await render()
    expect(wrapper!.text()).toContain('重新选择同一文件')
    expect(wrapper!.find('[aria-label="取件码"]').exists()).toBe(false)
    const input = wrapper!.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['abc'], '片段.mov', { lastModified: 456 })] })
    await input.trigger('change')
    await click('继续上传')
    await vi.waitFor(() => expect(wrapper!.get('[role="alert"]').text()).toContain('原文件'))
  })

  it('cancels lookups, ignores late responses and never accepts an unsafe download scheme', async () => {
    let resolve: ((value: unknown) => void) | undefined
    api.lookupTransfer.mockImplementationOnce(() => new Promise(result => { resolve = result }))
    await render()
    await wrapper!.get('input[aria-label="输入取件码"]').setValue('CODE')
    await wrapper!.get('form[aria-label="取件"]').trigger('submit')
    await click('取消查找')
    expect((api.lookupTransfer.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
    resolve!({ data: { filename: 'late', size: 1, expires_at: status.expires_at, download_url: '/api/v1/transfers/download/late' } })
    await flushPromises()
    expect(wrapper!.find('a[download]').exists()).toBe(false)
    api.lookupTransfer.mockResolvedValueOnce({ data: { filename: 'bad', size: 1, expires_at: status.expires_at, download_url: 'javascript:alert(1)' } })
    await wrapper!.get('form[aria-label="取件"]').trigger('submit')
    await flushPromises()
    expect(wrapper!.find('a[download]').exists()).toBe(false)
    expect(wrapper!.get('[role="alert"]').text()).toBeTruthy()
  })
})
