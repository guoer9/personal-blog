<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { getStageArtwork, stageIdentity } from '@/data/stage'
import { parseCategory, workCategories, type Work } from '@/data/works'
import { getWorks } from '@/api/works'
import WorkCard from '@/components/works/WorkCard.vue'
import SocialLinks from '@/components/portfolio/SocialLinks.vue'
import SceneAnchor from '@/components/immersive/SceneAnchor.vue'
import { visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'

const route = useRoute()
const category = computed(() => route.query.type == null ? 'music' : parseCategory(route.query.type))
const filters = ['music', 'film', 'code', 'all'].map(id => workCategories.find(item => item.id === id)!)
const presentation = computed(() => ({
  music: { title: 'Music.', kicker: 'Sound in motion', lede: '从一首歌开始。', empty: '暂时没有公开的音乐作品。' },
  film: { title: 'Films.', kicker: 'Moving images', lede: '一些被留下的生活片段。', empty: '暂时没有公开的影像作品。' },
  code: { title: 'Code.', kicker: 'Ideas into practice', lede: '想法、实验，以及把它们实现的代码。', empty: '暂时没有公开的代码项目。' },
  all: { title: 'Selected works.', kicker: 'Music / Films / Code', lede: '声音、画面和实验，收在这里。', empty: '暂时没有公开的作品。' },
}[category.value]))
const introArtworkFailed = ref(false)
const runtime = inject<Ref<VisualRuntimeBridge | null>>(visualRuntimeKey, ref(null))
const visibleWorks = ref<Work[]>([])
const loading = ref(true)
const failed = ref(false)
const hoveredIndex = ref<number | null>(null)
const keyboardFocusIndex = ref<number | null>(null)
let controller: AbortController | null = null
function publishSceneState() {
  runtime.value?.setPageState('works', {
    category: category.value,
    itemCount: visibleWorks.value.length,
    focusedIndex: keyboardFocusIndex.value ?? hoveredIndex.value,
  })
}
function setHoveredIndex(index: number | null) { hoveredIndex.value = index; publishSceneState() }
function setKeyboardFocusIndex(index: number | null) { keyboardFocusIndex.value = index; publishSceneState() }
function onWorkCardFocusOut(index: number, event: FocusEvent) {
  const card = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return
  if (keyboardFocusIndex.value === index) setKeyboardFocusIndex(null)
}
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  failed.value = false
  visibleWorks.value = []
  publishSceneState()
  try {
    const response = await getWorks(category.value === 'all' ? {} : { category: category.value }, current.signal)
    if (!current.signal.aborted) {
      visibleWorks.value = [...response.data.items].sort((a, b) => ['music', 'film', 'code'].indexOf(a.category) - ['music', 'film', 'code'].indexOf(b.category))
      publishSceneState()
    }
  } catch { if (!current.signal.aborted) failed.value = true }
  finally { if (!current.signal.aborted) loading.value = false }
}
watch(category, () => {
  hoveredIndex.value = null
  keyboardFocusIndex.value = null
  publishSceneState()
})
watch(category, load, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="works-page page-stage page-shell">
    <header class="simple-page-header works-intro">
      <div>
        <router-link to="/" class="back-link">← 返回首页 / HOME</router-link>
        <p class="section-kicker">{{ presentation.kicker }} / {{ stageIdentity.alias }}</p>
        <h1>{{ presentation.title }}</h1>
        <p class="page-lede">{{ presentation.lede }}</p>
      </div>
      <div class="works-intro-art" aria-hidden="true"><img v-if="!introArtworkFailed" :src="getStageArtwork()" alt="" width="240" height="240" @error="introArtworkFailed = true" /></div>
    </header>
    <div class="works-toolbar">
      <nav class="work-filters" aria-label="作品分类">
        <router-link v-for="item in filters" :key="item.id" :to="{ path: '/works', query: { type: item.id } }" :aria-current="category === item.id ? 'page' : 'false'" :aria-current-value="category === item.id ? 'page' : 'false'" :class="{ selected: category === item.id }">{{ item.label }} <small>{{ item.caption }}</small></router-link>
      </nav>
      <p role="status" aria-live="polite">{{ loading ? '正在读取作品…' : failed ? '读取未完成' : `${visibleWorks.length} 件作品` }}</p>
    </div>
    <div v-if="failed" class="works-state" role="status"><p>暂时无法读取作品，请稍后重试。</p><button class="editorial-button" type="button" @click="load">重新读取</button></div>
    <p v-else-if="!loading && !visibleWorks.length" class="works-state" role="status">{{ presentation.empty }}</p>
    <SceneAnchor v-else id="works-grid" :class="category === 'music' ? 'works-grid works-grid--music' : 'works-grid'" :aria-busy="loading">
      <WorkCard v-for="(work, index) in visibleWorks" :key="work.slug" :work="work" :index="index" @pointerenter="setHoveredIndex(index)" @pointerleave="setHoveredIndex(null)" @focusin="setKeyboardFocusIndex(index)" @focusout="onWorkCardFocusOut(index, $event)" />
    </SceneAnchor>
    <SocialLinks />
  </div>
</template>

<style scoped>
.works-intro { display: flex; justify-content: space-between; align-items: center; gap: 40px; padding-bottom: 44px; }
.works-intro > div:first-child { min-width: 0; }
.simple-page-header h1 { margin-bottom: 24px; font-size: clamp(3.3rem, 9vw, 8.5rem); line-height: .98; letter-spacing: -.055em; overflow-wrap: anywhere; }
.works-intro-art { flex: 0 0 min(15vw, 180px); aspect-ratio: 1; overflow: hidden; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #596950, #101319 70%); }
.works-intro-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
.works-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 0; margin-bottom: 40px; border-bottom: 1px solid var(--line); }
.work-filters { display: flex; flex-wrap: wrap; gap: 6px 24px; }
.work-filters a { display: inline-flex; align-items: center; gap: 9px; min-height: 44px; padding: 7px 0; border-bottom: 1px solid transparent; text-decoration: none; color: var(--muted); font-size: .85rem; }
.work-filters small { font: .6rem var(--mono-font); }
.work-filters a.selected { border-color: var(--acid); color: var(--acid); }
.work-filters a:hover { color: var(--ink); }
.works-toolbar > p { margin: 0; white-space: nowrap; color: var(--muted); font: .65rem var(--mono-font); }
.works-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 70px 32px; align-items: start; padding-top: 10px; }
.works-grid > :deep(.work-card) { grid-column: span 6; }
.works-grid--music > :deep(.work-card:nth-child(4n + 1)) { grid-column: 1 / span 7; }
.works-grid--music > :deep(.work-card:nth-child(4n + 2)) { grid-column: 9 / span 4; margin-top: clamp(70px, 13vw, 190px); }
.works-grid--music > :deep(.work-card:nth-child(4n + 3)) { grid-column: 1 / span 4; }
.works-grid--music > :deep(.work-card:nth-child(4n + 4)) { grid-column: 6 / span 7; margin-top: 70px; }
.works-state { min-height: 220px; padding: 60px 0; color: var(--muted); }
@media (max-width: 700px) {
  .works-grid { grid-template-columns: 1fr; gap: 50px; }
  .works-grid > :deep(.work-card:nth-child(n)) { grid-column: 1; margin-top: 0; }
  .works-toolbar { align-items: flex-start; flex-direction: column; gap: 14px; margin-bottom: 26px; }
  .work-filters { column-gap: 22px; }
  .work-filters small { display: none; }
  .works-intro { gap: 12px; }
  .works-intro-art { display: none; }
}
</style>
