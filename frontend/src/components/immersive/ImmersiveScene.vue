<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ alt?: string; progress?: number; paused?: boolean }>(), {
  alt: '跟随指针与滚动的抽象虹彩几何体',
  progress: 0,
  paused: false,
})

const showPoster = computed(() => props.paused)
const renderLabel = computed(() => {
  return props.paused ? 'PAUSED / MANUAL' : 'SHARED / WEBGL'
})
</script>

<template>
  <div
    ref="root"
    class="immersive-scene"
    role="img"
    :aria-label="alt"
    data-render-state="shared-runtime"
    :data-motion-stage="props.progress < 0.18 ? 'idea' : props.progress < 0.48 ? 'writing' : props.progress < 0.78 ? 'projects' : 'signal'"
    :style="{ '--scene-progress': props.progress }"
  >
    <div class="scene-grid" aria-hidden="true" />
    <div class="scene-orbit scene-orbit--one" aria-hidden="true" />
    <div class="scene-orbit scene-orbit--two" aria-hidden="true" />
    <div v-show="showPoster" class="scene-poster" aria-hidden="true">
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
.scene-poster { position: absolute; inset: 0; width: 100%; height: 100%; }
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
