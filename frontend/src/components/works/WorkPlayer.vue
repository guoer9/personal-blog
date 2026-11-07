<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Work } from '@/data/works'

const props = defineProps<{ work: Work }>()
const emit = defineEmits<{ playback: [state: { playing: boolean; playbackProgress: number }] }>()
const mode = ref<'audio' | 'video'>(props.work.audio ? 'audio' : 'video')
const player = ref<HTMLMediaElement | null>(null)
const failed = ref(false)
const playing = ref(false)

function stop() { player.value?.pause() }
function onVisibilityChange() { if (document.hidden) stop() }
function retry() { failed.value = false; player.value?.load() }
function publishPlayback(playing: boolean, target?: EventTarget | null, completed = false) {
  const media = target instanceof HTMLMediaElement ? target : player.value
  const duration = media?.duration ?? 0
  const playbackProgress = completed ? 1 : Number.isFinite(duration) && duration > 0
    ? Math.min(1, Math.max(0, (media?.currentTime ?? 0) / duration))
    : 0
  emit('playback', { playing: playing && !failed.value, playbackProgress })
}
function onPlaybackStart(event: Event) { playing.value = true; publishPlayback(true, event.currentTarget) }
function onPlaybackPause(event: Event) { playing.value = false; publishPlayback(false, event.currentTarget) }
function onPlaybackProgress(event: Event) {
  const media = event.currentTarget as HTMLMediaElement | null
  publishPlayback(playing.value, media)
}
function onPlaybackEnd(event: Event) { playing.value = false; publishPlayback(false, event.currentTarget, true) }
function onPlaybackError(event: Event) { failed.value = true; playing.value = false; publishPlayback(false, event.currentTarget) }

watch(mode, () => { stop(); playing.value = false; failed.value = false; publishPlayback(false, null) }, { flush: 'pre' })
watch(() => props.work.slug, () => { stop(); playing.value = false; mode.value = props.work.audio ? 'audio' : 'video'; failed.value = false; publishPlayback(false, null) })
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onBeforeUnmount(() => { stop(); document.removeEventListener('visibilitychange', onVisibilityChange) })
</script>

<template>
  <div class="work-player">
    <div v-if="work.audio && work.video" class="player-modes" role="group" aria-label="播放版本">
      <button type="button" data-mode="audio" :aria-pressed="mode === 'audio'" @click="mode = 'audio'">只听声音</button>
      <button type="button" data-mode="video" :aria-pressed="mode === 'video'" @click="mode = 'video'">观看影像</button>
    </div>
    <div v-if="mode === 'audio' && work.audio" class="audio-stage">
      <img v-if="work.cover" :src="work.cover" alt="" width="960" height="540" />
      <div class="audio-caption"><span class="eyebrow">SOUND ON YOUR TERMS</span><h2>{{ work.title }}</h2><span>小果Fruit / 音乐作品</span></div>
      <audio :key="work.audio" ref="player" :src="work.audio" controls preload="none" :aria-label="`${work.title}音频播放器`" @play="onPlaybackStart" @pause="onPlaybackPause" @timeupdate="onPlaybackProgress" @ended="onPlaybackEnd" @emptied="onPlaybackPause" @error="onPlaybackError" />
    </div>
    <video v-else :key="work.video || undefined" ref="player" :src="work.video || undefined" :poster="work.cover || undefined" controls playsinline preload="none" :aria-label="`${work.title}视频播放器`" @play="onPlaybackStart" @pause="onPlaybackPause" @timeupdate="onPlaybackProgress" @ended="onPlaybackEnd" @emptied="onPlaybackPause" @error="onPlaybackError" />
    <p v-if="failed" class="player-error" role="status">暂时无法播放。请检查连接后重试。<button type="button" class="text-action" data-retry @click="retry">重新加载</button><a v-if="work.externalWatch" :href="work.externalWatch" target="_blank" rel="noopener noreferrer">到 Bilibili 观看 ↗</a></p>
    <p class="player-note">点击播放后才加载声音或视频。离开此页或切到其他标签页时暂停。</p>
  </div>
</template>

<style scoped>
.player-modes { display: flex; gap: 8px; margin-bottom: 16px; }
.player-modes button { min-height: 44px; padding: 0 20px; border: 1px solid var(--ink); background: transparent; cursor: pointer; }
.player-modes button[aria-pressed='true'] { background: var(--void); color: var(--ink); }
video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #111; }
.audio-stage { position: relative; display: flex; flex-direction: column; justify-content: end; min-height: 400px; padding: clamp(20px, 5vw, 64px); overflow: hidden; background: var(--void); color: var(--ink); }
.audio-stage > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .26; }
.audio-caption, audio { position: relative; z-index: 1; }
.audio-caption { padding: 48px 0; }
.audio-caption h2 { margin: 25px 0 12px; font: 400 clamp(2rem, 5vw, 4rem)/1.2 var(--display-font); }
.audio-caption > span:last-child { font-size: .8rem; }
audio { width: 100%; }
.player-note { margin-top: 14px; color: var(--muted); font-size: .78rem; }
.player-error { display: flex; flex-wrap: wrap; gap: 16px; padding: 20px; border: 1px solid var(--line); font-size: .86rem; }
@media (max-width: 600px) { .audio-stage { min-height: 330px; } }
</style>
