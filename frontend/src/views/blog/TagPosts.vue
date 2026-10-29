<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPosts, type Post } from '@/api/posts'
import { formatDate } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const posts = ref<Post[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const tagSlug = computed(() => route.params.slug as string)

async function fetchPosts() {
  loading.value = true
  try {
    const response = await getPosts({
      page: currentPage.value,
      page_size: pageSize.value,
      tag: tagSlug.value,
    })
    posts.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    console.error('获取文章列表失败', error)
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

watch(tagSlug, () => {
  currentPage.value = 1
  fetchPosts()
})
</script>

<template>
  <div class="tag-posts-page container">
    <div class="page-header">
      <el-button text @click="router.push('/')">
        <el-icon><ArrowLeft /></el-icon>
        返回
      </el-button>
      <h1 class="page-title">
        <el-tag size="large">{{ tagSlug }}</el-tag>
        <span>标签下的文章</span>
      </h1>
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
      </article>
      
      <el-empty v-if="!loading && posts.length === 0" description="该标签下暂无文章" />
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
.tag-posts-page {
  max-width: 800px;
  padding: 24px 20px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 20px;
  font-weight: 600;
  margin-top: 16px;
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
}

.views {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
