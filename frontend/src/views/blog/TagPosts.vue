<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getPosts, type Post } from '@/api/posts'
import ArticleRow from '@/components/blog/ArticleRow.vue'
import StatePanel from '@/components/blog/StatePanel.vue'

const route = useRoute()
const posts = ref<Post[]>([])
const loading = ref(true)
const error = ref(false)
const total = ref(0)
const tagSlug = computed(() => String(route.params.slug || ''))
const pageSize = 12
const totalPages = computed(() => Math.ceil(total.value / pageSize))
const currentPage = ref(1)

async function loadTagPosts(page = 1) {
  loading.value = true
  error.value = false
  currentPage.value = page
  try {
    const response = await getPosts({ tag: tagSlug.value, page: currentPage.value, page_size: pageSize })
    posts.value = response.data.items
    total.value = response.data.total
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value) return
  loadTagPosts(page)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => loadTagPosts())
watch(tagSlug, () => loadTagPosts())
</script>

<template>
  <div class="tag-page page-stage">
    <div class="page-shell">
      <header class="simple-page-header">
        <router-link to="/writing" class="back-link">← 返回归档 / ARCHIVE</router-link>
        <p class="section-kicker">Topic index / tagged notes</p>
        <div class="heading-row">
          <h1>#{{ tagSlug }}</h1>
          <span class="result-count">{{ total }} 篇相关文章</span>
        </div>
        <p class="page-lede">同一主题下的文章会在这里归到一起，方便沿着问题继续阅读。</p>
      </header>

      <section class="tag-results" aria-label="标签文章列表">
        <div v-if="loading" class="loading-block" aria-label="正在载入文章">
          <span v-for="index in 4" :key="index" />
        </div>
        <div v-else-if="error" class="inline-error">
          <span>标签文章暂时无法加载。</span>
          <button type="button" class="text-action" @click="loadTagPosts(currentPage)">重试 ↗</button>
        </div>
        <div v-else-if="posts.length" class="article-list">
          <ArticleRow v-for="(post, index) in posts" :key="post.id" :post="post" :index="index" />
        </div>
        <StatePanel
          v-else
          title="这个主题还在等待第一篇文章。"
          description="可以先去文章归档看看其他内容。"
          action-label="浏览全部文章"
          @action="$router.push('/writing')"
        />
        <div v-if="totalPages > 1" class="pagination-bar tag-pagination">
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
.tag-results { padding-top: 34px; }
.tag-pagination { margin-top: 34px; }
.loading-block { display: grid; }
.loading-block span { display: block; height: 122px; border-top: 1px solid var(--line); background: linear-gradient(90deg, var(--paper-soft), transparent, var(--paper-soft)); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
</style>
