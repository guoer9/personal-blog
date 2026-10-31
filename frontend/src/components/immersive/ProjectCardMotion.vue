<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { prefersReducedMotion, projectCardTransform, springStep, type SpringState } from '@/graphics/motion'

withDefaults(defineProps<{ accent: 'lime' | 'blue' | 'paper' }>(), { accent: 'lime' })
const root = ref<HTMLElement | null>(null)
const rotateX = ref<SpringState>({ value: 0, velocity: 0 })
const rotateY = ref<SpringState>({ value: 0, velocity: 0 })
const active = ref(false)
let frame = 0
let lastTime = 0
let targetX = 0
let targetY = 0
let lightX = 50
let lightY = 50

function applyMotion() {
  if (!root.value) return
  root.value.style.setProperty('--card-rotate-x', `${rotateX.value.value.toFixed(3)}deg`)
  root.value.style.setProperty('--card-rotate-y', `${rotateY.value.value.toFixed(3)}deg`)
  root.value.style.setProperty('--card-light-x', `${lightX}%`)
  root.value.style.setProperty('--card-light-y', `${lightY}%`)
  root.value.style.setProperty('--card-lift', active.value ? '-8px' : '0px')
}

function animate(time: number) {
  const delta = lastTime > 0 ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60
  lastTime = time
  rotateX.value = springStep(rotateX.value, targetX, delta)
  rotateY.value = springStep(rotateY.value, targetY, delta)
  applyMotion()
  const settled = Math.abs(targetX - rotateX.value.value) < 0.01 && Math.abs(rotateX.value.velocity) < 0.02
    && Math.abs(targetY - rotateY.value.value) < 0.01 && Math.abs(rotateY.value.velocity) < 0.02
  if (settled) {
    frame = 0
    lastTime = 0
    return
  }
  frame = requestAnimationFrame(animate)
}

function startAnimation() {
  if (frame || !root.value) return
  frame = requestAnimationFrame(animate)
}

function onPointerMove(event: PointerEvent) {
  if (!root.value || prefersReducedMotion() || event.pointerType === 'touch') return
  const motion = projectCardTransform(event.clientX, event.clientY, root.value.getBoundingClientRect())
  targetX = motion.rotateX
  targetY = motion.rotateY
  lightX = Number(motion.lightX.toFixed(1))
  lightY = Number(motion.lightY.toFixed(1))
  active.value = true
  startAnimation()
}

function reset() {
  targetX = 0
  targetY = 0
  lightX = 50
  lightY = 50
  active.value = false
  startAnimation()
}

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <div
    ref="root"
    class="project-card-motion"
    :class="`project-card-motion--${accent}`"
    :data-active="active"
    @pointermove="onPointerMove"
    @pointerleave="reset"
    @pointercancel="reset"
  >
    <slot />
  </div>
</template>

<style scoped>
.project-card-motion {
  --card-rotate-x: 0deg;
  --card-rotate-y: 0deg;
  --card-light-x: 50%;
  --card-light-y: 50%;
  --card-lift: 0px;
  position: relative;
  height: 100%;
  isolation: isolate;
  perspective: 1200px;
  transform: translate3d(0, var(--card-lift), 0) rotateX(var(--card-rotate-x)) rotateY(var(--card-rotate-y));
  transform-style: preserve-3d;
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.project-card-motion:not([data-active='true']) { will-change: auto; }
.project-card-motion::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(360px circle at var(--card-light-x) var(--card-light-y), rgba(199, 255, 46, 0.16), transparent 62%);
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 260ms ease;
}
.project-card-motion--blue::before { background: radial-gradient(360px circle at var(--card-light-x) var(--card-light-y), rgba(115, 157, 255, 0.18), transparent 62%); }
.project-card-motion--paper::before { background: radial-gradient(360px circle at var(--card-light-x) var(--card-light-y), rgba(243, 177, 227, 0.17), transparent 62%); }
.project-card-motion:hover::before { opacity: 1; }
.project-card-motion :deep(.project-card) { height: 100%; transform: translateZ(0); }
.project-card-motion :deep(.project-card:hover) { transform: none; }
@media (pointer: coarse), (prefers-reduced-motion: reduce) {
  .project-card-motion { transform: none; }
  .project-card-motion::before { display: none; }
}
</style>
