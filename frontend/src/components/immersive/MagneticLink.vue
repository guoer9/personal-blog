<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{ href: string; external?: boolean }>(), { external: false })

const root = ref<HTMLAnchorElement | null>(null)

function onPointerMove(event: PointerEvent) {
  if (!root.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const rect = root.value.getBoundingClientRect()
  const x = event.clientX - rect.left - rect.width / 2
  const y = event.clientY - rect.top - rect.height / 2
  root.value.style.transform = `translate3d(${x * 0.12}px, ${y * 0.12}px, 0)`
}

function reset() {
  if (root.value) root.value.style.transform = ''
}
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
    @blur="reset"
  >
    <span><slot /></span>
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
  transition: transform 180ms ease, border-color 180ms ease;
}

.magnetic-link:hover { border-color: var(--electric-blue); }
.magnetic-link:focus-visible { outline: 3px solid var(--electric-blue); outline-offset: 4px; }
.magnetic-arrow { font-family: var(--body-font); font-size: 1.25rem; line-height: 1; }
</style>
