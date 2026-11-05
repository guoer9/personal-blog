// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ArticleRow from './ArticleRow.vue'

const post = {
  id: 1,
  title: '中文短链',
  slug: '中文 文章/测试',
  content: '正文',
  summary: '摘要',
  is_published: true,
  view_count: 0,
  author: { id: 1, username: 'reader' },
  tags: [],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

describe('ArticleRow links', () => {
  it('encodes a post slug through the named route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/post/:slug', name: 'PostDetail', component: { template: '<div />' } }],
    })
    await router.push('/')
    const wrapper = mount(ArticleRow, {
      props: { post, index: 0 },
      global: { plugins: [router] },
    })

    expect(wrapper.get('.article-link').attributes('href')).toBe('/post/%E4%B8%AD%E6%96%87%20%E6%96%87%E7%AB%A0%2F%E6%B5%8B%E8%AF%95')
    expect(wrapper.get('.article-arrow').attributes('href')).toBe('/post/%E4%B8%AD%E6%96%87%20%E6%96%87%E7%AB%A0%2F%E6%B5%8B%E8%AF%95')
    wrapper.unmount()
  })
})
