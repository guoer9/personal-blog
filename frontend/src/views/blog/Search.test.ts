// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Search from './Search.vue'

const searchPosts = vi.fn()

vi.mock('@/api/posts', () => ({
  searchPosts: (...args: unknown[]) => searchPosts(...args),
}))

const routes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/search', name: 'Search', component: Search },
  { path: '/writing', name: 'Archive', component: { template: '<div />' } },
  { path: '/post/:slug', name: 'PostDetail', component: { template: '<div />' } },
]

describe('Search results focus', () => {
  beforeEach(() => {
    searchPosts.mockReset()
    searchPosts.mockResolvedValue({ data: { items: [], total: 0 } })
    document.body.innerHTML = ''
  })

  it('moves focus to the result status after an in-page search', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=alpha')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    await wrapper.get('#search-query').setValue('beta')
    await wrapper.get('.search-form').trigger('submit')
    await flushPromises()
    await nextTick()

    const status = wrapper.get('.search-summary')
    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(status.element)
    expect(wrapper.get('.search-results').attributes('role')).toBeUndefined()
    expect(router.currentRoute.value.query.q).toBe('beta')

    wrapper.unmount()
  })

  it('labels the error and summary when the search request fails', async () => {
    searchPosts.mockRejectedValue(new Error('network'))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=failure')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    await nextTick()

    const error = wrapper.get('.inline-error')
    expect(error.attributes('role')).toBe('alert')
    expect(error.get('h2').text()).toContain('搜索暂时不可用')
    expect(wrapper.get('.search-summary').text()).toContain('SEARCH UNAVAILABLE')
    expect(document.activeElement).toBe(wrapper.get('.search-summary').element)

    wrapper.unmount()
  })

  it('restores focus to the results after a failed search is retried', async () => {
    searchPosts.mockRejectedValueOnce(new Error('network'))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=recover')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.find('.inline-error').exists()).toBe(true)
    const retry = wrapper.get('.inline-error button')
    ;(retry.element as HTMLElement).focus()
    expect(document.activeElement).toBe(retry.element)
    await retry.trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.find('.inline-error').exists()).toBe(false)
    expect(wrapper.get('.search-summary').text()).toContain('0 RESULTS')
    expect(document.activeElement).toBe(wrapper.get('.search-summary').element)

    wrapper.unmount()
  })

  it('moves focus to the result status when arriving from the site header', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=gamma')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    await nextTick()

    const status = wrapper.get('.search-summary')
    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(status.element)
    expect(router.currentRoute.value.query.q).toBe('gamma')

    wrapper.unmount()
  })

  it('announces the current page and restores focus after pagination', async () => {
    searchPosts.mockImplementation(({ page }: { page?: number }) => Promise.resolve({
      data: {
        items: [{
          id: page === 2 ? 13 : 1,
          title: page === 2 ? 'Second page article' : 'First page article',
          slug: page === 2 ? 'second-page' : 'first-page',
          summary: 'Test summary',
          is_published: true,
          view_count: 1,
          author: { id: 1, username: 'tester' },
          tags: [],
          created_at: '2026-10-30T12:00:00Z',
          updated_at: '2026-10-30T12:00:00Z',
        }],
        total: 13,
        page: page ?? 1,
        page_size: 12,
        total_pages: 2,
      },
    }))
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=paged')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    const next = wrapper.get('button[aria-label="下一页"]')
    const summary = wrapper.get('.search-summary').element as HTMLElement
    const summaryFocus = vi.spyOn(summary, 'focus')
    ;(next.element as HTMLElement).focus()
    await next.trigger('click')
    await flushPromises()
    await nextTick()

    expect(searchPosts).toHaveBeenLastCalledWith({ q: 'paged', page: 2, page_size: 12 })
    expect(wrapper.get('.search-summary').text()).toContain('PAGE 2 / 2')
    expect(router.currentRoute.value.query.page).toBe('2')
    expect(document.activeElement).toBe(wrapper.get('.search-summary').element)
    expect(summaryFocus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })

    wrapper.unmount()
    summaryFocus.mockRestore()
    scrollTo.mockRestore()
  })

  it('loads the page encoded in the search URL', async () => {
    searchPosts.mockResolvedValue({
      data: {
        items: [{
          id: 13,
          title: 'Second page article',
          slug: 'second-page',
          summary: 'Test summary',
          is_published: true,
          view_count: 1,
          author: { id: 1, username: 'tester' },
          tags: [],
          created_at: '2026-10-30T12:00:00Z',
          updated_at: '2026-10-30T12:00:00Z',
        }],
        total: 13,
        page: 2,
        page_size: 12,
        total_pages: 2,
      },
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=paged&page=2')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(searchPosts).toHaveBeenCalledWith({ q: 'paged', page: 2, page_size: 12 })
    expect(wrapper.get('.search-summary').text()).toContain('PAGE 2 / 2')
    expect(wrapper.get('.article-link').text()).toContain('Second page article')

    wrapper.unmount()
  })

  it('clears a stale page when a different keyword is submitted', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=first&page=2')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    await wrapper.get('#search-query').setValue('second')
    await wrapper.get('.search-form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ q: 'second' })

    wrapper.unmount()
  })

  it('restores focus to the article that opened the detail page', async () => {
    window.history.replaceState(
      { ...window.history.state, searchReturnFocus: '/post/second-page' },
      '',
    )
    searchPosts.mockResolvedValue({
      data: {
        items: [{
          id: 13,
          title: 'Second page article',
          slug: 'second-page',
          summary: 'Test summary',
          is_published: true,
          view_count: 1,
          author: { id: 1, username: 'tester' },
          tags: [],
          created_at: '2026-10-30T12:00:00Z',
          updated_at: '2026-10-30T12:00:00Z',
        }],
        total: 13,
        page: 2,
        page_size: 12,
        total_pages: 2,
      },
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/search?q=paged&page=2')
    await router.isReady()
    const wrapper = mount(Search, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    await nextTick()

    const article = wrapper.get('a[href="/post/second-page"]')
    expect(document.activeElement).toBe(article.element)
    expect(window.history.state.searchReturnFocus).toBeUndefined()

    wrapper.unmount()
  })
})
