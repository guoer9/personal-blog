<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { searchPosts, type Post } from '@/api/posts'
import { formatDate } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const posts = ref<Post[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const keyword = computed(() => route.query.q as string || '')

async function fetchPosts() {
  if (!keyword.value) {
    posts.value = []
    total.value = 0
    return
  }
  
  loading.value = true
  try {
    const response = await searchPosts({
      q: keyword.value,
      page: currentPage.value,
      page_size: pageSize.value,
    })
    posts.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    console.error('搜索失败', error)
  } finally {
    loading.value = false
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchPosts()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  fetchPosts()
})

watch(() => route.query.q, () => {
  currentPage.value = 1
  fetchPosts()
})
</script>

<template>
  <div class="search-page container">
    <div class="page-header">
      <el-button text @click="router.push('/')">
        <el-icon><ArrowLeft /></el-icon>
        返回
      </el-button>
      <h1 class="page-title">
        搜索结果：
        <span class="keyword">{{ keyword }}</span>
      </h1>
      <p class="result-count">共找到 {{ total }} 篇文章</p>
    </div>
    
    <div v-loading="loading" class="posts-list">
      <article
        v-for="post in posts"
        :key="post.id"
        class="post-card"
        @click="router.push(`/post/${post.slug}`)"
      >
        <h3 class="post-title">{{ post.title }}</h3>
        <p v-if="post.summary" class="post-summary">{{ post.summary }}</p>
        <div class="post-meta">
          <span class="author">{{ post.author.username }}</span>
          <span class="date">{{ formatDate(post.created_at) }}</span>
          <span class="views">
            <el-icon><View /></el-icon>
            {{ post.view_count }}
          </span>
        </div>
        <div v-if="post.tags.length" class="post-tags">
          <el-tag
            v-for="tag in post.tags"
            :key="tag.id"
            size="small"
            @click.stop="router.push(`/tag/${tag.slug}`)"
          >
            {{ tag.name }}
          </el-tag>
        </div>
      </article>
      
      <el-empty v-if="!loading && posts.length === 0 && keyword" description="未找到相关文章" />
      <el-empty v-if="!keyword" description="请输入搜索关键词" />
    </div>
    
    <div v-if="total > pageSize" class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.search-page {
  max-width: 800px;
  padding: 24px 20px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  margin-top: 16px;
}

.keyword {
  color: var(--el-color-primary);
}

.result-count {
  color: #909399;
  font-size: 14px;
  margin-top: 8px;
}

.posts-list {
  min-height: 200px;
}

.post-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  margin-bottom: 16px;
}

.post-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}

.post-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}

.post-summary {
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 12px;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: #909399;
  margin-bottom: 12px;
}

.views {
  display: flex;
  align-items: center;
  gap: 4px;
}

.post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.post-tags .el-tag {
  cursor: pointer;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
