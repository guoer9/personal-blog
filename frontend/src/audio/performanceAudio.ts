import { getCurrentInstance, getCurrentScope, inject, onScopeDispose, provide, ref, type InjectionKey, type Ref } from 'vue'
import type { Work } from '@/data/works'

export interface AudioFeatures {
  bass: number
  mid: number
  treble: number
  energy: number
  active: boolean
}

export interface PerformancePlaybackState {
  work: Work | null
  playing: boolean
  loading: boolean
  error: string
  currentTime: number
  duration: number
  volume: number
}

export interface PerformanceAudio {
  state: Ref<PerformancePlaybackState>
  features: AudioFeatures
  toggle(work?: Work): Promise<void>
  select(work: Work): void
  pause(): void
  seek(progress: number): void
  setVolume(value: number): void
  tick(timeMs: number): void
  dispose(): void
}

export const performanceAudioKey: InjectionKey<PerformanceAudio> = Symbol('performance-audio')
const clamp = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
const seconds = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
const trackKey = (work: Work | null) => work ? `${work.slug}\n${work.audio || ''}` : ''

export function createPerformanceAudio(): PerformanceAudio {
  const state = ref<PerformancePlaybackState>({ work: null, playing: false, loading: false, error: '', currentTime: 0, duration: 0, volume: 0.8 })
  const features: AudioFeatures = { bass: 0, mid: 0, treble: 0, energy: 0, active: false }
  let media: HTMLAudioElement | null = null
  let context: AudioContext | null = null
  let source: MediaElementAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let bins: Uint8Array<ArrayBuffer> | null = null
  let graphAttempted = false
  let sourceKey = ''
  let generation = 0
  let wanted = false
  let disposed = false
  let lastTick: number | null = null
  const listeners: Array<[string, EventListener]> = []

  function resetFeatures() {
    features.bass = features.mid = features.treble = features.energy = 0
    features.active = false
    lastTick = null
  }

  function isCurrentMedia() {
    if (disposed || !media || !sourceKey || sourceKey !== trackKey(state.value.work)) return false
    // currentSrc can still name the preceding resource while the next one loads.
    return !media.currentSrc || new URL(media.currentSrc, document.baseURI).href === new URL(media.src, document.baseURI).href
  }

  function syncTime() {
    if (!isCurrentMedia() || !media) return
    state.value.duration = seconds(media.duration)
    const current = seconds(media.currentTime)
    state.value.currentTime = state.value.duration > 0 ? Math.min(current, state.value.duration) : current
  }

  function pause() {
    if (disposed) return
    generation++
    wanted = false
    state.value.playing = false
    state.value.loading = false
    resetFeatures()
    media?.pause()
  }

  function fail(error: unknown) {
    pause()
    state.value.error = error instanceof Error && error.name === 'NotAllowedError'
      ? '浏览器暂未允许播放，请再点一次播放。'
      : '暂时无法播放，请重试。'
  }

  function createMedia() {
    if (media) return media
    media = new Audio()
    media.preload = 'none'
    media.crossOrigin = 'anonymous'
    media.volume = state.value.volume
    const on = (name: string, listener: EventListener) => { media!.addEventListener(name, listener); listeners.push([name, listener]) }
    const onPlaying = () => {
      if (!isCurrentMedia()) return
      if (!wanted || document.hidden) { media?.pause(); return }
      if (media!.paused || media!.ended) return
      if (context && context.state !== 'running') {
        state.value.playing = false
        state.value.loading = true
        return
      }
      state.value.playing = true
      state.value.loading = false
      syncTime()
    }
    on('playing', onPlaying)
    on('play', () => {
      if (!isCurrentMedia()) return
      if (!wanted || document.hidden) { media?.pause(); return }
      state.value.loading = true
    })
    on('pause', () => {
      if (!isCurrentMedia() || !media!.paused) return
      wanted = false
      generation++
      state.value.playing = state.value.loading = false
      syncTime()
      resetFeatures()
    })
    on('ended', () => {
      if (!isCurrentMedia() || !media!.ended) return
      syncTime()
      pause()
    })
    on('error', () => { if (isCurrentMedia() && media!.error) fail(media!.error) })
    on('waiting', () => {
      if (isCurrentMedia() && wanted && !media!.paused) {
        state.value.playing = false
        state.value.loading = true
        resetFeatures()
      }
    })
    on('emptied', () => {
      if (!isCurrentMedia() || wanted) return
      state.value.playing = state.value.loading = false
      state.value.currentTime = state.value.duration = 0
      resetFeatures()
    })
    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) on(event, syncTime)
    return media
  }

  function createGraph(audio: HTMLAudioElement) {
    if (graphAttempted) return
    graphAttempted = true
    const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return
    try {
      context = new Context()
      analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.65
      bins = new Uint8Array(analyser.frequencyBinCount)
      source = context.createMediaElementSource(audio)
      source.connect(analyser)
      analyser.connect(context.destination)
    } catch {
      // Once captured, the element must stay connected to an output even if
      // analysis is unavailable. Never create a second source for this element.
      source?.disconnect()
      analyser?.disconnect()
      if (source && context) source.connect(context.destination)
      else if (context) {
        // An uncaptured element can keep its native output. A broken analyser
        // must not make ordinary media playback depend on resuming this context.
        void context.close().catch(() => {})
        context = null
      }
      analyser = null
      bins = null
    }
  }

  function select(work: Work) {
    if (disposed) return
    if (trackKey(work) === trackKey(state.value.work)) { state.value.work = work; return }
    pause()
    sourceKey = ''
    if (media) { media.removeAttribute('src'); media.load() }
    state.value.work = work
    state.value.currentTime = 0
    state.value.duration = seconds(work.duration ?? 0)
    state.value.error = ''
  }

  async function toggle(work?: Work) {
    if (disposed) return
    if (work) select(work)
    if (wanted || state.value.playing || state.value.loading) { pause(); return }
    const selected = state.value.work
    if (!selected?.audio?.trim()) { state.value.error = '这首作品暂时没有可播放的音频。'; return }
    if (typeof window === 'undefined' || document.hidden) return
    const request = ++generation
    wanted = true
    state.value.error = ''
    state.value.loading = true
    try {
      const audio = createMedia()
      if (sourceKey !== trackKey(selected)) {
        sourceKey = trackKey(selected)
        audio.src = selected.audio
      } else if (audio.error) {
        audio.load()
      }
      if (audio.ended) audio.currentTime = 0
      createGraph(audio)
      // Both calls happen in the activation stack. Do not await resume before
      // play: doing so loses user activation on some browsers.
      const resume = context && context.state !== 'running' ? context.resume() : Promise.resolve()
      const play = (() => { try { return audio.play() } catch (error) { return Promise.reject(error) } })()
      await Promise.all([resume, play])
      if (disposed || request !== generation) {
        // A stale completion may not pause a newer request on the same element.
        if (!wanted) audio.pause()
        return
      }
      if (document.hidden) { pause(); return }
      if (context && context.state !== 'running') throw new Error('Audio output is not running')
      state.value.playing = !audio.paused && !audio.ended
      state.value.loading = false
      syncTime()
    } catch (error) {
      if (!disposed && request === generation) fail(error)
    }
  }

  function seek(progress: number) {
    if (!isCurrentMedia() || !media || !Number.isFinite(progress) || !Number.isFinite(media.duration) || media.duration <= 0) return
    try { media.currentTime = clamp(progress) * media.duration; syncTime() } catch { /* Metadata may be replaced while scrubbing. */ }
  }

  function setVolume(value: number) {
    if (disposed || !Number.isFinite(value)) return
    state.value.volume = clamp(value)
    if (media) media.volume = state.value.volume
  }

  function tick(timeMs: number) {
    if (disposed || !state.value.playing || !analyser || !bins || !context || context.state !== 'running') { resetFeatures(); return }
    try { analyser.getByteFrequencyData(bins) } catch { resetFeatures(); return }
    const hzPerBin = context.sampleRate / analyser.fftSize
    if (!Number.isFinite(hzPerBin) || hzPerBin <= 0) { resetFeatures(); return }
    const energy = (low: number, high: number) => {
      const start = Math.max(1, Math.ceil(low / hzPerBin))
      const end = Math.min(bins!.length, Math.ceil(high / hzPerBin))
      if (end <= start) return 0
      let sum = 0
      for (let i = start; i < end; i++) sum += (bins![i]! / 255) ** 2
      return clamp(Math.sqrt(sum / (end - start)))
    }
    const elapsed = Number.isFinite(timeMs) && lastTick !== null ? Math.max(0, Math.min(100, timeMs - lastTick)) : 1000 / 60
    if (Number.isFinite(timeMs)) lastTick = timeMs
    const blend = 1 - Math.exp(-elapsed / 80)
    features.bass = clamp(features.bass + (energy(20, 250) - features.bass) * blend)
    features.mid = clamp(features.mid + (energy(250, 2000) - features.mid) * blend)
    features.treble = clamp(features.treble + (energy(2000, 12000) - features.treble) * blend)
    features.energy = clamp(features.energy + (energy(20, 20000) - features.energy) * blend)
    features.active = true
  }

  function onVisibilityChange() { if (document.hidden) pause() }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)

  function dispose() {
    if (disposed) return
    pause()
    disposed = true
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    if (media) {
      for (const [event, listener] of listeners) media.removeEventListener(event, listener)
      media.removeAttribute('src')
      media.load()
    }
    listeners.length = 0
    source?.disconnect()
    analyser?.disconnect()
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    bins = null
    sourceKey = ''
  }

  return { state, features, toggle, select, pause, seek, setVolume, tick, dispose }
}

const localControllers = new WeakMap<object, PerformanceAudio>()

export function usePerformanceAudio(): PerformanceAudio {
  const instance = getCurrentInstance()
  const injected = instance ? inject(performanceAudioKey, undefined) : undefined
  if (injected) return injected
  const scope = getCurrentScope()
  const owner = instance || scope
  const existing = owner ? localControllers.get(owner) : undefined
  if (existing) return existing
  const controller = createPerformanceAudio()
  if (owner) localControllers.set(owner, controller)
  if (instance) provide(performanceAudioKey, controller)
  if (scope) onScopeDispose(() => { controller.dispose(); if (owner) localControllers.delete(owner) })
  return controller
}
