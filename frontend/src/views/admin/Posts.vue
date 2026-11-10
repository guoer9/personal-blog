<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getAdminArticles, unpublishAdminArticle, type AdminArticle } from '@/api/articles'
import { formatDate } from '@/utils/format'
import { confirmAction, showError, showSuccess } from '@/ui/feedback'

const router = useRouter()
const articles = ref<AdminArticle[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const statusLabels: Record<AdminArticle['status'], string> = {
  published: '已发布',
  draft: '草稿',
  isolated: '已隔离',
  archived: '已下架',
}

function statusType(status: AdminArticle['status']) {
  if (status === 'published') return 'success'
  if (status === 'draft') return 'info'
  return 'warning'
}

function statusLabel(status: unknown) {
  return statusLabels[status as AdminArticle['status']] || '未知状态'
}

async function fetchArticles() {
  loading.value = true
  try {
    const response = await getAdminArticles({ page: currentPage.value, page_size: pageSize.value })
    articles.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    console.error('获取统一文章列表失败', error)
  } finally {
    loading.value = false
  }
}

async function handleUnpublish(article: AdminArticle) {
  try {
    if (!await confirmAction(`确定要下架《${article.title}》吗？下架后公开页面将无法访问。`, '下架确认')) return
    await unpublishAdminArticle(article.kind, article.id)
    await showSuccess('文章已下架')
    await fetchArticles()
  } catch (error) {
    console.error('下架文章失败', error)
    await showError('下架失败')
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchArticles()
}

onMounted(fetchArticles)
</script>

<template>
  <div class="posts-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">文章管理</h1>
        <p class="page-lede">手动文章和 Notion 文章共用一张管理表，保留各自的来源链接。</p>
      </div>
      <el-button type="primary" @click="router.push('/admin/posts/new')">
        <el-icon><Plus /></el-icon>
        写文章
      </el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="articles" v-loading="loading" stripe row-key="key">
        <el-table-column label="文章" min-width="250">
          <template #default="{ row }">
            <a v-if="row.is_published" :href="row.public_url" target="_blank" rel="noopener noreferrer" class="article-link">
              {{ row.title }} ↗
            </a>
            <span v-else class="article-title">{{ row.title }}</span>
            <div class="article-source">
              <el-tag size="small" effect="plain">{{ row.kind === 'notion' ? 'Notion' : '手动' }}</el-tag>
              <span>{{ row.source_label }}</span>
              <a v-if="row.kind === 'notion' && row.external_url" :href="row.external_url" target="_blank" rel="noopener noreferrer">在 Notion 打开 ↗</a>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="作者" width="120">
          <template #default="{ row }">{{ row.author?.username || row.author_label }}</template>
        </el-table-column>

        <el-table-column label="标签" min-width="170">
          <template #default="{ row }">
            <el-tag v-for="tag in row.tags" :key="tag" size="small" class="tag-item">{{ tag }}</el-tag>
            <span v-if="!row.tags.length" class="no-tags">暂无标签</span>
          </template>
        </el-table-column>

        <el-table-column label="评论" width="80"><template #default="{ row }"><router-link :to="'/admin/comments'">{{ row.comment_count }}</router-link></template></el-table-column>
        <el-table-column label="阅读" width="80" prop="view_count" />

        <el-table-column label="更新时间" width="155">
          <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.kind === 'post'" text type="primary" size="small" @click="router.push(`/admin/posts/${row.id}/edit`)">编辑</el-button>
            <el-button v-if="row.is_published" text type="danger" size="small" @click="handleUnpublish(row)">下架</el-button>
            <span v-else class="operation-state">{{ statusLabel(row.status) }}</span>
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
.posts-page { max-width: 1400px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; }
.page-title { font-size: 24px; font-weight: 600; color: var(--admin-text); margin: 0; }
.page-lede { color: var(--admin-muted); margin: 8px 0 0; }
.article-link { color: var(--admin-link); font-weight: 600; text-decoration: none; }
.article-link:hover { text-decoration: underline; }
.article-title { font-weight: 600; color: var(--admin-text); }
.article-source { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; color: var(--admin-muted); font-size: 12px; }
.article-source a { color: var(--admin-link); text-decoration: none; }
.tag-item { margin: 0 4px 4px 0; }
.no-tags, .operation-state { color: var(--admin-muted); }
.pagination { margin-top: 20px; display: flex; justify-content: flex-end; }
@media (max-width: 700px) { .page-header { flex-direction: column; } }
</style>
