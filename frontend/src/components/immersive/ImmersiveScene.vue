<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LiquidSceneController } from '@/graphics/liquidScene'
import { pointerToNdc } from '@/graphics/motion'

const props = withDefaults(defineProps<{ alt?: string; progress?: number; paused?: boolean }>(), {
  alt: '跟随指针与滚动的抽象虹彩几何体',
  progress: 0,
  paused: false,
})

const canvas = ref<HTMLCanvasElement | null>(null)
const poster = ref<HTMLDivElement | null>(null)
const root = ref<HTMLDivElement | null>(null)
const ready = ref(false)
const fallback = ref(false)
const reducedMotion = ref(false)
const pointerX = ref(0)
const pointerY = ref(0)
const scroll = ref(props.progress)
const renderState = ref<'booting' | 'playing' | 'paused' | 'static'>('booting')
const showPoster = computed(() => fallback.value || reducedMotion.value || (props.paused && !ready.value))
const renderLabel = computed(() => {
  if (props.paused && !reducedMotion.value) return 'PAUSED / MANUAL'
  if (fallback.value || reducedMotion.value) return 'STATIC / SIGNAL'
  if (renderState.value === 'playing') return 'LIVE / WEBGL'
  if (renderState.value === 'paused') return 'PAUSED / OFFSCREEN'
  return 'STATIC / SIGNAL'
})

let controller: LiquidSceneController | null = null
let frame = 0
let mounted = false
let disposed = false
let isVisible = true
let resizeObserver: ResizeObserver | null = null
let visibilityObserver: IntersectionObserver | null = null
let mediaQuery: MediaQueryList | null = null
let cleanupListeners: Array<() => void> = []

function markSceneInput() {
  if (!import.meta.env.DEV || !canvas.value) return
  canvas.value.dataset.sceneInput = [
    pointerX.value.toFixed(3),
    pointerY.value.toFixed(3),
    scroll.value.toFixed(3),
    Math.round(performance.now()),
  ].join(',')
}

function markSceneFrame() {
  if (!import.meta.env.DEV || !canvas.value) return
  const previousFrame = Number(canvas.value.dataset.sceneFrame || 0)
  canvas.value.dataset.sceneFrame = String(previousFrame + 1)
}

function renderLoop(time: number) {
  frame = 0
  if (!mounted || disposed || !controller || !isVisible || document.hidden || props.paused) {
    renderState.value = props.paused || document.hidden || !isVisible ? 'paused' : 'static'
    return
  }
  renderState.value = 'playing'
  controller.setInput({ pointerX: pointerX.value, pointerY: pointerY.value, scroll: scroll.value })
  markSceneInput()
  controller.render(time)
  markSceneFrame()
  frame = requestAnimationFrame(renderLoop)
}

function stopLoop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  if (controller) renderState.value = fallback.value || reducedMotion.value ? 'static' : 'paused'
}

function startLoop() {
  if (!frame && mounted && controller && isVisible && !document.hidden && !props.paused) {
    frame = requestAnimationFrame(renderLoop)
  }
}

function resize() {
  if (!root.value || !controller) return
  const rect = root.value.getBoundingClientRect()
  controller.resize(rect.width, rect.height, window.devicePixelRatio || 1)
}

function updateScroll() {
  scroll.value = Math.min(Math.max(props.progress, 0), 1)
}

function onPointerMove(event: PointerEvent) {
  if (!root.value) return
  const point = pointerToNdc(event.clientX, event.clientY, root.value.getBoundingClientRect())
  pointerX.value = point.x
  pointerY.value = point.y
  if (fallback.value && poster.value) {
    poster.value.style.transform = `translate3d(${point.x * 7}px, ${-point.y * 7}px, 0)`
  }
}

function resetPointer() {
  pointerX.value = 0
  pointerY.value = 0
  if (fallback.value && poster.value) poster.value.style.transform = ''
}

function handleVisibility() {
  if (document.hidden) stopLoop()
  else startLoop()
}

function setReducedMotion(event: MediaQueryListEvent | MediaQueryList) {
  reducedMotion.value = event.matches
}

