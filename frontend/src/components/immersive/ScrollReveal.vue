<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(defineProps<{ delay?: number }>(), { delay: 0 })
const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!root.value) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
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

onBeforeUnmount(() => observer?.disconnect())
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
@media (prefers-reduced-motion: reduce) {
  .scroll-reveal { opacity: 1; transform: none; transition: none; }
}
</style>
