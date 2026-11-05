// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicArticle } from '@/api/posts'
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
  { path: '/documents/:slug', name: 'DocumentDetail', component: { template: '<div />' } },
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
          key: page === 2 ? 'post:13' : 'post:1',
          kind: 'post',
          public_url: page === 2 ? '/post/second-page' : '/post/first-page',
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
          key: 'post:13',
          kind: 'post',
          public_url: '/post/second-page',
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

  it.each(['post', 'documents'])('restores focus to the %s article that opened the detail page', async (prefix) => {
    const permalink = `/${prefix}/second-page`
    window.history.replaceState(
      { ...window.history.state, searchReturnFocus: permalink },
      '',
    )
    searchPosts.mockResolvedValue({
      data: {
        items: [{
          id: 13,
          key: prefix === 'post' ? 'post:13' : 'notion:13',
          kind: prefix === 'post' ? 'post' : 'notion',
          public_url: permalink,
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

    const article = wrapper.get(`a[href="${permalink}"]`)
    expect(document.activeElement).toBe(article.element)
    expect(window.history.state.searchReturnFocus).toBeUndefined()

    wrapper.unmount()
  })
})

function article(id: number, title: string): PublicArticle {
  return {
    id,
    title,
    slug: 'article-' + id,
    key: 'post:' + id,
    kind: 'post',
    public_url: '/post/article-' + id,
    summary: 'Search summary',
    is_published: true,
    view_count: 0,
    author: { id: 1, username: 'tester' },
    tags: [],
    created_at: '2026-10-30T12:00:00Z',
    updated_at: '2026-10-30T12:00:00Z',
  }
}

function result(items: PublicArticle[], total = items.length) {
  return { data: { items, total, page: 1, page_size: 12, total_pages: Math.ceil(total / 12) } }
}

function deferred() {
  let resolve!: (value: ReturnType<typeof result>) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<ReturnType<typeof result>>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('Search request lifecycle and query contract', () => {
  let wrapper: ReturnType<typeof mount> | undefined

  async function open(url = '/search?q=alpha') {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(url)
    await router.isReady()
    wrapper = mount(Search, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    return { router, view: wrapper }
  }

  beforeEach(() => {
    searchPosts.mockReset()
    searchPosts.mockResolvedValue(result([]))
    document.body.innerHTML = ''
    window.history.replaceState({}, '')
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
  })

  it('keeps the latest results when an older success arrives last', async () => {
    const oldRequest = deferred()
    const newRequest = deferred()
    searchPosts.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const { router, view } = await open()
    await router.push('/search?q=beta')
    await flushPromises()

    newRequest.resolve(result([article(2, 'Latest result')], 13))
    await flushPromises()
    const input = view.get('#search-query').element as HTMLInputElement
    input.focus()
    oldRequest.resolve(result([article(1, 'Obsolete result')]))
    await flushPromises()

    expect(view.get('.article-link').text()).toContain('Latest result')
    expect(view.get('.search-summary').text()).toContain('13 RESULTS')
    expect(document.activeElement).toBe(input)
  })

  it.each(['success', 'failure'])('keeps loading and focus when an older %s finishes first', async (outcome) => {
    const oldRequest = deferred()
    const newRequest = deferred()
    searchPosts.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const { router, view } = await open()
    await router.push('/search?q=beta')
    await flushPromises()
    const input = view.get('#search-query').element as HTMLInputElement
    input.focus()

    if (outcome === 'success') oldRequest.resolve(result([article(1, 'Obsolete result')]))
    else oldRequest.reject(new Error('old request failed'))
    await flushPromises()

    expect(view.find('[aria-label="正在搜索"]').exists()).toBe(true)
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(view.find('.article-link').exists()).toBe(false)
    expect(document.activeElement).toBe(input)

    newRequest.resolve(result([article(2, 'Latest result')]))
    await flushPromises()
    expect(view.get('.article-link').text()).toContain('Latest result')
    expect(document.activeElement).toBe(view.get('.search-summary').element)
  })

  it('ignores an obsolete failure after the current query succeeds', async () => {
    const oldRequest = deferred()
    searchPosts.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(result([article(2, 'Latest result')]))
    const { router, view } = await open()
    await router.push('/search?q=beta')
    await flushPromises()
    oldRequest.reject(new Error('obsolete network failure'))
    await flushPromises()

    expect(view.find('.inline-error').exists()).toBe(false)
    expect(view.get('.article-link').text()).toContain('Latest result')
  })

  it.each(['success', 'failure'])('clears pending state and ignores an old %s after the query is removed', async (outcome) => {
    const pending = deferred()
    searchPosts.mockReturnValueOnce(pending.promise)
    const { router, view } = await open()
    await router.push('/search')
    await flushPromises()

    expect(view.find('[aria-label="正在搜索"]').exists()).toBe(false)
    expect(view.text()).toContain('输入一个关键词')
    if (outcome === 'success') pending.resolve(result([article(1, 'Obsolete result')]))
    else pending.reject(new Error('obsolete failure'))
    await flushPromises()

    expect(view.find('.article-link').exists()).toBe(false)
    expect(view.find('.inline-error').exists()).toBe(false)
    expect(view.text()).toContain('输入一个关键词')
  })

  it('keeps the latest page when an older pagination response arrives last', async () => {
    const secondPage = deferred()
    const thirdPage = deferred()
    searchPosts.mockResolvedValueOnce(result([article(1, 'First page')], 25))
      .mockReturnValueOnce(secondPage.promise).mockReturnValueOnce(thirdPage.promise)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { router, view } = await open()
    await view.get('button[aria-label="下一页"]').trigger('click')
    await flushPromises()
    await router.push('/search?q=alpha&page=3')
    await flushPromises()

    thirdPage.resolve(result([article(25, 'Third page')], 25))
    await flushPromises()
    secondPage.resolve(result([article(13, 'Second page')], 25))
    await flushPromises()

    expect(view.get('.search-summary').text()).toContain('PAGE 3 / 3')
    expect(view.get('.article-link').text()).toContain('Third page')
    expect(view.get('button[aria-label="下一页"]').attributes('disabled')).toBeDefined()
  })

  it('resets both the URL page and results when the same query is resubmitted', async () => {
    searchPosts.mockImplementation(({ page }: { page: number }) => Promise.resolve(result([
      article(page, page === 1 ? 'First page' : 'Second page'),
    ], 13)))
    const { router, view } = await open('/search?q=alpha&page=2')
    await view.get('.search-form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ q: 'alpha' })
    expect(view.get('.article-link').text()).toContain('First page')
    expect(view.get('.search-summary').text()).toContain('PAGE 1 / 2')
  })

  it('honors the URL page when query and page change together', async () => {
    searchPosts.mockImplementation(({ page }: { page: number }) => Promise.resolve(result([
      article(page, page === 2 ? 'Second page' : 'First page'),
    ], 13)))
    const { router, view } = await open('/search?q=alpha')
    await router.push('/search?q=beta&page=2')
    await flushPromises()

    expect(view.get('.article-link').text()).toContain('Second page')
    expect(view.get('.search-summary').text()).toContain('PAGE 2 / 2')
  })

  it('normalizes fullwidth text and whitespace on keyboard form submission', async () => {
    searchPosts.mockImplementation(({ q }: { q: string }) => Promise.resolve(result(
      q === 'Python cache' ? [article(1, 'Normalized query match')] : [],
    )))
    const { router, view } = await open('/search')
    await view.get('#search-query').setValue('  Ｐｙｔｈｏｎ　　cache  ')
    await view.get('.search-form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.query.q).toBe('Python cache')
    expect(view.get('.article-link').text()).toContain('Normalized query match')
    expect(view.get('#search-query').attributes('aria-describedby')).toContain('search-help')
  })

  it.each(['x'.repeat(121), 'a b c d e f g h i', 'a A a A a A a A a'])('gives useful feedback for oversized input without sending it', async (query) => {
    const { view } = await open('/search')
    await view.get('#search-query').setValue(query)
    await view.get('.search-form').trigger('submit')
    await flushPromises()

    expect(searchPosts).not.toHaveBeenCalled()
    expect(view.get('[role="alert"]').text()).toMatch(/120|8/)
    expect(view.get('#search-query').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(view.get('#search-query').element)
  })

  it('rejects an oversized search URL without sending a request', async () => {
    const { view } = await open('/search?q=a+b+c+d+e+f+g+h+i')

    expect(searchPosts).not.toHaveBeenCalled()
    expect(view.get('[role="alert"]').text()).toContain('8')
    expect(view.find('[aria-label="正在搜索"]').exists()).toBe(false)
  })

  it('keeps backend relevance order instead of sorting by date in the page', async () => {
    searchPosts.mockResolvedValue(result([
      { ...article(1, 'Title match'), created_at: '2020-01-01T00:00:00Z' },
      article(2, 'Body match'),
    ]))
    const { view } = await open()

    expect(view.findAll('.article-link h3').map((title) => title.text())).toEqual(['Title match', 'Body match'])
  })
})
