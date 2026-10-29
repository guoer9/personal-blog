<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { getPost, type Post } from '@/api/posts'
import { getComments, createComment, deleteComment, type Comment } from '@/api/comments'
import { useUserStore } from '@/stores/user'
import { formatDate } from '@/utils/format'
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const post = ref<Post | null>(null)
const comments = ref<Comment[]>([])
const loading = ref(false)
const commentLoading = ref(false)
const newComment = ref('')
const replyTo = ref<Comment | null>(null)

const slug = computed(() => route.params.slug as string)

async function fetchPost() {
  loading.value = true
  try {
    const response = await getPost(slug.value)
    post.value = response.data
    // 获取评论
    fetchComments()
  } catch (error) {
    router.push('/')
  } finally {
    loading.value = false
  }
}

async function fetchComments() {
  if (!post.value) return
  try {
    const response = await getComments(post.value.id)
    comments.value = response.data
  } catch (error) {
    console.error('获取评论失败', error)
  }
}

async function handleSubmitComment() {
  if (!newComment.value.trim()) {
    ElMessage.warning('请输入评论内容')
    return
  }
  
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  
  commentLoading.value = true
  try {
    await createComment({
      content: newComment.value.trim(),
      post_id: post.value!.id,
      parent_id: replyTo.value?.id,
    })
    ElMessage.success('评论成功')
    newComment.value = ''
    replyTo.value = null
    fetchComments()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '评论失败')
  } finally {
    commentLoading.value = false
  }
}

async function handleDeleteComment(comment: Comment) {
  try {
    await ElMessageBox.confirm('确定要删除这条评论吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    
    await deleteComment(comment.id)
    ElMessage.success('删除成功')
    fetchComments()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

function handleReply(comment: Comment) {
  replyTo.value = comment
  // 滚动到评论框
  document.querySelector('.comment-form')?.scrollIntoView({ behavior: 'smooth' })
}

function cancelReply() {
  replyTo.value = null
}

function canDeleteComment(comment: Comment): boolean {
  if (!userStore.isLoggedIn) return false
  return userStore.isAdmin || comment.user.id === userStore.userInfo?.id
}

onMounted(() => {
  fetchPost()
})
</script>

<template>
  <div class="post-detail-page container">
    <div v-loading="loading">
      <article v-if="post" class="post-article">
        <!-- 文章头部 -->
        <header class="post-header">
          <h1 class="post-title">{{ post.title }}</h1>
          <div class="post-meta">
            <span class="author">
              <el-avatar :size="24">{{ post.author.username.charAt(0) }}</el-avatar>
              {{ post.author.username }}
            </span>
            <span class="date">发布于 {{ formatDate(post.created_at) }}</span>
            <span class="views">
              <el-icon><View /></el-icon>
              {{ post.view_count }} 次阅读
            </span>
          </div>
          <div v-if="post.tags.length" class="post-tags">
            <el-tag
              v-for="tag in post.tags"
              :key="tag.id"
              @click="router.push(`/tag/${tag.slug}`)"
            >
              {{ tag.name }}
            </el-tag>
          </div>
        </header>
        
        <!-- 文章封面 -->
        <div v-if="post.cover_image" class="post-cover">
          <img :src="post.cover_image" :alt="post.title" />
        </div>
        
        <!-- 文章内容 -->
        <div class="post-content">
          <MdPreview :modelValue="post.content" />
        </div>
      </article>
      
      <!-- 评论区 -->
      <section v-if="post" class="comments-section">
        <h2 class="section-title">评论 ({{ comments.length }})</h2>
        
        <!-- 评论表单 -->
        <div class="comment-form">
          <div v-if="replyTo" class="reply-to">
            回复 @{{ replyTo.user.username }}
            <el-button text size="small" @click="cancelReply">取消</el-button>
          </div>
          <el-input
            v-model="newComment"
            type="textarea"
            :rows="3"
            :placeholder="userStore.isLoggedIn ? '写下你的评论...' : '请先登录后评论'"
            :disabled="!userStore.isLoggedIn"
          />
          <div class="form-actions">
            <el-button
              type="primary"
              :loading="commentLoading"
              :disabled="!userStore.isLoggedIn"
              @click="handleSubmitComment"
            >
              发表评论
            </el-button>
          </div>
        </div>
        
        <!-- 评论列表 -->
        <div class="comments-list">
          <div v-for="comment in comments" :key="comment.id" class="comment-item">
            <div class="comment-main">
              <el-avatar :size="36">{{ comment.user.username.charAt(0) }}</el-avatar>
              <div class="comment-content">
                <div class="comment-header">
                  <span class="username">{{ comment.user.username }}</span>
                  <span class="time">{{ formatDate(comment.created_at) }}</span>
                </div>
                <p class="comment-text">{{ comment.content }}</p>
                <div class="comment-actions">
                  <el-button text size="small" @click="handleReply(comment)">回复</el-button>
                  <el-button
                    v-if="canDeleteComment(comment)"
                    text
                    size="small"
                    type="danger"
                    @click="handleDeleteComment(comment)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
            </div>
            
            <!-- 回复列表 -->
            <div v-if="comment.replies?.length" class="replies-list">
              <div v-for="reply in comment.replies" :key="reply.id" class="reply-item">
                <el-avatar :size="28">{{ reply.user.username.charAt(0) }}</el-avatar>
                <div class="comment-content">
                  <div class="comment-header">
                    <span class="username">{{ reply.user.username }}</span>
                    <span class="time">{{ formatDate(reply.created_at) }}</span>
                  </div>
                  <p class="comment-text">{{ reply.content }}</p>
                  <div class="comment-actions">
                    <el-button
                      v-if="canDeleteComment(reply)"
                      text
                      size="small"
                      type="danger"
                      @click="handleDeleteComment(reply)"
                    >
                      删除
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <el-empty v-if="comments.length === 0" description="暂无评论，快来抢沙发吧！" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.post-detail-page {
  max-width: 800px;
  padding: 24px 20px;
}

.post-article {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.post-header {
  padding: 32px;
  border-bottom: 1px solid #ebeef5;
}

.post-title {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 16px;
  color: #303133;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 20px;
  color: #909399;
  font-size: 14px;
  margin-bottom: 16px;
}

.author {
  display: flex;
  align-items: center;
  gap: 8px;
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

.post-cover {
  width: 100%;
}

.post-cover img {
  width: 100%;
  height: auto;
}

.post-content {
  padding: 32px;
}

.comments-section {
  margin-top: 24px;
  background: #fff;
  border-radius: 12px;
  padding: 24px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  color: #303133;
}

.comment-form {
  margin-bottom: 24px;
}

.reply-to {
  margin-bottom: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 14px;
  color: #606266;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-actions {
  margin-top: 12px;
  text-align: right;
}

.comment-item {
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.comment-item:last-child {
  border-bottom: none;
}

.comment-main {
  display: flex;
  gap: 12px;
}

.comment-content {
  flex: 1;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.username {
  font-weight: 500;
  color: #303133;
}

.time {
  font-size: 12px;
  color: #909399;
}

.comment-text {
  color: #606266;
  line-height: 1.6;
  margin-bottom: 8px;
}

.comment-actions {
  display: flex;
  gap: 8px;
}

.replies-list {
  margin-left: 48px;
  margin-top: 16px;
  padding-left: 16px;
  border-left: 2px solid #ebeef5;
}

.reply-item {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.reply-item:last-child {
  margin-bottom: 0;
}
</style>
