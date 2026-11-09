<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { WebGLRenderer } from 'three'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import SiteHeader from '@/components/navigation/SiteHeader.vue'
import { profile } from '@/data/portfolio'
import { displayedStageWorkKey } from '@/data/stage'
import type { Work } from '@/data/works'
import { HomeScene } from '@/graphics/scenes/home/HomeScene'
import { WorksScene } from '@/graphics/scenes/works/WorksScene'
import { WorkDetailScene } from '@/graphics/scenes/work-detail/WorkDetailScene'
import { AboutScene } from '@/graphics/scenes/about/AboutScene'
import { ArticleScene } from '@/graphics/scenes/article/ArticleScene'
import { ArchiveScene } from '@/graphics/scenes/archive/ArchiveScene'
import { LibraryScene } from '@/graphics/scenes/library/LibraryScene'
import { SceneRegistry, routeVisualIdentity } from '@/graphics/runtime/SceneRegistry'
import { VisualRuntime } from '@/graphics/runtime/VisualRuntime'
import type { RendererAdapter } from '@/graphics/runtime/types'
import type { VisualRuntimeDiagnostics } from '@/graphics/runtime/VisualRuntime'
import { visualPageSceneBridgeKey, visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'
import { createPageScroll, pageScrollKey } from '@/graphics/runtime/pageScroll'
import { createPerformanceAudio, performanceAudioKey } from '@/audio/performanceAudio'

const route = useRoute()
const performanceAudio = createPerformanceAudio()
provide(performanceAudioKey, performanceAudio)
const layout = ref<HTMLElement | null>(null)
const displayedWork = shallowRef<Work | null>(null)
provide(displayedStageWorkKey, displayedWork)
const isPerformance = computed(() => route.name === 'Home' || (
  route.name === 'WorkDetail'
  && displayedWork.value?.category === 'music'
  && route.params.slug === displayedWork.value.slug
))
const navigationOpen = ref(false)
const canvas = ref<HTMLCanvasElement | null>(null)
const runtime = shallowRef<VisualRuntime | null>(null)
const runtimeFailed = ref(false)
let scrollDriver: Lenis | null = null
let anchorsDirty = true
let previousScrollY = Number.NaN
const pageScroll = createPageScroll()
provide(pageScrollKey, pageScroll)
const touchDragThreshold = 16
let touchPointer: { id: number; startX: number; startY: number; dragging: boolean } | null = null
const diagnosticReader = (): VisualRuntimeDiagnostics | null => runtime.value?.getDiagnostics() ?? null
type DiagnosticWindow = Window & { __visualRuntimeDiagnostics?: () => VisualRuntimeDiagnostics | null }
provide(visualRuntimeKey, runtime)
provide(visualPageSceneBridgeKey, null)

function routeIdentity() {
  const params = Object.fromEntries(Object.entries(route.params).map(([key, value]) => [key, Array.isArray(value) ? value[0] || '' : String(value)]))
  return routeVisualIdentity(String(route.name || 'NotFound'), params)
}

function createRenderer(element: HTMLCanvasElement): RendererAdapter {
  const renderer = new WebGLRenderer({ canvas: element, alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = 'srgb'
  return renderer
}

function createRuntime(): VisualRuntime {
  const sceneRegistry = new SceneRegistry()
  sceneRegistry.register('home', () => new HomeScene(performanceAudio.features, false))
  sceneRegistry.register('works', () => new WorksScene())
  sceneRegistry.register('work-detail', () => new WorkDetailScene(performanceAudio.features))
  sceneRegistry.register('about', () => new AboutScene())
  sceneRegistry.register('article', () => new ArticleScene())
  sceneRegistry.register('archive', () => new ArchiveScene())
  sceneRegistry.register('library', () => new LibraryScene())
  return new VisualRuntime({ sceneRegistry, createRenderer, beforeFrame: updateFrame, onFallbackChange: (fallback) => { runtimeFailed.value = fallback } })
}

function updateRoute() {
  const track = performanceAudio.state.value.work
  const continuesMusic = route.name === 'Home'
    || (route.name === 'Works' && (!route.query.type || route.query.type === 'all' || route.query.type === 'music'))
    || (route.name === 'WorkDetail' && track?.category === 'music' && route.params.slug === track.slug)
  if (!continuesMusic) performanceAudio.pause()
  scrollDriver?.scrollTo(window.scrollY, { immediate: true, force: true })
  anchorsDirty = true
  runtime.value?.setRoute(routeIdentity())
}
function onPageBeforeLeave() { runtime.value?.beginTransitionLeave() }
function onPageAfterLeave() { runtime.value?.finishTransitionLeave() }
function onPageAfterEnter() { void runtime.value?.finishTransitionEnter() }
function onPointerDown(event: PointerEvent) {
  if (event.pointerType !== 'touch') return
  touchPointer = event.isPrimary
    ? { id: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false }
    : null
}
function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch') {
    if (!event.isPrimary || !touchPointer || touchPointer.id !== event.pointerId) return
    if (!touchPointer.dragging) {
      const dx = event.clientX - touchPointer.startX
      const dy = event.clientY - touchPointer.startY
      if (Math.hypot(dx, dy) <= touchDragThreshold) return
      // Let vertical swipes and native gestures scroll without disturbing the scene pointer.
      if (Math.abs(dy) >= Math.abs(dx)) { touchPointer = null; return }
      touchPointer.dragging = true
    }
  }
  runtime.value?.setPointer(
    (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1,
    -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1),
    event.clientX,
    event.clientY,
  )
}
function onPointerEnd(event: PointerEvent) {
  if (touchPointer?.id === event.pointerId) touchPointer = null
}
function onBlur() { touchPointer = null }
function updateScrollState() {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  runtime.value?.setScroll(window.scrollY, window.scrollY / max)
}
function onScroll() {
  updateScrollState()
  anchorsDirty = true
}
function updateFrame(timeMs: number) {
  performanceAudio.tick(timeMs)
  layout.value?.style.setProperty('--audio-energy', String(performanceAudio.features.energy))
  scrollDriver?.raf(timeMs)
  // Lenis updates the browser's actual scroll; use that same coordinate for
  // sticky DOM, section anchors and VisualState (including native touch/keys).
  const scrollY = window.scrollY
  const moved = scrollY !== previousScrollY
  const needsMeasure = moved || anchorsDirty || pageScroll.dirty
  if (needsMeasure) {
    updateScrollState()
    pageScroll.publish({ scrollY, viewportHeight: window.innerHeight, timeMs })
    runtime.value?.measureAnchors()
  }
  previousScrollY = scrollY
  anchorsDirty = false
}
function onResize() {
  runtime.value?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
  scrollDriver?.resize()
  anchorsDirty = true
  updateScrollState()
  runtime.value?.measureAnchors()
}

onMounted(() => {
  if (!canvas.value) return
  scrollDriver = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: false,
    autoRaf: false,
    respectReducedMotion: false,
    anchors: true,
    stopInertiaOnNavigate: true,
    prevent: (element) => Boolean(element.closest('.mobile-navigation, .header-search, [data-lenis-prevent]')),
  })
  if (import.meta.env.DEV) (window as DiagnosticWindow).__visualRuntimeDiagnostics = diagnosticReader
  try {
    runtime.value = createRuntime()
    runtime.value.mount(canvas.value)
    runtime.value.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
    runtime.value.start()
    updateRoute()
    onPageAfterEnter()
    onScroll()
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerEnd, { passive: true })
    window.addEventListener('pointercancel', onPointerEnd, { passive: true })
    window.addEventListener('blur', onBlur)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
  } catch {
    runtimeFailed.value = true
    canvas.value.style.display = 'none'
  }
})
watch(() => [route.name, route.fullPath], updateRoute)
watch(navigationOpen, (open) => { if (open) scrollDriver?.stop(); else scrollDriver?.start() })
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerEnd)
  window.removeEventListener('pointercancel', onPointerEnd)
  window.removeEventListener('blur', onBlur)
  touchPointer = null
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  scrollDriver?.destroy()
  scrollDriver = null
  pageScroll.clear()
  performanceAudio.dispose()
  const diagnosticWindow = window as DiagnosticWindow
  if (import.meta.env.DEV && diagnosticWindow.__visualRuntimeDiagnostics === diagnosticReader) {
    delete diagnosticWindow.__visualRuntimeDiagnostics
  }
  runtime.value?.dispose()
  runtime.value = null
})

