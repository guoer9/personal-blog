<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDocuments, type PublicDocumentSummary } from '@/api/documents'
import { formatDate } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const query = computed(() => text(route.query.q, 120))
const category = computed(() => text(route.query.category, 100))
const page = computed(() => {
  const value = String(route.query.page || '1')
  const number = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 && number <= 1000000 ? number : 1
})
const queryInput = ref('')
const categoryInput = ref('')
const entries = ref<PublicDocumentSummary[]>([])
const total = ref(0)
const totalPages = ref(0)
const loading = ref(true)
const failed = ref(false)
const resultHeading = ref<HTMLElement | null>(null)
let controller: AbortController | null = null
let focusOnResult = false
async function load() {
  controller?.abort()
  const current = new AbortController(); controller = current
  entries.value = []; total.value = 0; totalPages.value = 0; loading.value = true; failed.value = false
  queryInput.value = query.value; categoryInput.value = category.value
  try {
    const response = await getDocuments({ q: query.value || undefined, category: category.value || undefined, page: page.value, page_size: 10 }, current.signal)
    if (current.signal.aborted) return
    entries.value = response.data.items; total.value = response.data.total; totalPages.value = response.data.total_pages
  } catch { if (!current.signal.aborted) failed.value = true }
  finally {
    if (!current.signal.aborted) {
      loading.value = false
      if (focusOnResult) { focusOnResult = false; await nextTick(); resultHeading.value?.focus({ preventScroll: true }) }
    }
  }
}
async function navigate(nextPage = 1, clear = false) {
  const q = clear ? '' : text(queryInput.value, 120)
  const selectedCategory = clear ? '' : text(categoryInput.value, 100)
  const nextQuery = { ...(q ? { q } : {}), ...(selectedCategory ? { category: selectedCategory } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) }
  focusOnResult = true
  if (router.resolve({ path: '/documents', query: nextQuery }).fullPath === route.fullPath) await load()
  else await router.push({ path: '/documents', query: nextQuery })
}
watch(() => route.query, load, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="documents-page page-stage page-shell">
    <header class="simple-page-header"><router-link to="/" class="back-link">← 返回首页 / HOME</router-link><p class="section-kicker">Public library / 资料与笔记</p><h1>把有用的资料，<br /><em>留在这里。</em></h1><p class="page-lede">收集经过整理的文档与笔记。按关键词寻找内容，或用分类缩小范围。</p></header>
    <form class="documents-filters" role="search" aria-label="搜索资料库" @submit.prevent="navigate()"><div><label for="documents-query">关键词</label><input id="documents-query" v-model="queryInput" type="search" maxlength="120" placeholder="搜索标题、摘要或正文" /></div><div><label for="documents-category">分类名称</label><input id="documents-category" v-model="categoryInput" type="text" maxlength="100" placeholder="精确分类，例如：技术" /></div><button type="submit" class="editorial-button editorial-button--acid">查找资料 ↗</button><button v-if="query || category" type="button" class="clear-filter" @click="navigate(1, true)">清除筛选</button></form>
    <div class="results-heading"><h2 id="documents-results" ref="resultHeading" tabindex="-1">{{ query || category ? '查找结果' : '全部资料' }}</h2><p role="status" aria-live="polite">{{ loading ? '正在读取资料…' : failed ? '读取未完成' : `${total} 份公开资料` }}</p></div>
    <div v-if="failed" class="document-state" role="alert"><p>暂时无法读取资料库，请稍后重试。</p><button type="button" class="editorial-button" data-action="retry" @click="load">重新读取</button></div>
    <div v-else-if="!loading && !entries.length" class="document-state"><h3>没有找到资料。</h3><p>{{ query || category ? '试试其他关键词，或清除分类筛选。' : '第一份公开资料正在整理中。' }}</p><button v-if="query || category || page > 1" type="button" class="editorial-button" @click="navigate(1, true)">查看全部资料</button></div>
    <div v-else class="documents-list" :aria-busy="loading"><article v-for="entry in entries" :key="entry.slug" class="document-card"><img v-if="entry.cover_url && /^\/api\/v1\/documents\/media\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(entry.cover_url)" :src="entry.cover_url" class="card-cover" alt="" loading="lazy" /><div class="card-meta"><span>DOCUMENT</span><time :datetime="entry.updated_at">更新于 {{ formatDate(entry.updated_at) }}</time></div><h3><router-link :to="`/documents/${encodeURIComponent(entry.slug)}`"><span v-if="entry.icon" class="card-icon" aria-hidden="true">{{ entry.icon }}</span>{{ entry.title }} <span aria-hidden="true">↗</span></router-link></h3><p v-if="entry.summary">{{ entry.summary }}</p><div class="card-article-meta"><span>作者 {{ entry.author?.username || entry.author_label || 'Notion 导入' }}</span><span>{{ entry.view_count || 0 }} 次阅读</span><router-link :to="`/documents/${encodeURIComponent(entry.slug)}#discussion`">{{ entry.comment_count || 0 }} 条评论</router-link></div><p v-if="!entry.categories.length" class="no-tags">暂无标签</p><div v-if="entry.categories.length" class="document-categories"><router-link v-for="item in entry.categories" :key="item" :to="{ path: '/documents', query: { category: item } }">{{ item }}</router-link></div></article></div>
    <nav v-if="!loading && !failed && (totalPages > 1 || page > 1)" class="document-pagination" aria-label="资料分页"><button type="button" class="editorial-button" :disabled="page <= 1" @click="navigate(page - 1)">上一页</button><span>第 {{ page }} 页{{ totalPages ? ` / 共 ${totalPages} 页` : '' }}</span><button type="button" class="editorial-button" data-action="next-page" :disabled="page >= totalPages" @click="navigate(page + 1)">下一页</button></nav>
  </div>
</template>

<style scoped>
.card-article-meta { display: flex; flex-wrap: wrap; gap: 10px 18px; color: var(--muted); font-size: .75rem; }.card-article-meta a { color: var(--electric-blue); text-underline-offset: 3px; }.document-card .no-tags { font-size: .75rem; }

.simple-page-header h1 { font-size: clamp(2.6rem,6vw,5rem); line-height: 1.2; }h1 em { color: var(--electric-blue); font-weight: 400; }.documents-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 18px; padding: 32px 0; border-bottom: 1px solid var(--line); }.documents-filters > div { flex: 1; min-width: 190px; }.documents-filters label { display: block; font-size: .8rem; margin-bottom: 10px; }.documents-filters input { box-sizing: border-box; width: 100%; min-height: 46px; background: transparent; border: 1px solid var(--ink); padding: 10px 12px; color: var(--ink); border-radius: 0; font: inherit; font-size: .9rem; }.clear-filter { border: 0; background: none; min-height: 44px; padding: 8px; text-decoration: underline; color: var(--ink); cursor: pointer; }.results-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 28px 0; }.results-heading h2 { margin: 0; font: 400 1.5rem var(--display-font); }.results-heading p { color: var(--muted); font-size: .8rem; margin: 0; }.documents-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px; }.document-card { overflow: hidden; border: 1px solid var(--line); border-radius: 7px; padding: 24px; background: var(--paper-soft); }.card-cover { display: block; width: calc(100% + 48px); max-width: none; height: 190px; object-fit: cover; margin: -24px -24px 22px; }.card-icon { margin-right: 9px; }.card-meta { display: flex; flex-wrap: wrap; gap: 18px; color: var(--muted); font: .65rem var(--mono-font); }.document-card h3 { margin: 18px 0 12px; font: 600 clamp(1.2rem,2.5vw,1.6rem)/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; overflow-wrap: anywhere; }.document-card h3 a { color: var(--ink); text-decoration: none; }.document-card h3 a:hover { color: var(--electric-blue); }.document-card h3 span { font-size: .7em; }.document-card > p { max-width: 850px; color: var(--muted); font-size: .95rem; line-height: 1.8; overflow-wrap: anywhere; }.document-categories { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }.document-categories a { padding: 7px 12px; border: 1px solid var(--line); text-decoration: none; color: var(--ink); font-size: .75rem; }.document-state { padding: 45px 0; }.document-state p { color: var(--muted); }.document-pagination { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; margin: 42px 0; }.document-pagination span { font-size: .8rem; }button:disabled { opacity: .45; cursor: default; }:is(input,button,a,h2):focus-visible { outline: 3px solid var(--electric-blue); outline-offset: 4px; }@media(max-width:650px) { .documents-list { grid-template-columns: 1fr; } .documents-filters { gap: 14px; }.documents-filters > div { flex-basis: 100%; }.document-pagination { gap: 12px; } }
</style>
