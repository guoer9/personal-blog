<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { categoryLabel, formatDuration, type Work } from '@/data/works'
import { getWork, getWorks } from '@/api/works'
import WorkPlayer from '@/components/works/WorkPlayer.vue'
import WorkCard from '@/components/works/WorkCard.vue'

const route = useRoute()
const work = ref<Work | null>(null)
const related = ref<Work[]>([])
const loading = ref(true)
const failed = ref(false)
let controller: AbortController | null = null
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  work.value = null
  related.value = []
  loading.value = true
  failed.value = false
  try {
    const response = await getWork(String(route.params.slug), current.signal)
    if (current.signal.aborted) return
    work.value = response.data
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
watch(() => route.params.slug, load, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <article v-if="work" class="work-detail page-shell page-stage">
    <header class="simple-page-header">
      <router-link :to="{ path: '/works', query: { type: work.category } }" class="back-link">← 返回{{ categoryLabel(work.category) }}作品</router-link>
      <p class="section-kicker">{{ work.caption }}</p>
      <h1>{{ work.title }}</h1>
      <div class="detail-meta"><span>小果Fruit / GUOER</span><span>{{ categoryLabel(work.category) }}</span><span v-if="work.duration">{{ formatDuration(work.duration) }}</span></div>
      <p class="page-lede">{{ work.description }}</p>
    </header>
    <WorkPlayer v-if="work.video || work.audio" :key="work.slug" :work="work" class="detail-player" />
    <div v-else class="repository-feature" :class="`repository-feature--${work.accent}`"><span class="eyebrow">Open source / guoer9</span><p>{{ work.title }}</p><a :href="work.repository || undefined" target="_blank" rel="noopener noreferrer" class="editorial-button">在 GitHub 查看项目 ↗</a></div>
    <div class="detail-description">
      <div><p class="section-kicker">About this work</p><h2>关于这件作品</h2></div>
      <div><p v-for="note in work.notes" :key="note">{{ note }}</p><div class="detail-tags"><span v-for="tag in work.tags" :key="tag">{{ tag }}</span></div><a v-if="work.externalWatch" :href="work.externalWatch" target="_blank" rel="noopener noreferrer" class="detail-external">在 Bilibili 观看 ↗</a><a v-else-if="work.category !== 'code'" href="https://space.bilibili.com/693922070" target="_blank" rel="noopener noreferrer" class="detail-external">到 Bilibili 主页看看 ↗</a></div>
    </div>
    <section v-if="related.length" class="related-works" aria-labelledby="related-title"><p class="section-kicker">Keep exploring</p><h2 id="related-title">继续看一件。</h2><div><WorkCard v-for="(item, index) in related" :key="item.slug" :work="item" :index="index" heading-tag="h3" /></div></section>
  </article>
  <div v-else class="page-shell missing-work page-stage"><p class="section-kicker">{{ loading ? 'Loading work' : failed ? 'Unable to load' : 'Work not found' }}</p><h1>{{ loading ? '正在读取作品…' : failed ? '暂时无法读取这件作品。' : '这件作品还不在这里。' }}</h1><button v-if="failed" type="button" class="editorial-button" @click="load">重新读取</button> <router-link v-if="!loading" to="/works" class="editorial-button editorial-button--acid">返回作品集 ↗</router-link></div>
</template>

<style scoped>
.simple-page-header h1 { font-size: clamp(2.8rem, 7vw, 6rem); line-height: 1.15; overflow-wrap: anywhere; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 12px 28px; margin: 25px 0; color: var(--muted); font: .68rem var(--mono-font); }
.detail-player { margin-top: 40px; }
.repository-feature { display: flex; flex-direction: column; align-items: flex-start; gap: 35px; padding: clamp(30px, 6vw, 80px); margin-top: 40px; min-height: 340px; border: 1px solid var(--ink); background: var(--paper-soft); }
.repository-feature--lime { background: var(--acid); }
.repository-feature--blue { background: var(--electric-blue); color: white; }
.repository-feature--blue > a { border-color: white; color: white; }
.repository-feature > p { font: 400 clamp(2rem, 6vw, 5rem)/1.2 var(--display-font); letter-spacing: -.04em; overflow-wrap: anywhere; }
.detail-description { display: grid; grid-template-columns: 1fr 1.4fr; gap: 40px; padding: 60px 0; border-bottom: 1px solid var(--line); }
.detail-description h2 { font: 400 1.8rem var(--display-font); }
.detail-description > div:last-child > p { color: var(--muted); font-size: .95rem; }
.detail-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 25px 0; }
.detail-tags span { padding: 4px 10px; border: 1px solid var(--line); font: .65rem var(--mono-font); }
.detail-external { display: inline-block; padding: 10px 0; font-size: .85rem; text-underline-offset: 5px; }
.related-works { padding-top: 70px; }
.related-works > h2 { font: 400 2rem var(--display-font); margin-bottom: 36px; }
.related-works > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
.missing-work { padding-top: 100px; }
.missing-work > h1 { font: 400 clamp(2.5rem, 6vw, 4rem)/1.3 var(--display-font); }
@media (max-width: 650px) { .detail-description, .related-works > div { grid-template-columns: 1fr; gap: 24px; } }
</style>
