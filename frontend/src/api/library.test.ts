// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosProgressEvent, InternalAxiosRequestConfig } from 'axios'
import { ReadableStream, WritableStream } from 'node:stream/web'
import request from '@/utils/request'
import { createUploadSession, putUploadPart, downloadLibraryEntry, getLibraryEntries } from './library'

const showError = vi.fn()
vi.mock('@/ui/feedback', () => ({ showError: (...args: unknown[]) => showError(...args) }))
const user = vi.hoisted(() => ({ token: 'private-access-token', refreshToken: '', refreshAccessToken: vi.fn(), logout: vi.fn() }))
vi.mock('@/stores/user', () => ({ useUserStore: () => user }))
vi.mock('@/router', () => ({ default: { currentRoute: { value: { path: '/admin/library' } }, push: vi.fn() } }))

describe('library transport and authenticated download', () => {
  const originalAdapter = request.defaults.adapter
  let requests: InternalAxiosRequestConfig[]
  beforeEach(() => {
    requests = []
    user.token = 'private-access-token'
    user.refreshToken = ''
    showError.mockClear()
    request.defaults.adapter = async config => {
      requests.push(config)
      return { data: new Blob(['private bytes']), status: 200, statusText: 'OK', headers: {}, config }
    }
  })
  afterEach(() => {
    request.defaults.adapter = originalAdapter
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends JSON session config and raw binary chunks with explicit content types', async () => {
    const config = { name: 'clip.mov', size: 3, mime_type: 'video/quicktime', parent_id: null }
    await createUploadSession(config)
    const body = new Blob(['abc'])
    await putUploadPart('session', 0, body, new AbortController().signal)
    expect(JSON.parse(requests[0]!.data)).toEqual(config)
    expect(requests[0]!.url).toBe('/library/uploads')
    expect(requests[0]!.headers.get('Content-Type')).toBe('application/json')
    expect(requests[1]!.url).toBe('/library/uploads/session/parts/0')
    expect(requests[1]!.data).toBe(body)
    expect(requests[1]!.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(requests.every(config => config.suppressErrorToast)).toBe(true)
  })

  it('omits parent_id at root and passes trash separately', async () => {
    await getLibraryEntries(null, false)
    await getLibraryEntries('folder', false)
    await getLibraryEntries(null, true)
    expect(requests.map(config => config.params)).toEqual([{ trash: false }, { parent_id: 'folder', trash: false }, { trash: true }])
  })

  it('downloads via authenticated axios blob and removes anchor and object URL with no token URL', async () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-download')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let clicked: HTMLAnchorElement | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked = this })
    await downloadLibraryEntry({ id: 'file-id', name: '私有片段.mov', size: 13 })
    expect(requests[0]!.url).toBe('/library/entries/file-id/download')
    expect(requests[0]!.headers.get('Authorization')).toBe('Bearer private-access-token')
    expect(requests[0]!.responseType).toBe('blob')
    expect(clicked?.href).toBe('blob:private-download')
    expect(clicked?.download).toBe('私有片段.mov')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(create).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(revoke).toHaveBeenCalledWith('blob:private-download')
  })

  it('cleans up even if the browser cannot trigger a download', async () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-download')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('blocked') })
    await expect(downloadLibraryEntry({ id: 'file-id', name: 'clip.mov', size: 13 })).rejects.toThrow('blocked')
    await vi.runAllTimersAsync()
    expect(revoke).toHaveBeenCalledWith('blob:failed-download')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('keeps errors inline without triggering the global feedback', async () => {
    request.defaults.adapter = config => Promise.reject({ config, response: { status: 503, data: { detail: 'offline' } } })
    await expect(getLibraryEntries(null, false)).rejects.toMatchObject({ response: { status: 503 } })
    expect(showError).not.toHaveBeenCalled()
  })

  it('rejects unsupported large downloads before requesting or allocating a blob', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(downloadLibraryEntry({ id: 'large', name: 'large.mov', size: 128 * 1024 * 1024 + 1 })).rejects.toThrow('128 MiB')
    expect(requests).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('enforces the fallback cap during progress if the actual response exceeds its metadata', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined)
    let requestSignal: AbortSignal | undefined
    request.defaults.adapter = async config => {
      requestSignal = config.signal as AbortSignal
      config.onDownloadProgress?.({ loaded: 128 * 1024 * 1024 + 1 } as AxiosProgressEvent)
      return { data: new Blob(['overflow']), status: 200, statusText: 'OK', headers: {}, config }
    }
    await expect(downloadLibraryEntry({ id: 'file-id', name: 'clip.mov', size: 13 })).rejects.toThrow('128 MiB')
    expect(requestSignal?.aborted).toBe(true)
  })

  it('streams an 8 GiB entry through the picker without materializing a blob and waits for writes', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])]
    const written: number[][] = []
    let releaseWrite: (() => void) | undefined
    let closed = false
    const writable = new WritableStream<Uint8Array>({
      async write(chunk) {
        written.push([...chunk])
        if (written.length === 1) await new Promise<void>(resolve => { releaseWrite = resolve })
      },
      close() { closed = true },
    })
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => writable })
    vi.stubGlobal('showSaveFilePicker', picker)
    const blob = vi.fn(() => { throw new Error('must never buffer this file') })
    const fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close() } }), blob })
    vi.stubGlobal('fetch', fetch)
    const pending = downloadLibraryEntry({ id: 'large', name: 'large.mov', size: 8 * 1024 ** 3 })
    // The picker must run synchronously while the click's user activation is valid.
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'large.mov' })
    await vi.waitFor(() => expect(written).toEqual([[1, 2]]))
    expect(closed).toBe(false)
    releaseWrite!()
    await pending
    expect(written).toEqual([[1, 2], [3, 4]])
    expect(closed).toBe(true)
    expect(blob).not.toHaveBeenCalled()
    expect(requests).toEqual([])
    const [url, options] = fetch.mock.calls[0]!
    expect(url).toBe('/api/v1/library/entries/large/download')
    expect(options.headers.Authorization).toBe('Bearer private-access-token')
    expect(options.redirect).toBe('error')
  })

  it('aborts the file writer and cancels the network stream when download is interrupted', async () => {
    const abort = vi.fn()
    const cancel = vi.fn()
    const writable = new WritableStream<Uint8Array>({ abort })
    const writerAbort = vi.spyOn(writable, 'abort')
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable: async () => writable }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ cancel }) }))
    const controller = new AbortController()
    const pending = downloadLibraryEntry({ id: 'large', name: 'large.mov', size: 8 * 1024 ** 3 }, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(writable.locked).toBe(true))
    controller.abort()
    await rejected
    expect(abort).toHaveBeenCalledOnce()
    expect(writerAbort).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('aborts the writer on HTTP errors before touching the network payload', async () => {
    const abort = vi.fn()
    const cancel = vi.fn()
    const writable = new WritableStream({ abort })
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable: async () => writable }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, body: new ReadableStream({ cancel }) }))
    await expect(downloadLibraryEntry({ id: 'large', name: 'large.mov', size: 8 * 1024 ** 3 })).rejects.toThrow('403')
    expect(abort).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(showError).not.toHaveBeenCalled()
  })

  it('does not make a network request if the user cancels the save picker', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(downloadLibraryEntry({ id: 'large', name: 'large.mov', size: 8 * 1024 ** 3 })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(requests).toEqual([])
  })
})
