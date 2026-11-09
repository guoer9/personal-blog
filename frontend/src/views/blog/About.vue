<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { getWorks } from '@/api/works'
import type { Work } from '@/data/works'
import { getStageArtwork, stageAssets, stageIdentity } from '@/data/stage'
import ChenGuoSignature from '@/components/immersive/ChenGuoSignature.vue'
import { profile } from '@/data/portfolio'
import MagneticLink from '@/components/immersive/MagneticLink.vue'
import ScrollReveal from '@/components/immersive/ScrollReveal.vue'
import SocialLinks from '@/components/portfolio/SocialLinks.vue'
import { visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'

const sections = [
  { id: 'approach', index: '01', label: '声音与创作' },
  { id: 'now', index: '02', label: '生活片段' },
  { id: 'practice', index: '03', label: '技术实践' },
]

const films = ref<Work[]>([])
const filmController = new AbortController()
const failedImages = ref<string[]>([])
const portrait = computed(() => [stageAssets.artistPortrait, films.value[0]?.cover, getStageArtwork()]
  .find((src): src is string => Boolean(src) && !failedImages.value.includes(src!)))
function markImageFailed(src: string | undefined) { if (src) failedImages.value.push(src) }
function filmArtwork(film: Work) { return [getStageArtwork(film), getStageArtwork()].find(src => !failedImages.value.includes(src)) }
async function loadFilms() {
  try {
    const response = await getWorks({ category: 'film' }, filmController.signal)
    if (!filmController.signal.aborted) films.value = response.data.items.filter(work => work.category === 'film').slice(0, 2)
  } catch { /* Identity and category destinations remain available without film data. */ }
}
const activeSection = ref('approach')
const runtime = inject<Ref<VisualRuntimeBridge | null>>(visualRuntimeKey, ref(null))
watch(activeSection, (section) => {
  if (section === 'approach' || section === 'practice' || section === 'now') {
    runtime.value?.setPageState('about', { activeSection: section })
  }
})
const approachAnchor = ref<HTMLElement | null>(null)
const practiceAnchor = ref<HTMLElement | null>(null)
const nowAnchor = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let unregisterSectionAnchors: (() => void)[] = []

function registerSectionAnchors() {
  unregisterSectionAnchors.forEach((unregister) => unregister())
  unregisterSectionAnchors = []
  const activeRuntime = runtime.value
  if (!activeRuntime) return
  const anchors = [
    ['about-approach', approachAnchor.value],
    ['about-practice', practiceAnchor.value],
    ['about-now', nowAnchor.value],
  ] as const
  for (const [id, element] of anchors) {
    if (element) {
      const unregister = activeRuntime.registerAnchor?.(id, element)
      if (unregister) unregisterSectionAnchors.push(unregister)
    }
  }
  activeRuntime.measureAnchors?.()
}

const practice = [
  {
    title: 'Systems',
    caption: '系统与工程',
    body: '关注异步服务、接口边界、数据一致性，以及让复杂系统能够被理解与持续维护的工程方法。',
    stack: 'Python · FastAPI · PostgreSQL · Docker',
  },
  {
    title: 'Intelligence',
    caption: 'AI 与推理',
    body: '记录模型推理、vLLM 和 AI 工程中的实验。重点是把结论变成可复现、可验证的实践。',
    stack: 'vLLM · Python · Data · Evaluation',
  },
  {
    title: 'Interface',
    caption: '界面与表达',
    body: '研究内容、交互和动效如何共同建立清晰的体验。视觉效果最终服务于阅读与操作。',
    stack: 'Vue · TypeScript · Three.js · GLSL',
  },
]

function scrollToSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth' })
  activeSection.value = id
  window.history.replaceState({}, '', `#${id}`)
}

function sharePage() {
  const url = window.location.href
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).catch(() => undefined)
  }
}

async function focusHash() {
  const id = window.location.hash.slice(1)
  if (!id) return
  await nextTick()
  document.getElementById(id)?.scrollIntoView()
}

