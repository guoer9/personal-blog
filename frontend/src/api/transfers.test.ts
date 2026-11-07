// @vitest-environment happy-dom
import axios, { type AxiosRequestConfig } from 'axios'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { userState } = vi.hoisted(() => ({
  userState: { token: 'registered-user-token', refreshToken: '', logout: vi.fn(), refreshAccessToken: vi.fn() },
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => userState }))

const calls: AxiosRequestConfig[] = []
let rejectFirstWith: string | null = null
const originalAdapter = axios.defaults.adapter
axios.defaults.adapter = async config => {
  calls.push(config)
  if (rejectFirstWith && calls.length === 1) {
    return Promise.reject({ response: { status: 401, data: { detail: rejectFirstWith } }, config })
  }
  return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
}
const transfers = await import('./transfers')
beforeEach(() => {
  calls.length = 0
  rejectFirstWith = null
  userState.token = 'registered-user-token'
  userState.refreshToken = ''
  userState.logout.mockReset()
  userState.refreshAccessToken.mockReset()
})
afterAll(() => { axios.defaults.adapter = originalAdapter })

describe('authenticated transfer HTTP contract', () => {
  it('sends the registered-user bearer token and keeps codes out of URLs', async () => {
    await transfers.getTransferConfig()
    await transfers.createTransferUpload({ filename: 'clip.mov', size: 10, fingerprint: 'sha256:sample' })
    await transfers.lookupTransfer('SECRET-CODE')
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['get', '/transfers/config'], ['post', '/transfers/uploads'], ['post', '/transfers/lookup'],
    ])
    expect(JSON.parse(calls[1]!.data)).toEqual({ filename: 'clip.mov', size: 10, fingerprint: 'sha256:sample' })
    expect(JSON.parse(calls[2]!.data)).toEqual({ code: 'SECRET-CODE' })
    for (const call of calls) {
      expect(call.headers?.Authorization).toBe('Bearer registered-user-token')
      expect(call.url).not.toContain('SECRET-CODE')
    }
    expect(calls[2]!.withCredentials).toBe(true)
  })

  it('sends raw chunks, token headers and abort/progress options using the documented endpoints', async () => {
    const signal = new AbortController().signal
    const progress = () => {}
    const part = new Blob(['abc'])
    await transfers.putTransferChunk('id/encoded', 'TOKEN', 2, part, signal, progress)
    const call = calls[0]!
    expect(call.url).toBe('/transfers/uploads/id%2Fencoded/chunks/2')
    expect(call.data).toBe(part)
    expect(call.headers?.['Content-Type']).toBe('application/octet-stream')
    expect(call.headers?.['X-Upload-Token']).toBe('TOKEN')
    expect(call.signal).toBe(signal)
    expect(call.onUploadProgress).toBe(progress)
    expect(call.timeout).toBe(0)
    await transfers.getTransferUpload('id', 'TOKEN', signal)
    await transfers.completeTransferUpload('id', 'TOKEN', signal)
    await transfers.cancelTransferUpload('id', 'TOKEN', signal)
    expect(calls.slice(1).map(call => [call.method, call.url, call.headers?.['X-Upload-Token']])).toEqual([
      ['get', '/transfers/uploads/id', 'TOKEN'], ['post', '/transfers/uploads/id/complete', 'TOKEN'], ['delete', '/transfers/uploads/id', 'TOKEN'],
    ])
  })

  it('does not refresh or log out the account for an invalid upload-session token', async () => {
    rejectFirstWith = 'Upload token required'
    userState.refreshToken = 'registered-refresh-token'

    await expect(transfers.getTransferUpload('upload-id', '')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(calls).toHaveLength(1)
    expect(userState.refreshAccessToken).not.toHaveBeenCalled()
    expect(userState.logout).not.toHaveBeenCalled()
  })

  it('refreshes an expired account token and retries the transfer request once', async () => {
    rejectFirstWith = '未登录或登录已过期'
    userState.refreshToken = 'registered-refresh-token'
    userState.refreshAccessToken.mockImplementation(async () => { userState.token = 'refreshed-user-token' })

    await transfers.getTransferConfig()

    expect(userState.refreshAccessToken).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.headers?.Authorization).toBe('Bearer refreshed-user-token')
  })

  it('accepts only the configured download-ticket endpoint on the configured API origin', () => {
    const url = transfers.transferDownloadUrl('/api/v1/transfers/download/ticket_123-abc.signature_456')
    expect(new URL(url).pathname).toBe('/api/v1/transfers/download/ticket_123-abc.signature_456')
    for (const value of [
      'javascript:alert(1)',
      'https://other.example/api/v1/transfers/download/ticket',
      '/api/v1/transfers/download/ticket/extra',
      '/api/v1/transfers/download/%2Fadmin',
      '/api/v1/transfers/download/ticket?code=SECRET',
    ]) expect(() => transfers.transferDownloadUrl(value)).toThrow('下载地址无效')
  })
})
