<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { WebGLRenderer } from 'three'
import SiteHeader from '@/components/navigation/SiteHeader.vue'
import { profile } from '@/data/portfolio'
import { HomeScene } from '@/graphics/scenes/home/HomeScene'
import { SceneRegistry, routeVisualIdentity } from '@/graphics/runtime/SceneRegistry'
import { VisualRuntime } from '@/graphics/runtime/VisualRuntime'
import type { RendererAdapter } from '@/graphics/runtime/types'
import { visualPageSceneBridgeKey, visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

const route = useRoute()
const canvas = ref<HTMLCanvasElement | null>(null)
const runtime = shallowRef<VisualRuntime | null>(null)
const runtimeFailed = ref(false)
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
  return new VisualRuntime({ sceneRegistry, createRenderer })
}

function updateRoute() { runtime.value?.setRoute(routeIdentity()) }
function onPointerMove(event: PointerEvent) {
  runtime.value?.setPointer((event.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1))
}
function onScroll() {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  runtime.value?.setScroll(window.scrollY, window.scrollY / max)
}
function onResize() {
  runtime.value?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
  runtime.value?.measureAnchors()
  onScroll()
}

onMounted(() => {
  if (!canvas.value) return
  try {
    runtime.value = createRuntime()
    runtime.value.mount(canvas.value)
    runtime.value.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
    runtime.value.start()
    updateRoute()
    onScroll()
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
  } catch {
    runtimeFailed.value = true
    canvas.value.style.display = 'none'
  }
})
watch(() => [route.name, route.fullPath], updateRoute)
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  runtime.value?.dispose()
  runtime.value = null
})

function focusMainContent() {
  document.querySelector<HTMLElement>('#main-content')?.focus()
}
</script>

<template>
  <div class="main-layout">
    <a class="skip-link" href="#main-content" @click="focusMainContent">跳到正文</a>
    <SiteHeader />
    <canvas ref="canvas" class="visual-runtime-canvas" aria-hidden="true" :data-runtime-failed="runtimeFailed" />
    <main id="main-content" class="site-main" tabindex="-1">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
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
.visual-runtime-canvas { position: fixed; z-index: 1; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .7; }
.skip-link { position: fixed; z-index: 1000; top: 12px; left: 12px; padding: 10px 15px; background: var(--ink); color: var(--paper); transform: translateY(-160%); }
.skip-link:focus { transform: none; }
.page-enter-active, .page-leave-active { transition: opacity 180ms ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
