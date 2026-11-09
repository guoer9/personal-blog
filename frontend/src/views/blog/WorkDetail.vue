<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { categoryLabel, formatDuration, type Work } from '@/data/works'
import { displayedStageWorkKey, getStageArtwork, stageIdentity } from '@/data/stage'
import { getWork, getWorks } from '@/api/works'
import WorkPlayer from '@/components/works/WorkPlayer.vue'
import WorkCard from '@/components/works/WorkCard.vue'
import { visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'

const route = useRoute()
const runtime = inject<Ref<VisualRuntimeBridge | null>>(visualRuntimeKey, ref(null))
const detailAnchor = ref<HTMLElement | null>(null)
const work = ref<Work | null>(null)
const displayedWork = inject(displayedStageWorkKey, null)
watch(work, current => { if (displayedWork) displayedWork.value = current }, { flush: 'sync' })
const related = ref<Work[]>([])
const failedArtwork = ref<string[]>([])
const artwork = computed(() => [getStageArtwork(work.value), getStageArtwork()].find(src => !failedArtwork.value.includes(src)))
function onArtworkError() { if (artwork.value) failedArtwork.value.push(artwork.value) }
const loading = ref(true)
const failed = ref(false)
let controller: AbortController | null = null
let unregisterDetailAnchor: (() => void) | null = null
function registerDetailAnchor() {
  unregisterDetailAnchor?.()
  unregisterDetailAnchor = null
  const activeRuntime = runtime.value
  if (!activeRuntime || !detailAnchor.value) return
  unregisterDetailAnchor = activeRuntime.registerAnchor?.('work-detail', detailAnchor.value) ?? null
  activeRuntime.measureAnchors?.()
}
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  work.value = null
  failedArtwork.value = []
  related.value = []
  loading.value = true
  failed.value = false
  runtime.value?.setPageState('work-detail', { category: null, hasMedia: false, playing: false, playbackProgress: 0 })
  try {
    const response = await getWork(String(route.params.slug), current.signal)
    if (current.signal.aborted) return
    work.value = response.data
    runtime.value?.setPageState('work-detail', { category: response.data.category, hasMedia: Boolean(response.data.video || response.data.audio), playing: false, playbackProgress: 0 })
    document.title = `${response.data.title} · GUOER`
    try {
      const others = await getWorks({ category: response.data.category }, current.signal)
      if (!current.signal.aborted) related.value = others.data.items.filter((item) => item.slug !== response.data.slug).slice(0, 2)
    } catch { /* The main work remains usable if related items fail. */ }
  } catch (error: any) {
    if (!current.signal.aborted) {
      failed.value = error.response?.status !== 404
      document.title = `${failed.value ? '作品暂不可用' : '作品未找到'} · GUOER`
    }
  } finally { if (!current.signal.aborted) loading.value = false }
}
function onPlayback(state: { playing: boolean; playbackProgress: number }) {
  const current = work.value
  if (!current) return
  runtime.value?.setPageState('work-detail', {
    category: current.category,
    hasMedia: Boolean(current.video || current.audio),
    playing: state.playing,
    playbackProgress: state.playbackProgress,
  })
}
watch(() => route.params.slug, load, { immediate: true })
watch([runtime, detailAnchor], registerDetailAnchor, { flush: 'post' })
onBeforeUnmount(() => {
  controller?.abort(); unregisterDetailAnchor?.()
  if (displayedWork?.value === work.value) displayedWork.value = null
})
</script>

