// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { Work } from '@/data/works'
import { createPerformanceAudio, performanceAudioKey, usePerformanceAudio, type PerformanceAudio } from './performanceAudio'

const first: Work = { slug: 'first', title: '第一首', category: 'music', caption: '', description: '', tags: [], accent: 'lime', notes: [], audio: '/first.mp3' }
const second: Work = { ...first, slug: 'second', title: '第二首', audio: '/second.mp3' }
const deferred = () => {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Browser media and Web Audio are the external boundary; the controller is real.
class Media extends EventTarget {
  static instances: Media[] = []
  static playFailure: unknown = null
  src = ''
  preload = ''
  crossOrigin = ''
  volume = 1
  currentTime = 0
  duration = 120
  paused = true
  ended = false
  error: { code: number } | null = null
  get currentSrc() { return this.src }
  constructor() { super(); Media.instances.push(this) }
  play = vi.fn((): Promise<void> => { if (Media.playFailure) return Promise.reject(Media.playFailure); this.start(); return Promise.resolve() })
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')) })
  load = vi.fn(() => { this.currentTime = 0; this.error = null; this.dispatchEvent(new Event('emptied')) })
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  start() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')) }
  fire(name: string) { this.dispatchEvent(new Event(name)) }
}

class Context {
  static instances: Context[] = []
  static analysisFailure = false
  state: AudioContextState = 'running'
  sampleRate = 48000
  destination = {}
  bins = new Uint8Array(1024)
  analyser = { fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0, connect: vi.fn(), disconnect: vi.fn(), getByteFrequencyData: vi.fn((data: Uint8Array) => data.set(this.bins)) }
  source = { connect: vi.fn(), disconnect: vi.fn() }
  createAnalyser = vi.fn(() => { if (Context.analysisFailure) { this.state = 'suspended'; this.resume.mockRejectedValue(new Error('analysis unavailable')); throw new Error('analysis unavailable') }; return this.analyser })
  createMediaElementSource = vi.fn(() => this.source)
  resume = vi.fn((): Promise<void> => { this.state = 'running'; return Promise.resolve() })
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { Context.instances.push(this) }
}

describe('shared performance audio', () => {
  const controllers: PerformanceAudio[] = []
  const create = () => { const controller = createPerformanceAudio(); controllers.push(controller); return controller }
  beforeEach(() => {
    Media.instances = []; Media.playFailure = null; Context.instances = []; Context.analysisFailure = false
    vi.stubGlobal('Audio', Media)
    vi.stubGlobal('AudioContext', Context)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })
  afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('selects without constructing media, requesting audio, or starting a clock', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const controller = create()
    controller.select(first); controller.tick(0); controller.seek(0.5); controller.setVolume(0.4)
    expect(controller.state.value).toMatchObject({ work: first, playing: false, loading: false, currentTime: 0, volume: 0.4 })
    expect(Media.instances).toHaveLength(0)
    expect(Context.instances).toHaveLength(0)
    expect(raf).not.toHaveBeenCalled()
  })

  it('keeps one audio element, source and context across tracks and resumes', async () => {
    const controller = create()
    await controller.toggle(first)
    expect(controller.state.value.playing).toBe(true)
    expect(Media.instances[0]!.preload).toBe('none')
    controller.pause(); await controller.toggle(); await controller.toggle(second)
    expect(controller.state.value).toMatchObject({ work: second, playing: true, error: '' })
    expect(Media.instances).toHaveLength(1)
    expect(Context.instances).toHaveLength(1)
    expect(Context.instances[0]!.createMediaElementSource).toHaveBeenCalledTimes(1)
    expect(Media.instances[0]!.src).toContain('/second.mp3')
  })

  it('shows autoplay rejection as stopped and allows an explicit retry', async () => {
    const controller = create()
    Media.playFailure = new DOMException('blocked', 'NotAllowedError')
    await controller.toggle(first)
    expect(controller.state.value).toMatchObject({ playing: false, loading: false })
    expect(controller.state.value.error).not.toBe('')
    expect(controller.features.active).toBe(false)
    Media.playFailure = null
    await controller.toggle()
    expect(Media.instances[0]!.play).toHaveBeenCalledTimes(2)
    expect(controller.state.value).toMatchObject({ playing: true, error: '' })
  })

  it('does not revive playback when pause wins a pending play promise', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const pending = deferred()
    const media = Media.instances[0]!
    media.play.mockImplementationOnce(() => pending.promise)
    const play = controller.toggle()
    expect(controller.state.value.loading).toBe(true)
    controller.pause()
    media.start(); pending.resolve(); await play
    expect(media.paused).toBe(true)
    expect(controller.state.value).toMatchObject({ playing: false, loading: false, error: '' })
  })

  it('does not let a stale success or rejection stop a newly selected track', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const media = Media.instances[0]!
    const pending = deferred()
    media.play.mockImplementationOnce(() => pending.promise)
    const previousPlay = controller.toggle()
    await controller.toggle(second)
    pending.resolve(); await previousPlay
    expect(controller.state.value).toMatchObject({ work: second, playing: true, loading: false, error: '' })
    expect(media.paused).toBe(false)
    controller.pause()
    const rejected = deferred()
    media.play.mockImplementationOnce(() => rejected.promise)
    const previousRetry = controller.toggle()
    await controller.toggle(first)
    rejected.reject(new DOMException('old request', 'AbortError')); await previousRetry
    expect(controller.state.value).toMatchObject({ work: first, playing: true, error: '' })
    expect(media.paused).toBe(false)
  })

  it('invalidates pending AudioContext resume after a pause or selection', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const context = Context.instances[0]!
    context.state = 'suspended'
    const pending = deferred(); context.resume.mockReturnValueOnce(pending.promise)
    const play = controller.toggle()
    controller.select(second)
    pending.resolve(); await play
    expect(controller.state.value).toMatchObject({ work: second, playing: false, loading: false, currentTime: 0 })
    expect(Media.instances[0]!.paused).toBe(true)
    expect(Media.instances[0]!.src).not.toContain('/second.mp3')
  })

  it('handles failed context resume without claiming playback', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const context = Context.instances[0]!
    context.state = 'suspended'; context.resume.mockRejectedValueOnce(new Error('resume denied'))
    await controller.toggle()
    expect(controller.state.value).toMatchObject({ playing: false, loading: false })
    expect(controller.state.value.error).not.toBe('')
    expect(Media.instances[0]!.paused).toBe(true)
  })

  it('resumes an interrupted graph on an explicit playback request', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const context = Context.instances[0]!
    context.state = 'interrupted' as AudioContextState
    await controller.toggle()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.state).toBe('running')
    expect(controller.state.value).toMatchObject({ playing: true, loading: false, error: '' })
  })

  it('does not report success if resume resolves while the graph is still interrupted', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const context = Context.instances[0]!
    context.state = 'interrupted' as AudioContextState
    context.resume.mockResolvedValueOnce()
    await controller.toggle()
    expect(controller.state.value).toMatchObject({ playing: false, loading: false })
    expect(controller.state.value.error).not.toBe('')
    expect(Media.instances[0]!.paused).toBe(true)
  })

  it('updates progress, buffering, pause, end and media errors even without ticks', async () => {
    const controller = create()
    await controller.toggle(first)
    const media = Media.instances[0]!
    media.duration = 40; media.currentTime = 10; media.fire('loadedmetadata'); media.fire('timeupdate')
    expect(controller.state.value).toMatchObject({ playing: true, currentTime: 10, duration: 40 })
    media.fire('waiting')
    expect(controller.state.value.loading).toBe(true)
    media.fire('playing')
    expect(controller.state.value.loading).toBe(false)
    media.pause()
    expect(controller.state.value.playing).toBe(false)
    await controller.toggle()
    media.currentTime = 40; media.ended = true; media.paused = true; media.fire('ended')
    expect(controller.state.value).toMatchObject({ playing: false, loading: false, currentTime: 40 })
    expect(controller.features).toMatchObject({ bass: 0, mid: 0, treble: 0, energy: 0, active: false })
    await controller.toggle()
    media.error = { code: 3 }; media.fire('error')
    expect(controller.state.value).toMatchObject({ playing: false, loading: false })
    expect(controller.state.value.error).not.toBe('')
    expect(media.paused).toBe(true)
  })

  it('pauses immediately when hidden and never resumes just because visibility returns', async () => {
    const controller = create()
    await controller.toggle(first)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(controller.state.value).toMatchObject({ playing: false, loading: false })
    expect(Media.instances[0]!.paused).toBe(true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(controller.state.value.playing).toBe(false)
  })

  it('clamps seek and volume and keeps non-finite media values out of state', async () => {
    const controller = create()
    await controller.toggle(first)
    const media = Media.instances[0]!
    media.duration = 40; media.fire('loadedmetadata')
    controller.seek(0.25); expect(media.currentTime).toBe(10)
    controller.seek(2); expect(media.currentTime).toBe(40)
    controller.seek(-1); expect(media.currentTime).toBe(0)
    controller.seek(Number.NaN); expect(media.currentTime).toBe(0)
    controller.setVolume(2); expect(media.volume).toBe(1)
    controller.setVolume(-1); expect(media.volume).toBe(0)
    controller.setVolume(Number.NaN); expect(Number.isFinite(media.volume)).toBe(true)
    media.duration = Infinity; media.currentTime = Number.NaN; media.fire('durationchange'); media.fire('timeupdate')
    expect(controller.state.value.duration).toBe(0)
    expect(controller.state.value.currentTime).toBe(0)
  })

  it('samples distinct finite frequency bands into one stable object and resets on pause', async () => {
    const controller = create()
    const features = controller.features
    await controller.toggle(first)
    const context = Context.instances[0]!
    // 48 kHz / 2048 = 23.4375 Hz per bin: 1..10 are bass, 11..85 mid, 86..511 treble.
    context.bins.fill(255, 1, 11)
    for (let time = 0; time < 1000; time += 16) controller.tick(time)
    expect(features.bass).toBeGreaterThan(0.95)
    expect(features.mid).toBe(0); expect(features.treble).toBe(0)
    expect(features.energy).toBeGreaterThan(0)
    expect(features.active).toBe(true)
    context.bins.fill(255)
    for (const time of [Number.NaN, Infinity, -1, 2000, 2016]) controller.tick(time)
    for (const value of [features.bass, features.mid, features.treble, features.energy]) {
      expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1)
    }
    expect(features.mid).toBeGreaterThan(0); expect(features.treble).toBeGreaterThan(0)
    expect(controller.features).toBe(features)
    controller.pause()
    expect(features).toEqual({ bass: 0, mid: 0, treble: 0, energy: 0, active: false })
  })

  it('plays without Web Audio and keeps unavailable analysis at zero', async () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    const controller = create()
    await controller.toggle(first); controller.tick(100)
    expect(controller.state.value.playing).toBe(true)
    expect(controller.features).toEqual({ bass: 0, mid: 0, treble: 0, energy: 0, active: false })
  })

  it('continues native playback if analysis initialization fails before capture', async () => {
    Context.analysisFailure = true
    const controller = create()
    await controller.toggle(first); controller.tick(100)
    expect(controller.state.value).toMatchObject({ playing: true, loading: false, error: '' })
    expect(controller.features).toEqual({ bass: 0, mid: 0, treble: 0, energy: 0, active: false })
    expect(Context.instances[0]!.state).toBe('closed')
    controller.pause(); await controller.toggle(second)
    expect(controller.state.value.playing).toBe(true)
    expect(Context.instances).toHaveLength(1)
  })

  it('refuses empty sources without allocating media', async () => {
    const controller = create()
    await controller.toggle({ ...first, audio: null })
    expect(controller.state.value.playing).toBe(false)
    expect(controller.state.value.error).not.toBe('')
    expect(Media.instances).toHaveLength(0)
  })

  it('releases resources and listeners once and ignores pending completions after disposal', async () => {
    const controller = create()
    await controller.toggle(first); controller.pause()
    const media = Media.instances[0]!
    const context = Context.instances[0]!
    const pending = deferred(); media.play.mockReturnValueOnce(pending.promise)
    const play = controller.toggle()
    controller.dispose(); controller.dispose()
    media.start(); pending.resolve(); await play
    expect(media.paused).toBe(true); expect(media.src).toBe('')
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(context.source.disconnect).toHaveBeenCalledTimes(1)
    expect(context.analyser.disconnect).toHaveBeenCalledTimes(1)
    const lastState = { ...controller.state.value }
    media.currentTime = 33; media.fire('timeupdate'); media.fire('error')
    expect(controller.state.value).toEqual(lastState)
    const pauses = media.pause.mock.calls.length
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await controller.toggle(second)
    expect(media.pause).toHaveBeenCalledTimes(pauses)
  })

  it('reuses injected controllers and owns a single cleaned-up fallback in a component scope', async () => {
    let local!: PerformanceAudio
    let reused!: PerformanceAudio
    const Probe = defineComponent({ setup() { local = usePerformanceAudio(); reused = usePerformanceAudio(); return () => h('span') } })
    const wrapper = mount(Probe)
    expect(local).toBe(reused)
    await local.toggle(first)
    wrapper.unmount()
    expect(Media.instances[0]!.paused).toBe(true)
    expect(Context.instances[0]!.state).toBe('closed')
    const provided = create()
    const injected = mount(Probe, { global: { provide: { [performanceAudioKey as symbol]: provided } } })
    expect(local).toBe(provided)
    await provided.toggle(first); injected.unmount()
    expect(provided.state.value.playing).toBe(true)
  })
})
