<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { profile } from '@/data/portfolio'
import { portraitAssets, type PortraitMode } from '@/graphics/scenes/home/portraitAssets'
import SceneAnchor from './SceneAnchor.vue'

const props = withDefaults(defineProps<{ alt?: string; progress?: number; paused?: boolean; mode?: PortraitMode }>(), {
  progress: 0,
  paused: false,
  mode: 'front',
})
const asset = computed(() => portraitAssets[props.mode])
const portraitReady = ref(false)
const runtimeFailed = ref(false)
const showPoster = computed(() => props.paused || !portraitReady.value || runtimeFailed.value)
let observer: MutationObserver | null = null

onMounted(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('.visual-runtime-canvas')
  if (!canvas) return
  const readState = () => {
    portraitReady.value = canvas.dataset.portraitState === 'ready'
    runtimeFailed.value = canvas.dataset.runtimeFailed === 'true'
  }
  readState()
  observer = new MutationObserver(readState)
  observer.observe(canvas, { attributes: true, attributeFilter: ['data-portrait-state', 'data-runtime-failed'] })
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <SceneAnchor id="home-portrait" class="immersive-scene" :data-portrait="mode" :data-render-state="showPoster ? 'poster' : 'webgl'" :style="{ '--scene-progress': progress }">
    <div v-show="showPoster" class="portrait-poster">
      <img :src="asset.preview" :alt="alt || asset.alt" :width="asset.width" :height="asset.height" fetchpriority="high" decoding="async" />
    </div>
    <p class="portrait-description sr-only">{{ alt || asset.alt }} 移动指针可显露贝斯构图，向下滚动时两个视图会自然交融。</p>
    <div class="scene-caption">
      <span v-if="asset.isDemo" class="demo-label">人物习作 <span>/</span> 非本人照片</span>
      <span v-else>{{ profile.name }} / {{ asset.label }}</span>
      <span class="scene-caption__pointer" aria-hidden="true">MOVE TO REVEAL ↗</span>
    </div>
  </SceneAnchor>
</template>

<style scoped>
.immersive-scene { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; isolation: isolate; pointer-events: none; }
.portrait-poster { position: absolute; top: 50%; left: 50%; width: calc(100% - (100% - min(566px, 100%)) * var(--hero-eased, 0)); height: calc(100% - (100% - min(366px, 42svh)) * var(--hero-eased, 0)); transform: translate(-50%, -50%); z-index: 1; pointer-events: none; }
.portrait-poster img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }
.scene-caption { position: absolute; z-index: 4; top: 130px; right: 5.5%; display: flex; flex-direction: column; align-items: flex-end; gap: 9px; color: var(--muted); font: .53rem var(--mono-font); letter-spacing: .04em; opacity: var(--intro-opacity, 1); transform: translateY(var(--intro-rise, 0px)); }
.demo-label { font-size: .58rem; letter-spacing: .05em; }
.demo-label > span { margin: 0 5px; opacity: .4; }
.scene-caption__pointer { color: var(--acid); font-size: .48rem; letter-spacing: .09em; }
@media (max-width:760px) {
  .portrait-poster { width: calc(100% - (100% - min(400px, 86vw)) * var(--hero-eased, 0)); height: calc(100% - (100% - min(380px, 42svh)) * var(--hero-eased, 0)); }
  .portrait-poster img { object-fit: contain; object-position: center; }
  .scene-caption { top: 100px; right: 22px; }
  .demo-label { font-size: .5rem; }
}
@media (pointer:coarse) { .scene-caption__pointer { display:none; } }
</style>
