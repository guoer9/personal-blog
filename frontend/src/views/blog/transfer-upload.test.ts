import { describe, expect, it, vi } from 'vitest'
import { createTransferUploader, fingerprintFile, TRANSFER_UPLOAD_KEY } from './transfer-upload'

const expiry = '2026-11-01T12:00:00Z'
const config = { max_file_bytes: 10737418240, chunk_bytes: 4, retention_seconds: 21600 }
const session = { upload_id: 'upload', upload_token: 'PRIVATE-TOKEN', code: 'SHARE-CODE', chunk_bytes: 4, expires_at: expiry }
const status = { received_bytes: 0, size: 10, status: 'uploading', expires_at: expiry }
const file = (content = 'abcdefghij', lastModified = 123456) => new File([content], 'clip.mov', { lastModified })
function setup() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  let completionAccepted = false
  const completedStatus = { ...status, received_bytes: 10, status: 'completed', expires_at: '2026-11-01T18:00:00Z' }
  const api = {
    getTransferConfig: vi.fn().mockResolvedValue({ data: config }),
    createTransferUpload: vi.fn().mockResolvedValue({ data: session }),
    getTransferUpload: vi.fn().mockImplementation(async () => ({ data: completionAccepted ? completedStatus : status })),
    putTransferChunk: vi.fn().mockResolvedValue({ data: status }),
    completeTransferUpload: vi.fn().mockImplementation(async () => { completionAccepted = true; return { data: completedStatus } }),
    cancelTransferUpload: vi.fn().mockResolvedValue({ data: undefined }),
  }
  return { storage, api, uploader: createTransferUploader({ storage, api }) }
}
function interrupted(signal: AbortSignal) {
  return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
}

describe('bounded public transfer fingerprint', () => {
  it('includes content and mtime and samples at most three 64 KiB slices even at 10 GiB', async () => {
    const original = await fingerprintFile(file())
    expect(original).toBe('sha256:b18dec08683c95baca81e0afe3a86a50b98e0e75e1b722cbc8ff6e9d250c1753')
    expect(await fingerprintFile(new File(['abc'], '片段.mov', { lastModified: 123 })))
      .toBe('sha256:20114d8e9533c3195c1aee6cf0f125ce5ea8662eea366302529b81077c68a0d2')
    expect(await fingerprintFile(file('abcXefghij'))).not.toBe(original)
    expect(await fingerprintFile(file('abcdefghij', 654321))).not.toBe(original)
    const slices: number[] = []
    const huge = { name: 'huge.bin', size: 10737418240, lastModified: 123, type: '', arrayBuffer: () => { throw new Error('whole file read') }, slice: (start: number, end: number) => { slices.push(end - start); return new Blob([new Uint8Array(end - start)]) } } as unknown as File
    await fingerprintFile(huge)
    expect(slices).toEqual([65536, 65536, 65536])
  })
})

