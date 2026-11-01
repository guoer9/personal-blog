// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import NotFound from './NotFound.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: NotFound }],
})

describe('NotFound skip link', () => {
  it('moves keyboard focus to the error content when activated', async () => {
    await router.push('/missing-page')
    await router.isReady()
    const wrapper = mount(NotFound, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    const skipLink = wrapper.get('.skip-link')
    const content = wrapper.get('#lost-content')

    ;(skipLink.element as HTMLElement).focus()
    await skipLink.trigger('click')
    await nextTick()

    expect(content.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(content.element)
    expect(window.location.hash).toBe('#lost-content')

    wrapper.unmount()
  })
})