onMounted(() => {
  registerSectionAnchors()
  focusHash()
  loadFilms()
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
    if (visible?.target.id) activeSection.value = visible.target.id
  }, { rootMargin: '-25% 0px -55%', threshold: [0.05, 0.25, 0.5] })
  sections.forEach(({ id }) => {
    const element = document.getElementById(id)
    if (element) observer?.observe(element)
  })
})

watch(runtime, registerSectionAnchors, { flush: 'post' })
onBeforeUnmount(() => { filmController.abort(); observer?.disconnect(); unregisterSectionAnchors.forEach((unregister) => unregister()) })
</script>

<template>
  <div class="about-page page-stage page-stage--top">
    <div class="page-shell about-layout">
      <aside class="about-sidebar" aria-label="关于页导航">
        <router-link to="/" class="back-link">← 返回首页 / HOME</router-link>
        <div class="sidebar-index">
          <p>ABOUT / INDEX</p>
          <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" :class="{ active: activeSection === section.id }" :aria-current="activeSection === section.id ? 'location' : undefined" @click.prevent="scrollToSection(section.id)">
            <span>{{ section.index }}</span>{{ section.label }}
          </a>
        </div>
        <button type="button" class="share-link" @click="sharePage">复制本页链接 ↗</button>
      </aside>

      <article class="about-content">
        <header class="about-hero">
          <div class="portrait" aria-hidden="true"><img v-if="portrait" :key="portrait" :src="portrait" alt="" width="900" height="1100" decoding="async" @error="markImageFailed(portrait)" /></div>
          <div class="about-hero-copy">
            <p class="section-kicker">{{ stageIdentity.role }}</p>
            <h1>{{ stageIdentity.name }}<span>{{ stageIdentity.alias }}</span></h1>
            <p class="about-intro">{{ profile.intro }}</p>
            <ChenGuoSignature class="about-signature" :progress="1" />
            <router-link to="/works?type=music" class="creative-link">听我的音乐 <span aria-hidden="true">↗</span></router-link>
          </div>
        </header>

        <section id="approach" ref="approachAnchor" class="about-section approach-section" aria-labelledby="approach-title">
          <div class="section-number">01 / SOUND</div>
          <ScrollReveal>
            <div class="section-body">
              <p class="section-kicker">Music & expression</p>
              <h2 id="approach-title">先听，<br /><em>再慢慢认识。</em></h2>
              <p class="large-copy">音乐是这里的起点。影像、文字和交互，是表达的其他方式。</p>
            </div>
          </ScrollReveal>
          <div class="principle-grid">
            <div v-for="(principle, index) in profile.principles" :key="principle.title" class="principle-item">
              <span>{{ String(index + 1).padStart(2, '0') }}</span><h3>{{ principle.title }}</h3><p>{{ principle.body }}</p>
            </div>
          </div>
        </section>

        <section id="now" ref="nowAnchor" class="about-section now-section" aria-labelledby="now-title">
          <div class="section-number">02 / MOMENTS</div>
          <div class="section-body">
            <p class="section-kicker">Life in frames</p>
            <h2 id="now-title">声音之外，<br /><em>还有画面。</em></h2>
            <p class="large-copy">一些日常，留在镜头里。</p>
            <router-link to="/works?type=film" class="creative-link">浏览影像 <span aria-hidden="true">↗</span></router-link>
          </div>
          <div v-if="films.length" class="about-films">
            <router-link v-for="film in films" :key="film.slug" :to="`/works/${film.slug}`" class="about-film">
              <div class="about-film-frame"><img v-if="filmArtwork(film)" :src="filmArtwork(film)" alt="" width="960" height="540" loading="lazy" decoding="async" @error="markImageFailed(filmArtwork(film))" /></div>
              <span>{{ film.title }} <span aria-hidden="true">↗</span></span>
            </router-link>
          </div>
        </section>

        <section id="practice" ref="practiceAnchor" class="about-section" aria-labelledby="practice-title">
          <div class="section-number">03 / PRACTICE</div>
          <div class="section-body">
            <p class="section-kicker">Behind this space</p>
            <h2 id="practice-title">也用代码，<br /><em>把想法做出来。</em></h2>
            <p>这个网站也是一件持续打磨的作品。技术实践、实验和笔记，都可以在档案中找到。</p>
          </div>
          <div class="practice-list">
            <article v-for="(item, index) in practice" :key="item.title" class="practice-row">
              <div class="practice-index">{{ String(index + 1).padStart(2, '0') }}</div>
              <div><p class="practice-caption">{{ item.caption }}</p><h3>{{ item.title }}</h3></div>
              <p>{{ item.body }}</p><span>{{ item.stack }}</span>
            </article>
          </div>
          <div class="practice-actions">
            <MagneticLink href="/writing">打开档案</MagneticLink>
            <router-link to="/works?type=code" class="creative-link">查看代码项目 <span aria-hidden="true">↗</span></router-link>
          </div>
        </section>

        <SocialLinks />
        <footer class="about-end">
          <p>{{ stageIdentity.name }} / {{ stageIdentity.alias }}</p>
          <h2>Stay for<br /><em>another song.</em></h2>
          <router-link to="/works?type=music" class="creative-link">再听一首 <span aria-hidden="true">↗</span></router-link>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.about-layout { display: grid; grid-template-columns: 145px minmax(0, 1fr); gap: clamp(30px, 5vw, 85px); align-items: start; }
