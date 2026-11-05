// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Work } from '@/data/works'
import WorkPlayer from './WorkPlayer.vue'
const film: Work = { slug: 'line-time-01', title: '线条时光 第一集', category: 'film', caption: '', description: '', tags: [], accent: 'paper', notes: [], video: '/api/v1/work-assets/test-video', cover: '/api/v1/work-assets/test-cover' }
const music: Work = { ...film, slug: 'rain-at-dawn', title: '凌晨的雨', category: 'music', audio: '/api/v1/work-assets/test-audio' }

describe('user-controlled work player', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not preload or autoplay, and pauses when leaving the page or hiding the tab', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = mount(WorkPlayer, { props: { work: film } })
    const video = wrapper.get('video')
    expect(video.attributes('preload')).toBe('none')
    expect(video.attributes('autoplay')).toBeUndefined()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pause).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(pause).toHaveBeenCalledTimes(2)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('pauses audio before switching to the music video and exposes recovery on failure', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const wrapper = mount(WorkPlayer, { props: { work: music } })
    expect(wrapper.get('audio').attributes('preload')).toBe('none')
    await wrapper.get('button[data-mode="video"]').trigger('click')
    expect(pause).toHaveBeenCalled()
    expect(wrapper.emitted('playback')).toEqual([[{ playing: false, playbackProgress: 0 }]])
    expect(wrapper.find('audio').exists()).toBe(false)
    await wrapper.get('video').trigger('error')
    expect(wrapper.get('[role="status"]').text()).toContain('暂时无法播放')
    await wrapper.get('button[data-retry]').trigger('click')
    expect(load).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('emits playback state from the controlled media element', async () => {
    const wrapper = mount(WorkPlayer, { props: { work: music } })
    const audio = wrapper.get('audio').element as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 10 })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 40 })
    Object.defineProperty(audio, 'paused', { configurable: true, value: false })
    await wrapper.get('audio').trigger('play')
    await wrapper.get('audio').trigger('timeupdate')
    await wrapper.get('audio').trigger('pause')
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 40 })
    await wrapper.get('audio').trigger('ended')
    await wrapper.get('audio').trigger('error')
    expect(wrapper.emitted('playback')).toEqual([
      [{ playing: true, playbackProgress: 0.25 }],
      [{ playing: true, playbackProgress: 0.25 }],
      [{ playing: false, playbackProgress: 0.25 }],
      [{ playing: false, playbackProgress: 1 }],
      [{ playing: false, playbackProgress: 1 }],
    ])
    wrapper.unmount()
  })
})
