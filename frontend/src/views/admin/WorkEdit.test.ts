// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import WorkEdit from './WorkEdit.vue'
import type { AdminWork } from '@/api/works'

const api = vi.hoisted(() => ({ createWork: vi.fn(), getAdminWork: vi.fn(), saveWork: vi.fn(), openPreviewSession: vi.fn(), prepareWorkAsset: vi.fn(), previewWork: vi.fn(), publishWork: vi.fn(), unpublishWork: vi.fn() }))
vi.mock('@/api/works', () => api)
vi.mock('@/utils/request', () => ({ default: { get: vi.fn() } }))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks() })

it('opens the saved draft once while blocking unrelated navigation during a pending save', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/works/new', name: 'AdminWorkCreate', component: WorkEdit },
    { path: '/admin/works/:id/edit', name: 'AdminWorkEdit', component: WorkEdit },
    { path: '/admin/works', component: { template: '<div>作品列表</div>' } },
  ] })
  await router.push('/admin/works/new')
  let finish!: (value: { data: AdminWork }) => void
  api.createWork.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  api.saveWork.mockImplementation(async (_id, version, draft) => ({ data: { id: 'saved-work', slug: 'new-work', version: version + 1, draft } }))
  const confirm = vi.fn(() => true)
  vi.stubGlobal('confirm', confirm)
  wrapper = mount(RouterView, { global: { plugins: [router], stubs: { WorkPlayer: true, WorkCard: true } } })
  await flushPromises()
  const inputs = wrapper.findAll('input')
  await inputs[0]!.setValue('新作品')
  await inputs[1]!.setValue('new-work')
  await wrapper.get('form').trigger('submit')
  await router.push('/admin/works')
  expect(router.currentRoute.value.name).toBe('AdminWorkCreate')
  finish({ data: { id: 'saved-work', slug: 'new-work', draft: api.createWork.mock.calls[0]![1], published: null, version: 1, created_at: '', updated_at: '', published_at: null } })
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/admin/works/saved-work/edit')
  expect(wrapper.get('input').element.value).toBe('新作品')
  expect(confirm).not.toHaveBeenCalled()
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(api.createWork).toHaveBeenCalledTimes(1)
  expect(api.saveWork).toHaveBeenCalledWith('saved-work', 1, expect.objectContaining({ title: '新作品' }))
})