<template>
  <article v-if="work" ref="detailAnchor" class="work-detail page-shell page-stage" :class="{ 'work-detail--music': work.category === 'music' }">
    <header class="simple-page-header">
      <router-link :to="{ path: '/works', query: { type: work.category } }" class="back-link">← 返回{{ categoryLabel(work.category) }}作品</router-link>
      <p class="section-kicker">{{ work.category === 'music' ? 'Music / ' + stageIdentity.alias : work.caption }}</p>
      <h1>{{ work.title }}</h1>
      <div class="detail-meta"><span>{{ stageIdentity.name }} / {{ stageIdentity.alias }}</span><span>{{ categoryLabel(work.category) }}</span><span v-if="work.duration">{{ formatDuration(work.duration) }}</span></div>
      <p v-if="work.category !== 'music'" class="page-lede">{{ work.description }}</p>
    </header>

    <div v-if="work.category === 'music'" class="music-stage">
      <div class="detail-artwork" aria-hidden="true"><img v-if="artwork" :key="artwork" :src="artwork" alt="" width="960" height="960" decoding="async" @error="onArtworkError" /></div>
      <div class="music-stage-player">
        <p class="stage-listen-label">Press play. Stay a while.</p>
        <WorkPlayer v-if="work.video || work.audio" :key="work.slug" :work="work" class="detail-player" @playback="onPlayback" />
        <p v-else class="media-unavailable" role="status">这首作品暂时没有可播放的音频或视频。</p>
        <p v-if="work.description" class="music-description">{{ work.description }}</p>
      </div>
    </div>
    <WorkPlayer v-else-if="work.video || work.audio" :key="work.slug" :work="work" class="detail-player" @playback="onPlayback" />
    <div v-else-if="work.category === 'code'" class="repository-feature" :class="`repository-feature--${work.accent}`">
      <span class="eyebrow">Code / {{ stageIdentity.alias }}</span><p>{{ work.title }}</p>
      <a v-if="work.repository" :href="work.repository" target="_blank" rel="noopener noreferrer" class="editorial-button">在 GitHub 查看项目 ↗</a>
      <p v-else class="media-unavailable" role="status">这个项目暂时没有公开的仓库链接。</p>
    </div>
    <div v-else class="film-unavailable"><div class="detail-artwork" aria-hidden="true"><img v-if="artwork" :key="artwork" :src="artwork" alt="" width="960" height="540" @error="onArtworkError" /></div><p class="media-unavailable" role="status">这件作品暂时没有可播放的影像。</p></div>

    <div v-if="work.notes.length || work.tags.length || work.externalWatch" class="detail-description">
      <div><p class="section-kicker">About this work</p><h2>{{ work.category === 'music' ? '关于这首歌' : '关于这件作品' }}</h2></div>
      <div><p v-for="note in work.notes" :key="note">{{ note }}</p><div v-if="work.tags.length" class="detail-tags"><span v-for="tag in work.tags" :key="tag">{{ tag }}</span></div><a v-if="work.externalWatch" :href="work.externalWatch" target="_blank" rel="noopener noreferrer" class="detail-external">在 Bilibili 观看 ↗</a></div>
    </div>
    <section v-if="related.length" class="related-works" aria-labelledby="related-title"><p class="section-kicker">Keep exploring</p><h2 id="related-title">{{ work.category === 'music' ? '下一首。' : '继续看一件。' }}</h2><div><WorkCard v-for="(item, index) in related" :key="item.slug" :work="item" :index="index" heading-tag="h3" /></div></section>
  </article>
  <div v-else class="page-shell missing-work page-stage"><p class="section-kicker">{{ loading ? 'Loading work' : failed ? 'Unable to load' : 'Work not found' }}</p><h1>{{ loading ? '正在读取作品…' : failed ? '暂时无法读取这件作品。' : '这件作品还不在这里。' }}</h1><button v-if="failed" type="button" class="editorial-button" @click="load">重新读取</button> <router-link v-if="!loading" to="/works" class="editorial-button editorial-button--acid">返回作品集 ↗</router-link></div>
</template>

