<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, type Ref } from 'vue'
import { getPosts, type PublicArticle } from '@/api/posts'
import ArticleRow from '@/components/blog/ArticleRow.vue'
import StatePanel from '@/components/blog/StatePanel.vue'
import ScrollReveal from '@/components/immersive/ScrollReveal.vue'
import { usePageSceneState } from '@/graphics/runtime/usePageSceneState'
import { visualPageSceneBridgeKey, visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'
import type { ArchivePageState } from '@/graphics/scenes/pageStates'

const posts = ref<PublicArticle[]>([])
const runtime = inject<Ref<VisualRuntimeBridge | null>>(visualRuntimeKey, ref(null))
const sceneBridge = usePageSceneState<ArchivePageState>({ mode: 'archive', query: '', resultCount: 0, page: 1, totalPages: 0 })
provide(visualPageSceneBridgeKey, sceneBridge)
const loading = ref(true)
const error = ref(false)
const currentPage = ref(1)
const total = ref(0)
const pageSize = 12
const totalPages = computed(() => Math.ceil(total.value / pageSize))
const archiveAnchor = ref<HTMLElement | null>(null)
let unregisterArchiveAnchor: (() => void) | null = null

function publishArchiveState() {
  const state: ArchivePageState = { mode: 'archive', query: '', resultCount: total.value, page: currentPage.value, totalPages: totalPages.value }
  sceneBridge.setState(state)
  runtime.value?.setPageState('archive', state)
}

watch([runtime, archiveAnchor], ([activeRuntime, element]) => {
  unregisterArchiveAnchor?.()
  unregisterArchiveAnchor = activeRuntime && element
    ? activeRuntime.registerAnchor?.('archive-list', element) ?? null
    : null
  activeRuntime?.measureAnchors?.()
}, { flush: 'post' })

async function loadPosts() {
  loading.value = true
  error.value = false
  try {
    const response = await getPosts({ page: currentPage.value, page_size: pageSize })
    posts.value = response.data.items
    total.value = response.data.total
    publishArchiveState()
  } catch {
    error.value = true
  } finally {
    loading.value = false
    publishArchiveState()
    await nextTick()
    runtime.value?.measureAnchors?.()
  }
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadPosts()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(loadPosts)
onBeforeUnmount(() => unregisterArchiveAnchor?.())
</script>

<template>
  <div class="archive-page page-stage page-stage--top">
    <div class="page-shell">
      <ScrollReveal>
        <header class="archive-header">
          <div>
            <p class="section-kicker">The archive / {{ new Date().getFullYear() }}</p>
            <h1>演出之后，<br /><em>留下的文字。</em></h1>
          </div>
          <p class="archive-intro">创作记录、生活片段与技术笔记。沿着时间，继续认识我。</p>
        </header>
      </ScrollReveal>

      <section ref="archiveAnchor" class="archive-body" aria-label="文章归档">
        <div class="archive-label">
          <span>ARCHIVE / {{ String(total).padStart(2, '0') }} ENTRIES</span>
          <span>NEWEST FIRST ↓</span>
        </div>
        <div v-if="loading" class="archive-loading" aria-label="正在载入文章">
          <span v-for="index in 5" :key="index" />
        </div>
        <div v-else-if="error" class="inline-error archive-error">
          <span>文章暂时没有加载成功。</span>
          <button type="button" class="text-action" @click="loadPosts">重新加载 ↗</button>
        </div>
        <div v-else-if="posts.length" class="article-list">
          <ArticleRow v-for="(post, index) in posts" :key="post.key" :post="post" :index="(currentPage - 1) * pageSize + index" heading-tag="h2" />
        </div>
        <StatePanel
          v-else
          title="这里还没有文章。"
          description="第一篇文章发布后，会从这一页开始积累。"
          action-label="回到首页"
          @action="$router.push('/')"
        />
        <div v-if="totalPages > 1" class="pagination-bar">
          <span>PAGE {{ String(currentPage).padStart(2, '0') }} / {{ String(totalPages).padStart(2, '0') }}</span>
          <div class="pagination-buttons">
            <button type="button" :disabled="currentPage === 1" aria-label="上一页" @click="changePage(currentPage - 1)">←</button>
            <button type="button" :disabled="currentPage === totalPages" aria-label="下一页" @click="changePage(currentPage + 1)">→</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.archive-header { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr); align-items: end; gap: 70px; padding-bottom: 62px; }
h1 { margin-bottom: 0; font: 400 clamp(4rem, 9vw, 8rem)/0.87 var(--display-font); letter-spacing: -0.065em; }
h1 em { color: var(--electric-blue); font-weight: 400; }
.archive-intro { max-width: 390px; padding-bottom: 8px; color: var(--muted); font-size: 0.9rem; }
.archive-label { display: flex; justify-content: space-between; gap: 20px; padding: 18px 0; border-top: 1px solid var(--ink); color: var(--muted); font: 0.61rem var(--mono-font); letter-spacing: 0.05em; }
.archive-loading { display: grid; }
.archive-loading span { height: 130px; border-top: 1px solid var(--line); background: linear-gradient(90deg, var(--paper-soft), transparent, var(--paper-soft)); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.archive-error { border-top: 1px solid var(--line); }
@media (max-width: 760px) {
  .archive-header { grid-template-columns: 1fr; gap: 26px; padding-bottom: 42px; }
  .archive-intro { max-width: 100%; }
  .archive-label { font-size: 0.55rem; }
}
</style>
