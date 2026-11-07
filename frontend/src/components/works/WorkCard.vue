<script setup lang="ts">
import { categoryLabel, formatDuration, type Work } from '@/data/works'
withDefaults(defineProps<{ work: Work; index: number; headingTag?: 'h2' | 'h3'; previewMode?: boolean }>(), { headingTag: 'h2', previewMode: false })
</script>

<template>
  <component :is="previewMode ? 'div' : 'router-link'" v-bind="previewMode ? {} : { to: `/works/${work.slug}` }" class="work-card" :class="`work-card--${work.accent}`">
    <div class="work-card__visual">
      <img v-if="work.cover" :src="work.cover" alt="" width="960" height="540" loading="lazy" decoding="async" />
      <div v-else class="code-art" aria-hidden="true"><span>{{ String(index + 1).padStart(2, '0') }}</span><b>{{ work.slug === 'money-agent' ? 'ƒ(x)' : work.slug === 'financial-reports' ? '{ ? }' : work.slug === 'personal-blog' ? 'G/' : 'ε →' }}</b><i>BUILT BY GUOER</i></div>
      <span class="work-card__badge">{{ categoryLabel(work.category) }}<template v-if="work.duration"> / {{ formatDuration(work.duration) }}</template></span>
      <span class="work-card__open" aria-hidden="true">{{ work.category === 'code' ? '↗' : work.category === 'music' ? '♫' : '▶' }}</span>
    </div>
    <div class="work-card__copy"><p class="eyebrow">{{ work.caption }}</p><component :is="headingTag" class="work-card__title">{{ work.title }} <span aria-hidden="true">↗</span></component><p>{{ work.description }}</p><div class="work-card__tags"><span v-for="tag in work.tags" :key="tag">{{ tag }}</span></div></div>
  </component>
</template>

<style scoped>
.work-card { display: block; color: var(--ink); text-decoration: none; min-width: 0; }
.work-card__visual { position: relative; overflow: hidden; aspect-ratio: 16 / 10; border: 1px solid var(--ink); background: var(--paper-soft); }
.work-card__visual > img { width: 100%; height: 100%; object-fit: cover; transition: transform 400ms ease; }
.work-card:hover img { transform: scale(1.035); }
.work-card__badge { position: absolute; left: 16px; bottom: 16px; padding: 6px 10px; background: var(--paper); color: var(--ink); font: .65rem var(--mono-font); }
.work-card__open { position: absolute; right: 16px; top: 16px; display: grid; place-items: center; width: 40px; height: 40px; background: var(--acid); color: var(--acid-ink); border: 1px solid var(--acid-ink); border-radius: 50%; font-size: 1.1rem; transition: transform 200ms; }
.work-card:hover .work-card__open { transform: rotate(-10deg); }
.work-card__copy { padding: 22px 0 12px; }
.work-card__copy > .eyebrow { color: var(--muted); font-size: .58rem; }
.work-card__title { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; font: 400 clamp(1.5rem, 3vw, 2.1rem)/1.3 var(--display-font); }
.work-card__title > span { font-size: 1.3rem; }
.work-card__copy > p:not(.eyebrow) { max-width: 500px; color: var(--muted); font-size: .86rem; }
.work-card__tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.work-card__tags span { padding: 3px 8px; border: 1px solid var(--line); font: .6rem var(--mono-font); }
.code-art { position: absolute; inset: 0; display: grid; place-items: center; background: var(--paper-soft); }
.work-card--lime .code-art { background: var(--acid); color: var(--acid-ink); }
.work-card--blue .code-art { background: var(--electric-blue); color: white; }
.code-art::before { position: absolute; inset: 0; content: ''; background-image: linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px); background-size: 48px 48px; opacity: .1; }
.code-art > span { position: absolute; top: 20px; left: 20px; font: .7rem var(--mono-font); }
.code-art b { font: 400 clamp(4rem, 10vw, 7rem)/1 var(--display-font); letter-spacing: -.08em; }
.code-art i { position: absolute; right: 16px; bottom: 22px; font: .55rem var(--mono-font); letter-spacing: .1em; }
</style>
