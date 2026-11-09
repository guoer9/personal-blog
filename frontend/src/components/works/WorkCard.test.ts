// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import WorkCard from './WorkCard.vue'
import type { Work } from '@/data/works'

const work: Work = { slug: 'a-song', title: 'A song', category: 'music', caption: 'A caption', description: 'Details', tags: ['tag'], accent: 'paper', notes: [], audio: '/audio.mp3' }
async function mountCard(props: Partial<{ work: Work; previewMode: boolean }> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  await router.push('/works'); await router.isReady()
  return mount(WorkCard, { props: { work, index: 0, ...props }, global: { plugins: [router] } })
}

describe('WorkCard artwork and navigation', () => {
  it('offers a single explicit detail link without nested playback controls or media requests', async () => {
    const wrapper = await mountCard()
    try {
      expect(wrapper.attributes('href')).toBe('/works/a-song')
      expect(wrapper.text()).toContain('进入单曲')
      expect(wrapper.element.querySelectorAll('button, audio, video, a')).toHaveLength(0)
      expect(wrapper.get('img').attributes('src')).toBeTruthy()
    } finally { wrapper.unmount() }
  })

  it('retains artwork and a working link after both image sources fail', async () => {
    const wrapper = await mountCard({ work: { ...work, cover: '/broken.jpg' } })
    try {
      await wrapper.get('img').trigger('error')
      if (wrapper.find('img').exists()) await wrapper.get('img').trigger('error')
      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find('.work-card__visual').exists()).toBe(true)
      expect(wrapper.attributes('href')).toBe('/works/a-song')
    } finally { wrapper.unmount() }
  })

  it('keeps previewMode non-interactive for existing consumers', async () => {
    const wrapper = await mountCard({ previewMode: true })
    try {
      expect(wrapper.element.tagName).toBe('DIV')
      expect(wrapper.findAll('a, button')).toHaveLength(0)
    } finally { wrapper.unmount() }
  })
})
