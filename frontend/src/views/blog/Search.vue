<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { searchPosts, type PublicArticle } from '@/api/posts'
import ArticleRow from '@/components/blog/ArticleRow.vue'
import StatePanel from '@/components/blog/StatePanel.vue'

const route = useRoute()
const router = useRouter()
const posts = ref<PublicArticle[]>([])
const loading = ref(false)
const error = ref(false)
const total = ref(0)
const currentPage = ref(parsePage(route.query.page))
const pageSize = 12
const maxQueryLength = 120
const maxQueryTokens = 8
const keyword = computed(() => normalizeQuery(String(route.query.q || '')))
const totalPages = computed(() => Math.ceil(total.value / pageSize))
const searchValue = ref('')
const shouldFocusResults = ref(Boolean(route.query.q))
const pageChangeRequested = ref(false)
const statusRegion = ref<HTMLElement | null>(null)
const articleList = ref<HTMLElement | null>(null)
const queryInput = ref<HTMLInputElement | null>(null)
const queryError = ref('')
let latestRequestId = 0

function normalizeQuery(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function validateQuery(value: string) {
  if (Array.from(value).length > maxQueryLength) return '搜索最多输入 120 个字符，请缩短后重试。'
  if (value.split(' ').length > maxQueryTokens) return '搜索最多使用 8 个词，请减少后重试。'
  return ''
}

function parsePage(value: unknown) {
  const page = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

async function focusResults(requestId = latestRequestId) {
  await nextTick()
  if (requestId !== latestRequestId) return
  statusRegion.value?.focus({ preventScroll: true })
}

async function restoreReturnFocus(requestId: number) {
  const target = String(window.history.state?.searchReturnFocus || '')
  if (!target) {
    await focusResults(requestId)
    return
  }
  await nextTick()
  if (requestId !== latestRequestId) return
  const link = Array.from(articleList.value?.querySelectorAll<HTMLAnchorElement>('a.article-link, a.article-arrow') || [])
    .find((candidate) => candidate.getAttribute('href') === target)
  if (link) {
    link.focus({ preventScroll: true })
  } else {
    await focusResults(requestId)
  }
  if (requestId !== latestRequestId) return
  window.history.replaceState(
    { ...window.history.state, searchReturnFocus: undefined },
    '',
  )
}

async function loadResults(page = 1) {
  const requestId = ++latestRequestId
  const query = keyword.value
  currentPage.value = page
  queryError.value = validateQuery(query)
  if (!query || queryError.value) {
    posts.value = []
    total.value = 0
    error.value = false
    loading.value = false
    shouldFocusResults.value = false
    pageChangeRequested.value = false
    return
  }
  loading.value = true
  error.value = false
  try {
    const response = await searchPosts({ q: query, page, page_size: pageSize })
    if (requestId !== latestRequestId) return
    posts.value = response.data.items
    total.value = response.data.total
  } catch {
    if (requestId !== latestRequestId) return
    error.value = true
  } finally {
    if (requestId !== latestRequestId) return
    loading.value = false
    const focusRequested = shouldFocusResults.value || pageChangeRequested.value
    shouldFocusResults.value = false
    pageChangeRequested.value = false
    if (window.history.state?.searchReturnFocus && currentPage.value === parsePage(route.query.page)) {
      await restoreReturnFocus(requestId)
    } else if (focusRequested) {
      await focusResults(requestId)
    }
  }
}

async function submit() {
  const value = normalizeQuery(searchValue.value)
  queryError.value = validateQuery(value)
  if (queryError.value) {
    await nextTick()
    queryInput.value?.focus()
    return
  }
  if (!value) return
  searchValue.value = value
  shouldFocusResults.value = true
  if (value === keyword.value && parsePage(route.query.page) === 1) {
    await loadResults()
    return
  }
  await router.push({ name: 'Search', query: { q: value } })
}

async function retryResults() {
  shouldFocusResults.value = true
  await loadResults(currentPage.value)
}

async function changePage(page: number) {
  if (page < 1 || page > totalPages.value) return
  pageChangeRequested.value = true
  window.scrollTo({ top: 0, behavior: 'auto' })
  const query: LocationQueryRaw = { ...route.query, q: keyword.value }
  if (page === 1) delete query.page
  else query.page = String(page)
  await router.push({ name: 'Search', query })
}

function rememberReturnFocus(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const link = target.closest<HTMLAnchorElement>('a.article-link, a.article-arrow')
  if (!link || !link.closest('.article-list')) return
  window.history.replaceState(
    { ...window.history.state, searchReturnFocus: link.getAttribute('href') },
    '',
  )
}

watch(
  () => [keyword.value, parsePage(route.query.page)] as const,
  ([nextKeyword], previous) => {
    if (!previous || nextKeyword !== previous[0]) {
      searchValue.value = nextKeyword
      shouldFocusResults.value = Boolean(nextKeyword)
    } else {
      pageChangeRequested.value = true
    }
    currentPage.value = parsePage(route.query.page)
    loadResults(currentPage.value)
  },
)

onMounted(() => {
  searchValue.value = keyword.value
  window.addEventListener('click', rememberReturnFocus, true)
  loadResults(currentPage.value)
})

onBeforeUnmount(() => {
  latestRequestId += 1
  window.removeEventListener('click', rememberReturnFocus, true)
})
</script>

<template>
  <div class="search-page page-stage">
    <div class="page-shell">
      <header class="simple-page-header search-header">
        <router-link to="/" class="back-link">← 返回首页 / HOME</router-link>
        <p class="section-kicker">Search / the archive</p>
        <h1>Find your<br /><em>thread.</em></h1>
        <form class="search-form" role="search" @submit.prevent="submit">
          <label for="search-query">搜索文章</label>
          <div class="search-input-row">
            <input id="search-query" ref="queryInput" v-model="searchValue" name="q" type="search" placeholder="标题、摘要、标签或正文" autocomplete="off" :aria-describedby="queryError ? 'search-help search-query-error' : 'search-help'" :aria-invalid="queryError ? 'true' : undefined" @input="queryError = ''" />
            <button type="submit" class="editorial-button editorial-button--acid" :disabled="!searchValue.trim()">SEARCH ↗</button>
          </div>
          <p id="search-help" class="search-help">空格分隔多个词，每个词都需在标题、标签、摘要或正文中匹配。按相关度排序：标题优先，其次标签、摘要、正文；同级按日期从新到旧。最多 120 字、8 个词。</p>
          <p v-if="queryError" id="search-query-error" class="query-error" role="alert">{{ queryError }}</p>
        </form>
      </header>

      <section class="search-results" aria-label="搜索结果">
        <div v-if="keyword" ref="statusRegion" class="search-summary" role="status" tabindex="-1" aria-live="polite">
          <span>QUERY / “{{ keyword }}”</span>
          <span>{{ loading ? 'SEARCHING' : error ? 'SEARCH UNAVAILABLE' : `${total} RESULTS` }}</span>
          <span v-if="!loading && !error && totalPages > 1">PAGE {{ currentPage }} / {{ totalPages }}</span>
        </div>
        <div v-if="loading" class="loading-block" aria-label="正在搜索">
          <span v-for="index in 3" :key="index" />
        </div>
        <div v-else-if="error" class="inline-error" role="alert">
          <h2>搜索暂时不可用</h2>
          <p>网络或服务异常，请稍后重试。</p>
          <button type="button" class="text-action" @click="retryResults">重试 ↗</button>
        </div>
        <div v-else-if="posts.length" ref="articleList" class="article-list">
          <ArticleRow v-for="(post, index) in posts" :key="post.key" :post="post" :index="index" />
        </div>
        <StatePanel
          v-else-if="keyword"
          eyebrow="NO MATCH / TRY ANOTHER"
          title="没有找到相关内容。"
          description="换一个更短的关键词，或者回到文章归档继续浏览。"
          action-label="查看全部文章"
          @action="$router.push('/writing')"
        />
        <StatePanel
          v-else
          eyebrow="START WITH A WORD"
          title="输入一个关键词。"
          description="搜索已发布文章的标题、摘要、标签与正文；多个词用空格分隔。"
        />
        <div v-if="totalPages > 1" class="pagination-bar">
          <span>PAGE {{ currentPage }} / {{ totalPages }}</span>
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
.search-header h1 em { color: var(--electric-blue); font-weight: 400; }
.search-form { max-width: 760px; margin-top: 38px; }
.search-form label { display: block; margin-bottom: 10px; color: var(--muted); font: 0.63rem var(--mono-font); letter-spacing: 0.07em; text-transform: uppercase; }
.search-input-row { display: flex; align-items: stretch; gap: 12px; }
.search-input-row input { width: 100%; min-width: 0; padding: 0 0 12px; border: 0; border-bottom: 1px solid var(--ink); border-radius: 0; background: transparent; color: var(--ink); font: clamp(1.3rem, 3vw, 2.3rem) var(--display-font); outline: none; }
.search-input-row input::placeholder { color: #aaa79f; }
.search-help, .query-error { margin-top: 14px; color: var(--muted); font-size: 0.85rem; line-height: 1.7; }
.query-error { color: var(--ink); }
.search-results { padding-top: 34px; }
.search-summary { display: flex; justify-content: space-between; gap: 18px; padding: 15px 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--line); color: var(--muted); font: 0.62rem var(--mono-font); letter-spacing: 0.05em; }
.search-summary:focus { outline: none; }
.inline-error { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 28px 0; border-bottom: 1px solid var(--line); }
.inline-error h2 { margin: 0; font: 400 1.4rem var(--display-font); }
.inline-error p { margin: 0; color: var(--muted); }
.loading-block { display: grid; }
.loading-block span { height: 126px; border-bottom: 1px solid var(--line); background: linear-gradient(90deg, var(--paper-soft), transparent, var(--paper-soft)); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (max-width: 620px) {
  .search-input-row { display: grid; gap: 18px; }
  .search-input-row .editorial-button { width: fit-content; }
  .search-summary { font-size: 0.54rem; }
}
</style>
