<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getPosts, type Post } from '@/api/posts'
import { getTags, type Tag } from '@/api/tags'
import { formatDate } from '@/utils/format'

const router = useRouter()
const posts = ref<Post[]>([])
const tags = ref<Tag[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

async function fetchPosts() {
  loading.value = true
  try {
    const response = await getPosts({
      page: currentPage.value,
      page_size: pageSize.value,
    })
    posts.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    console.error('获取文章列表失败', error)
  } finally {
    loading.value = false
  }
}

async function fetchTags() {
  try {
    const response = await getTags()
    tags.value = response.data
  } catch (error) {
    console.error('获取标签失败', error)
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchPosts()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  fetchPosts()
  fetchTags()
})
</script>

<template>
  <div class="home-page container">
    <div class="content-wrapper">
      <!-- 文章列表 -->
      <div class="posts-section">
        <h2 class="section-title">最新文章</h2>
        
        <div v-loading="loading" class="posts-list">
          <article 
            v-for="post in posts" 
            :key="post.id" 
            class="post-card"
            @click="router.push(`/post/${post.slug}`)"
          >
            <div v-if="post.cover_image" class="post-cover">
              <img :src="post.cover_image" :alt="post.title" />
            </div>
            <div class="post-content">
              <h3 class="post-title">{{ post.title }}</h3>
              <p v-if="post.summary" class="post-summary">{{ post.summary }}</p>
              <div class="post-meta">
                <span class="author">
                  <el-avatar :size="20">{{ post.author.username.charAt(0) }}</el-avatar>
                  {{ post.author.username }}
                </span>
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
            </div>
          </article>
          
          <el-empty v-if="!loading && posts.length === 0" description="暂无文章" />
        </div>
        
        <!-- 分页 -->
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
      
      <!-- 侧边栏 -->
      <aside class="sidebar">
        <div class="sidebar-section">
          <h3 class="sidebar-title">标签</h3>
          <div class="tags-cloud">
            <el-tag
              v-for="tag in tags"
              :key="tag.id"
              class="tag-item"
              @click="router.push(`/tag/${tag.slug}`)"
            >
              {{ tag.name }}
            </el-tag>
            <span v-if="tags.length === 0" class="no-tags">暂无标签</span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  padding: 24px 20px;
}

.content-wrapper {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 24px;
}

@media (max-width: 768px) {
  .content-wrapper {
    grid-template-columns: 1fr;
  }
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 20px;
  color: #303133;
}

.posts-list {
  min-height: 200px;
}

.post-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  margin-bottom: 20px;
}

.post-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}

.post-cover {
  height: 200px;
  overflow: hidden;
}

.post-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.post-content {
  padding: 20px;
}

.post-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
  line-height: 1.4;
}

.post-summary {
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: #909399;
  margin-bottom: 12px;
}

.author {
  display: flex;
  align-items: center;
  gap: 6px;
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

.sidebar {
  position: sticky;
  top: 80px;
}

.sidebar-section {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: #303133;
}

.tags-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-item {
  cursor: pointer;
}

.no-tags {
  color: #909399;
  font-size: 14px;
}
</style>
