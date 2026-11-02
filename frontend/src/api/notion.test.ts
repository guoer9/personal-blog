// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import request from '@/utils/request'
import * as notion from './notion'
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ token: '', refreshToken: '' }) }))
vi.mock('@/router', () => ({ default: { currentRoute: { value: { path: '/admin/notion' } } } }))
const original = request.defaults.adapter
afterEach(() => { request.defaults.adapter = original })
it('uses explicit endpoints, long timeouts, cancellation and connection IDs without tokens', async () => {
  const requests: InternalAxiosRequestConfig[] = []
  request.defaults.adapter = async config => { requests.push(config); return { config, data: {}, status: 200, statusText: 'OK', headers: {} } }
  const signal = new AbortController().signal
  await notion.inspectNotionSource({ connection_id: 'journal', url: 'https://notion.so/database' }, signal)
  await notion.importNotionSource({ connection_id: 'docs', url: 'https://notion.so/other' }, signal)
  await notion.syncNotionSource(8, signal)
  await notion.inspectNotionPage(8, 'https://notion.so/page', signal)
  await notion.importNotionPage(8, 'https://notion.so/page', signal)
  expect(requests.map(item => item.url)).toEqual(['/admin/notion/sources/inspect', '/admin/notion/sources', '/admin/notion/sources/8/sync', '/admin/notion/sources/8/pages/inspect', '/admin/notion/sources/8/pages/import'])
  expect(JSON.parse(requests[0]!.data)).toEqual({ connection_id: 'journal', url: 'https://notion.so/database' })
  expect(JSON.parse(requests[3]!.data)).toEqual({ url: 'https://notion.so/page' })
  expect(requests.every(item => item.signal === signal && item.suppressErrorToast && item.timeout! >= 120000)).toBe(true)
})
