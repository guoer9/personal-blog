<script setup lang="ts">
import { computed } from 'vue'
import { usePerformanceAudio } from '@/audio/performanceAudio'
import { formatDuration, type Work } from '@/data/works'

const props = withDefaults(defineProps<{ work: Work; compact?: boolean }>(), { compact: false })
const audio = usePerformanceAudio()
const { state } = audio
const selected = computed(() => state.value.work?.slug === props.work.slug && state.value.work?.audio === props.work.audio)
const playing = computed(() => selected.value && state.value.playing)
const loading = computed(() => selected.value && state.value.loading)
const error = computed(() => selected.value ? state.value.error : '')
const available = computed(() => Boolean(props.work.audio?.trim()))
const currentTime = computed(() => selected.value ? state.value.currentTime : 0)
const duration = computed(() => {
  const value = selected.value ? state.value.duration : (props.work.duration ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const progress = computed(() => duration.value > 0 ? Math.min(1, Math.max(0, currentTime.value / duration.value)) : 0)
const playLabel = computed(() => `${playing.value ? '暂停' : loading.value ? '取消播放' : '播放'} ${props.work.title}`)
function seek(event: Event) { audio.seek(Number((event.target as HTMLInputElement).value)) }
function volume(event: Event) { audio.setVolume(Number((event.target as HTMLInputElement).value)) }
defineExpose({ playing, loading, error })
</script>

<template>
  <div class="performance-player" :class="{ 'is-compact': compact, 'is-playing': playing }" :aria-label="`${work.title}音频播放器`" role="group">
    <div class="transport">
      <button type="button" class="play-control" data-play :disabled="!available" :aria-label="playLabel" :aria-pressed="playing" :aria-busy="loading" @click="audio.toggle(work)">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path v-if="playing || loading" d="M7 5h3v14H7zm7 0h3v14h-3z" />
          <path v-else d="m8 4 12 8-12 8z" />
        </svg>
      </button>
      <div class="track-timeline">
        <div class="track-heading"><span class="track-title">{{ work.title }}</span><span class="track-time">{{ formatDuration(currentTime) }} <span aria-hidden="true">/</span> {{ formatDuration(duration) }}</span></div>
        <input data-seek class="seek-rail" type="range" min="0" max="1" step="0.001" :value="progress" :style="{ '--filled': `${progress * 100}%` }" :disabled="!available || !selected || duration <= 0" :aria-label="`${work.title}播放进度`" :aria-valuetext="`${formatDuration(currentTime)}，共 ${formatDuration(duration)}`" @input="seek" />
      </div>
      <label class="volume-control">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 4-6 5H3v6h3l6 5V4zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg>
        <input data-volume type="range" min="0" max="1" step="0.01" :value="state.volume" :style="{ '--filled': `${state.volume * 100}%` }" aria-label="音量" :aria-valuetext="`${Math.round(state.volume * 100)}%`" @input="volume" />
      </label>
    </div>
    <p v-if="error" class="player-error" role="status">{{ error }} <button type="button" data-retry @click="audio.toggle(work)">重试播放 ↗</button></p>
    <p v-else-if="!available" class="player-empty">音频暂未上线</p>
  </div>
</template>

<style scoped>
.performance-player { --player-ink: #f2f0e9; --player-acid: #c7ff2e; width: 100%; min-width: 0; color: var(--player-ink); }
.transport { display: flex; align-items: center; gap: clamp(14px, 2.5vw, 28px); min-width: 0; }
.play-control { display: grid; flex: 0 0 62px; width: 62px; height: 62px; place-items: center; padding: 0; border: 1px solid currentColor; border-radius: 50%; color: var(--player-ink); background: transparent; cursor: pointer; transition: color .2s, background .2s, border-color .2s; }
.play-control svg { width: 23px; height: 23px; fill: currentColor; }
.play-control:hover:not(:disabled), .is-playing .play-control { color: #080a05; border-color: var(--player-acid); background: var(--player-acid); }
.play-control[aria-busy='true'] { border-color: var(--player-acid); color: var(--player-acid); }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--player-acid); outline-offset: 5px; }
.track-timeline { min-width: 0; flex: 1; }
.track-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.track-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .88rem; }
.track-time { flex-shrink: 0; color: #bcbdb3; font: .66rem var(--mono-font, monospace); font-variant-numeric: tabular-nums; }
.track-time > span { margin: 0 4px; opacity: .5; }
input[type='range'] { display: block; width: 100%; height: 28px; margin: 0; padding: 0; appearance: none; -webkit-appearance: none; border: 0; border-radius: 0; background: transparent; cursor: pointer; accent-color: var(--player-acid); }
input[type='range']::-webkit-slider-runnable-track { height: 1px; background: linear-gradient(to right, var(--player-acid) var(--filled, 0%), #f2f0e94d var(--filled, 0%)); }
input[type='range']::-moz-range-track { height: 1px; background: #f2f0e94d; }
input[type='range']::-moz-range-progress { height: 1px; background: var(--player-acid); }
input[type='range']::-webkit-slider-thumb { width: 8px; height: 8px; margin-top: -3.5px; appearance: none; -webkit-appearance: none; border: 0; border-radius: 50%; background: var(--player-acid); }
input[type='range']::-moz-range-thumb { width: 8px; height: 8px; border: 0; border-radius: 50%; background: var(--player-acid); }
input:disabled { opacity: .35; cursor: default; }
.volume-control { display: flex; flex: 0 0 100px; align-items: center; gap: 10px; }
.volume-control svg { flex-shrink: 0; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
.player-error, .player-empty { margin: 14px 0 0; color: #bcbdb3; font-size: .78rem; }
.player-error button { padding: 6px 0; margin-left: 10px; border: 0; background: none; color: var(--player-acid); font: inherit; cursor: pointer; }
.is-compact .play-control { flex-basis: 48px; width: 48px; height: 48px; }
.is-compact .volume-control { flex-basis: 76px; }
@media (max-width: 540px) {
  .transport { flex-wrap: wrap; gap: 10px 16px; }
  .play-control { flex-basis: 48px; width: 48px; height: 48px; }
  .volume-control, .is-compact .volume-control { flex: 0 0 104px; margin-left: auto; }
  .track-heading { flex-wrap: wrap; gap: 2px 8px; }
  .track-title { max-width: 100%; }
}
</style>