function focusMainContent() {
  document.querySelector<HTMLElement>('#main-content')?.focus()
}
</script>

<template>
  <div ref="layout" class="main-layout" :class="{ 'main-layout--home': route.name === 'Home', 'main-layout--performance': isPerformance, 'main-layout--fallback': runtimeFailed }">
    <a class="skip-link" href="#main-content" :inert="navigationOpen" @click="focusMainContent">跳到正文</a>
    <SiteHeader @menu-change="navigationOpen = $event" />
    <canvas ref="canvas" class="visual-runtime-canvas" aria-hidden="true" :data-runtime-failed="runtimeFailed" />
    <div v-if="runtimeFailed && isPerformance" class="stage-fallback" aria-hidden="true"><i /><i /></div>
    <main id="main-content" class="site-main" tabindex="-1" :inert="navigationOpen">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in" @before-leave="onPageBeforeLeave" @after-leave="onPageAfterLeave" @after-enter="onPageAfterEnter">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <footer class="footer" :inert="navigationOpen">
      <div class="page-shell">
        <div class="footer-inner">
          <div>
            <router-link to="/" class="footer-mark">{{ profile.monogram }} {{ profile.name }}</router-link>
            <p class="footer-copy">{{ profile.role }} · {{ profile.location }}</p>
          </div>
          <div class="footer-links">
            <router-link to="/works?type=music">音乐</router-link>
            <router-link to="/works?type=film">影像</router-link>
            <router-link to="/writing">档案</router-link>
            <router-link to="/about">关于</router-link>
            <router-link to="/search">搜索</router-link>
            <router-link to="/transfer">临时传输</router-link>
            <a href="https://github.com/guoer9" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            <a href="https://space.bilibili.com/693922070" target="_blank" rel="noopener noreferrer">Bilibili ↗</a>
          </div>
        </div>
        <p class="footer-legal">© {{ new Date().getFullYear() }} 陈果 / {{ profile.name }} · MUSIC, IN MOTION.</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.main-layout { min-height: 100vh; display: flex; flex-direction: column; }
