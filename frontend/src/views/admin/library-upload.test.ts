import { describe, expect, it, vi } from 'vitest'
import { createLibraryUploader, fingerprintFile, LIBRARY_UPLOAD_KEY } from './library-upload'
import type { LibraryEntry, UploadSession } from '@/api/library'

vi.mock('@/utils/request', () => ({ default: {} }))

const entry: LibraryEntry = { id: 'entry', name: 'clip.mov', kind: 'file', parent_id: null, size: 10, mime_type: 'video/quicktime', created_at: '2026-11-01T00:00:00Z', deleted_at: null }
const session: UploadSession = { id: 'session', chunk_size: 4, received_parts: [], expires_at: '2026-11-02T00:00:00Z' }
function setup() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const api = {
    createUploadSession: vi.fn().mockResolvedValue({ data: session }),
    getUploadSession: vi.fn().mockResolvedValue({ data: session }),
    putUploadPart: vi.fn().mockResolvedValue({ data: undefined }),
    completeUpload: vi.fn().mockResolvedValue({ data: entry }),
    cancelUpload: vi.fn().mockResolvedValue({ data: undefined }),
  }
  const onComplete = vi.fn()
  return { storage, api, onComplete, uploader: createLibraryUploader({ storage, api, onComplete }) }
}
const file = () => new File(['abcdefghij'], 'clip.mov', { type: 'video/quicktime', lastModified: 123456 })
function interrupted(signal: AbortSignal) {
  return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
}

