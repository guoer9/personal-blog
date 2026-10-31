<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const loading = ref(true)
const notFound = ref(false)
const loadError = ref(false)
const commentsLoading = ref(false)
const commentsError = ref(false)
const commentLoading = ref(false)
const newComment = ref('')
const replyTo = ref<Comment | null>(null)
const readingProgress = ref(0)

const slug = computed(() => String(route.params.slug || ''))
const readingTime = computed(() => {
  const content = post.value?.content || ''
  const cjkCharacters = (content.match(/[\u3400-\u9fff]/g) || []).length
  const latinWords = (content.match(/[A-Za-z0-9_]+/g) || []).length
  return Math.max(1, Math.ceil(cjkCharacters / 450 + latinWords / 220))
})
const canComment = computed(() => userStore.isLoggedIn && Boolean(userStore.userInfo))

let requestSequence = 0

async function fetchPost() {
  const sequence = ++requestSequence
  loading.value = true
  notFound.value = false
  loadError.value = false
  post.value = null
  comments.value = []

  try {
    const response = await getPost(slug.value)
    if (sequence !== requestSequence) return
    post.value = response.data
    document.title = `${response.data.title} · GUOER`
    fetchComments()
  } catch (error: any) {
    if (sequence !== requestSequence) return
    notFound.value = error?.response?.status === 404
    loadError.value = !notFound.value
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

async function fetchComments() {
  if (!post.value) return
  const postId = post.value.id
  commentsLoading.value = true
  commentsError.value = false
  try {
    const response = await getComments(postId)
    if (post.value?.id === postId) comments.value = response.data
  } catch {
    if (post.value?.id === postId) commentsError.value = true
  } finally {
    commentsLoading.value = false
  }
}

async function handleSubmitComment() {
  if (!newComment.value.trim()) {
    ElMessage.warning('请输入评论内容')
    return
  }
  if (!userStore.isLoggedIn) {
    router.push({ name: 'AdminLogin', query: { redirect: route.fullPath } })
    return
  }
  if (!post.value) return

  commentLoading.value = true
  try {
    await createComment({
      content: newComment.value.trim(),
      post_id: post.value.id,
      parent_id: replyTo.value?.id,
    })
    ElMessage.success('评论已发布')
    newComment.value = ''
    replyTo.value = null
    await fetchComments()
  } catch (error: any) {
    if (!error?.response) ElMessage.error('评论发布失败，请稍后重试')
  } finally {
    commentLoading.value = false
  }
}

async function handleDeleteComment(comment: Comment) {
  try {
    await ElMessageBox.confirm('删除后无法恢复，确定继续吗？', '删除评论', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await deleteComment(comment.id)
    await fetchComments()
    ElMessage.success('评论已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('删除失败，请稍后重试')
  }
}

async function handleReply(comment: Comment) {
  replyTo.value = comment
  await nextTick()
  document.querySelector('.comment-form')?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  })
  document.querySelector<HTMLTextAreaElement>('.comment-form textarea')?.focus({ preventScroll: true })
}

function canDeleteComment(comment: Comment): boolean {
  if (!userStore.isLoggedIn || !userStore.userInfo) return false
  return userStore.isAdmin || comment.user.id === userStore.userInfo.id
}

async function copyArticleLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    ElMessage.success('文章链接已复制')
  } catch {
    ElMessage.info(window.location.href)
  }
}

function updateReadingProgress() {
  if (!post.value) {
    readingProgress.value = 0
    return
  }
  const article = document.querySelector<HTMLElement>('.prose-shell')
  if (!article) return
  const rect = article.getBoundingClientRect()
  const distance = Math.max(0, rect.height - window.innerHeight)
  readingProgress.value = distance === 0 ? 100 : Math.min(100, Math.max(0, (-rect.top / distance) * 100))
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && window.getSelection()?.toString()) {
    const selection = window.getSelection()?.toString() || ''
    navigator.clipboard?.writeText(selection).catch(() => undefined)
  }
}

