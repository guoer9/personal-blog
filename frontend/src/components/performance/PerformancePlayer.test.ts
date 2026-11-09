// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Work } from '@/data/works'
import { createPerformanceAudio, performanceAudioKey, type PerformanceAudio } from '@/audio/performanceAudio'
import PerformancePlayer from './PerformancePlayer.vue'

const music: Work = { slug: 'rain', title: '凌晨的雨', category: 'music', caption: '', description: '', tags: [], accent: 'lime', notes: [], audio: '/rain.mp3', duration: 40 }

describe('performance player', () => {
  let controller: PerformanceAudio
  let media: HTMLAudioElement[]
  beforeEach(() => {
    media = []
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    vi.stubGlobal('Audio', function () {
      const audio = document.createElement('audio')
      let paused = true
      Object.defineProperty(audio, 'paused', { get: () => paused })
      Object.defineProperty(audio, 'duration', { get: () => 40 })
      audio.play = vi.fn(async () => { paused = false; audio.dispatchEvent(new Event('playing')) })
      audio.pause = vi.fn(() => { paused = true; audio.dispatchEvent(new Event('pause')) })
      audio.load = vi.fn()
      media.push(audio)
      return audio
    })
    controller = createPerformanceAudio()
  })
  afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const render = (work = music, compact = false) => mount(PerformancePlayer, { props: { work, compact }, global: { provide: { [performanceAudioKey as symbol]: controller } } })

  it('creates no audio until activation and exposes actual playing state', async () => {
    const wrapper = render()
    expect(media).toHaveLength(0)
    expect(wrapper.get('button[data-play]').attributes('aria-label')).toContain('播放')
    expect(wrapper.vm.playing).toBe(false)
    await wrapper.get('button[data-play]').trigger('click'); await flushPromises()
    expect(wrapper.vm.playing).toBe(true)
    expect(wrapper.get('button[data-play]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('button[data-play]').trigger('click')
    expect(wrapper.vm.playing).toBe(false)
    expect(media[0]!.paused).toBe(true)
    wrapper.unmount()
  })

  it('shows event-driven timing, seeks, and adjusts shared volume without ticks', async () => {
    const wrapper = render(music, true)
    await wrapper.get('button[data-play]').trigger('click'); await flushPromises()
    media[0]!.currentTime = 10; media[0]!.dispatchEvent(new Event('timeupdate')); await nextTick()
    expect(wrapper.text()).toContain('0:10')
    expect((wrapper.get('input[data-seek]').element as HTMLInputElement).value).toBe('0.25')
    await wrapper.get('input[data-seek]').setValue('0.5')
    expect(media[0]!.currentTime).toBe(20)
    await wrapper.get('input[data-volume]').setValue('0.3')
    expect(media[0]!.volume).toBe(0.3)
    expect(wrapper.classes()).toContain('is-compact')
    wrapper.unmount()
  })

  it('keeps two instances in sync and does not stop injected playback on unmount', async () => {
    const first = render(); const second = render()
    await first.get('button[data-play]').trigger('click'); await flushPromises()
    expect(second.vm.playing).toBe(true)
    first.unmount()
    expect(controller.state.value.playing).toBe(true)
    expect(media).toHaveLength(1)
    await second.get('button[data-play]').trigger('click')
    expect(controller.state.value.playing).toBe(false)
    second.unmount()
  })

  it('does not show another song as playing and switches only on activation', async () => {
    const wrapper = render()
    const other = render({ ...music, slug: 'other', title: '另一首', audio: '/other.mp3' })
    expect(controller.state.value.work).toBeNull()
    await wrapper.get('button[data-play]').trigger('click'); await flushPromises()
    expect(other.vm.playing).toBe(false)
    await other.get('button[data-play]').trigger('click'); await flushPromises()
    expect(wrapper.vm.playing).toBe(false)
    expect(other.vm.playing).toBe(true)
    expect(media).toHaveLength(1)
    wrapper.unmount(); other.unmount()
  })

  it('offers a retry after rejected playback and clears the visible error on success', async () => {
    const wrapper = render()
    await controller.toggle(music); controller.pause()
    vi.mocked(media[0]!.play).mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
    await wrapper.get('button[data-play]').trigger('click'); await flushPromises()
    expect(wrapper.vm.playing).toBe(false)
    expect(wrapper.vm.error).not.toBe('')
    expect(wrapper.get('[role="status"]').text()).toContain('播放')
    await wrapper.get('button[data-retry]').trigger('click'); await flushPromises()
    expect(wrapper.vm.playing).toBe(true)
    expect(wrapper.vm.error).toBe('')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('disables unavailable audio and disposes a standalone fallback on unmount', async () => {
    const empty = render({ ...music, audio: null })
    expect(empty.get('button[data-play]').attributes('disabled')).toBeDefined()
    expect(empty.get('input[data-seek]').attributes('disabled')).toBeDefined()
    empty.unmount()
    const standalone = mount(PerformancePlayer, { props: { work: music } })
    await standalone.get('button[data-play]').trigger('click'); await flushPromises()
    expect(standalone.vm.playing).toBe(true)
    standalone.unmount()
    expect(media[0]!.paused).toBe(true)
    expect(media[0]!.getAttribute('src')).toBeNull()
  })
})
