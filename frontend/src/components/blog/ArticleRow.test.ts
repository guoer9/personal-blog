// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ArticleRow from './ArticleRow.vue'
import type { PublicArticle } from '@/api/posts'

const post: PublicArticle = {
  id: 1,
  key: 'post:1',
  kind: 'post',
  public_url: '/documents/%E4%B8%AD%E6%96%87%20%E6%96%87%E7%AB%A0%2F%E6%B5%8B%E8%AF%95',
  title: '中文短链',
  slug: '中文 文章/测试',
  summary: '摘要',
  is_published: true,
  view_count: 0,
  author: { id: 1, username: 'reader' },
  tags: [],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

describe('ArticleRow links', () => {
  it('encodes an article slug through the canonical document route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/documents/:slug', name: 'DocumentDetail', component: { template: '<div />' } }],
    })
    await router.push('/')
    const wrapper = mount(ArticleRow, {
      props: { post, index: 0 },
      global: { plugins: [router] },
    })

    expect(wrapper.get('.article-link').attributes('href')).toBe('/documents/%E4%B8%AD%E6%96%87%20%E6%96%87%E7%AB%A0%2F%E6%B5%8B%E8%AF%95')
    expect(wrapper.get('.article-arrow').attributes('href')).toBe('/documents/%E4%B8%AD%E6%96%87%20%E6%96%87%E7%AB%A0%2F%E6%B5%8B%E8%AF%95')
    wrapper.unmount()
  })
})
