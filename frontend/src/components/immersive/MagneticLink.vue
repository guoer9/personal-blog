<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { prefersReducedMotion, springStep, type SpringState } from '@/graphics/motion'

const props = withDefaults(defineProps<{ href: string; external?: boolean }>(), { external: false })
const root = ref<HTMLAnchorElement | null>(null)
const x = ref<SpringState>({ value: 0, velocity: 0 })
const y = ref<SpringState>({ value: 0, velocity: 0 })
let frame = 0
let lastTime = 0
let targetX = 0
let targetY = 0
let pressed = false

function applyTransform() {
  if (!root.value) return
  const scale = pressed ? 0.97 : 1
  root.value.style.transform = `translate3d(${x.value.value.toFixed(2)}px, ${y.value.value.toFixed(2)}px, 0) scale(${scale})`
}

function animate(time: number) {
  const delta = lastTime > 0 ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60
  lastTime = time
  x.value = springStep(x.value, targetX, delta)
  y.value = springStep(y.value, targetY, delta)
  applyTransform()
  const settled = Math.abs(targetX - x.value.value) < 0.02 && Math.abs(x.value.velocity) < 0.02
    && Math.abs(targetY - y.value.value) < 0.02 && Math.abs(y.value.velocity) < 0.02
  if (settled) {
    frame = 0
    lastTime = 0
    return
  }
  frame = requestAnimationFrame(animate)
}

function startAnimation() {
  if (frame || !root.value || props.external) return
  frame = requestAnimationFrame(animate)
}

function onPointerMove(event: PointerEvent) {
  if (!root.value || prefersReducedMotion() || event.pointerType === 'touch') return
  const rect = root.value.getBoundingClientRect()
  targetX = (event.clientX - rect.left - rect.width / 2) * 0.13
  targetY = (event.clientY - rect.top - rect.height / 2) * 0.18
  startAnimation()
}

function reset() {
  targetX = 0
  targetY = 0
  pressed = false
  startAnimation()
}

function onPointerDown() {
  pressed = true
  applyTransform()
}

function onPointerUp() {
  pressed = false
  applyTransform()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') onPointerDown()
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') onPointerUp()
}

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <a
    ref="root"
    :href="href"
    class="magnetic-link"
    :target="external ? '_blank' : undefined"
    :rel="external ? 'noreferrer' : undefined"
    @pointermove="onPointerMove"
    @pointerleave="reset"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="reset"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @blur="reset"
  >
    <span class="magnetic-label"><slot /></span>
    <span class="magnetic-arrow" aria-hidden="true">↗</span>
  </a>
</template>

<style scoped>
.magnetic-link {
  display: inline-flex;
  align-items: center;
  gap: 18px;
  width: fit-content;
  min-height: 46px;
  padding: 0 2px;
  color: var(--ink);
  border-bottom: 2px solid var(--ink);
  font-family: var(--mono-font);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-decoration: none;
  touch-action: manipulation;
  will-change: transform;
  transition: border-color 180ms ease;
}
.magnetic-link:hover { border-color: var(--electric-blue); }
.magnetic-link:active { color: var(--electric-blue); }
.magnetic-link:focus-visible { outline: 3px solid var(--electric-blue); outline-offset: 4px; }
.magnetic-arrow { font-family: var(--body-font); font-size: 1.25rem; line-height: 1; transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
.magnetic-link:hover .magnetic-arrow { transform: translate(3px, -3px); }
@media (prefers-reduced-motion: reduce) {
  .magnetic-link, .magnetic-arrow { transition: none; }
}
</style>
