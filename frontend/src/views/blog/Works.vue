<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { parseCategory, workCategories, type Work } from '@/data/works'
import { getWorks } from '@/api/works'
import WorkCard from '@/components/works/WorkCard.vue'
import SocialLinks from '@/components/portfolio/SocialLinks.vue'

const route = useRoute()
const category = computed(() => parseCategory(route.query.type))
const visibleWorks = ref<Work[]>([])
const loading = ref(true)
const failed = ref(false)
let controller: AbortController | null = null
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  failed.value = false
  visibleWorks.value = []
  try {
    const response = await getWorks(category.value === 'all' ? {} : { category: category.value }, current.signal)
    if (!current.signal.aborted) visibleWorks.value = response.data.items
  } catch { if (!current.signal.aborted) failed.value = true }
  finally { if (!current.signal.aborted) loading.value = false }
}
watch(category, load, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="works-page page-stage page-shell">
    <header class="simple-page-header">
      <router-link to="/" class="back-link">← 返回首页 / HOME</router-link>
      <p class="section-kicker">Selected & collected / 小果Fruit</p>
      <h1>Code. Film.<br /><em>And a little music.</em></h1>
      <p class="page-lede">代码是解决问题的方式，影像与音乐是留下生活的方式。这里是我的作品集。</p>
    </header>
    <div class="works-toolbar">
      <nav class="work-filters" aria-label="作品分类"><router-link v-for="item in workCategories" :key="item.id" :to="item.id === 'all' ? '/works' : { path: '/works', query: { type: item.id } }" :aria-current="category === item.id ? 'page' : undefined" :class="{ selected: category === item.id }">{{ item.label }} <small>{{ item.caption }}</small></router-link></nav>
      <p role="status" aria-live="polite">{{ loading ? '正在读取作品…' : failed ? '读取未完成' : `${visibleWorks.length} 件作品` }}</p>
    </div>
    <div v-if="failed" class="works-state" role="status"><p>暂时无法读取作品，请稍后重试。</p><button class="editorial-button" type="button" @click="load">重新读取</button></div>
    <p v-else-if="!loading && !visibleWorks.length" class="works-state">这个分类的第一件作品，正在路上。</p>
    <div v-else class="works-grid" :aria-busy="loading"><WorkCard v-for="(work, index) in visibleWorks" :key="work.slug" :work="work" :index="index" /></div>
    <SocialLinks />
  </div>
</template>

<style scoped>
.simple-page-header { padding-bottom: 44px; }
.simple-page-header h1 { font-size: clamp(3rem, 7vw, 6rem); line-height: 1; }
h1 em { color: var(--electric-blue); font-weight: 400; }
.works-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 25px 0; margin-bottom: 20px; border-bottom: 1px solid var(--line); }
.work-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.work-filters a { display: inline-flex; align-items: center; gap: 9px; min-height: 44px; padding: 7px 18px; border: 1px solid transparent; text-decoration: none; font-size: .85rem; }
.work-filters small { font: .6rem var(--mono-font); }
.work-filters a.selected { border-color: var(--ink); background: var(--acid); }
.work-filters a:hover { border-color: var(--ink); }
.works-toolbar > p { margin: 0; white-space: nowrap; color: var(--muted); font: .7rem var(--mono-font); }
.works-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 60px 32px; padding-top: 10px; }
.works-state { padding: 60px 0; color: var(--muted); }
@media (max-width: 700px) { .works-grid { grid-template-columns: 1fr; gap: 38px; } .works-toolbar { align-items: flex-start; flex-direction: column; gap: 14px; } .work-filters a { padding: 7px 11px; } .work-filters small { display: none; } }
</style>
