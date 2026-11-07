<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { WebGLRenderer } from 'three'
import SiteHeader from '@/components/navigation/SiteHeader.vue'
import { profile } from '@/data/portfolio'
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

const route = useRoute()
const canvas = ref<HTMLCanvasElement | null>(null)
const runtime = shallowRef<VisualRuntime | null>(null)
const runtimeFailed = ref(false)
let reducedMotionQuery: MediaQueryList | null = null
let anchorMeasureFrame = 0
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
  sceneRegistry.register('home', () => new HomeScene())
  sceneRegistry.register('works', () => new WorksScene())
  sceneRegistry.register('work-detail', () => new WorkDetailScene())
  sceneRegistry.register('about', () => new AboutScene())
  sceneRegistry.register('article', () => new ArticleScene())
  sceneRegistry.register('archive', () => new ArchiveScene())
  sceneRegistry.register('library', () => new LibraryScene())
  return new VisualRuntime({ sceneRegistry, createRenderer, onFallbackChange: (fallback) => { runtimeFailed.value = fallback } })
}

function updateRoute() { runtime.value?.setRoute(routeIdentity()) }
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
  if (anchorMeasureFrame) return
  anchorMeasureFrame = requestAnimationFrame(() => {
    anchorMeasureFrame = 0
    runtime.value?.measureAnchors()
  })
}
function onResize() {
  runtime.value?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
  if (anchorMeasureFrame) cancelAnimationFrame(anchorMeasureFrame)
  anchorMeasureFrame = 0
  updateScrollState()
  runtime.value?.measureAnchors()
}
function onReducedMotionChange(event: MediaQueryList | MediaQueryListEvent) {
  runtime.value?.setReducedMotion(event.matches)
}

onMounted(() => {
  if (!canvas.value) return
  if (import.meta.env.DEV) (window as DiagnosticWindow).__visualRuntimeDiagnostics = diagnosticReader
  try {
    runtime.value = createRuntime()
    runtime.value.mount(canvas.value)
    runtime.value.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
    if (typeof window.matchMedia === 'function') {
      reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      onReducedMotionChange(reducedMotionQuery)
      reducedMotionQuery.addEventListener('change', onReducedMotionChange)
    }
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
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerEnd)
  window.removeEventListener('pointercancel', onPointerEnd)
  window.removeEventListener('blur', onBlur)
  touchPointer = null
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  if (anchorMeasureFrame) cancelAnimationFrame(anchorMeasureFrame)
  anchorMeasureFrame = 0
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
  reducedMotionQuery = null
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
  <div class="main-layout" :class="{ 'main-layout--home': route.name === 'Home' }">
    <a class="skip-link" href="#main-content" @click="focusMainContent">跳到正文</a>
    <SiteHeader />
    <canvas ref="canvas" class="visual-runtime-canvas" aria-hidden="true" :data-runtime-failed="runtimeFailed" />
    <main id="main-content" class="site-main" tabindex="-1">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in" @before-leave="onPageBeforeLeave" @after-leave="onPageAfterLeave" @after-enter="onPageAfterEnter">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <footer class="footer">
      <div class="page-shell">
        <div class="footer-inner">
          <div>
            <router-link to="/" class="footer-mark">{{ profile.monogram }} {{ profile.name }}</router-link>
            <p class="footer-copy">{{ profile.role }} · {{ profile.location }}</p>
          </div>
          <div class="footer-links">
            <router-link to="/works">作品集</router-link>
            <router-link to="/writing">文章归档</router-link>
            <router-link to="/about">关于</router-link>
            <router-link to="/search">搜索</router-link>
            <router-link to="/transfer">临时传输</router-link>
            <a href="https://github.com/guoer9" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            <a href="https://space.bilibili.com/693922070" target="_blank" rel="noopener noreferrer">Bilibili ↗</a>
          </div>
        </div>
        <p class="footer-legal">© {{ new Date().getFullYear() }} {{ profile.name }} · Built with curiosity and code.</p>
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
.skip-link { position: fixed; z-index: 1000; top: 12px; left: 12px; padding: 10px 15px; background: var(--ink); color: var(--paper); transform: translateY(-160%); }
.skip-link:focus { transform: none; }
.page-enter-active, .page-leave-active { transition: opacity 180ms ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
