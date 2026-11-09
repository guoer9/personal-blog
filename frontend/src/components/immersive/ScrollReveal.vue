<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { pageScrollKey, type PageScrollFrame } from '@/graphics/runtime/pageScroll'

const props = withDefaults(defineProps<{ delay?: number; scroll?: boolean }>(), { delay: 0, scroll: false })
const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
const pageScroll = inject(pageScrollKey, null)
let unsubscribe: (() => void) | undefined
let offset = 0

function update(frame: PageScrollFrame) {
  if (!root.value) return
  const top = root.value.getBoundingClientRect().top - offset
  const p = Math.max(0, Math.min(1, (frame.viewportHeight * 0.96 - top - props.delay * 0.18) / (frame.viewportHeight * 0.34)))
  const eased = p * p * (3 - 2 * p)
  offset = (1 - eased) * 28
  root.value.style.setProperty('--scroll-reveal', String(eased))
  root.value.style.setProperty('--scroll-rise', `${offset}px`)
}

onMounted(() => {
  if (!root.value) return
  if (props.scroll && pageScroll) {
    root.value.dataset.scrollDriven = 'true'
    offset = 28
    update(pageScroll.current)
    unsubscribe = pageScroll.subscribe(update)
    pageScroll.invalidate()
    if (typeof ResizeObserver === 'function') {
      // Local content changes also invalidate the shared frame. Upstream shifts
      // are reported by the page's layout observer, not a second animation loop.
      resizeObserver = new ResizeObserver(() => pageScroll.invalidate())
      resizeObserver.observe(root.value)
    }
    return
  }
  if (!('IntersectionObserver' in window)) {
    root.value.dataset.revealed = 'true'
    return
  }
  observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return
    root.value!.dataset.revealed = 'true'
    observer?.disconnect()
    observer = null
  }, { threshold: 0.12 })
  observer.observe(root.value)
})

onBeforeUnmount(() => { observer?.disconnect(); resizeObserver?.disconnect(); unsubscribe?.() })
</script>

<template>
  <div ref="root" class="scroll-reveal" :style="{ '--reveal-delay': `${delay}ms` }">
    <slot />
  </div>
</template>

<style scoped>
.scroll-reveal {
  opacity: 0;
  transform: translateY(26px);
  transition: opacity 700ms cubic-bezier(0.22, 1, 0.36, 1), transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: var(--reveal-delay);
}
.scroll-reveal[data-revealed='true'] { opacity: 1; transform: none; }
.scroll-reveal[data-scroll-driven='true'] {
  opacity: var(--scroll-reveal, 0);
  transform: translateY(var(--scroll-rise, 28px));
  transition: none;
}
</style>
