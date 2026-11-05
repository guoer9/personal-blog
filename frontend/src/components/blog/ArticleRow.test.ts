// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ArticleRow from './ArticleRow.vue'
import type { PublicArticle } from '@/api/posts'

const notionArticle: PublicArticle = {
  id: 1,
  key: 'notion:1',
  kind: 'notion',
  public_url: '/documents/shared-article',
  title: '从 Notion 导入的文章',
  slug: 'shared-article',
  summary: '摘要',
  is_published: true,
  view_count: 7,
  author: null,
  tags: [{ name: '技术', slug: 'tech' }],
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
}

const manualArticle: PublicArticle = {
  ...notionArticle,
  id: 2,
  key: 'post:2',
  kind: 'post',
  public_url: '/documents/%E4%B8%AD%E6%96%87%20%E6%96%87%E7%AB%A0%2F%E6%B5%8B%E8%AF%95',
  slug: '中文 文章/测试',
  author: { id: 2, username: 'reader' },
  tags: [],
}

const routes = [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }]

describe('shared article links', () => {
  it('opens Notion articles and tags from the shared archive row', () => {
    const router = createRouter({
      history: createMemoryHistory(), routes,
    })
    const wrapper = mount(ArticleRow, {
      props: { post: notionArticle, index: 0 },
      global: { plugins: [router] },
    })

    expect(wrapper.get('.article-link').attributes('href')).toBe('/documents/shared-article')
    expect(wrapper.get('.article-arrow').attributes('href')).toBe('/documents/shared-article')
    expect(wrapper.get('.tag-link').attributes('href')).toBe('/tag/tech')
    wrapper.unmount()
  })

  it('encodes a handwritten article slug through the canonical route', () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ArticleRow, {
      props: { post: manualArticle, index: 0 },
      global: { plugins: [router] },
    })
    expect(wrapper.get('.article-link').attributes('href')).toBe(manualArticle.public_url)
    expect(wrapper.get('.article-arrow').attributes('href')).toBe(manualArticle.public_url)
    wrapper.unmount()
  })
})