function suspendScene() {
  ready.value = false
  stopLoop()
  renderState.value = 'static'
  if (controller) {
    controller.dispose()
    controller = null
  }
}

function activatePoster() {
  fallback.value = true
  suspendScene()
}

let initializing = false

async function initialize() {
  if (initializing) return
  if (!mounted || disposed || reducedMotion.value || props.paused) {
    if (reducedMotion.value) suspendScene()
    else if (props.paused) renderState.value = 'paused'
    return
  }
  if (!canvas.value || fallback.value) return
  initializing = true
  try {
    const { createLiquidScene } = await import('@/graphics/liquidScene')
    if (!mounted || disposed || reducedMotion.value || !canvas.value) return
    controller = createLiquidScene(canvas.value, { pointerX: 0, pointerY: 0, scroll: props.progress })
    if (import.meta.env.DEV) {
      canvas.value.dataset.sceneFrame = '0'
      markSceneInput()
    }
    resize()
    updateScroll()
    ready.value = true
    startLoop()
  } catch (error) {
    console.warn('WebGL scene unavailable; keeping the static portrait.', error)
    activatePoster()
  } finally {
    initializing = false
  }
}

watch(() => props.progress, (nextProgress) => {
  scroll.value = Math.min(Math.max(nextProgress, 0), 1)
}, { flush: 'post' })

watch(reducedMotion, (shouldReduce) => {
  if (shouldReduce) suspendScene()
  else if (!controller && !fallback.value && !props.paused) initialize()
})

watch(() => props.paused, (isPaused) => {
  if (isPaused) {
    stopLoop()
    renderState.value = fallback.value || reducedMotion.value ? 'static' : 'paused'
  } else if (controller) {
    startLoop()
  } else if (!reducedMotion.value && !fallback.value && isVisible && !document.hidden) {
    void initialize()
  }
})

onMounted(async () => {
  mounted = true
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  setReducedMotion(mediaQuery)
  mediaQuery.addEventListener('change', setReducedMotion)

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerleave', resetPointer)
  document.addEventListener('visibilitychange', handleVisibility)
  cleanupListeners = [
    () => window.removeEventListener('pointermove', onPointerMove),
    () => window.removeEventListener('pointerleave', resetPointer),
    () => document.removeEventListener('visibilitychange', handleVisibility),
    () => mediaQuery?.removeEventListener('change', setReducedMotion),
  ]

  if (root.value) {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(root.value)
    visibilityObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting
      if (isVisible) startLoop()
      else stopLoop()
    }, { threshold: 0.01 })
    visibilityObserver.observe(root.value)
  }
  updateScroll()
  await initialize()
})

onBeforeUnmount(() => {
  disposed = true
  mounted = false
  stopLoop()
  cleanupListeners.forEach((cleanup) => cleanup())
  cleanupListeners = []
  resizeObserver?.disconnect()
  resizeObserver = null
  visibilityObserver?.disconnect()
  visibilityObserver = null
  controller?.dispose()
  controller = null
})
</script>

<template>
  <div
    ref="root"
    class="immersive-scene"
    role="img"
    :aria-label="alt"
    :data-render-state="renderState"
    :data-motion-stage="fallback ? undefined : scroll < 0.18 ? 'idea' : scroll < 0.48 ? 'writing' : scroll < 0.78 ? 'projects' : 'signal'"
    :style="{ '--scene-progress': scroll }"
  >
    <div class="scene-grid" aria-hidden="true" />
    <div class="scene-orbit scene-orbit--one" aria-hidden="true" />
    <div class="scene-orbit scene-orbit--two" aria-hidden="true" />
    <canvas v-show="ready && !fallback && !reducedMotion" ref="canvas" class="scene-canvas" aria-hidden="true" />
    <div v-show="showPoster" ref="poster" class="scene-poster" aria-hidden="true">
      <span class="poster-ring poster-ring--one" />
      <span class="poster-ring poster-ring--two" />
      <span class="poster-core">∿</span>
      <span class="poster-coordinate">31.2304° N / 121.4737° E</span>
    </div>
    <div class="scene-caption" aria-hidden="true">
      <span>{{ renderLabel }}</span>
      <span class="scene-caption__pointer">MOVE TO DISTORT</span>
      <span class="scene-caption__touch">SCROLL TO TRANSFORM</span>
    </div>
  </div>
