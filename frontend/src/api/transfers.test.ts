// @vitest-environment happy-dom
import axios, { type AxiosRequestConfig } from 'axios'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const calls: AxiosRequestConfig[] = []
const originalAdapter = axios.defaults.adapter
axios.defaults.adapter = async config => {
  calls.push(config)
  return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
}
const transfers = await import('./transfers')
beforeEach(() => { calls.length = 0 })
afterAll(() => { axios.defaults.adapter = originalAdapter })

describe('public transfer HTTP contract', () => {
  it('sends anonymous JSON create/lookup and keeps codes out of URLs', async () => {
    await transfers.getTransferConfig()
    await transfers.createTransferUpload({ filename: 'clip.mov', size: 10, fingerprint: 'sha256:sample' })
    await transfers.lookupTransfer('SECRET-CODE')
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['get', '/transfers/config'], ['post', '/transfers/uploads'], ['post', '/transfers/lookup'],
    ])
    expect(JSON.parse(calls[1]!.data)).toEqual({ filename: 'clip.mov', size: 10, fingerprint: 'sha256:sample' })
    expect(JSON.parse(calls[2]!.data)).toEqual({ code: 'SECRET-CODE' })
    for (const call of calls) {
      expect(call.headers?.Authorization).toBeUndefined()
      expect(call.url).not.toContain('SECRET-CODE')
      expect(call.withCredentials).toBe(false)
    }
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

  it('accepts only the configured download-ticket endpoint on the configured API origin', () => {
    const url = transfers.transferDownloadUrl('/api/v1/transfers/download/ticket_123-abc')
    expect(new URL(url).pathname).toBe('/api/v1/transfers/download/ticket_123-abc')
    for (const value of [
      'javascript:alert(1)',
      'https://other.example/api/v1/transfers/download/ticket',
      '/api/v1/transfers/download/ticket/extra',
      '/api/v1/transfers/download/%2Fadmin',
      '/api/v1/transfers/download/ticket?code=SECRET',
    ]) expect(() => transfers.transferDownloadUrl(value)).toThrow('下载地址无效')
  })
})
