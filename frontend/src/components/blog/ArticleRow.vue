<script setup lang="ts">
import type { PublicArticle } from '@/api/posts'
import { formatDate } from '@/utils/format'

withDefaults(defineProps<{ post: PublicArticle; index: number; headingTag?: 'h2' | 'h3' }>(), { headingTag: 'h3' })
</script>

<template>
  <article class="article-row">
    <div class="article-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</div>
    <div class="article-body">
      <div class="article-meta">
        <time :datetime="post.created_at">{{ formatDate(post.created_at) }}</time>
        <span class="dot" aria-hidden="true">•</span>
        <span>{{ post.view_count }} 次阅读</span>
      </div>
      <router-link :to="post.public_url" class="article-link">
        <component :is="headingTag" class="article-title">{{ post.title }}</component>
        <p v-if="post.summary">{{ post.summary }}</p>
      </router-link>
      <div v-if="post.tags.length" class="article-tags" aria-label="文章标签">
        <router-link
          v-for="tag in post.tags"
          :key="tag.slug"
          :to="`/tag/${encodeURIComponent(tag.slug)}`"
          class="tag-link"
        >
          # {{ tag.name }}
        </router-link>
      </div>
    </div>
    <router-link :to="post.public_url" class="article-arrow" :aria-label="`阅读 ${post.title}`">↗</router-link>
  </article>
</template>

<style scoped>
.article-row {
  position: relative;
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr) 36px;
  gap: 24px;
  padding: 32px 0;
  border-top: 1px solid var(--line);
  transition: background-color 220ms ease;
}
.article-row:last-child { border-bottom: 1px solid var(--line); }
.article-row:hover { background: rgba(199, 255, 46, 0.08); }
.article-index {
  padding-top: 5px;
  font-family: var(--mono-font);
  font-size: 0.69rem;
  color: var(--muted);
}
.article-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--muted);
  font-family: var(--mono-font);
  font-size: 0.67rem;
  letter-spacing: 0.025em;
}
.article-link { color: var(--ink); text-decoration: none; }
.article-link:focus-visible { outline: 3px solid var(--electric-blue); outline-offset: 5px; }
.article-title {
  font-family: var(--display-font);
  font-size: clamp(1.45rem, 3vw, 2.35rem);
  line-height: 1.06;
  letter-spacing: -0.04em;
  transition: color 180ms ease;
}
.article-row:hover .article-title { color: var(--electric-blue); }
p { max-width: 760px; margin-top: 12px; color: var(--muted); font-size: 0.94rem; }
.article-tags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
.tag-link {
  padding: 5px 9px;
  border: 1px solid var(--line);
  color: var(--ink);
  font-family: var(--mono-font);
  font-size: 0.63rem;
  text-decoration: none;
}
.tag-link:hover { border-color: var(--ink); background: var(--acid); }
.article-arrow {
  display: grid;
  place-items: center;
  align-self: start;
  width: 34px;
  height: 34px;
  border: 1px solid var(--ink);
  border-radius: 50%;
  color: var(--ink);
  text-decoration: none;
  transition: transform 180ms ease, background 180ms ease;
}
.article-arrow:hover { transform: rotate(45deg); background: var(--acid); }
@media (max-width: 640px) {
  .article-row { grid-template-columns: 38px minmax(0, 1fr); gap: 12px; padding: 24px 0; }
  .article-arrow { display: none; }
  .article-meta { flex-wrap: wrap; }
}
</style>