describe('private library upload lifecycle', () => {
  it('uses session chunk size, zero based binary parts, one request at a time and completes afterward', async () => {
    const { uploader, api, storage, onComplete } = setup()
    const parts: string[] = []
    let inFlight = 0
    api.putUploadPart.mockImplementation(async (_id, index, body: Blob) => {
      expect(inFlight++).toBe(0)
      expect(index).toBe(parts.length)
      parts.push(await body.text())
      inFlight--
    })
    await uploader.start(file(), 'folder')
    expect(api.createUploadSession).toHaveBeenCalledWith({ name: 'clip.mov', size: 10, mime_type: 'video/quicktime', parent_id: 'folder' }, expect.any(AbortSignal))
    expect(parts).toEqual(['abcd', 'efgh', 'ij'])
    expect(api.completeUpload).toHaveBeenCalledOnce()
    expect(uploader.state.phase).toBe('completed')
    expect(uploader.state.uploadedBytes).toBe(10)
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).toBeNull()
    expect(onComplete).toHaveBeenCalledWith(entry)
  })

  it('pause aborts and reload resume verifies sampled SHA256 before fetching validated received parts', async () => {
    const { uploader, api, storage } = setup()
    let signal: AbortSignal | undefined
    api.putUploadPart.mockImplementationOnce((_id, _index, _body, currentSignal) => { signal = currentSignal; return interrupted(currentSignal) })
    const pending = uploader.start(file(), null)
    await vi.waitFor(() => expect(signal).toBeDefined())
    uploader.pause()
    await pending
    expect(signal?.aborted).toBe(true)
    expect(uploader.state.phase).toBe('paused')
    const saved = JSON.parse(storage.getItem(LIBRARY_UPLOAD_KEY)!)
    expect(Object.keys(saved).sort()).toEqual(['fingerprint', 'id'])
    expect(saved.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    api.getUploadSession.mockResolvedValue({ data: { ...session, received_parts: [0, 2] } })
    api.putUploadPart.mockResolvedValue({ data: undefined })
    api.putUploadPart.mockClear()
    const resumed = createLibraryUploader({ storage, api })
    await resumed.start(new File(['abcXefghij'], 'clip.mov', { type: 'video/quicktime', lastModified: 123456 }), null)
    expect(resumed.state.error).toContain('指纹')
    expect(api.getUploadSession).not.toHaveBeenCalled()
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).not.toBeNull()
    await resumed.start(file(), null)
    expect(api.getUploadSession).toHaveBeenCalledWith('session', expect.any(AbortSignal))
    expect(api.putUploadPart).toHaveBeenCalledOnce()
    expect(api.putUploadPart.mock.calls[0]?.[1]).toBe(1)
    expect(await (api.putUploadPart.mock.calls[0]?.[2] as Blob).text()).toBe('efgh')
    expect(api.createUploadSession).toHaveBeenCalledOnce()
  })

  it('retains session on failure and failed cancel; successful cancel cleans server before forgetting', async () => {
    const { uploader, api, storage } = setup()
    api.putUploadPart.mockRejectedValueOnce(new Error('offline'))
    await uploader.start(file(), null)
    expect(uploader.state.phase).toBe('error')
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).not.toBeNull()
    api.cancelUpload.mockRejectedValueOnce(new Error('offline'))
    await uploader.cancel()
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).not.toBeNull()
    api.cancelUpload.mockImplementationOnce(async () => {
      expect(storage.getItem(LIBRARY_UPLOAD_KEY)).not.toBeNull()
      return { data: undefined }
    })
    await uploader.cancel()
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).toBeNull()
    expect(uploader.state.phase).toBe('idle')
    expect(api.completeUpload).not.toHaveBeenCalled()
  })

  it('cancel aborts the active part and prevents completion before deleting the server session', async () => {
    const { uploader, api, storage } = setup()
    let signal: AbortSignal | undefined
    api.putUploadPart.mockImplementationOnce((_id, _index, _body, currentSignal) => { signal = currentSignal; return interrupted(currentSignal) })
    const pending = uploader.start(file(), null)
    await vi.waitFor(() => expect(signal).toBeDefined())
    await uploader.cancel()
    await pending
    expect(signal?.aborted).toBe(true)
    expect(api.cancelUpload).toHaveBeenCalledWith('session', expect.any(AbortSignal))
    expect(api.completeUpload).not.toHaveBeenCalled()
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).toBeNull()
  })

  it('unmount aborts without server cancellation or losing resumable state', async () => {
    const { uploader, api, storage } = setup()
    let signal: AbortSignal | undefined
    api.putUploadPart.mockImplementationOnce((_id, _index, _body, currentSignal) => { signal = currentSignal; return interrupted(currentSignal) })
    const pending = uploader.start(file(), null)
    await vi.waitFor(() => expect(signal).toBeDefined())
    uploader.dispose()
    await pending
    expect(signal?.aborted).toBe(true)
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).not.toBeNull()
    expect(api.cancelUpload).not.toHaveBeenCalled()
    expect(api.completeUpload).not.toHaveBeenCalled()
  })

  it('recovers an already committed completion when cancellation loses the race', async () => {
    const { uploader, api, storage, onComplete } = setup()
    api.completeUpload.mockImplementationOnce((_id, signal) => interrupted(signal))
    const pending = uploader.start(file(), null)
    await vi.waitFor(() => expect(uploader.state.phase).toBe('completing'))
    api.cancelUpload.mockRejectedValueOnce({ response: { status: 409 } })
    api.completeUpload.mockResolvedValueOnce({ data: entry })
    await uploader.cancel()
    await pending
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).toBeNull()
    expect(uploader.state.phase).toBe('completed')
    expect(onComplete).toHaveBeenCalledWith(entry)
    await uploader.start(new File(['new'], 'new.txt'), null)
    expect(uploader.state.phase).toBe('completed')
    expect(uploader.state.error).toBe('')
  })

  it('rejects invalid received indexes without sending bytes or losing the session', async () => {
    const { api, storage } = setup()
    storage.setItem(LIBRARY_UPLOAD_KEY, JSON.stringify({ id: 'session', fingerprint: await fingerprintFile(file()) }))
    api.getUploadSession.mockResolvedValue({ data: { ...session, received_parts: [3] } })
    const uploader = createLibraryUploader({ api, storage })
    await uploader.start(file(), null)
    expect(uploader.state.phase).toBe('error')
    expect(api.putUploadPart).not.toHaveBeenCalled()
    expect(storage.getItem(LIBRARY_UPLOAD_KEY)).not.toBeNull()
  })

  it('hashes bounded first middle and last samples instead of the whole large file', async () => {
    const size = 1024 * 1024
    const bytes = new Uint8Array(size)
    const original = new File([bytes], 'large.bin', { lastModified: 123456 })
    const slice = vi.spyOn(original, 'slice')
    const first = await fingerprintFile(original)
    expect(slice.mock.calls.reduce((sum, [start, end]) => sum + Number(end) - Number(start), 0)).toBeLessThanOrEqual(3 * 65536)
    bytes[size - 1] = 1
    expect(await fingerprintFile(new File([bytes], 'large.bin', { lastModified: 123456 }))).not.toBe(first)
  })

  it('includes modification time in its metadata and documents the limits of a sample fingerprint', async () => {
    const bytes = new Uint8Array(1024 * 1024)
    const first = await fingerprintFile(new File([bytes], 'large.bin', { lastModified: 123456 }))
    expect(await fingerprintFile(new File([bytes], 'large.bin', { lastModified: 123457 }))).not.toBe(first)
    // This position is outside the first, middle and last 64 KiB samples.
    bytes[200000] = 1
    expect(await fingerprintFile(new File([bytes], 'large.bin', { lastModified: 123456 }))).toBe(first)
  })
})
