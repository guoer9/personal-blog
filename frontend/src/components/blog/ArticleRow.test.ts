// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ArticleRow from './ArticleRow.vue'

const routes = [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }]

const article = {
  id: 1, key: 'notion:1', kind: 'notion', title: '从 Notion 导入的文章',
  slug: 'shared-article', public_url: '/documents/shared-article',
  is_published: true, view_count: 7, author: null,
  tags: [{ name: '技术', slug: 'tech' }],
  created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
} as const

describe('shared article links', () => {
  it('opens the canonical library detail from both archive links', () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ArticleRow, {
      props: { post: { ...article, tags: [...article.tags] }, index: 0 },
      global: { plugins: [router] },
    })

    expect(wrapper.get('.article-link').attributes('href')).toBe('/documents/shared-article')
    expect(wrapper.get('.article-arrow').attributes('href')).toBe('/documents/shared-article')
    expect(wrapper.get('.tag-link').attributes('href')).toBe('/tag/tech')
    wrapper.unmount()
  })

  it('keeps handwritten article permalinks', () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ArticleRow, {
      props: { post: { ...article, kind: 'post', key: 'post:1', public_url: '/post/shared-article', tags: [] }, index: 0 },
      global: { plugins: [router] },
    })
    expect(wrapper.get('.article-link').attributes('href')).toBe('/post/shared-article')
    wrapper.unmount()
  })
})
