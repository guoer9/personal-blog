<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import MarkdownIt from 'markdown-it'
import { getDocument, type PublicDocument } from '@/api/documents'
import { formatDate } from '@/utils/format'
import NotionBlocks from '@/components/notion/NotionBlocks.vue'
import ArticleDiscussion from '@/components/blog/ArticleDiscussion.vue'
import { visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'
import type { LibraryPageState } from '@/graphics/scenes/pageStates'

const route = useRoute()
const runtime = inject<Ref<VisualRuntimeBridge | null>>(visualRuntimeKey, ref(null))
const entry = ref<PublicDocument | null>(null)
const loading = ref(true)
const failed = ref(false)
const commentCount = ref(0)
const readingProgress = ref(0)
const documentContent = ref<HTMLElement | null>(null)
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
const rendered = computed(() => markdown.render(entry.value?.content || ''))
const cover = computed(() => entry.value?.cover_url && /^\/api\/v1\/documents\/media\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(entry.value.cover_url) ? entry.value.cover_url : undefined)
let controller: AbortController | null = null
let unregisterLibraryAnchor: (() => void) | null = null

function publishLibraryState() {
  const state: LibraryPageState = {
    mode: 'detail', category: entry.value?.categories[0] || null,
    itemCount: entry.value ? 1 : 0, page: 1, readingProgress: readingProgress.value,
  }
  runtime.value?.setPageState('library', state)
}

function updateReadingProgress() {
  const content = documentContent.value
  if (!content) { readingProgress.value = 0; publishLibraryState(); return }
  const rect = content.getBoundingClientRect()
  const distance = Math.max(0, rect.height - window.innerHeight)
  readingProgress.value = distance === 0 ? 100 : Math.min(100, Math.max(0, (-rect.top / distance) * 100))
  publishLibraryState()
}

watch([entry, runtime, documentContent], async ([loadedEntry, activeRuntime, content]) => {
  unregisterLibraryAnchor?.()
  unregisterLibraryAnchor = null
  publishLibraryState()
  if (!loadedEntry || !activeRuntime) return
  await nextTick()
  const anchor = content || documentContent.value
  if (!anchor) return
  unregisterLibraryAnchor = activeRuntime.registerAnchor?.('library-document-content', anchor) ?? null
  activeRuntime.measureAnchors?.()
}, { flush: 'post' })

onMounted(() => {
  window.addEventListener('scroll', updateReadingProgress, { passive: true })
  window.addEventListener('resize', updateReadingProgress)
})

async function load() {
  controller?.abort()
  const current = new AbortController(); controller = current
  entry.value = null; loading.value = true; failed.value = false
  try {
    const response = await getDocument(String(route.params.slug), current.signal)
    if (!current.signal.aborted) { entry.value = response.data; commentCount.value = response.data.comment_count || 0; readingProgress.value = 0; document.title = `${response.data.title} · GUOER` }
  } catch (cause) {
    if (!current.signal.aborted) {
      failed.value = (cause as { response?: { status?: number } })?.response?.status !== 404
      document.title = `${failed.value ? '资料暂不可用' : '资料未找到'} · GUOER`
    }
  } finally { if (!current.signal.aborted) loading.value = false }
}
watch(() => route.params.slug, load, { immediate: true })
onBeforeUnmount(() => {
  controller?.abort()
  unregisterLibraryAnchor?.()
  window.removeEventListener('scroll', updateReadingProgress)
  window.removeEventListener('resize', updateReadingProgress)
})
</script>

<template>
  <article v-if="entry" class="document-detail page-stage page-shell" @load.capture="runtime?.measureAnchors?.()">
    <header class="simple-page-header">
      <router-link to="/documents" class="back-link">← 返回资料库 / LIBRARY</router-link>
      <p class="section-kicker">Document / 公开资料</p>
      <img v-if="cover" :src="cover" class="document-cover" alt="" />
      <span v-if="entry.icon" class="document-icon" aria-hidden="true">{{ entry.icon }}</span>
      <h1>{{ entry.title }}</h1>
      <div class="document-meta">
        <span>作者 {{ entry.author?.username || entry.author_label || 'Notion 导入' }}</span>
        <time :datetime="entry.updated_at">更新于 {{ formatDate(entry.updated_at) }}</time>
        <span>{{ entry.view_count || 0 }} 次阅读</span>
        <a href="#discussion">{{ commentCount }} 条评论</a>
        <a v-if="entry.external_url" :href="entry.external_url" target="_blank" rel="noopener noreferrer">Notion 原文 ↗</a>
      </div>
      <nav v-if="entry.categories.length" class="document-categories" aria-label="文章标签">
        <router-link v-for="category in entry.categories" :key="category" :to="{ path: '/documents', query: { category } }">{{ category }}</router-link>
      </nav>
      <p v-else class="document-no-tags">暂无标签</p>
    </header>
    <div v-if="entry.blocks" ref="documentContent" class="document-content"><NotionBlocks :blocks="entry.blocks" /></div>
    <div v-else ref="documentContent" class="document-content document-markdown" v-html="rendered" />
    <ArticleDiscussion v-if="entry.id" :key="entry.id" kind="notion" :article-id="entry.id" :initial-count="commentCount" @count-change="commentCount = $event" />
    <footer><router-link to="/documents" class="editorial-button">继续浏览资料 ↗</router-link></footer>
  </article>
  <div v-else class="document-state page-stage page-shell" :role="failed ? 'alert' : 'status'"><p class="section-kicker">{{ loading ? 'Loading document' : failed ? 'Unable to load' : 'Document not found' }}</p><h1>{{ loading ? '正在读取资料…' : failed ? '暂时无法读取这份资料。' : '资料未找到' }}</h1><p v-if="!loading && !failed">链接可能已失效，或这份资料已不再公开。</p><button v-if="failed" type="button" class="editorial-button" data-action="retry" @click="load">重新读取</button> <router-link v-if="!loading" to="/documents" class="editorial-button editorial-button--acid">返回资料库 ↗</router-link></div>
</template>

<style scoped>
.document-meta a { color: var(--electric-blue); text-underline-offset: 3px; }.document-no-tags { color: var(--muted); font-size: .8rem; }
.document-detail { max-width: 1100px; }.document-cover { display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 24px 0; }.document-icon { display: block; font-size: 3rem; margin: 20px 0; }.simple-page-header h1 { font-size: clamp(2.4rem,6vw,5rem); line-height: 1.2; overflow-wrap: anywhere; }.document-meta { display: flex; flex-wrap: wrap; gap: 24px; color: var(--muted); font: .7rem var(--mono-font); margin: 24px 0; }.document-categories { display: flex; flex-wrap: wrap; gap: 10px; }.document-categories a { color: var(--ink); text-decoration: none; padding: 8px 12px; border: 1px solid var(--line); font-size: .8rem; }.document-content { max-width: 800px; margin: 50px auto 70px; font-size: 1.02rem; line-height: 1.95; overflow-wrap: anywhere; }.document-markdown :deep(h2) { margin: 2em 0 .8em; font: 400 clamp(1.6rem,4vw,2.2rem)/1.4 var(--display-font); }.document-markdown :deep(h3) { margin: 1.7em 0 .7em; font-size: 1.3rem; }.document-markdown :deep(h1) { font: 400 2.5rem/1.4 var(--display-font); }.document-markdown :deep(a) { color: #2359a8; text-underline-offset: 4px; }.document-markdown :deep(img) { max-width: 100%; height: auto; }.document-markdown :deep(pre) { overflow-x: auto; background: var(--paper-soft); border: 1px solid var(--line); padding: 20px; font: .8rem/1.8 var(--mono-font); white-space: pre; }.document-markdown :deep(:not(pre) > code) { font-family: var(--mono-font); font-size: .85em; background: var(--paper-soft); padding: 2px 5px; }.document-markdown :deep(blockquote) { margin: 24px 0; border-left: 3px solid var(--electric-blue); padding: 4px 22px; color: var(--muted); }.document-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }.document-markdown :deep(th),.document-markdown :deep(td) { border: 1px solid var(--line); padding: 8px 14px; }.document-markdown :deep(ul),.document-markdown :deep(ol) { padding-left: 1.5em; }.document-detail footer { border-top: 1px solid var(--line); padding: 30px 0; }.document-state { padding-top: 100px; }.document-state h1 { font: 400 clamp(2.3rem,5vw,4rem)/1.3 var(--display-font); }.document-state > p { color: var(--muted); }:is(a,button):focus-visible { outline: 3px solid var(--electric-blue); outline-offset: 4px; }
</style>