describe('public transfer upload lifecycle', () => {
  it('passes the bounded sampled sha256 fingerprint unchanged into upload creation', async () => {
    const { api, uploader } = setup()
    const sampledFingerprint = await fingerprintFile(file())
    await uploader.start(file())
    expect(sampledFingerprint).toBe('sha256:b18dec08683c95baca81e0afe3a86a50b98e0e75e1b722cbc8ff6e9d250c1753')
    expect(api.createTransferUpload).toHaveBeenCalledWith({
      filename: 'clip.mov', size: 10, fingerprint: sampledFingerprint,
    }, expect.any(AbortSignal))
  })

  it('uses the server completion response for final status and expiry', async () => {
    const { api, uploader } = setup()
    api.completeTransferUpload.mockResolvedValue({ data: { ...status, received_bytes: 10, status: 'completed', expires_at: '2026-11-01T18:00:00Z' } })
    api.getTransferUpload.mockResolvedValue({ data: { ...status, received_bytes: 10, status: 'completed', expires_at: '2026-11-01T18:00:00Z' } })
    await uploader.start(file())
    expect(api.completeTransferUpload).toHaveBeenCalledWith('upload', 'PRIVATE-TOKEN', expect.any(AbortSignal))
    expect(api.getTransferUpload).not.toHaveBeenCalled()
    expect(uploader.state.phase).toBe('completed')
    expect(uploader.state.expiresAt).toBe('2026-11-01T18:00:00Z')
  })

  it('sends sequential server-sized raw chunks and keeps code/token and completion expiry for refresh', async () => {
    const { api, storage, uploader } = setup()
    const parts: string[] = []
    let active = false
    api.putTransferChunk.mockImplementation(async (_id, token, index, body: Blob, _signal, progress) => {
      expect(active).toBe(false)
      active = true
      expect(token).toBe('PRIVATE-TOKEN')
      expect(index).toBe(parts.length)
      progress?.({ loaded: body.size + 100 })
      expect(uploader.state.uploadedBytes).toBeLessThanOrEqual(10)
      parts.push(await body.text())
      active = false
    })
    await uploader.start(file())
    expect(parts).toEqual(['abcd', 'efgh', 'ij'])
    expect(uploader.state.phase).toBe('completed')
    expect(uploader.state.uploadedBytes).toBe(10)
    expect(uploader.state.expiresAt).toBe('2026-11-01T18:00:00Z')
    const saved = JSON.parse(storage.getItem(TRANSFER_UPLOAD_KEY)!)
    expect(saved.code).toBe('SHARE-CODE')
    expect(saved.upload_token).toBe('PRIVATE-TOKEN')
    api.getTransferUpload.mockResolvedValue({ data: { ...status, status: 'completed', received_bytes: 10 } })
    const reloaded = createTransferUploader({ storage, api })
    await reloaded.initialize()
    expect(reloaded.state.phase).toBe('completed')
    expect(api.getTransferUpload).toHaveBeenCalledWith('upload', 'PRIVATE-TOKEN', expect.any(AbortSignal))
  })

  it('aborts on pause, rejects changed mtime, then reselects the original and resumes from confirmed bytes', async () => {
    const { api, storage, uploader } = setup()
    let activeSignal: AbortSignal | undefined
    api.putTransferChunk.mockImplementationOnce((_id, _token, _index, _body, signal) => { activeSignal = signal; return interrupted(signal) })
    const pending = uploader.start(file())
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    uploader.pause()
    await pending
    expect(activeSignal!.aborted).toBe(true)
    expect(uploader.state.phase).toBe('paused')
    const reloaded = createTransferUploader({ storage, api })
    await reloaded.start(file('abcdefghij', 654321))
    expect(reloaded.state.error).toContain('原文件')
    expect(api.getTransferUpload).not.toHaveBeenCalled()
    api.getTransferUpload.mockResolvedValueOnce({ data: { ...status, received_bytes: 4 } })
    api.putTransferChunk.mockClear().mockResolvedValue({ data: status })
    await reloaded.start(file())
    expect(api.createTransferUpload).toHaveBeenCalledOnce()
    expect(api.putTransferChunk.mock.calls.map(call => call[2])).toEqual([1, 2])
    expect(reloaded.state.phase).toBe('completed')
  })

  it('recovers accepted completion after a lost response without uploading again', async () => {
    const { api, storage, uploader } = setup()
    api.completeTransferUpload.mockRejectedValueOnce(new Error('network disconnected'))
    await uploader.start(file())
    expect(uploader.state.phase).toBe('error')
    api.getTransferUpload.mockResolvedValue({ data: { ...status, status: 'completed', received_bytes: 10 } })
    api.putTransferChunk.mockClear()
    const reloaded = createTransferUploader({ storage, api })
    await reloaded.initialize()
    expect(reloaded.state.phase).toBe('completed')
    expect(reloaded.state.saved?.code).toBe('SHARE-CODE')
    expect(api.putTransferChunk).not.toHaveBeenCalled()
  })

  it.each([0, 10737418241])('rejects invalid or over-10 GiB size %s before sampling/reservation', async size => {
    const { uploader, api } = setup()
    const slice = vi.fn()
    await uploader.start({ name: 'huge.bin', size, slice } as unknown as File)
    expect(uploader.state.phase).toBe('error')
    expect(slice).not.toHaveBeenCalled()
    expect(api.createTransferUpload).not.toHaveBeenCalled()
  })

  it('accepts exactly 10 GiB and holds only one 8 MiB upload chunk at a time', async () => {
    const { uploader, api } = setup()
    api.getTransferConfig.mockResolvedValue({ data: { ...config, chunk_bytes: 8388608 } })
    api.createTransferUpload.mockResolvedValue({ data: { ...session, chunk_bytes: 8388608 } })
    let signal: AbortSignal | undefined
    const sizes: number[] = []
    api.putTransferChunk.mockImplementation((_id, _token, _index, body: Blob, current) => { sizes.push(body.size); signal = current; return interrupted(current) })
    const huge = { name: 'huge.bin', size: 10737418240, lastModified: 123, type: '', slice: (start: number, end: number) => new Blob([new Uint8Array(end - start)]) } as File
    const pending = uploader.start(huge)
    await vi.waitFor(() => expect(signal).toBeDefined())
    uploader.pause()
    await pending
    expect(sizes).toEqual([8388608])
  })

  it('obeys smaller server limits and rejects unsafe chunk sizes', async () => {
    const { uploader, api } = setup()
    api.getTransferConfig.mockResolvedValue({ data: { ...config, max_file_bytes: 9 } })
    await uploader.start(file())
    expect(uploader.state.phase).toBe('error')
    expect(api.createTransferUpload).not.toHaveBeenCalled()
    api.getTransferConfig.mockResolvedValue({ data: { ...config, chunk_bytes: 8388609 } })
    const next = createTransferUploader({ api, storage: setup().storage })
    await next.start(file())
    expect(next.state.phase).toBe('error')
    expect(api.createTransferUpload).not.toHaveBeenCalled()
  })

  it('keeps credentials after a lost chunk response and rejects nonaligned server resume offsets', async () => {
    const { uploader, api } = setup()
    api.putTransferChunk.mockRejectedValueOnce(new Error('offline'))
    await uploader.start(file())
    expect(uploader.state.saved).not.toBeNull()
    api.getTransferUpload.mockResolvedValue({ data: { ...status, received_bytes: 3 } })
    api.putTransferChunk.mockClear()
    await uploader.start(file())
    expect(uploader.state.phase).toBe('error')
    expect(api.putTransferChunk).not.toHaveBeenCalled()
  })

  it('aborts before delete; failed cancellation retains credentials until deletion succeeds', async () => {
    const { uploader, api, storage } = setup()
    let signal: AbortSignal | undefined
    api.putTransferChunk.mockImplementationOnce((_id, _token, _index, _body, current) => { signal = current; return interrupted(current) })
    const pending = uploader.start(file())
    await vi.waitFor(() => expect(signal).toBeDefined())
    api.cancelTransferUpload.mockRejectedValueOnce(new Error('offline'))
    await uploader.cancel()
    await pending
    expect(signal!.aborted).toBe(true)
    expect(uploader.state.phase).toBe('error')
    expect(storage.getItem(TRANSFER_UPLOAD_KEY)).not.toBeNull()
    await uploader.cancel()
    expect(api.cancelTransferUpload).toHaveBeenLastCalledWith('upload', 'PRIVATE-TOKEN', expect.any(AbortSignal))
    expect(uploader.state.phase).toBe('idle')
    expect(storage.getItem(TRANSFER_UPLOAD_KEY)).toBeNull()
  })

  it('unmount aborts without deleting the resumable upload and ignores late responses', async () => {
    const { uploader, api, storage } = setup()
    let finish: (() => void) | undefined
    api.putTransferChunk.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = uploader.start(file())
    await vi.waitFor(() => expect(finish).toBeDefined())
    uploader.dispose()
    finish!()
    await pending
    expect(api.completeTransferUpload).not.toHaveBeenCalled()
    expect(api.cancelTransferUpload).not.toHaveBeenCalled()
    expect(storage.getItem(TRANSFER_UPLOAD_KEY)).not.toBeNull()
  })

  it('avoids reservation if local storage cannot persist credentials', async () => {
    const { api } = setup()
    const uploader = createTransferUploader({ api, storage: { getItem: () => null, setItem: () => { throw new Error('storage denied') }, removeItem: () => {} } })
    await uploader.start(file())
    expect(api.createTransferUpload).not.toHaveBeenCalled()
    expect(uploader.state.phase).toBe('error')
  })

  it('removes expired credentials on 410 so a new file may be uploaded', async () => {
    const { uploader, api, storage } = setup()
    api.putTransferChunk.mockRejectedValueOnce(new Error('offline'))
    await uploader.start(file())
    api.getTransferUpload.mockRejectedValueOnce({ response: { status: 410 } })
    const reloaded = createTransferUploader({ storage, api })
    await reloaded.initialize()
    expect(reloaded.state.saved).toBeNull()
    expect(reloaded.state.error).toContain('过期')
    expect(storage.getItem(TRANSFER_UPLOAD_KEY)).toBeNull()
  })
})
