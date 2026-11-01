// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PostDetail from './PostDetail.vue'

const getPost = vi.fn()
const getComments = vi.fn()

vi.mock('@/api/posts', () => ({
  getPost: (...args: unknown[]) => getPost(...args),
}))

vi.mock('@/api/comments', () => ({
  getComments: (...args: unknown[]) => getComments(...args),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
}))

const messageError = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: { error: (...args: unknown[]) => messageError(...args), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

vi.mock('md-editor-v3', () => ({
  MdPreview: {
    props: ['modelValue'],
    template: '<div class="mock-prose">{{ modelValue }}</div>',
  },
}))

const routes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/post/:slug', name: 'PostDetail', component: PostDetail },
  { path: '/writing', name: 'Archive', component: { template: '<div />' } },
  { path: '/admin/login', name: 'AdminLogin', component: { template: '<div />' } },
]

const post = {
  id: 101,
  title: '第 11 轮原创文章标题',
  slug: 'round11-article',
  content: '## 原创正文\n\n第 11 轮测试正文。',
  summary: '原创测试摘要。',
  is_published: true,
  view_count: 11,
  author: { id: 1, username: 'tester' },
  tags: [],
  created_at: '2026-10-30T12:00:00Z',
  updated_at: '2026-10-30T12:00:00Z',
}

async function mountPost(path = '/post/round11-article') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PostDetail, {
    attachTo: document.body,
    global: { plugins: [createPinia(), router] },
  })
  await flushPromises()
  return wrapper
}

describe('Post detail loaded-state semantics', () => {
  beforeEach(() => {
    getPost.mockReset()
    getComments.mockReset()
    messageError.mockReset()
    getPost.mockResolvedValue({ data: post })
    getComments.mockResolvedValue({ data: [] })
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('moves focus into the named discussion when its in-page link is activated', async () => {
    const wrapper = await mountPost()
    const section = wrapper.get('#discussion')
    const link = wrapper.get('a[href="#discussion"]')

    expect(section.attributes('tabindex')).toBe('-1')
    ;(link.element as HTMLElement).focus()
    await link.trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(section.element)

    wrapper.unmount()
  })

  it('announces an empty comment result as the named discussion status', async () => {
    const wrapper = await mountPost()

    const list = wrapper.get('.comments-list')
    const empty = wrapper.get('.comments-empty')
    expect(list.attributes('role')).toBe('region')
    expect(list.attributes('aria-labelledby')).toBe('discussion-title')
    expect(empty.attributes('role')).toBe('status')
    expect(empty.attributes('aria-live')).toBe('polite')
    expect(empty.text()).toContain('还没有评论')

    wrapper.unmount()
  })

  it('exposes a comment-loading failure as an alert', async () => {
    getComments.mockRejectedValue(new Error('network'))
    const wrapper = await mountPost()

    expect(wrapper.get('.comments-error').attributes('role')).toBe('alert')
    expect(wrapper.get('.comments-error').text()).toContain('评论暂时没有加载成功')

    wrapper.unmount()
  })

  it('uses one dynamic announcement for an empty result and none for populated comments', async () => {
    const emptyWrapper = await mountPost()
    expect(emptyWrapper.get('.comments-list').attributes('aria-live')).toBeUndefined()
    expect(emptyWrapper.get('.comments-empty').attributes('role')).toBe('status')
    emptyWrapper.unmount()

    getComments.mockResolvedValue({
      data: [{
        id: 1,
        content: '原创评论',
        post_id: 101,
        user: { id: 1, username: 'tester' },
        created_at: '2026-10-30T12:00:00Z',
        replies: [],
      }],
    })
    const populatedWrapper = await mountPost()
    expect(populatedWrapper.find('.comments-empty').exists()).toBe(false)
    expect(populatedWrapper.find('.comments-list').attributes('aria-live')).toBeUndefined()
    expect(populatedWrapper.findAll('[role="status"]')).toHaveLength(0)
    populatedWrapper.unmount()
  })
})

describe('Post detail discussion deep link', () => {
  beforeEach(() => {
    getPost.mockReset()
    getComments.mockReset()
    getPost.mockResolvedValue({ data: post })
    getComments.mockResolvedValue({ data: [] })
    document.body.innerHTML = ''
  })

  it('moves focus to the discussion after directly opening its deep link', async () => {
    const wrapper = await mountPost('/post/round11-article#discussion')

    expect(document.activeElement).toBe(wrapper.get('#discussion').element)

    wrapper.unmount()
  })

  it('leaves focus on the body for a normal article entry', async () => {
    const wrapper = await mountPost()

    expect(document.activeElement).toBe(document.body)

    wrapper.unmount()
  })

  it('does not try to focus a discussion that failed to load', async () => {
    getPost.mockRejectedValue({ response: { status: 503 } })
    const wrapper = await mountPost('/post/round11-article#discussion')

    expect(wrapper.find('#discussion').exists()).toBe(false)
    expect(document.activeElement).toBe(document.body)

    wrapper.unmount()
  })

  it('keeps the not-found state for a 404 discussion deep link', async () => {
    getPost.mockRejectedValue({ response: { status: 404 } })
    const wrapper = await mountPost('/post/round404#discussion')

    expect(wrapper.text()).toContain('这篇文章不在档案里')
    expect(wrapper.find('#discussion').exists()).toBe(false)
    expect(document.activeElement).toBe(document.body)

    wrapper.unmount()
  })
})