</template>

<style scoped>
.immersive-scene {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 440px;
  overflow: hidden;
  isolation: isolate;
  contain: layout paint;
}
.scene-canvas, .scene-poster { position: absolute; inset: 0; width: 100%; height: 100%; }
.scene-canvas { z-index: 3; display: block; touch-action: pan-y; }
.scene-grid {
  position: absolute;
  inset: 8%;
  z-index: 0;
  border: 1px solid rgba(17, 17, 17, 0.16);
  background-image:
    linear-gradient(rgba(17, 17, 17, 0.075) 1px, transparent 1px),
    linear-gradient(90deg, rgba(17, 17, 17, 0.075) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle, #000 35%, transparent 78%);
}
.scene-orbit { position: absolute; z-index: 1; border: 1px solid rgba(17, 17, 17, 0.28); border-radius: 50%; pointer-events: none; }
.scene-orbit--one { width: 76%; aspect-ratio: 1.68; top: 17%; left: 12%; transform: rotate(-17deg); animation: orbit 15s linear infinite; }
.scene-orbit--two { width: 58%; aspect-ratio: 0.85; top: 19%; left: 21%; transform: rotate(42deg); border-color: rgba(55, 103, 255, 0.38); animation: orbit-reverse 19s linear infinite; }
.scene-poster { z-index: 3; display: grid; place-items: center; transition: transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.poster-core {
  display: grid;
  place-items: center;
  width: min(54vw, 340px);
  aspect-ratio: 1;
  border: 2px solid var(--ink);
  border-radius: 47% 53% 43% 57% / 50% 35% 65% 50%;
  background:
    radial-gradient(circle at 31% 27%, #f6ffe2 0, transparent 23%),
    radial-gradient(circle at 78% 70%, #d8ff4b 0, transparent 28%),
    conic-gradient(from 30deg, #111, #3767ff, #dbe3d5, #c7ff2e, #111);
  box-shadow: 20px 22px 0 rgba(17, 17, 17, 0.12);
  color: var(--paper);
  font-family: var(--display-font);
  font-size: clamp(5rem, 13vw, 9rem);
  line-height: 1;
  animation: float 8s ease-in-out infinite;
}
.poster-ring { position: absolute; border: 2px solid var(--ink); border-radius: 50%; }
.poster-ring--one { width: min(70vw, 440px); aspect-ratio: 1.62; transform: rotate(-20deg); }
.poster-ring--two { width: min(54vw, 360px); aspect-ratio: 1; border-color: var(--electric-blue); transform: rotate(24deg); }
.poster-coordinate { position: absolute; right: 8%; bottom: 12%; font-family: var(--mono-font); font-size: 0.65rem; letter-spacing: 0.05em; }
.scene-caption { position: absolute; z-index: 4; inset: auto 8% 6%; display: flex; justify-content: space-between; gap: 20px; font-family: var(--mono-font); font-size: 0.66rem; letter-spacing: 0.08em; pointer-events: none; }
.scene-caption__touch { display: none; }
@keyframes orbit { to { transform: rotate(343deg); } }
@keyframes orbit-reverse { to { transform: rotate(-318deg); } }
@keyframes float { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-12px) rotate(2deg); } }
@media (max-width: 760px) {
  .immersive-scene { min-height: 390px; }
  .scene-caption { inset: auto 6% 4%; font-size: 0.57rem; }
  .scene-grid { inset: 4%; background-size: 32px 32px; }
  .poster-core { width: min(70vw, 290px); }
}
@media (pointer: coarse) {
  .scene-caption__pointer { display: none; }
  .scene-caption__touch { display: inline; }
}
@media (prefers-reduced-motion: reduce) {
  .scene-orbit, .poster-core { animation: none; }
  .scene-poster { transform: none !important; }
}
</style>