.about-sidebar { position: sticky; top: 112px; padding-top: 48px; }
.back-link { color: var(--muted); font: .65rem var(--mono-font); text-decoration: none; }
.sidebar-index { display: grid; margin-top: 44px; }
.sidebar-index p { padding: 14px 0; margin: 0; color: var(--muted); font: .58rem var(--mono-font); }
.sidebar-index a { display: flex; gap: 13px; align-items: center; min-height: 44px; padding: 8px 0; font-size: .75rem; text-decoration: none; }
.sidebar-index a span { color: var(--muted); font: .57rem var(--mono-font); }
.sidebar-index a.active { color: var(--acid); }
.share-link { min-height: 44px; padding: 14px 0; border: 0; background: transparent; color: var(--muted); font: .6rem var(--mono-font); cursor: pointer; }
.about-content { min-width: 0; }
.about-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .85fr); align-items: center; gap: clamp(20px, 4vw, 64px); padding: 70px 0 90px; }
.portrait { grid-column: 2; grid-row: 1; position: relative; width: 100%; aspect-ratio: 4 / 5; min-height: 280px; overflow: hidden; background: radial-gradient(ellipse at 60% 20%, #677b51, #1a2730 50%, #090b0e 85%); }
.portrait img { display: block; width: 100%; height: 100%; position: absolute; inset: 0; object-fit: cover; }
.about-hero-copy { grid-column: 1; grid-row: 1; min-width: 0; }
.about-hero h1 { margin: 28px 0; font: 400 clamp(3.8rem, 7.2vw, 7.8rem)/1.05 var(--display-font); letter-spacing: -.06em; }
.about-hero h1 span { display: block; margin-top: 14px; font-size: .52em; letter-spacing: -.02em; }
.about-intro { max-width: 460px; color: var(--muted); font-size: clamp(.9rem, 1.3vw, 1.1rem); line-height: 1.85; }
.about-signature { width: min(100%, 280px); margin: 28px 0 18px -8px; }
.creative-link { display: inline-flex; align-items: center; gap: 28px; min-height: 44px; padding: 6px 0; border-bottom: 1px solid var(--line); text-decoration: none; font: .75rem var(--body-font); }
.creative-link:hover { color: var(--acid); border-color: var(--acid); }
.about-section { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 28px; padding: clamp(70px, 9vw, 130px) 0; border-top: 1px solid var(--line); }
.section-number { color: var(--muted); font: .58rem var(--mono-font); }
.section-body { min-width: 0; }
.section-body h2 { margin-bottom: 30px; font: 400 clamp(2.4rem, 4.5vw, 4.8rem)/1.2 var(--display-font); letter-spacing: -.04em; }
.section-body h2 em { color: var(--muted); font-style: normal; font-weight: 400; }
.section-body > p:not(.section-kicker):not(.large-copy) { max-width: 570px; color: var(--muted); font-size: .9rem; }
.large-copy { max-width: 600px; margin-bottom: 24px; font: 400 clamp(1.1rem, 1.8vw, 1.5rem)/1.6 var(--body-font); }
.principle-grid { grid-column: 2; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; margin-top: 35px; }
.principle-item { padding-top: 18px; border-top: 1px solid var(--line); }
.principle-item > span { color: var(--muted); font: .6rem var(--mono-font); }
.principle-item h3 { margin: 24px 0 12px; font-size: .88rem; font-weight: 400; }
.principle-item p { color: var(--muted); font-size: .78rem; line-height: 1.85; }
.about-films { grid-column: 1 / -1; display: grid; grid-template-columns: 1.3fr 1fr; gap: 32px; margin-top: 36px; }
.about-film { min-width: 0; text-decoration: none; }
.about-film:nth-child(2) { margin-top: 90px; }
.about-film-frame { aspect-ratio: 16 / 10; overflow: hidden; background: radial-gradient(ellipse, #344e62, #11161b); }
.about-film-frame img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 600ms; }
.about-film:hover img { transform: scale(1.035); }
.about-film > span { display: flex; justify-content: space-between; gap: 18px; padding-top: 18px; font: .8rem/1.6 var(--body-font); }
.practice-list { grid-column: 2; margin-top: 24px; }
.practice-row { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 12px 20px; align-items: start; padding: 24px 0; border-top: 1px solid var(--line); }
.practice-index { color: var(--muted); font: .61rem var(--mono-font); }
.practice-caption { margin-bottom: 8px; color: var(--muted); font: .58rem var(--mono-font); }
.practice-row h3 { margin: 0; font: 400 1.8rem/1 var(--display-font); }
.practice-row > p, .practice-row > span { grid-column: 2; color: var(--muted); }
.practice-row > p { max-width: 540px; margin-bottom: 0; font-size: .82rem; }
.practice-row > span { font: .58rem/1.7 var(--mono-font); }
.practice-actions { grid-column: 2; display: flex; flex-wrap: wrap; gap: 28px; align-items: center; }
.about-end { display: flex; flex-direction: column; align-items: center; padding: 100px 0 40px; text-align: center; }
.about-end > p { color: var(--muted); font: .58rem var(--mono-font); }
.about-end h2 { font: 400 clamp(2.8rem, 6vw, 6rem)/1 var(--display-font); letter-spacing: -.04em; }
.about-end h2 em { color: var(--muted); font-weight: 400; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--acid); outline-offset: 5px; }
@media (max-width: 1000px) {
  .about-layout { display: block; }
  .about-sidebar { position: static; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-top: 28px; }
  .sidebar-index { display: flex; flex-wrap: wrap; gap: 18px; margin: 0; }
  .sidebar-index p, .share-link { display: none; }
  .about-hero { padding: 60px 0; }
}
@media (max-width: 680px) {
  .about-sidebar { align-items: flex-start; flex-direction: column; gap: 12px; }
  .sidebar-index { gap: 16px; }
  .sidebar-index a { gap: 6px; font-size: .68rem; }
  .about-hero { grid-template-columns: 1fr; gap: 34px; padding-top: 36px; }
  .about-hero-copy { grid-column: 1; grid-row: 1; }
  .portrait { grid-column: 1; grid-row: 2; aspect-ratio: 4 / 3; min-height: 0; }
  .about-hero h1 { font-size: clamp(4rem, 20vw, 7rem); }
  .about-signature { width: 220px; margin-block: 20px 12px; }
  .about-section { grid-template-columns: 1fr; gap: 24px; padding: 64px 0; }
  .principle-grid, .practice-list, .practice-actions { grid-column: 1; }
  .principle-grid { grid-template-columns: 1fr; gap: 20px; margin-top: 18px; }
  .principle-item h3 { margin-top: 16px; }
  .about-films { grid-template-columns: 1fr; gap: 36px; margin-top: 12px; }
  .about-film:nth-child(2) { margin-top: 0; }
  .about-end { padding-top: 70px; }
}
</style>
