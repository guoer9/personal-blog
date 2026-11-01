<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getPosts, deletePost, type Post } from '@/api/posts'
import { formatDate } from '@/utils/format'
import { confirmAction, showError, showSuccess } from '@/ui/feedback'

const router = useRouter()
const posts = ref<Post[]>([])
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

async function handleDelete(post: Post) {
  try {
    if (!await confirmAction(`确定要删除文章《${post.title}》吗？此操作不可恢复。`, '删除确认')) return
    
    await deletePost(post.id)
    await showSuccess('删除成功')
    fetchPosts()
  } catch (error: any) {
    await showError('删除失败')
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchPosts()
}

onMounted(() => {
  fetchPosts()
})
</script>

<template>
  <div class="posts-page">
    <div class="page-header">
      <h1 class="page-title">文章管理</h1>
      <el-button type="primary" @click="router.push('/admin/posts/new')">
        <el-icon><Plus /></el-icon>
        写文章
      </el-button>
    </div>
    
    <el-card shadow="never">
      <el-table :data="posts" v-loading="loading" stripe>
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <router-link :to="`/post/${row.slug}`" target="_blank">
              {{ row.title }}
            </router-link>
          </template>
        </el-table-column>
        
        <el-table-column prop="is_published" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_published ? 'success' : 'info'" size="small">
              {{ row.is_published ? '已发布' : '草稿' }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="view_count" label="阅读" width="80" />
        
        <el-table-column prop="tags" label="标签" width="200">
          <template #default="{ row }">
            <el-tag
              v-for="tag in row.tags"
              :key="tag.id"
              size="small"
              class="tag-item"
            >
              {{ tag.name }}
            </el-tag>
            <span v-if="!row.tags.length" class="no-tags">-</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="created_at" label="创建时间" width="150">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              text
              type="primary"
              size="small"
              @click="router.push(`/admin/posts/${row.id}/edit`)"
            >
              编辑
            </el-button>
            <el-button
              text
              type="danger"
              size="small"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.posts-page {
  max-width: 1200px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.tag-item {
  margin-right: 4px;
  margin-bottom: 4px;
}

.no-tags {
  color: #909399;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
