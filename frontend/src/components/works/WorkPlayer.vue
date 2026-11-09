<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Work } from '@/data/works'
import { usePerformanceAudio } from '@/audio/performanceAudio'
import PerformancePlayer from '@/components/performance/PerformancePlayer.vue'

const props = defineProps<{ work: Work }>()
const emit = defineEmits<{ playback: [state: { playing: boolean; playbackProgress: number }] }>()
const audio = usePerformanceAudio()
const mode = ref<'audio' | 'video'>(props.work.audio ? 'audio' : 'video')
const player = ref<HTMLVideoElement | null>(null)
const videoError = ref('')
const videoPlaying = ref(false)
const selected = computed(() => audio.state.value.work?.slug === props.work.slug && audio.state.value.work?.audio === props.work.audio)
const playing = computed(() => mode.value === 'audio' ? selected.value && audio.state.value.playing : videoPlaying.value)
const error = computed(() => mode.value === 'audio' ? (selected.value ? audio.state.value.error : '') : videoError.value)

function fraction(current: number, duration: number) {
  return Number.isFinite(current) && Number.isFinite(duration) && duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0
}
function publishVideo(completed = false) {
  emit('playback', { playing: videoPlaying.value && !videoError.value, playbackProgress: completed ? 1 : fraction(player.value?.currentTime ?? 0, player.value?.duration ?? 0) })
}
function stopVideo() { player.value?.pause(); videoPlaying.value = false }
function onVisibilityChange() { if (document.hidden && mode.value === 'video') { stopVideo(); publishVideo() } }
function retry() { videoError.value = ''; player.value?.load() }
function onPlaybackStart() {
  audio.pause()
  if (document.hidden) { stopVideo(); publishVideo(); return }
  videoPlaying.value = true
  videoError.value = ''
  publishVideo()
}
function onPlaybackPause() { videoPlaying.value = false; publishVideo() }
function onPlaybackEnd() { videoPlaying.value = false; publishVideo(true) }
function onPlaybackError() { stopVideo(); videoError.value = '暂时无法播放。请检查连接后重试。'; publishVideo() }
function setMode(next: 'audio' | 'video') {
  if (next === mode.value) return
  stopVideo()
  audio.pause()
  videoError.value = ''
  mode.value = next
  if (next === 'video') publishVideo()
}

watch(() => [props.work.slug, props.work.audio, props.work.video], () => {
  stopVideo()
  videoError.value = ''
  mode.value = props.work.audio ? 'audio' : 'video'
  if (props.work.audio) audio.select(props.work)
  else audio.pause()
}, { immediate: true, flush: 'pre' })
watch(() => [audio.state.value.work?.slug, audio.state.value.work?.audio, audio.state.value.playing, audio.state.value.loading, audio.state.value.currentTime, audio.state.value.duration, mode.value], () => {
  if (mode.value === 'audio') {
    emit('playback', { playing: playing.value, playbackProgress: selected.value ? fraction(audio.state.value.currentTime, audio.state.value.duration) : 0 })
  } else if (videoPlaying.value && (audio.state.value.playing || audio.state.value.loading)) {
    stopVideo()
    publishVideo()
  }
}, { immediate: true })
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onBeforeUnmount(() => { stopVideo(); document.removeEventListener('visibilitychange', onVisibilityChange) })
defineExpose({ playing, error })
</script>

<template>
  <div class="work-player">
    <div v-if="work.audio && work.video" class="player-modes" role="group" aria-label="播放版本">
      <button type="button" data-mode="audio" :aria-pressed="mode === 'audio'" @click="setMode('audio')">只听声音</button>
      <button type="button" data-mode="video" :aria-pressed="mode === 'video'" @click="setMode('video')">观看影像</button>
    </div>
    <div v-if="mode === 'audio' && work.audio" class="audio-stage">
      <PerformancePlayer :work="work" />
    </div>
    <video v-else-if="work.video" :key="work.video" ref="player" :src="work.video" :poster="work.cover || undefined" controls playsinline preload="none" :aria-label="`${work.title}视频播放器`" @play="onPlaybackStart" @playing="onPlaybackStart" @pause="onPlaybackPause" @timeupdate="publishVideo()" @ended="onPlaybackEnd" @emptied="onPlaybackPause" @error="onPlaybackError" />
    <p v-if="mode === 'video' && videoError" class="player-error" role="status">{{ videoError }}<button type="button" data-retry @click="retry">重新加载 ↗</button><a v-if="work.externalWatch" :href="work.externalWatch" target="_blank" rel="noopener noreferrer">到 Bilibili 观看 ↗</a></p>
  </div>
</template>

<style scoped>
.work-player { min-width: 0; color: #f2f0e9; }
.player-modes { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 28px; }
.player-modes button { min-height: 44px; padding: 8px 0; border: 0; border-bottom: 1px solid transparent; background: transparent; color: #bcbdb3; font: inherit; font-size: .8rem; cursor: pointer; }
.player-modes button[aria-pressed='true'] { border-bottom-color: #c7ff2e; color: #c7ff2e; }
button:focus-visible, a:focus-visible { outline: 2px solid #c7ff2e; outline-offset: 5px; }
video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
.audio-stage { padding: clamp(18px, 3vw, 36px) 0; }
.player-error { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: baseline; padding: 16px 0; font-size: .8rem; color: #bcbdb3; }
.player-error button, .player-error a { padding: 6px 0; border: 0; background: transparent; color: #c7ff2e; font: inherit; cursor: pointer; }
</style>
