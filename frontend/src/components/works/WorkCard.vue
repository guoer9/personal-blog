<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { categoryLabel, formatDuration, type Work } from '@/data/works'
import { getStageArtwork } from '@/data/stage'
const props = withDefaults(defineProps<{ work: Work; index: number; headingTag?: 'h2' | 'h3'; previewMode?: boolean }>(), { headingTag: 'h2', previewMode: false })
const preferredArtwork = computed(() => props.work.category === 'code' && !props.work.cover ? null : getStageArtwork(props.work))
const failedSources = ref<string[]>([])
const artwork = computed(() => preferredArtwork.value
  ? [preferredArtwork.value, getStageArtwork()].find(src => !failedSources.value.includes(src))
  : null)
const entryLabel = computed(() => props.work.category === 'music' ? '进入单曲' : props.work.category === 'film' ? '观看影像' : '查看项目')
function onArtworkError() { if (artwork.value) failedSources.value.push(artwork.value) }
watch(preferredArtwork, () => { failedSources.value = [] })
</script>

<template>
  <component :is="previewMode ? 'div' : 'router-link'" v-bind="previewMode ? {} : { to: `/works/${work.slug}`, 'aria-label': `${work.title} · ${entryLabel}` }" class="work-card" :class="[`work-card--${work.accent}`, `work-card--${work.category}`]">
    <div class="work-card__visual">
      <img v-if="artwork" :key="artwork" :src="artwork" alt="" width="960" height="960" loading="lazy" decoding="async" @error="onArtworkError" />
      <div v-else-if="work.category === 'code'" class="code-art" aria-hidden="true"><span>{{ String(index + 1).padStart(2, '0') }}</span><b>{{ work.slug === 'money-agent' ? 'ƒ(x)' : work.slug === 'financial-reports' ? '{ ? }' : work.slug === 'personal-blog' ? 'G/' : 'ε →' }}</b><i>BUILT BY GUOER</i></div>
      <span class="work-card__badge">{{ categoryLabel(work.category) }}<template v-if="work.duration"> / {{ formatDuration(work.duration) }}</template></span>
      <span class="work-card__open" aria-hidden="true">↗</span>
    </div>
    <div class="work-card__copy">
      <p v-if="work.category !== 'music'" class="eyebrow">{{ work.caption }}</p>
      <component :is="headingTag" class="work-card__title">{{ work.title }}</component>
      <p v-if="work.category !== 'music'" class="work-card__description">{{ work.description }}</p>
      <span v-if="!previewMode" class="work-card__entry">{{ entryLabel }} <span aria-hidden="true">↗</span></span>
    </div>
  </component>
</template>

<style scoped>
.work-card { display: block; min-width: 0; color: var(--ink); text-decoration: none; }
.work-card__visual { position: relative; overflow: hidden; aspect-ratio: 16 / 10; background: radial-gradient(ellipse at 35% 30%, #516346, #192122 40%, #0b0d11 80%); }
.work-card--music .work-card__visual { aspect-ratio: 1; }
.work-card--film .work-card__visual { aspect-ratio: 16 / 9; }
.work-card__visual > img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 650ms cubic-bezier(.2,.7,.2,1); }
.work-card:hover img, .work-card:focus-visible img { transform: scale(1.035); }
.work-card__badge { position: absolute; left: 18px; bottom: 18px; padding: 6px 10px; background: #080808b8; color: #f2f0e9; font: .62rem var(--mono-font); }
.work-card__open { position: absolute; right: 16px; top: 16px; display: grid; place-items: center; width: 38px; height: 38px; background: var(--acid); color: var(--acid-ink); border-radius: 50%; font-size: 1.2rem; transition: transform 200ms; }
.work-card:hover .work-card__open { transform: rotate(-10deg); }
.work-card__copy { position: relative; padding: 20px 0 12px; }
.work-card__copy > .eyebrow { color: var(--muted); font-size: .58rem; }
.work-card__title { margin: 0 0 10px; font: 400 clamp(1.5rem, 3vw, 2.4rem)/1.25 var(--display-font); overflow-wrap: anywhere; }
.work-card__description { max-width: 500px; color: var(--muted); font-size: .86rem; }
.work-card__entry { display: inline-flex; align-items: center; gap: 18px; min-height: 32px; color: var(--muted); font: .65rem var(--body-font); }
.work-card:hover .work-card__entry, .work-card:focus-visible .work-card__entry { color: var(--acid); }
.work-card:focus-visible { outline: 2px solid var(--acid); outline-offset: 8px; }
.code-art { position: absolute; inset: 0; display: grid; place-items: center; background: var(--paper-soft); }
.work-card--lime .code-art { background: var(--acid); color: var(--acid-ink); }
.work-card--blue .code-art { background: var(--electric-blue); color: white; }
.code-art::before { position: absolute; inset: 0; content: ''; background-image: linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px); background-size: 48px 48px; opacity: .1; }
.code-art > span { position: absolute; top: 20px; left: 20px; font: .7rem var(--mono-font); }
.code-art b { font: 400 clamp(4rem, 10vw, 7rem)/1 var(--display-font); letter-spacing: -.08em; }
.code-art i { position: absolute; right: 16px; bottom: 22px; font: .55rem var(--mono-font); letter-spacing: .1em; }
</style>
