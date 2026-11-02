<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getAdminArticles, getAdminArticleComments, type AdminArticle } from '@/api/articles'
import { deleteComment, type Comment } from '@/api/comments'
import { formatDate } from '@/utils/format'
import { confirmAction, showError, showSuccess } from '@/ui/feedback'

interface PostWithComments extends AdminArticle {
  comments: Comment[]
}

const postsWithComments = ref<PostWithComments[]>([])
const loading = ref(false)
const failed = ref(false)

async function fetchData() {
  loading.value = true
  failed.value = false
  try {
    const result: PostWithComments[] = []
    let page = 1
    let totalPages = 1
    do {
      const response = await getAdminArticles({ page, page_size: 50 })
      totalPages = response.data.total_pages
      const groups = await Promise.all(response.data.items.filter(article => article.comment_count > 0).map(async article => {
        const response = await getAdminArticleComments(article.kind, article.id)
        return { ...article, comments: response.data }
      }))
      result.push(...groups)
      page += 1
    } while (page <= totalPages)
    postsWithComments.value = result
  } catch (error) {
    failed.value = true
    console.error('获取数据失败', error)
  } finally {
    loading.value = false
  }
}

async function handleDelete(comment: Comment) {
  try {
    if (!await confirmAction('确定要删除这条评论吗？', '删除确认')) return
    
    await deleteComment(comment.id)
    await showSuccess('删除成功')
    fetchData()
  } catch (error: any) {
    await showError('删除失败')
  }
}

function flattenComments(comments: Comment[]): Comment[] {
  const result: Comment[] = []
  for (const comment of comments) {
    result.push(comment)
    if (comment.replies?.length) {
      result.push(...flattenComments(comment.replies))
    }
  }
  return result
}

onMounted(() => {
  fetchData()
})
</script>

<template>
  <div class="comments-page">
    <div class="page-header">
      <h1 class="page-title">评论管理</h1>
    </div>
    <div v-if="failed" role="alert"><p>评论读取失败，请重试。</p><el-button @click="fetchData">重新加载</el-button></div>
    
    <div v-loading="loading">
      <el-card
        v-for="post in postsWithComments"
        :key="post.key"
        shadow="never"
        class="post-card"
      >
        <template #header>
          <div class="post-header">
            <router-link v-if="post.is_published" :to="`${post.public_url}#discussion`" target="_blank">
              {{ post.title }}
            </router-link>
            <span v-else>{{ post.title }}（未公开）</span>
            <el-tag size="small">{{ post.kind === 'notion' ? 'Notion' : '手动文章' }}</el-tag>
            <span class="comment-count">{{ flattenComments(post.comments).length }} 条评论</span>
          </div>
        </template>
        
        <el-table :data="flattenComments(post.comments)" size="small">
          <el-table-column prop="user.username" label="用户" width="120" />
          <el-table-column prop="content" label="内容" min-width="200">
            <template #default="{ row }">
              <span v-if="row.parent_id" class="reply-tag">[回复]</span>
              {{ row.content }}
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="时间" width="150">
            <template #default="{ row }">
              {{ formatDate(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
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
      </el-card>
      
      <el-empty v-if="!loading && !failed && postsWithComments.length === 0" description="暂无评论" />
    </div>
  </div>
</template>

<style scoped>
.comments-page {
  max-width: 1200px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.post-card {
  margin-bottom: 20px;
}

.post-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.comment-count {
  font-size: 12px;
  color: #909399;
}

.reply-tag {
  color: #909399;
  font-size: 12px;
  margin-right: 4px;
}
</style>
