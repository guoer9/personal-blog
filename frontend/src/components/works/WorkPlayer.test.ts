// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Work } from '@/data/works'
import { createPerformanceAudio, performanceAudioKey, type PerformanceAudio } from '@/audio/performanceAudio'
import PerformancePlayer from '@/components/performance/PerformancePlayer.vue'
import WorkPlayer from './WorkPlayer.vue'
const film: Work = { slug: 'line-time-01', title: '线条时光 第一集', category: 'film', caption: '', description: '', tags: [], accent: 'paper', notes: [], video: '/test-video.mp4', cover: '/test-cover.jpg' }
const music: Work = { ...film, slug: 'rain-at-dawn', title: '凌晨的雨', category: 'music', audio: '/test-audio.mp3' }

describe('user-controlled work player', () => {
  let audio: PerformanceAudio
  let media: HTMLAudioElement[]
  beforeEach(() => {
    media = []
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    vi.stubGlobal('Audio', function () {
      const element = document.createElement('audio')
      let paused = true
      Object.defineProperty(element, 'paused', { get: () => paused })
      Object.defineProperty(element, 'duration', { get: () => 40 })
      element.play = vi.fn(async () => { paused = false; element.dispatchEvent(new Event('playing')) })
      element.pause = vi.fn(() => { paused = true; element.dispatchEvent(new Event('pause')) })
      element.load = vi.fn()
      media.push(element)
      return element
    })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    audio = createPerformanceAudio()
  })
  afterEach(() => { audio.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const render = (work = music) => mount(WorkPlayer, { props: { work }, global: { provide: { [performanceAudioKey as symbol]: audio } } })

  it('does not preload or autoplay video and pauses on hide and unmount with listener cleanup', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = render(film)
    expect(wrapper.get('video').attributes('preload')).toBe('none')
    expect(wrapper.get('video').attributes('autoplay')).toBeUndefined()
    expect(media).toHaveLength(0)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pause).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(pause).toHaveBeenCalledTimes(2)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('uses shared audio and pauses before switching to video with recovery on failure', async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const wrapper = render()
    expect(wrapper.findComponent(PerformancePlayer).exists()).toBe(true)
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(media).toHaveLength(0)
    await wrapper.get('button[data-play]').trigger('click'); await flushPromises()
    expect(audio.state.value.playing).toBe(true)
    await wrapper.get('button[data-mode="video"]').trigger('click')
    expect(media[0]!.paused).toBe(true)
    expect(audio.state.value.playing).toBe(false)
    expect(wrapper.vm.playing).toBe(false)
    await wrapper.get('video').trigger('error')
    expect(wrapper.get('[role="status"]').text()).toContain('暂时无法播放')
    expect(wrapper.vm.error).not.toBe('')
    await wrapper.get('button[data-retry]').trigger('click')
    expect(load).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.error).toBe('')
    wrapper.unmount()
  })

  it('forwards shared audio progress, pause and end without a render tick', async () => {
    const wrapper = render()
    await wrapper.get('button[data-play]').trigger('click'); await flushPromises()
    const element = media[0]!
    element.currentTime = 10; element.dispatchEvent(new Event('timeupdate')); await nextTick()
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: true, playbackProgress: 0.25 }])
    expect(wrapper.vm.playing).toBe(true)
    audio.pause(); await nextTick()
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: false, playbackProgress: 0.25 }])
    await audio.toggle(); element.currentTime = 40
    Object.defineProperty(element, 'ended', { value: true })
    element.dispatchEvent(new Event('ended')); await nextTick()
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: false, playbackProgress: 1 }])
    expect(wrapper.vm.playing).toBe(false)
    wrapper.unmount()
  })

  it('stops audio before video starts and video when audio starts elsewhere', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = render()
    await wrapper.get('button[data-mode="video"]').trigger('click')
    await audio.toggle(music)
    await wrapper.get('video').trigger('play')
    expect(audio.state.value.playing).toBe(false)
    expect(media[0]!.paused).toBe(true)
    expect(wrapper.vm.playing).toBe(true)
    const pauses = pause.mock.calls.length
    await audio.toggle(music); await nextTick()
    expect(pause.mock.calls.length).toBeGreaterThan(pauses)
    expect(wrapper.vm.playing).toBe(false)
    expect(audio.state.value.playing).toBe(true)
    wrapper.unmount()
  })

  it('pauses video on mode and work changes and clears the previous error', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = render()
    await wrapper.get('button[data-mode="video"]').trigger('click')
    await wrapper.get('video').trigger('play')
    await wrapper.get('button[data-mode="audio"]').trigger('click')
    expect(pause).toHaveBeenCalled()
    expect(wrapper.vm.playing).toBe(false)
    await wrapper.get('button[data-mode="video"]').trigger('click')
    await wrapper.get('video').trigger('error')
    const pauses = pause.mock.calls.length
    await wrapper.setProps({ work: { ...music, slug: 'other', audio: '/other.mp3' } })
    expect(pause.mock.calls.length).toBeGreaterThan(pauses)
    expect(wrapper.vm.error).toBe('')
    expect(wrapper.findComponent(PerformancePlayer).exists()).toBe(true)
    expect(audio.state.value.work?.slug).toBe('other')
    wrapper.unmount()
  })

  it('forwards finite video progress, completion and errors', async () => {
    const wrapper = render(film)
    const video = wrapper.get('video')
    Object.defineProperty(video.element, 'duration', { configurable: true, value: 100 })
    Object.defineProperty(video.element, 'currentTime', { configurable: true, value: 25 })
    await video.trigger('play')
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: true, playbackProgress: 0.25 }])
    await video.trigger('pause')
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: false, playbackProgress: 0.25 }])
    await video.trigger('ended')
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: false, playbackProgress: 1 }])
    Object.defineProperty(video.element, 'currentTime', { configurable: true, value: Number.NaN })
    await video.trigger('error')
    expect(wrapper.emitted('playback')?.slice(-1)[0]).toEqual([{ playing: false, playbackProgress: 0 }])
    expect(wrapper.vm.error).not.toBe('')
    wrapper.unmount()
  })

  it('continues the same track through mounting and leaves route pause policy to the owner', async () => {
    await audio.toggle(music)
    media[0]!.currentTime = 10; media[0]!.dispatchEvent(new Event('timeupdate'))
    const wrapper = render()
    expect(wrapper.vm.playing).toBe(true)
    expect(audio.state.value.currentTime).toBe(10)
    wrapper.unmount()
    expect(audio.state.value.playing).toBe(true)
    const other = render({ ...music, slug: 'other', audio: '/other.mp3' })
    expect(audio.state.value.playing).toBe(false)
    expect(media[0]!.paused).toBe(true)
    other.unmount()
  })
})