.site-main { position: relative; z-index: 2; flex: 1; }
.main-layout--home .site-main { z-index: auto; }
.main-layout--home .footer { position: relative; z-index: 2; }
.visual-runtime-canvas { position: fixed; z-index: 1; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .7; }
.main-layout--performance .visual-runtime-canvas { opacity: 1; }
.skip-link { position: fixed; z-index: 1000; top: 12px; left: 12px; padding: 10px 15px; background: var(--ink); color: var(--paper); transform: translateY(-160%); }
.skip-link:focus { transform: none; }
.page-enter-active { transition: opacity 550ms ease, clip-path 650ms cubic-bezier(.2,.7,.2,1); }
.page-leave-active { transition: opacity 240ms ease; }
.page-enter-from { opacity: 0; clip-path:inset(0 0 100% 0 round 0 0 45% 45%); }
.page-enter-to { opacity:1;clip-path:inset(0 0 0 0 round 0); }
.page-leave-to {opacity:0;}
.stage-fallback {position:fixed;z-index:1;left:50%;top:50%;width:min(52vw,520px);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle at 27% 25%,#dfe8f6,#6e99ea 20%,#123ae0 48%,#101323 73%);box-shadow:inset -12px -8px 30px #c7ff2e70,0 0 70px #365cef1a;pointer-events:none;animation:stage-breathe 7s ease-in-out infinite;}
.stage-fallback i {position:absolute;inset:10%;border:1px solid #dbe6ff55;border-radius:50%;transform:rotateY(65deg) rotate(-25deg);}
.stage-fallback i:last-child {transform:rotateX(65deg) rotate(25deg);inset:4%;}
@keyframes stage-breathe {50% {filter:hue-rotate(20deg) brightness(1.08);}}
@media(max-width:700px) {.stage-fallback {width:74vw;}}
</style>