watch(slug, fetchPost, { immediate: true })
onMounted(() => {
  window.addEventListener('scroll', updateReadingProgress, { passive: true })
  window.addEventListener('resize', updateReadingProgress)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  requestSequence += 1
  window.removeEventListener('scroll', updateReadingProgress)
  window.removeEventListener('resize', updateReadingProgress)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="post-detail-page">
    <div v-if="loading" class="article-skeleton page-shell" aria-label="正在载入文章">
      <span class="skeleton-kicker" />
      <span class="skeleton-title" />
      <span class="skeleton-title skeleton-title--short" />
      <span class="skeleton-meta" />
      <div class="skeleton-body">
        <span v-for="index in 8" :key="index" />
      </div>
    </div>

    <div v-else-if="notFound || loadError" class="article-state page-shell">
      <div class="state-code">{{ notFound ? '404 / MISSING' : '503 / INTERRUPTED' }}</div>
      <div class="state-copy">
        <p class="section-kicker">Field note / unavailable</p>
        <h1>{{ notFound ? '这篇文章不在档案里。' : '文章暂时无法加载。' }}</h1>
        <p>{{ notFound ? '链接可能已经变更，或者这篇文章不再公开。' : '网络或服务暂时出现问题，你可以稍后重新尝试。' }}</p>
        <div class="state-actions">
          <button v-if="loadError" type="button" class="editorial-button editorial-button--acid" @click="fetchPost">重新加载 ↗</button>
          <router-link to="/writing" class="editorial-button">浏览全部文章</router-link>
          <router-link to="/" class="text-link">返回首页</router-link>
        </div>
      </div>
    </div>

    <template v-else-if="post">
      <div class="reading-progress" aria-hidden="true"><span :style="{ width: `${readingProgress}%` }" /></div>

      <header class="article-hero">
        <div class="page-shell article-hero-inner">
          <router-link to="/writing" class="back-link">← WRITING / ALL NOTES</router-link>
          <div class="article-heading-grid">
            <div>
              <p class="section-kicker">Field note / {{ new Date(post.created_at).getFullYear() }}</p>
              <h1>{{ post.title }}</h1>
            </div>
            <div class="article-meta-card">
              <p v-if="post.summary">{{ post.summary }}</p>
              <dl>
                <div><dt>PUBLISHED</dt><dd>{{ formatDate(post.created_at) }}</dd></div>
                <div><dt>AUTHOR</dt><dd>{{ post.author.username }}</dd></div>
                <div><dt>READ</dt><dd>{{ readingTime }} MIN / {{ post.view_count }} VIEWS</dd></div>
              </dl>
            </div>
          </div>
          <div v-if="post.tags.length" class="article-tags" aria-label="文章标签">
            <router-link v-for="tag in post.tags" :key="tag.id" :to="`/tag/${tag.slug}`"># {{ tag.name }}</router-link>
          </div>
        </div>
        <div v-if="post.cover_image" class="article-cover page-shell">
          <img :src="post.cover_image" :alt="post.title" />
          <span>FIG. 01 / COVER</span>
        </div>
      </header>

      <div class="article-layout page-shell">
        <aside class="article-tools" aria-label="文章工具">
          <div class="tool-index">
            <span>ARTICLE</span>
            <b>{{ String(post.id).padStart(3, '0') }}</b>
          </div>
          <button type="button" @click="copyArticleLink">复制链接 <span>↗</span></button>
          <a href="#discussion">参与讨论 <span>↓</span></a>
        </aside>

        <article class="article-main">
          <div class="prose-shell">
            <MdPreview :model-value="post.content || ''" :editor-id="`post-${post.id}`" />
          </div>

          <footer class="article-end">
            <p>END / FIELD NOTE {{ String(post.id).padStart(3, '0') }}</p>
            <div>
              <span>如果这篇文章对你有帮助，可以分享给正在思考同一问题的人。</span>
              <button type="button" @click="copyArticleLink">复制文章链接 ↗</button>
            </div>
            <router-link to="/writing" class="next-link">继续浏览全部文章 <span>↗</span></router-link>
          </footer>
        </article>
      </div>

      <section id="discussion" class="discussion page-shell" aria-labelledby="discussion-title">
        <header class="discussion-header">
          <div>
            <p class="section-kicker">Discussion / {{ String(comments.length).padStart(2, '0') }}</p>
            <h2 id="discussion-title">Leave a<br /><em>thought.</em></h2>
          </div>
          <p>评论会保存在这套内容系统中。保持具体、友善，并让讨论沿着文章继续。</p>
        </header>

        <div class="discussion-grid">
          <div class="comment-form-wrap">
            <div v-if="!canComment" class="login-prompt">
              <span>评论区暂未开放</span>
              <p>当前仅展示已有讨论。公开博客不提供登录或注册入口。</p>
            </div>
            <form v-else class="comment-form" @submit.prevent="handleSubmitComment">
              <div class="form-heading">
                <span>{{ replyTo ? `回复 @${replyTo.user.username}` : '发表评论' }}</span>
                <button v-if="replyTo" type="button" @click="replyTo = null">取消回复</button>
              </div>
              <label for="comment-content" class="sr-only">评论内容</label>
              <textarea id="comment-content" v-model="newComment" name="comment" rows="5" autocomplete="off" maxlength="2000" placeholder="写下你的想法…" />
              <div class="form-footer">
                <span>{{ newComment.length }} / 2000</span>
                <button type="submit" class="editorial-button" :disabled="commentLoading || !newComment.trim()">
                  {{ commentLoading ? '发送中…' : '发布评论' }}
                </button>
              </div>
            </form>
          </div>

          <div class="comments-list" aria-live="polite">
            <div v-if="commentsLoading" class="comments-loading">
              <span v-for="index in 3" :key="index" />
            </div>
            <div v-else-if="commentsError" class="comments-error">
              <p>评论暂时没有加载成功。</p>
              <button type="button" class="text-action" @click="fetchComments">重新加载 ↗</button>
            </div>
            <div v-else-if="comments.length">
              <article v-for="comment in comments" :key="comment.id" class="comment-item">
                <div class="comment-main">
                  <div class="comment-avatar" aria-hidden="true">{{ comment.user.username.charAt(0).toUpperCase() }}</div>
                  <div class="comment-content">
                    <header>
                      <strong>{{ comment.user.username }}</strong>
                      <time :datetime="comment.created_at">{{ formatDate(comment.created_at) }}</time>
                    </header>
                    <p>{{ comment.content }}</p>
                    <div class="comment-actions">
                      <button type="button" @click="handleReply(comment)">回复</button>
                      <button v-if="canDeleteComment(comment)" type="button" class="danger" @click="handleDeleteComment(comment)">删除</button>
                    </div>
                  </div>
                </div>
                <div v-if="comment.replies?.length" class="replies-list">
                  <article v-for="reply in comment.replies" :key="reply.id" class="reply-item">
                    <div class="comment-avatar comment-avatar--small" aria-hidden="true">{{ reply.user.username.charAt(0).toUpperCase() }}</div>
                    <div class="comment-content">
                      <header>
                        <strong>{{ reply.user.username }}</strong>
                        <time :datetime="reply.created_at">{{ formatDate(reply.created_at) }}</time>
                      </header>
                      <p>{{ reply.content }}</p>
                      <div class="comment-actions">
                        <button v-if="canDeleteComment(reply)" type="button" class="danger" @click="handleDeleteComment(reply)">删除</button>
                      </div>
                    </div>
                  </article>
                </div>
              </article>
            </div>
            <div v-else class="comments-empty">
              <span>00</span>
              <p>还没有评论。第一条想法会从这里开始。</p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.post-detail-page { min-height: 70vh; }
.reading-progress { position: fixed; z-index: 45; top: 75px; left: 0; right: 0; height: 2px; pointer-events: none; }
.reading-progress span { display: block; height: 100%; background: var(--acid); transition: width 80ms linear; }
.article-skeleton { padding: 110px 0 80px; }
.article-skeleton > span { display: block; background: linear-gradient(90deg, var(--paper-soft), #fbfaf7, var(--paper-soft)); background-size: 200% 100%; animation: skeleton 1.4s infinite; }
.skeleton-kicker { width: 170px; height: 13px; margin-bottom: 35px; }
.skeleton-title { width: 82%; height: clamp(55px, 8vw, 105px); margin-bottom: 13px; }
.skeleton-title--short { width: 54%; }
.skeleton-meta { width: 310px; height: 14px; margin-top: 35px; }
.skeleton-body { display: grid; gap: 15px; width: min(720px, 78%); margin: 80px auto 0; }
.skeleton-body span { height: 18px; }
.skeleton-body span:nth-child(2n) { width: 86%; }
.article-state { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 45px; align-items: start; padding: 130px 0; }
.state-code { padding-top: 5px; color: var(--muted); font: .65rem var(--mono-font); letter-spacing: .06em; }
.state-copy h1 { max-width: 850px; margin-bottom: 28px; font: 400 clamp(4rem, 9vw, 8rem)/.88 var(--display-font); letter-spacing: -.065em; }
.state-copy > p:not(.section-kicker) { max-width: 600px; color: var(--muted); }
.state-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 22px; margin-top: 38px; }
.text-link { color: var(--ink); font: .64rem var(--mono-font); text-decoration: none; border-bottom: 1px solid currentColor; }
.article-hero { padding: 64px 0 0; background: var(--ink); color: var(--paper); }
.article-hero-inner { padding-bottom: 55px; }
.back-link { display: inline-flex; margin-bottom: 65px; color: #a7aaa6; font: .62rem var(--mono-font); letter-spacing: .05em; text-decoration: none; }
.article-hero .section-kicker { color: #a7aaa6; }
.article-heading-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(250px, .4fr); gap: clamp(40px, 9vw, 130px); align-items: end; }
.article-hero h1 { max-width: 970px; margin: 0; font: 400 clamp(3.7rem, 8vw, 8rem)/.88 var(--display-font); letter-spacing: -.065em; text-wrap: balance; }
.article-meta-card { padding-top: 18px; border-top: 1px solid rgba(244,241,234,.4); }
.article-meta-card > p { color: #c1c4c0; font-size: .84rem; line-height: 1.7; }
.article-meta-card dl { display: grid; gap: 10px; margin: 25px 0 0; }
.article-meta-card dl div { display: flex; justify-content: space-between; gap: 20px; padding-top: 9px; border-top: 1px solid rgba(244,241,234,.13); }
.article-meta-card dt { color: #8f9390; font: .54rem var(--mono-font); letter-spacing: .05em; }
.article-meta-card dd { margin: 0; color: #d8dad6; font: .58rem var(--mono-font); text-align: right; }
.article-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 42px; }
.article-tags a { padding: 6px 10px; border: 1px solid rgba(244,241,234,.3); color: var(--acid); font: .6rem var(--mono-font); text-decoration: none; }
.article-tags a:hover { border-color: var(--acid); background: var(--acid); color: var(--ink); }
.article-cover { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: end; padding-top: 30px; }
.article-cover img { grid-column: 1 / -1; width: 100%; max-height: 680px; object-fit: cover; }
.article-cover span { grid-column: 2; color: #8f9390; font: .56rem var(--mono-font); }
.article-layout { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: clamp(35px, 8vw, 110px); align-items: start; }
.article-tools { position: sticky; top: 112px; display: grid; gap: 16px; padding-top: 90px; }
.tool-index { display: grid; gap: 4px; padding-bottom: 15px; border-bottom: 1px solid var(--line); }
.tool-index span { color: var(--muted); font: .55rem var(--mono-font); letter-spacing: .07em; }
.tool-index b { font: 400 2rem var(--display-font); }
.article-tools button, .article-tools a { display: flex; justify-content: space-between; gap: 10px; padding: 0; border: 0; background: transparent; color: var(--muted); font: .59rem var(--mono-font); text-align: left; text-decoration: none; cursor: pointer; }
.article-main { min-width: 0; max-width: 820px; }
.prose-shell { padding: 74px 0 50px; font-size: 1.03rem; line-height: 1.9; }
.prose-shell :deep(.md-editor) { background: transparent; color: var(--ink); }
.prose-shell :deep(.md-editor-preview-wrapper) { padding: 0; }
.prose-shell :deep(.md-editor-preview) { font-family: var(--body-font); font-size: 1.03rem; line-height: 1.9; }
.prose-shell :deep(.md-editor-preview h1),
.prose-shell :deep(.md-editor-preview h2),
.prose-shell :deep(.md-editor-preview h3),
.prose-shell :deep(.md-editor-preview h4) { color: var(--ink); font-family: var(--display-font); font-weight: 400; letter-spacing: -.035em; line-height: 1.05; }
.prose-shell :deep(.md-editor-preview h1) { margin: 1.3em 0 .6em; font-size: clamp(2.8rem, 6vw, 4.5rem); }
.prose-shell :deep(.md-editor-preview h2) { margin: 2.3em 0 .7em; padding-bottom: .25em; border-bottom: 1px solid var(--line); font-size: clamp(2.2rem, 5vw, 3.4rem); }
.prose-shell :deep(.md-editor-preview h3) { margin: 1.8em 0 .6em; font-size: 2rem; }
.prose-shell :deep(.md-editor-preview p) { margin: 0 0 1.3em; color: #34332f; }
.prose-shell :deep(.md-editor-preview a) { color: var(--electric-blue); text-underline-offset: 4px; }
.prose-shell :deep(.md-editor-preview blockquote) { margin: 2em 0; padding: 22px 25px; border: 0; border-left: 3px solid var(--acid); background: var(--paper-soft); color: var(--ink); font: 400 1.5rem/1.5 var(--display-font); }
.prose-shell :deep(.md-editor-preview code) { border-radius: 0; background: #e5e1d8; color: #20201d; font-family: var(--mono-font); font-size: .86em; }
.prose-shell :deep(.md-editor-preview pre) { margin: 2em 0; padding: 24px; border-left: 2px solid var(--acid); border-radius: 0; background: #171817; color: #e6e7e2; overflow-x: auto; }
.prose-shell :deep(.md-editor-preview pre code) { background: transparent; color: inherit; }
.prose-shell :deep(.md-editor-preview img) { width: 100%; margin: 2em 0; border: 1px solid var(--line); }
.prose-shell :deep(.md-editor-preview table) { width: 100%; border-collapse: collapse; font-size: .82rem; }
.prose-shell :deep(.md-editor-preview th),
.prose-shell :deep(.md-editor-preview td) { padding: 10px; border: 1px solid var(--line); }
.prose-shell :deep(.md-editor-preview hr) { margin: 3em 0; border: 0; border-top: 1px solid var(--line); }
.article-end { padding: 34px 0 0; border-top: 1px solid var(--ink); }
.article-end > p { color: var(--muted); font: .58rem var(--mono-font); letter-spacing: .05em; }
.article-end > div { display: flex; justify-content: space-between; gap: 30px; margin-top: 28px; }
.article-end > div span { max-width: 460px; color: var(--muted); font-size: .82rem; }
.article-end > div button { align-self: start; padding: 0 0 5px; border: 0; border-bottom: 1px solid currentColor; background: transparent; color: var(--ink); font: .61rem var(--mono-font); cursor: pointer; }
.next-link { display: flex; justify-content: space-between; margin-top: 50px; padding: 21px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--ink); font-size: .9rem; text-decoration: none; }
.next-link:hover { padding-right: 8px; padding-left: 8px; background: var(--acid); }
.discussion { margin-top: 125px; }
.discussion-header { display: grid; grid-template-columns: 1fr 330px; gap: 60px; align-items: end; padding-bottom: 44px; border-bottom: 1px solid var(--ink); }
.discussion-header h2 { margin: 0; font: 400 clamp(3.7rem, 8vw, 7rem)/.87 var(--display-font); letter-spacing: -.06em; }
.discussion-header h2 em { color: var(--electric-blue); font-weight: 400; }
.discussion-header > p { color: var(--muted); font-size: .82rem; }
.discussion-grid { display: grid; grid-template-columns: minmax(260px, .68fr) minmax(0, 1.32fr); gap: clamp(45px, 9vw, 130px); padding-top: 44px; }
.comment-form-wrap { position: sticky; top: 105px; align-self: start; }
.comment-form { padding: 24px; border: 1px solid var(--ink); background: var(--paper-soft); }
.form-heading { display: flex; justify-content: space-between; gap: 15px; margin-bottom: 17px; font-size: .82rem; font-weight: 700; }
.form-heading button { padding: 0; border: 0; background: transparent; color: var(--muted); font: .58rem var(--mono-font); cursor: pointer; }
.comment-form textarea { width: 100%; min-height: 150px; padding: 14px; resize: vertical; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink); outline: none; font-size: .87rem; line-height: 1.7; }
.comment-form textarea:focus { border-color: var(--electric-blue); outline: 2px solid rgba(55,103,255,.16); }
.form-footer { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-top: 16px; }
.form-footer > span { color: var(--muted); font: .56rem var(--mono-font); }
.form-footer .editorial-button { min-height: 42px; padding: 0 16px; }
.form-footer .editorial-button:disabled { cursor: not-allowed; opacity: .45; }
.login-prompt { padding: 26px; border: 1px solid var(--line); }
.login-prompt > span { font: 400 2rem var(--display-font); }
.login-prompt p { margin: 12px 0 22px; color: var(--muted); font-size: .82rem; }
.login-prompt .editorial-button { min-height: 42px; padding: 0 16px; }
.comments-list { min-width: 0; }
.comment-item { padding: 0 0 28px; margin-bottom: 28px; border-bottom: 1px solid var(--line); }
.comment-main, .reply-item { display: flex; gap: 14px; }
.comment-avatar { display: grid; place-items: center; flex: 0 0 37px; width: 37px; height: 37px; border: 1px solid var(--ink); border-radius: 50%; background: var(--acid); font: 700 .7rem var(--mono-font); }
.comment-avatar--small { flex-basis: 29px; width: 29px; height: 29px; font-size: .6rem; }
.comment-content { flex: 1; min-width: 0; }
.comment-content header { display: flex; justify-content: space-between; gap: 15px; align-items: baseline; }
.comment-content strong { font-size: .82rem; }
.comment-content time { color: var(--muted); font: .56rem var(--mono-font); }
.comment-content > p { margin: 12px 0 10px; color: #41413c; font-size: .87rem; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-actions { display: flex; gap: 14px; }
.comment-actions button { padding: 0; border: 0; background: transparent; color: var(--muted); font: .57rem var(--mono-font); cursor: pointer; }
.comment-actions button:hover { color: var(--ink); }
.comment-actions .danger:hover { color: #b32e25; }
.replies-list { display: grid; gap: 20px; margin: 23px 0 0 51px; padding-left: 18px; border-left: 1px solid var(--line); }
.replies-list .reply-item:not(:last-child) { padding-bottom: 20px; border-bottom: 1px dashed var(--line); }
.comments-empty { display: grid; grid-template-columns: 60px 1fr; gap: 22px; align-items: center; min-height: 150px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.comments-empty span { color: var(--muted); font: 2.5rem var(--display-font); }
.comments-empty p { color: var(--muted); font-size: .86rem; }
.comments-loading { display: grid; gap: 16px; }
.comments-loading span { height: 110px; border-top: 1px solid var(--line); background: linear-gradient(90deg, var(--paper-soft), transparent, var(--paper-soft)); background-size: 200% 100%; animation: skeleton 1.4s infinite; }
.comments-error { padding: 25px; border: 1px solid var(--line); color: var(--muted); }
.comments-error .text-action { margin-top: 14px; color: var(--ink); }
@keyframes skeleton { to { background-position: -200% 0; } }
@media (max-width: 900px) {
  .article-heading-grid { grid-template-columns: 1fr; gap: 42px; }
  .article-meta-card { max-width: 450px; }
  .article-layout { grid-template-columns: 1fr; }
  .article-tools { position: static; display: flex; align-items: center; gap: 18px; padding-top: 32px; }
  .tool-index { margin-right: auto; padding: 0 20px 0 0; border: 0; border-right: 1px solid var(--line); }
  .article-main { max-width: none; }
  .prose-shell { padding-top: 50px; }
  .discussion-header { grid-template-columns: 1fr; gap: 25px; }
  .discussion-header > p { max-width: 500px; }
  .discussion-grid { grid-template-columns: 1fr; }
  .comment-form-wrap { position: static; }
  .comment-form { max-width: 700px; }
}
@media (max-width: 620px) {
  .reading-progress { top: 65px; }
  .article-skeleton { padding-top: 70px; }
  .article-skeleton > span { max-width: 100%; }
  .skeleton-body { width: 100%; }
  .article-state { grid-template-columns: 1fr; gap: 22px; padding: 90px 0; }
  .article-hero { padding-top: 42px; }
  .back-link { margin-bottom: 45px; }
  .article-hero h1 { font-size: clamp(3.2rem, 15vw, 5.5rem); }
  .article-tools { flex-wrap: wrap; }
  .tool-index { flex: 1 0 100%; border-right: 0; }
  .prose-shell { font-size: 1rem; }
  .prose-shell :deep(.md-editor-preview) { font-size: 1rem; }
  .article-end > div { flex-direction: column; gap: 18px; }
  .discussion { margin-top: 90px; }
  .discussion-header h2 { font-size: clamp(3.4rem, 17vw, 5.5rem); }
  .comment-form, .login-prompt { padding: 18px; }
  .form-footer { align-items: stretch; flex-direction: column; }
  .form-footer .editorial-button { width: 100%; }
  .replies-list { margin-left: 19px; padding-left: 14px; }
  .comments-empty { grid-template-columns: 42px 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .reading-progress span { transition: none; }
  .article-skeleton > span, .comments-loading span { animation: none; }
}
</style>
