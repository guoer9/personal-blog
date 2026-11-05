<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { profile } from '@/data/portfolio'
import MagneticLink from '@/components/immersive/MagneticLink.vue'
import ScrollReveal from '@/components/immersive/ScrollReveal.vue'
import SocialLinks from '@/components/portfolio/SocialLinks.vue'
import { visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'

const sections = [
  { id: 'approach', index: '01', label: '工作方式' },
  { id: 'practice', index: '02', label: '技术实践' },
  { id: 'now', index: '03', label: '此刻' },
]

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
  target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
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
onBeforeUnmount(() => { observer?.disconnect(); unregisterSectionAnchors.forEach((unregister) => unregister()) })
</script>

<template>
  <div class="about-page page-stage page-stage--top">
    <div class="page-shell about-layout">
      <aside class="about-sidebar" aria-label="关于页导航">
        <router-link to="/" class="back-link">← 返回首页 / HOME</router-link>
        <div class="sidebar-index">
          <p>ABOUT / INDEX</p>
          <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" :class="{ active: activeSection === section.id }" @click.prevent="scrollToSection(section.id)">
            <span>{{ section.index }}</span>
            {{ section.label }}
          </a>
        </div>
        <button type="button" class="share-link" @click="sharePage">复制本页链接 ↗</button>
      </aside>

      <article class="about-content">
        <header class="about-hero">
          <p class="section-kicker">Profile / {{ profile.availability }}</p>
          <div class="portrait" aria-hidden="true">
            <span>{{ profile.monogram }}</span>
            <i />
            <b>31.2304° N<br />121.4737° E</b>
          </div>
          <h1>A builder<br />collecting <em>clarity.</em></h1>
          <p class="about-intro">我是小果，{{ profile.name }}，在 Bilibili 也叫小果Fruit。写代码、拍 Vlog、做音乐，把不同形式的表达留在同一个地方。</p>
          <div class="about-meta">
            <span>BASED IN {{ profile.location }}</span>
            <span>{{ profile.role }}</span>
            <span>ONLINE / ALWAYS LEARNING</span>
          </div>
        </header>

        <section id="approach" ref="approachAnchor" class="about-section approach-section" aria-labelledby="approach-title">
          <div class="section-number">01 / APPROACH</div>
          <ScrollReveal>
            <div class="section-body">
              <p class="section-kicker">How I work</p>
              <h2 id="approach-title">把问题拆到<br /><em>可以被理解。</em></h2>
              <p class="large-copy">{{ profile.intro }}</p>
              <p>我喜欢在“能运行”和“能长期维护”之间寻找平衡。写代码时，我会先确认问题边界；写文章时，我会把选择背后的理由一并留下。局部技巧需要服务于整体判断，设计也需要让内容更容易被发现。</p>
            </div>
          </ScrollReveal>
          <div class="principle-grid">
            <div v-for="(principle, index) in profile.principles" :key="principle.title" class="principle-item">
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              <h3>{{ principle.title }}</h3>
              <p>{{ principle.body }}</p>
            </div>
          </div>
        </section>

        <section id="practice" ref="practiceAnchor" class="about-section" aria-labelledby="practice-title">
          <div class="section-number">02 / PRACTICE</div>
          <div class="section-body">
            <p class="section-kicker">Areas of practice</p>
            <h2 id="practice-title">三个持续<br /><em>交叠的方向。</em></h2>
          </div>
          <div class="practice-list">
            <article v-for="(item, index) in practice" :key="item.title" class="practice-row">
              <div class="practice-index">{{ String(index + 1).padStart(2, '0') }}</div>
              <div>
                <p class="practice-caption">{{ item.caption }}</p>
                <h3>{{ item.title }}</h3>
              </div>
              <p>{{ item.body }}</p>
              <span>{{ item.stack }}</span>
            </article>
          </div>
        </section>

        <section id="now" ref="nowAnchor" class="about-section now-section" aria-labelledby="now-title">
          <div class="section-number">03 / NOW</div>
          <div class="section-body">
            <p class="section-kicker">Current focus</p>
            <h2 id="now-title">继续构建，<br /><em>继续记录。</em></h2>
            <p class="large-copy">当前专注于把 AI 工程学习、vLLM 实践与软件架构经验整理成可检索的知识，同时完善这个个人内容的长期基础设施。</p>
          </div>
          <div class="now-card">
            <div class="now-status"><span /> OPEN NOTEBOOK</div>
            <p>这个站点使用 Vue 3、FastAPI 与 PostgreSQL 构建；视觉动效来自原创 Three.js 场景，并为低性能设备、减少动态效果与 WebGL 不可用场景提供静态后备。</p>
            <div class="now-actions">
              <MagneticLink href="/writing">阅读文章</MagneticLink>
              <router-link to="/works" class="editorial-button editorial-button--acid">查看作品 <span aria-hidden="true">→</span></router-link>
            </div>
          </div>
        </section>

        <SocialLinks />
        <footer class="about-end">
          <p>END / {{ new Date().getFullYear() }}</p>
          <h2>Thanks for<br /><em>reading.</em></h2>
          <router-link to="/writing" class="end-link">从一篇文章继续 <span>↗</span></router-link>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.about-layout { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: clamp(48px, 8vw, 120px); align-items: start; }
.about-sidebar { position: sticky; top: 112px; padding-top: 48px; }
.back-link { color: var(--muted); font: 0.65rem var(--mono-font); letter-spacing: 0.04em; text-decoration: none; }
.sidebar-index { display: grid; margin-top: 44px; border-top: 1px solid var(--line); }
.sidebar-index p { padding: 14px 0; margin: 0; color: var(--muted); font: 0.58rem var(--mono-font); letter-spacing: 0.06em; }
.sidebar-index a { display: flex; gap: 13px; align-items: center; padding: 13px 0; border-top: 1px solid var(--line); font-size: 0.79rem; text-decoration: none; }
.sidebar-index a span { color: var(--muted); font: 0.57rem var(--mono-font); }
.sidebar-index a.active { color: #2852d4; }
.share-link { padding: 14px 0 0; border: 0; background: transparent; color: var(--muted); font: 0.6rem var(--mono-font); cursor: pointer; }
.about-content { min-width: 0; }
.about-hero { min-height: 760px; padding-top: 66px; border-bottom: 1px solid var(--ink); }
.portrait { position: relative; width: min(100%, 660px); height: 285px; margin: 6px 0 32px; overflow: hidden; border: 1px solid var(--ink); background: var(--acid); isolation: isolate; }
.portrait::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 42px, rgba(17,17,17,.13) 43px); }
.portrait span { position: absolute; z-index: 1; left: 45%; top: 45%; color: var(--ink); font: 17rem/0.7 var(--display-font); letter-spacing: -0.12em; transform: translate(-50%, -50%) rotate(-9deg); }
.portrait i { position: absolute; right: 12%; top: 20%; width: 170px; aspect-ratio: 1; border: 2px solid var(--ink); border-radius: 50%; box-shadow: 0 0 0 25px rgba(55,103,255,.35), 0 0 0 26px var(--ink); }
.portrait b { position: absolute; right: 12px; bottom: 11px; z-index: 2; text-align: right; font: 0.58rem/1.5 var(--mono-font); }
.about-hero h1 { margin-bottom: 32px; font: 400 clamp(4.2rem, 9vw, 8.4rem)/0.85 var(--display-font); letter-spacing: -0.065em; }
.about-hero h1 em { color: var(--electric-blue); font-weight: 400; }
.about-intro { max-width: 690px; color: var(--muted); font-size: clamp(1rem, 1.5vw, 1.2rem); line-height: 1.75; }
.about-meta { display: flex; flex-wrap: wrap; gap: 12px 34px; margin-top: 34px; padding-top: 15px; border-top: 1px solid var(--line); color: var(--muted); font: 0.61rem var(--mono-font); letter-spacing: 0.04em; }
.about-section { display: grid; grid-template-columns: 115px minmax(0, 1fr); gap: 35px; padding: clamp(76px, 11vw, 150px) 0; border-bottom: 1px solid var(--ink); }
.section-number { color: var(--muted); font: 0.6rem var(--mono-font); letter-spacing: 0.04em; }
.section-body { min-width: 0; }
.section-body h2 { margin-bottom: 30px; font: 400 clamp(3rem, 6vw, 5.8rem)/0.9 var(--display-font); letter-spacing: -0.055em; }
.section-body h2 em { color: var(--electric-blue); font-weight: 400; }
.section-body > p:not(.section-kicker):not(.large-copy) { max-width: 570px; color: var(--muted); font-size: 0.95rem; }
.large-copy { max-width: 680px; margin-bottom: 18px; font: 400 clamp(1.35rem, 2.2vw, 1.75rem)/1.45 var(--display-font); letter-spacing: -0.025em; }
.approach-section { grid-template-rows: auto auto; }
.principle-grid { grid-column: 2; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 50px; background: var(--line); border: 1px solid var(--line); }
.principle-item { padding: 24px 19px; background: var(--paper); }
.principle-item > span { color: var(--muted); font: 0.61rem var(--mono-font); }
.principle-item h3 { margin: 42px 0 12px; font-size: 0.9rem; }
.principle-item p { color: var(--muted); font-size: 0.78rem; line-height: 1.75; }
.practice-list { grid-column: 2; margin-top: 52px; border-top: 1px solid var(--line); }
.practice-row { display: grid; grid-template-columns: 38px minmax(110px, .65fr) minmax(190px, 1fr); gap: 22px; align-items: start; padding: 23px 0; border-bottom: 1px solid var(--line); }
.practice-index { color: var(--muted); font: 0.61rem var(--mono-font); }
.practice-caption { margin-bottom: 8px; color: var(--muted); font: 0.58rem var(--mono-font); }
.practice-row h3 { margin: 0; font: 400 2.1rem/1 var(--display-font); }
.practice-row > p { color: var(--muted); font-size: 0.82rem; }
.practice-row > span { grid-column: 3; color: var(--muted); font: 0.58rem var(--mono-font); }
.now-card { grid-column: 2; padding: 25px; background: var(--ink); color: var(--paper); }
.now-status { display: flex; gap: 9px; align-items: center; color: var(--acid); font: 0.6rem var(--mono-font); letter-spacing: 0.06em; }
.now-status span { width: 7px; height: 7px; border-radius: 50%; background: var(--acid); }
.now-card > p { max-width: 680px; margin-top: 30px; color: #c3c6c1; font-size: .88rem; }
.now-actions { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 34px; }
.now-actions :deep(.magnetic-link) { color: var(--paper); border-color: var(--acid); }
.about-end { display: flex; flex-direction: column; align-items: center; padding: 120px 0 40px; text-align: center; }
.about-end > p { color: var(--muted); font: .58rem var(--mono-font); letter-spacing: .08em; }
.about-end h2 { font: 400 clamp(4rem, 9vw, 8rem)/.85 var(--display-font); letter-spacing: -.06em; }
.about-end h2 em { color: var(--electric-blue); font-weight: 400; }
.end-link { display: inline-flex; gap: 30px; align-items: center; margin-top: 40px; padding-bottom: 7px; border-bottom: 1px solid var(--ink); font: .67rem var(--mono-font); text-decoration: none; }
@media (max-width: 1000px) {
  .about-layout { display: block; }
  .about-sidebar { position: static; display: flex; justify-content: space-between; align-items: center; gap: 20px; padding-top: 34px; }
  .sidebar-index { display: flex; margin: 0; border: 0; }
  .sidebar-index p, .share-link { display: none; }
  .sidebar-index a { border: 0; padding: 8px; }
  .about-hero { min-height: auto; padding: 58px 0 50px; }
  .about-section { grid-template-columns: 75px minmax(0, 1fr); }
}
@media (max-width: 680px) {
  .about-sidebar { align-items: flex-start; flex-direction: column; }
  .sidebar-index { flex-wrap: wrap; }
  .sidebar-index a { padding: 5px 0 5px 15px; font-size: .7rem; }
  .portrait { height: 210px; }
  .portrait span { font-size: 11rem; }
  .portrait i { width: 115px; box-shadow: 0 0 0 17px rgba(55,103,255,.35), 0 0 0 18px var(--ink); }
  .about-hero h1 { font-size: clamp(3.9rem, 20vw, 6.2rem); }
  .about-meta { display: grid; gap: 8px; }
  .about-section { grid-template-columns: 1fr; gap: 22px; padding: 80px 0; }
  .principle-grid, .practice-list, .now-card { grid-column: 1; }
  .principle-grid { grid-template-columns: 1fr; margin-top: 30px; }
  .principle-item h3 { margin-top: 20px; }
  .practice-list { margin-top: 28px; }
  .practice-row { grid-template-columns: 28px 1fr; gap: 12px 14px; }
  .practice-row > p { grid-column: 2; }
  .practice-row > span { grid-column: 2; }
  .now-card { padding: 22px 18px; }
  .about-end { padding-top: 80px; }
}
</style>
