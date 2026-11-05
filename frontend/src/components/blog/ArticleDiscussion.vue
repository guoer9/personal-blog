<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { createComment, deleteComment, getComments, getNotionComments, type Comment } from '@/api/comments'
import { useUserStore } from '@/stores/user'
import { confirmAction, showError, showSuccess } from '@/ui/feedback'
import { formatDate } from '@/utils/format'

const props = defineProps<{ kind: 'post' | 'notion'; articleId: number; initialCount: number }>()
const emit = defineEmits<{ countChange: [count: number] }>()
const user = useUserStore()
const route = useRoute()
const comments = ref<Comment[]>([])
const loading = ref(false)
const failed = ref(false)
const sending = ref(false)
const content = ref('')
const replyTo = ref<Comment | null>(null)
const canComment = computed(() => user.isLoggedIn && !!user.userInfo)
const count = ref(props.initialCount)
const textarea = ref<HTMLTextAreaElement | null>(null)
let sequence = 0

function flatten(items: Comment[], depth = 0): Array<{ comment: Comment; depth: number }> {
  return items.flatMap(comment => [{ comment, depth }, ...flatten(comment.replies || [], depth + 1)])
}
const rows = computed(() => flatten(comments.value))

async function load() {
  const current = ++sequence
  loading.value = true; failed.value = false
  try {
    const response = await (props.kind === 'notion' ? getNotionComments(props.articleId) : getComments(props.articleId))
    if (current !== sequence) return
    comments.value = response.data
    count.value = flatten(response.data).length
    emit('countChange', count.value)
  } catch {
    if (current === sequence) failed.value = true
  } finally {
    if (current === sequence) loading.value = false
  }
}

async function submit() {
  if (sending.value || !canComment.value || !content.value.trim()) return
  const key = `${props.kind}:${props.articleId}`
  sending.value = true
  try {
    await createComment({
      ...(props.kind === 'notion' ? { notion_document_id: props.articleId } : { post_id: props.articleId }),
      content: content.value.trim(), parent_id: replyTo.value?.id,
    })
    if (key !== `${props.kind}:${props.articleId}`) return
    content.value = ''; replyTo.value = null
    await load()
    await showSuccess('评论已发布')
  } catch {
    if (key === `${props.kind}:${props.articleId}`) await showError('评论发布失败，请稍后重试')
  } finally {
    if (key === `${props.kind}:${props.articleId}`) sending.value = false
  }
}

async function remove(comment: Comment) {
  if (!await confirmAction('删除后无法恢复，确定删除这条评论及其回复吗？', '删除评论')) return
  const key = `${props.kind}:${props.articleId}`
  try {
    await deleteComment(comment.id)
    if (key === `${props.kind}:${props.articleId}`) await load()
  } catch { await showError('删除失败，请稍后重试') }
}

function reply(comment: Comment) {
  replyTo.value = comment
  textarea.value?.focus()
}

watch(() => [props.kind, props.articleId], () => {
  comments.value = []; content.value = ''; replyTo.value = null; sending.value = false
  count.value = props.initialCount
  void load()
}, { immediate: true })
onBeforeUnmount(() => { sequence += 1 })
</script>

<template>
  <section id="discussion" class="article-discussion" tabindex="-1" aria-labelledby="discussion-title">
    <header><h2 id="discussion-title">讨论 <span>{{ count }} 条评论</span></h2></header>
    <form v-if="canComment" class="comment-form" @submit.prevent="submit">
      <div class="form-heading"><label for="document-comment">{{ replyTo ? `回复 @${replyTo.user.username}` : '发表评论' }}</label><button v-if="replyTo" type="button" @click="replyTo = null">取消回复</button></div>
      <textarea id="document-comment" ref="textarea" v-model="content" rows="4" maxlength="2000" placeholder="写下你的想法…" :disabled="sending" />
      <div class="form-footer"><span>{{ content.length }} / 2000</span><button type="submit" class="editorial-button" :disabled="sending || !content.trim()">{{ sending ? '发送中…' : '发布评论' }}</button></div>
    </form>
    <p v-else class="anonymous-note"><router-link :to="{ path: '/login', query: { redirect: route.fullPath } }">登录后发表评论 ↗</router-link></p>
    <div v-if="loading" role="status">正在读取评论…</div>
    <div v-else-if="failed" role="alert"><p>评论暂时没有加载成功。</p><button type="button" class="editorial-button" @click="load">重新加载评论</button></div>
    <div v-else-if="!rows.length" role="status">还没有评论。第一条想法会从这里开始。</div>
    <div v-else class="comments-list">
      <article v-for="{ comment, depth } in rows" :key="comment.id" class="comment-item" :style="{ marginLeft: `${Math.min(depth, 3) * 18}px` }">
        <header><strong>{{ comment.user.username }}</strong><time :datetime="comment.created_at">{{ formatDate(comment.created_at) }}</time></header>
        <p><span v-if="comment.parent_id" class="reply-marker">回复 · </span>{{ comment.content }}</p>
        <div class="comment-actions"><button v-if="canComment" type="button" @click="reply(comment)">回复</button><button v-if="canComment && (user.isAdmin || user.userInfo?.id === comment.user.id)" type="button" @click="remove(comment)">删除</button></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.article-discussion { max-width: 800px; margin: 70px auto 0; padding: 30px 0; border-top: 1px solid var(--line); scroll-margin-top: 100px; }
.article-discussion h2 { margin: 0 0 24px; font-size: 1.6rem; }.article-discussion h2 span { margin-left: 14px; color: var(--muted); font-size: .85rem; font-weight: 400; }
.comment-form { margin-bottom: 30px; padding: 22px; border: 1px solid var(--line); background: var(--paper-soft); }
.form-heading,.form-footer,.comment-item header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; align-items: center; }
.comment-form textarea { box-sizing: border-box; width: 100%; margin: 16px 0; padding: 12px; resize: vertical; background: var(--paper); color: var(--ink); border: 1px solid var(--line); font: inherit; }
.form-footer > span,.anonymous-note,time,.reply-marker { color: var(--muted); font-size: .8rem; }.anonymous-note { margin-bottom: 28px; }
.comment-item { border-bottom: 1px solid var(--line); padding: 22px 0; }.comment-item p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }.comment-actions { display: flex; gap: 18px; }
.comment-actions button,.form-heading button { padding: 6px 0; border: 0; background: none; color: var(--electric-blue); cursor: pointer; }
button:disabled { cursor: default; opacity: .5; }:is(button,textarea):focus-visible { outline: 3px solid var(--electric-blue); outline-offset: 3px; }
</style>