<style scoped>
.simple-page-header h1 { margin-bottom: 24px; font-size: clamp(2.8rem, 7vw, 6rem); line-height: 1.15; overflow-wrap: anywhere; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 12px 28px; margin: 25px 0; color: var(--muted); font: .68rem var(--mono-font); }
.detail-player { margin-top: 40px; }
.work-detail--music .simple-page-header { width: min(100%, 330px); padding-bottom: 0; border-bottom: 0; }
.work-detail--music .simple-page-header h1 { font-size: clamp(2.5rem, 3.7vw, 3.6rem); }
.music-stage { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.65fr) minmax(0, .95fr); align-items: center; gap: 32px; min-height: 360px; margin: 12px 0 100px; }
.music-stage > .detail-artwork { grid-column: 1; }
.detail-artwork { aspect-ratio: 1; position: relative; overflow: hidden; background: radial-gradient(ellipse at 30% 30%, #667e51, #1b3035 40%, #0b1118 80%); }
.detail-artwork > img { width: 100%; height: 100%; object-fit: cover; display: block; }
.music-stage-player { grid-column: 3; min-width: 0; }
.stage-listen-label { margin: 0 0 30px; color: var(--ink); font: 400 clamp(1.4rem, 2.1vw, 2rem)/1.15 var(--display-font); letter-spacing: -.03em; }
.music-stage .detail-player { margin: 0; }
.music-stage :deep(.audio-stage) { min-height: 0; padding: 0; overflow: visible; background: transparent; }
.music-stage :deep(.track-title) { display: none; }
.music-stage :deep(.track-heading) { justify-content: flex-end; }
.music-stage :deep(.transport) { flex-wrap: wrap; }
.music-stage :deep(.volume-control) { margin-left: auto; }
.music-description { margin-top: 30px; max-width: 480px; color: var(--muted); font-size: .88rem; line-height: 1.85; }
.media-unavailable { color: var(--muted); font-size: .88rem; line-height: 1.8; }
.film-unavailable .detail-artwork { aspect-ratio: 16 / 9; }
.repository-feature { display: flex; flex-direction: column; align-items: flex-start; gap: 35px; padding: clamp(30px, 6vw, 80px); margin-top: 40px; min-height: 340px; background: var(--paper-soft); }
.repository-feature--lime { background: var(--acid); color: var(--acid-ink); }
.repository-feature--lime > a { color: var(--acid-ink); border-color: var(--acid-ink); }
.repository-feature--blue { background: var(--electric-blue); color: white; }
.repository-feature--blue > a { border-color: white; color: white; }
.repository-feature > p:not(.media-unavailable) { font: 400 clamp(2rem, 6vw, 5rem)/1.2 var(--display-font); letter-spacing: -.04em; overflow-wrap: anywhere; }
.detail-description { display: grid; grid-template-columns: 1fr 1.4fr; gap: 40px; padding: 60px 0; border-block: 1px solid var(--line); }
.detail-description h2 { font: 400 1.8rem var(--display-font); }
.detail-description > div:last-child > p { color: var(--muted); font-size: .95rem; }
.detail-tags { display: flex; gap: 8px 18px; flex-wrap: wrap; margin: 25px 0; }
.detail-tags span { color: var(--muted); font: .65rem var(--mono-font); }
.detail-external { display: inline-block; padding: 10px 0; font-size: .85rem; text-underline-offset: 5px; }
.related-works { padding-top: 70px; }
.related-works > h2 { font: 400 2rem var(--display-font); margin-bottom: 36px; }
.related-works > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
.missing-work { padding-top: 100px; }
.missing-work > h1 { font: 400 clamp(2.5rem, 6vw, 4rem)/1.3 var(--display-font); }
@media (max-width: 1000px) {
  .work-detail--music .simple-page-header { width: 100%; }
  .music-stage { grid-template-columns: minmax(0, .7fr) minmax(0, 1fr); min-height: 0; gap: 28px; padding-top: clamp(240px, 42vh, 420px); }
  .music-stage-player { grid-column: 2; }
}
@media (max-width: 650px) {
  .music-stage { grid-template-columns: 1fr; padding-top: clamp(180px, 35vh, 300px); margin-bottom: 60px; }
  .music-stage > .detail-artwork { width: min(58%, 220px); }
  .music-stage-player { grid-column: 1; }
}
@media (max-width: 650px) { .detail-description, .related-works > div { grid-template-columns: 1fr; gap: 24px; } .detail-meta { gap: 10px 18px; } }
</style>
