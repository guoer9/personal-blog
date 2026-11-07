<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch, type Ref } from 'vue'
import { getPosts, getArticleTags, type PublicArticle, type ArticleTag } from '@/api/posts'
import { profile, resources } from '@/data/portfolio'
import { getWorks } from '@/api/works'
import type { Work } from '@/data/works'
import WorkCard from '@/components/works/WorkCard.vue'
import ImmersiveScene from '@/components/immersive/ImmersiveScene.vue'
import { usePageSceneState } from '@/graphics/runtime/usePageSceneState'
import { visualPageSceneBridgeKey, visualRuntimeKey, type VisualRuntimeHandle } from '@/graphics/runtime/visualRuntimeHandle'
import type { HomePageState } from '@/graphics/scenes/pageStates'
import {
  createHomeSphereInteractionBridge,
  defaultHomeSphereInteractionOptions,
  homeSphereInteractionOptionsKey,
} from './homeInteraction'
import MagneticLink from '@/components/immersive/MagneticLink.vue'
import ProjectCardMotion from '@/components/immersive/ProjectCardMotion.vue'
import ScrollReveal from '@/components/immersive/ScrollReveal.vue'
import ArticleRow from '@/components/blog/ArticleRow.vue'
import StatePanel from '@/components/blog/StatePanel.vue'
import { narrativeProgress, resolveMotionStage, stageFocus } from '@/graphics/motion'

const posts = ref<PublicArticle[]>([])
const featuredWorks = ref<Work[]>([])
const worksError = ref(false)
const worksLoading = ref(true)
let worksController: AbortController | null = null
const projects = computed(() => featuredWorks.value.filter((item) => item.category === 'code').slice(0, 3).map((item, index) => ({ ...item, number: String(index + 1).padStart(2, '0'), type: item.caption, href: `/works/${item.slug}`, external: false, stack: item.tags })))
const mediaWorks = computed(() => featuredWorks.value.filter((item) => item.category !== 'code').slice(0, 2))
async function loadWorks() {
  worksController?.abort()
  const current = new AbortController()
  worksController = current
  worksLoading.value = true
  worksError.value = false
  try { const response = await getWorks({ featured: true }, current.signal); if (!current.signal.aborted) featuredWorks.value = response.data.items }
  catch { if (!current.signal.aborted) worksError.value = true }
  finally { if (!current.signal.aborted) worksLoading.value = false }
}
const tags = ref<ArticleTag[]>([])
const loading = ref(true)
const error = ref(false)
const home = ref<HTMLElement | null>(null)
const storyProgress = ref(0)
const manualMotionPaused = ref(false)
const systemReducedMotion = ref(false)
const motionPaused = computed(() => manualMotionPaused.value || systemReducedMotion.value)
const motionStage = computed(() => resolveMotionStage(storyProgress.value))
const storyStages = [
  { id: 'idea', index: '01', label: 'IDEA' },
  { id: 'writing', index: '02', label: 'NOTES' },
  { id: 'projects', index: '03', label: 'WORK' },
  { id: 'signal', index: '04', label: 'SIGNAL' },
]
const runtime = inject<Ref<VisualRuntimeHandle | null>>(visualRuntimeKey, ref(null))
const sceneBridge = usePageSceneState<HomePageState>({ paused: false, interaction: null })
provide(visualPageSceneBridgeKey, sceneBridge)
const latestInteraction = ref<HomePageState['interaction']>(null)
const sphereInteractionOptions = inject(homeSphereInteractionOptionsKey, defaultHomeSphereInteractionOptions)

function publishSceneState() {
  const state: HomePageState = { paused: motionPaused.value, interaction: latestInteraction.value }
  sceneBridge.setState(state)
  runtime.value?.setPageState('home', state)
  runtime.value?.setCanvasVisible?.(!motionPaused.value)
}
const sphereInteraction = createHomeSphereInteractionBridge({
  options: sphereInteractionOptions,
  emit: (interaction) => {
    latestInteraction.value = interaction
    publishSceneState()
  },
})
const MOTION_PAUSE_KEY = 'field-notes:motion-paused'
let scrollFrame = 0
let resizeObserver: ResizeObserver | null = null
let reducedMotionQuery: MediaQueryList | null = null

