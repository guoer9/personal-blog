// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AddConnection from './AddConnection.vue'
import { createNotionConnection } from '@/api/notion-connections'

const request = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: request }))
const token = 'ntn_unit_test_only_secret'
const summary = { id: 'test-connection-id', label: '项目资料', configured: true }
let wrapper: ReturnType<typeof mount> | undefined

async function fill() {
  wrapper = mount(AddConnection)
  await wrapper.get('input[name="label"]').setValue(' 项目资料 ')
  await wrapper.get('input[name="token"]').setValue(token)
}
async function submit() {
  await wrapper!.get('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  request.post.mockReset()
  request.post.mockResolvedValue({ data: summary })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })

describe('AddConnection', () => {
  it('provides associated native labels and a nonpersistent password field', () => {
    wrapper = mount(AddConnection)
    for (const [name, text] of [['label', '连接名称'], ['token', 'Notion 密钥']]) {
      const input = wrapper.get(`input[name="${name}"]`)
      expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe(text)
      expect(input.attributes('required')).toBeDefined()
    }
    expect(wrapper.get('input[name="token"]').attributes('type')).toBe('password')
    expect(wrapper.get('input[name="token"]').attributes('autocomplete')).toBe('off')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(request.post).not.toHaveBeenCalled()
  })

  it('creates through the bounded API and emits only metadata while clearing the secret', async () => {
    request.post.mockResolvedValue({ data: { ...summary, token } })
    await fill(); await submit()
    expect(request.post).toHaveBeenCalledWith('/admin/notion/connections', { label: '项目资料', token }, expect.objectContaining({ suppressErrorToast: true, timeout: 30000, signal: expect.any(AbortSignal) }))
    expect(wrapper!.emitted('created')).toEqual([[summary]])
    expect((wrapper!.get('input[name="token"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper!.get('[role="status"]').text()).toContain('连接已添加')
    expect(wrapper!.html()).not.toContain(token)
    expect(localStorage.getItem('notion-token')).toBeNull()
  })

  it.each([400, 409, 422, 503, undefined])('clears the secret and shows safe inline feedback on failure %s', async status => {
    request.post.mockRejectedValue({ message: token, config: { data: token }, response: status ? { status, data: { detail: token } } : undefined })
    await fill(); await submit()
    expect(wrapper!.get('[role="alert"]').text().length).toBeGreaterThan(0)
    expect(wrapper!.html()).not.toContain(token)
    expect((wrapper!.get('input[name="token"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper!.emitted('created')).toBeUndefined()
    await wrapper!.get('input[name="token"]').setValue('retry-test-secret')
    request.post.mockResolvedValue({ data: summary })
    await submit()
    expect(wrapper!.emitted('created')).toEqual([[summary]])
  })

  it('blocks duplicate submissions during verification', async () => {
    let finish!: (value: unknown) => void
    request.post.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await fill(); await submit(); await submit()
    expect(request.post).toHaveBeenCalledTimes(1)
    expect(wrapper!.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    finish({ data: summary }); await flushPromises()
    expect(wrapper!.emitted('created')).toEqual([[summary]])
  })

  it('rejects blank fields even when a submit event is fired directly', async () => {
    wrapper = mount(AddConnection)
    await wrapper.get('input[name="label"]').setValue('   ')
    await wrapper.get('input[name="token"]').setValue('   ')
    await submit()
    expect(request.post).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
  })

  it('times out, aborts verification, clears the token and ignores late success', async () => {
    vi.useFakeTimers()
    let finish!: (value: unknown) => void
    request.post.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await fill(); await submit()
    const signal = request.post.mock.calls[0]![2].signal as AbortSignal
    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(signal.aborted).toBe(true)
    expect((wrapper!.get('input[name="token"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper!.get('[role="alert"]').text()).toContain('超时')
    finish({ data: summary }); await flushPromises()
    expect(wrapper!.emitted('created')).toBeUndefined()
  })

  it('aborts on unmount and ignores a response received afterward', async () => {
    let finish!: (value: unknown) => void
    request.post.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await fill(); await submit()
    const signal = request.post.mock.calls[0]![2].signal as AbortSignal
    const instance = wrapper!
    instance.unmount(); wrapper = undefined
    expect(signal.aborted).toBe(true)
    finish({ data: summary }); await flushPromises()
    expect(instance.emitted('created')).toBeUndefined()
  })
})

it('the API does not propagate Axios request credentials in its error', async () => {
  request.post.mockRejectedValue({ message: token, config: { data: token }, response: { status: 409, data: { detail: token } } })
  try {
    await createNotionConnection({ label: '项目资料', token })
    expect.unreachable('Expected failure')
  } catch (error) {
    expect(String(error)).not.toContain(token)
    expect(JSON.stringify(error)).not.toContain(token)
  }
})