async function loadHomeContent() {
  loading.value = true
  error.value = false
  try {
    const [postResponse, tagResponse] = await Promise.all([getPosts({ page_size: 4 }), getArticleTags()])
    posts.value = postResponse.data.items
    tags.value = tagResponse.data
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

function updateNarrative() {
  scrollFrame = 0
  storyProgress.value = narrativeProgress(
    window.scrollY,
    document.documentElement.scrollHeight,
    window.innerHeight,
  )
}

function scheduleNarrativeUpdate() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(updateNarrative)
}

function stageStyle(index: number) {
  return { '--stage-focus': stageFocus(storyProgress.value, index) }
}

function setSystemReducedMotion(event: MediaQueryListEvent | MediaQueryList) {
  systemReducedMotion.value = event.matches
}

function toggleMotion() {
  if (systemReducedMotion.value) return
  manualMotionPaused.value = !manualMotionPaused.value
  try {
    window.localStorage.setItem(MOTION_PAUSE_KEY, manualMotionPaused.value ? '1' : '0')
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }
}

onMounted(() => {
  void loadHomeContent()
  void loadWorks()
  try {
    manualMotionPaused.value = window.localStorage.getItem(MOTION_PAUSE_KEY) === '1'
  } catch {
    manualMotionPaused.value = false
  }
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  setSystemReducedMotion(reducedMotionQuery)
  reducedMotionQuery.addEventListener('change', setSystemReducedMotion)
  document.addEventListener('pointerdown', sphereInteraction.onPointerDown, true)
  document.addEventListener('pointermove', sphereInteraction.onPointerMove, true)
  document.addEventListener('pointerup', sphereInteraction.onPointerUp, true)
  document.addEventListener('pointercancel', sphereInteraction.onPointerCancel, true)
  document.addEventListener('click', sphereInteraction.onClickCapture, true)
  document.addEventListener('mousedown', sphereInteraction.onMouseDown, true)
  document.addEventListener('contextmenu', sphereInteraction.onContextMenu, true)
  window.addEventListener('blur', sphereInteraction.cancel)
  updateNarrative()
  window.addEventListener('scroll', scheduleNarrativeUpdate, { passive: true })
  window.addEventListener('resize', scheduleNarrativeUpdate, { passive: true })
  if (home.value) {
    resizeObserver = new ResizeObserver(scheduleNarrativeUpdate)
    resizeObserver.observe(home.value)
  }
  publishSceneState()
})

watch(motionPaused, publishSceneState)
watch(runtime, publishSceneState)

onBeforeUnmount(() => {
  sphereInteraction.dispose()
  document.removeEventListener('pointerdown', sphereInteraction.onPointerDown, true)
  document.removeEventListener('pointermove', sphereInteraction.onPointerMove, true)
  document.removeEventListener('pointerup', sphereInteraction.onPointerUp, true)
  document.removeEventListener('pointercancel', sphereInteraction.onPointerCancel, true)
  document.removeEventListener('click', sphereInteraction.onClickCapture, true)
  document.removeEventListener('mousedown', sphereInteraction.onMouseDown, true)
  document.removeEventListener('contextmenu', sphereInteraction.onContextMenu, true)
  window.removeEventListener('blur', sphereInteraction.cancel)
  worksController?.abort()
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  window.removeEventListener('scroll', scheduleNarrativeUpdate)
  window.removeEventListener('resize', scheduleNarrativeUpdate)
  reducedMotionQuery?.removeEventListener('change', setSystemReducedMotion)
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="home"
    class="home"
    :data-stage="motionStage"
    :data-motion-paused="motionPaused"
    :style="{ '--story-progress': storyProgress }"
  >
    <div class="story-rail" aria-hidden="true">
      <span class="story-rail__line"><i /></span>
      <ol class="story-rail__stages">
        <li v-for="(stage, index) in storyStages" :key="stage.id" :data-stage-label="stage.id" :style="stageStyle(index)">
          <span>{{ stage.index }}</span> {{ stage.label }}
        </li>
      </ol>
    </div>
    <section class="hero page-shell" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="hero-kicker"><span class="status-dot" /> {{ profile.availability }} <span>／</span> {{ profile.location }}</p>
        <h1 id="hero-title">
          <span>Make ideas</span>
          <em>move.</em>
        </h1>
        <p class="hero-intro">{{ profile.intro }}</p>
        <div class="hero-actions">
          <router-link to="/works" class="editorial-button editorial-button--acid">浏览作品 <span aria-hidden="true">↗</span></router-link>
          <MagneticLink href="#writing">最新文章</MagneticLink>
        </div>
      </div>
      <div class="hero-visual">
        <ImmersiveScene :progress="storyProgress" :paused="motionPaused" />
        <span class="hero-signature">{{ profile.name }}</span>
      </div>
      <div class="hero-footnote">
        <span>01 — FIELD NOTES</span>
        <span>SOFTWARE / THINKING / MOTION</span>
        <button
          v-if="!systemReducedMotion"
          type="button"
          class="motion-toggle"
          :aria-label="manualMotionPaused ? '恢复自动动效' : '暂停自动动效'"
          :aria-pressed="manualMotionPaused"
          @click="toggleMotion"
        >
          <span class="motion-toggle__icon" aria-hidden="true">{{ manualMotionPaused ? '▶' : 'Ⅱ' }}</span>
          <span>{{ manualMotionPaused ? 'MOTION OFF' : 'MOTION ON' }}</span>
        </button>
      </div>
    </section>

    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        <span>CODE WITH INTENTION <i>✳</i> WRITE TO REMEMBER <i>✳</i> DESIGN FOR CLARITY <i>✳</i></span>
        <span>CODE WITH INTENTION <i>✳</i> WRITE TO REMEMBER <i>✳</i> DESIGN FOR CLARITY <i>✳</i></span>
      </div>
    </div>

    <section id="writing" class="writing-section page-shell" aria-labelledby="writing-title">
      <ScrollReveal>
        <div class="section-title-row">
          <div>
            <p class="section-kicker">01 / Recent writing</p>
            <h2 id="writing-title" class="section-heading">Latest<br /><em>field notes.</em></h2>
          </div>
          <router-link to="/writing" class="section-link">ALL NOTES <span>↗</span></router-link>
        </div>
      </ScrollReveal>
      <div class="writing-grid">
        <div class="article-list">
          <ArticleRow v-for="(post, index) in posts" :key="post.key" :post="post" :index="index" />
          <div v-if="loading" class="loading-lines" aria-label="正在载入文章">
            <span v-for="index in 3" :key="index" />
          </div>
          <div v-if="error" class="inline-error">
            <span>暂时无法读取文章列表。</span>
            <button class="text-action" type="button" @click="loadHomeContent">重新尝试 ↗</button>
          </div>
          <StatePanel
            v-if="!loading && !error && posts.length === 0"
            title="第一篇，正在路上。"
            description="文章会在发布后出现在这里。先去项目与关于页面逛逛吧。"
            action-label="了解这个博客"
            @action="$router.push('/about')"
          />
        </div>
        <aside class="topic-index" aria-label="标签索引">
          <div class="topic-index-heading">
            <span>INDEX / TOPICS</span>
            <span>↘</span>
          </div>
          <router-link v-for="(tag, index) in tags" :key="tag.slug" :to="`/tag/${encodeURIComponent(tag.slug)}`" class="topic-row">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <strong>{{ tag.name }}</strong>
            <span aria-hidden="true">↗</span>
          </router-link>
          <p v-if="!loading && tags.length === 0" class="empty-topics">更多主题将在写作中逐渐成形。</p>
          <router-link to="/search" class="topic-search">寻找一个关键词 <span>⌕</span></router-link>
        </aside>
      </div>
    </section>

    <section id="projects" class="projects-section" aria-labelledby="projects-title">
      <div class="projects-section__backdrop" aria-hidden="true" />
      <div class="page-shell">
        <ScrollReveal>
          <div class="section-title-row section-title-row--light">
            <div>
              <p class="section-kicker">02 / Selected work</p>
              <h2 id="projects-title" class="section-heading">Made to<br /><em>be used.</em></h2>
            </div>
            <router-link to="/works?type=code" class="projects-note">全部代码作品 ↗</router-link>
          </div>
        </ScrollReveal>
        <div class="project-grid">
          <ScrollReveal v-for="(project, index) in projects" :key="project.number" :delay="index * 80">
            <ProjectCardMotion :accent="project.accent">
              <component
                :is="project.external ? 'a' : 'router-link'"
                v-bind="project.external ? { href: project.href, target: '_blank', rel: 'noreferrer' } : { to: project.href }"
                class="project-card"
                :class="`project-card--${project.accent}`"
              >
                <div class="project-topline"><span>{{ project.number }}</span><span>{{ project.type }}</span></div>
                <div class="project-glyph" aria-hidden="true">
                  <span v-if="index === 0">▦</span>
                  <span v-else-if="index === 1">∿</span>
                  <span v-else>✳</span>
                </div>
                <div class="project-bottom">
                  <h3>{{ project.title }}</h3>
                  <p>{{ project.description }}</p>
                  <div class="project-stack"><span v-for="item in project.stack" :key="item">{{ item }}</span></div>
                </div>
                <span class="project-arrow" aria-hidden="true">↗</span>
              </component>
            </ProjectCardMotion>
          </ScrollReveal>
        </div>
        <div v-if="worksError" class="featured-state" role="status"><p>暂时无法读取精选作品。</p><button type="button" class="text-action" @click="loadWorks">重新读取 ↗</button></div>
        <p v-else-if="worksLoading" class="featured-state" role="status">正在读取精选作品…</p>
        <p v-else-if="!projects.length" class="featured-state">新作品将在发布后出现在这里。</p>
      </div>
    </section>

    <section v-if="mediaWorks.length" class="media-section page-shell" aria-labelledby="media-title">
      <div class="section-title-row"><div><p class="section-kicker">Film & Music / 小果Fruit</p><h2 id="media-title" class="section-heading">Life, in<br /><em>other forms.</em></h2></div><router-link to="/works" class="section-link">全部作品 ↗</router-link></div>
      <div class="media-grid"><WorkCard v-for="(work, index) in mediaWorks" :key="work.slug" :work="work" :index="index" heading-tag="h3" /></div>
    </section>

    <section id="motion" class="principle-section page-shell" aria-labelledby="principles-title">
      <ScrollReveal>
        <div class="principle-intro">
          <p class="section-kicker">03 / Working principles</p>
          <h2 id="principles-title" class="section-heading">Signal over<br /><em>noise.</em></h2>
          <p>技术、视觉与表达最终都服务于理解。把复杂留给自己，把清晰交给读者。</p>
        </div>
      </ScrollReveal>
      <div class="principle-list">
        <ScrollReveal v-for="(principle, index) in profile.principles" :key="principle.title" :delay="index * 80">
          <article class="principle-row">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <h3>{{ principle.title }}</h3>
            <p>{{ principle.body }}</p>
          </article>
        </ScrollReveal>
      </div>
    </section>

    <section id="resources" class="resource-section page-shell" aria-labelledby="resource-title">
      <ScrollReveal>
        <p class="section-kicker">04 / Elsewhere</p>
        <h2 id="resource-title" class="section-heading">Keep<br /><em>exploring.</em></h2>
      </ScrollReveal>
      <div class="resource-grid">
        <router-link v-for="resource in resources" :key="resource.index" :to="resource.href" class="resource-card">
          <div class="resource-top"><span>{{ resource.index }}</span><span>{{ resource.kind }}</span></div>
          <h3>{{ resource.title }}</h3>
          <p>{{ resource.description }}</p>
          <span class="resource-arrow" aria-hidden="true">↗</span>
        </router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home { position: relative; overflow-x: clip; }
.home > section:not(.projects-section), .home > .marquee { position: relative; z-index: 2; }
.projects-section > .page-shell { position: relative; z-index: 2; }
.projects-section__backdrop { position: absolute; inset: 0; z-index: 0; background: var(--void); pointer-events: none; }
.featured-state { padding: 30px 0; color: var(--ink); font-size: .85rem; }
.media-section { padding-top: var(--section-space); }
.media-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
@media (max-width: 700px) { .media-grid { grid-template-columns: 1fr; gap: 36px; } }
.story-rail {
  position: fixed;
  z-index: 20;
  top: 50%;
  right: clamp(8px, calc((100vw - var(--page-width)) / 2 - 12px), 34px);
  display: grid;
  grid-template-columns: 18px auto;
  align-items: center;
  gap: 12px;
  color: var(--ink);
  font: 0.56rem var(--mono-font);
  letter-spacing: 0.08em;
  pointer-events: none;
  transform: translateY(-50%);
  transition: color 520ms ease;
}
.motion-toggle {
  display: inline-flex;
  justify-self: end;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--ink);
  background: rgba(8, 8, 8, 0.92);
  color: var(--ink);
  box-shadow: 3px 3px 0 rgba(242, 240, 233, 0.12);
  font: 700 0.58rem var(--mono-font);
  letter-spacing: 0.08em;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: background-color 180ms ease, transform 180ms ease;
}
.motion-toggle:hover { background: var(--acid); color: var(--acid-ink); border-color: var(--acid-ink); transform: translateY(-2px); }
.motion-toggle:active { transform: translateY(0); }
.motion-toggle__icon { display: grid; place-items: center; width: 16px; height: 16px; font: 0.55rem var(--mono-font); }
.story-rail__line {
  position: relative;
  display: block;
  width: 1px;
  height: 164px;
  background: rgba(242, 240, 233, 0.24);
  overflow: hidden;
  transition: background-color 520ms ease;
}
.story-rail__line i {
  position: absolute;
  inset: 0;
  background: var(--electric-blue);
  transform: scaleY(var(--story-progress));
  transform-origin: top;
  transition: background-color 520ms ease;
}
.story-rail__stages {
  display: grid;
  gap: 25px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.story-rail__stages li {
  position: relative;
  display: flex;
  gap: 7px;
  opacity: calc(0.46 + var(--stage-focus, 0) * 0.54);
  transform: translateX(calc(var(--stage-focus, 0) * -4px));
}
.story-rail__stages li::before {
  position: absolute;
  top: 50%;
  left: -16px;
  width: calc(4px + var(--stage-focus, 0) * 1px);
  height: calc(4px + var(--stage-focus, 0) * 1px);
  border: 1px solid currentColor;
  border-radius: 50%;
  background: var(--paper);
  content: '';
  transform: translate(-50%, -50%) scale(calc(0.88 + var(--stage-focus, 0) * 0.12));
  box-shadow: 0 0 0 calc(var(--stage-focus, 0) * 3px) rgba(55, 103, 255, calc(var(--stage-focus, 0) * 0.16));
}
.story-rail__stages li span { color: inherit; opacity: 0.62; }
.home[data-stage='projects'] .story-rail,
.home[data-stage='signal'] .story-rail { color: rgba(242, 240, 233, 0.74); }
.home[data-stage='projects'] .story-rail__line,
.home[data-stage='signal'] .story-rail__line { background: rgba(242, 240, 233, 0.25); }
.home[data-stage='projects'] .story-rail__line i,
.home[data-stage='signal'] .story-rail__line i { background: var(--acid); }
.home[data-stage='projects'] .story-rail__stages li::before,
.home[data-stage='signal'] .story-rail__stages li::before { background: var(--ink); }
.home[data-motion-paused='true'] .marquee-track,
.home[data-motion-paused='true'] .loading-lines span,
.home[data-motion-paused='true'] :deep(.scene-orbit),
.home[data-motion-paused='true'] :deep(.poster-core) { animation-play-state: paused; }
.home[data-motion-paused='true'] :deep(.scroll-reveal) { transition: none; }
.projects-section { isolation: auto; }
.projects-section__backdrop::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  background:
    radial-gradient(circle at 82% 18%, rgba(55, 103, 255, 0.15), transparent 28%),
    linear-gradient(115deg, transparent 55%, rgba(199, 255, 46, 0.035));
  content: '';
  opacity: 0.45;
  pointer-events: none;
  transform: scale(1.08);
  transition: opacity 900ms ease, transform 1200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.home[data-stage='projects'] .projects-section__backdrop::before,
.home[data-stage='signal'] .projects-section__backdrop::before { opacity: 1; transform: scale(1); }
.hero {
  touch-action: pan-y pinch-zoom;
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(360px, 1.08fr);
  align-items: center;
  min-height: min(790px, calc(100vh - 76px));
  padding-top: 36px;
  padding-bottom: 64px;
}
.hero-copy { position: relative; z-index: 2; }
.hero-kicker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 36px;
  color: var(--muted);
  font: 0.65rem var(--mono-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.status-dot { width: 7px; height: 7px; margin-right: 2px; border-radius: 50%; background: #5c9917; box-shadow: 0 0 0 4px rgba(92, 153, 23, 0.14); }
h1 {
  margin-bottom: 28px;
  font-family: var(--display-font);
  font-size: clamp(5.2rem, 10vw, 10.5rem);
  font-weight: 400;
  letter-spacing: -0.075em;
  line-height: 0.77;
}
h1 span, h1 em { display: block; }
h1 em, .section-heading em { color: var(--electric-blue); font-weight: 400; }
.hero-intro { max-width: 480px; color: var(--muted); font-size: clamp(1rem, 1.5vw, 1.22rem); line-height: 1.8; }
.hero-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 26px; margin-top: 38px; }
.hero-visual { position: relative; min-width: 0; min-height: 480px; touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.hero h1 { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.hero-visual :deep(.immersive-scene) { height: min(680px, 72vh); }
.hero-signature { position: absolute; right: 10%; bottom: 18%; z-index: 1; color: rgba(242, 240, 233, 0.1); font: 800 clamp(3rem, 7vw, 7rem) var(--display-font); letter-spacing: -0.05em; pointer-events: none; }
.hero-footnote { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-top: 22px; border-top: 1px solid var(--line); color: var(--muted); font: 0.58rem var(--mono-font); letter-spacing: 0.07em; }
.marquee { overflow: hidden; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); background: var(--acid); color: var(--acid-ink); }
.marquee-track { display: flex; width: max-content; animation: marquee 24s linear infinite; }
.marquee-track span { display: block; padding: 13px 0; font: 0.72rem var(--mono-font); letter-spacing: 0.12em; white-space: nowrap; }
.marquee i { padding: 0 30px; font-style: normal; }
@keyframes marquee { to { transform: translateX(-50%); } }
.writing-section { padding-top: var(--section-space); }
.section-title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; }
.section-link { display: inline-flex; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--ink); color: var(--ink); font: 0.68rem var(--mono-font); text-decoration: none; white-space: nowrap; }
.writing-grid { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: clamp(40px, 7vw, 100px); }
.topic-index { align-self: start; padding-top: 10px; }
.topic-index-heading { display: flex; justify-content: space-between; padding-bottom: 13px; border-bottom: 1px solid var(--ink); color: var(--muted); font: 0.62rem var(--mono-font); letter-spacing: 0.06em; }
.topic-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--line); color: var(--ink); text-decoration: none; }
.topic-row span { color: var(--muted); font: 0.6rem var(--mono-font); }
.topic-row strong { overflow-wrap: anywhere; font-size: 0.82rem; font-weight: 500; }
.topic-row:hover strong { color: var(--electric-blue); }
.empty-topics { padding: 22px 0; color: var(--muted); font-size: 0.8rem; }
.topic-search { display: flex; justify-content: space-between; margin-top: 24px; padding: 12px; border: 1px solid var(--ink); color: var(--ink); font: 0.65rem var(--mono-font); text-decoration: none; }
.topic-search:hover { background: var(--acid); color: var(--acid-ink); border-color: var(--acid-ink); }
.loading-lines { display: grid; gap: 1px; }
.loading-lines span { display: block; height: 122px; background: linear-gradient(90deg, var(--paper-soft), rgba(255,255,255,0.42), var(--paper-soft)); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-top: 1px solid var(--line); }
@keyframes shimmer { to { background-position: -200% 0; } }
.projects-section { position: relative; margin-top: var(--section-space); padding: var(--section-space) 0; color: var(--ink); }
.section-title-row--light .section-kicker, .projects-note { color: #9ca09e; }
.section-title-row--light .section-heading em { color: var(--acid); }
.projects-note { max-width: 260px; text-align: right; font-size: 0.82rem; }
.project-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.project-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 500px;
  padding: 22px;
  overflow: hidden;
  border: 1px solid rgba(244, 241, 234, 0.35);
  color: var(--ink);
  text-decoration: none;
  transition: transform 250ms ease, border-color 250ms ease;
}
.project-card:hover, .project-card:focus-visible { border-color: var(--acid); }
.project-card--lime { background: #1c280b; }
.project-card--blue { background: #101d50; }
.project-card--paper { background: #242424; }
.project-topline { display: flex; justify-content: space-between; gap: 15px; color: #b1b6b2; font: 0.61rem var(--mono-font); letter-spacing: 0.04em; }
.project-glyph { display: grid; place-items: center; flex: 1; min-height: 200px; color: var(--acid); font: 17rem/1 var(--display-font); opacity: 0.78; transform: rotate(-12deg); }
.project-card--blue .project-glyph { color: #8eb1ff; }
.project-card--paper .project-glyph { color: #f3b1e3; }
.project-bottom { position: relative; z-index: 1; }
.project-bottom h3 { margin-bottom: 12px; font: 400 2.3rem/0.95 var(--display-font); letter-spacing: -0.04em; }
.project-bottom p { color: #bdc2c0; font-size: 0.81rem; line-height: 1.65; }
.project-stack { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 19px; }
.project-stack span { padding: 3px 7px; border: 1px solid rgba(244, 241, 234, 0.27); color: #d4d8d4; font: 0.57rem var(--mono-font); }
.project-arrow { position: absolute; top: 55px; right: 22px; font-size: 1.4rem; transition: transform 220ms ease; }
.project-card:hover .project-arrow, .project-card:focus-visible .project-arrow { transform: rotate(45deg); }
.principle-section { display: grid; grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1fr); gap: clamp(40px, 8vw, 130px); padding-top: var(--section-space); }
.principle-intro > p:last-child { max-width: 330px; color: var(--muted); font-size: 0.9rem; }
.principle-row { display: grid; grid-template-columns: 42px minmax(0, 0.8fr) minmax(0, 1fr); gap: 22px; padding: 23px 0; border-top: 1px solid var(--line); }
.principle-row:last-child { border-bottom: 1px solid var(--line); }
.principle-row > span { color: var(--muted); font: 0.61rem var(--mono-font); }
.principle-row h3 { font-size: 0.94rem; font-weight: 700; line-height: 1.45; }
.principle-row p { color: var(--muted); font-size: 0.8rem; line-height: 1.7; }
.resource-section { padding-top: var(--section-space); }
.resource-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.resource-card { position: relative; min-height: 270px; padding: 22px; border: 1px solid var(--line); color: var(--ink); text-decoration: none; transition: background 180ms ease; }
.resource-card:hover { background: var(--paper-soft); }
.resource-top { display: flex; justify-content: space-between; color: var(--muted); font: 0.6rem var(--mono-font); }
.resource-card h3 { margin-top: 52px; font: 400 2rem/1 var(--display-font); letter-spacing: -0.04em; }
.resource-card p { max-width: 260px; margin-top: 14px; color: var(--muted); font-size: 0.8rem; }
.resource-arrow { position: absolute; right: 20px; bottom: 20px; font-size: 1.2rem; }
@media (max-width: 1679px) {
  .story-rail { right: 8px; grid-template-columns: 1fr; gap: 0; }
  .story-rail__stages { display: none; }
}
@media (max-width: 1200px) {
  .hero { grid-template-columns: 1fr 0.95fr; }
  .hero-visual :deep(.immersive-scene) { min-height: 420px; }
  .project-grid { grid-template-columns: 1fr 1fr; }
  .project-card:last-child { grid-column: span 2; min-height: 390px; }
  .writing-grid { grid-template-columns: minmax(0, 1fr) 230px; gap: 40px; }
}
@media (max-width: 760px) {
  .hero { grid-template-columns: 1fr; min-height: auto; padding-top: 42px; gap: 20px; }
  .hero-kicker { margin-bottom: 26px; }
  h1 { font-size: clamp(4.8rem, 20vw, 7.5rem); }
  .hero-visual { min-height: auto; }
  .hero-visual :deep(.immersive-scene) { height: 430px; min-height: 430px; }
  .hero-footnote { flex-wrap: wrap; margin-top: 6px; font-size: 0.53rem; }
  .writing-grid, .principle-section { grid-template-columns: 1fr; gap: 42px; }
  .section-title-row { display: block; }
  .section-link { margin-top: 25px; }
  .projects-note { margin-top: 24px; text-align: left; }
  .project-grid, .resource-grid { grid-template-columns: 1fr; }
  .project-card, .project-card:last-child { min-height: 430px; grid-column: auto; }
  .project-glyph { font-size: 12rem; }
  .principle-row { grid-template-columns: 30px 1fr; gap: 14px; }
  .principle-row p { grid-column: 2; }
  .resource-card { min-height: 230px; }
  .story-rail { right: 8px; }
  .story-rail__line { height: 108px; }
}
@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation: none; }
  .loading-lines span { animation: none; }
  .motion-toggle { display: none; }
  .story-rail, .story-rail__line, .story-rail__line i, .projects-section__backdrop::before { transition: none; }
}
</style>
