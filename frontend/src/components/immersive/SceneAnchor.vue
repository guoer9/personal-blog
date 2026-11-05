<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'

const props = defineProps<{ id: string; class?: string }>()
const element = ref<HTMLElement | null>(null)
const runtime = inject(visualRuntimeKey, ref<VisualRuntimeBridge | null>(null))
let unregister: (() => void) | null = null

function registerAnchor() {
  unregister?.()
  unregister = null
  if (!runtime.value || !element.value) return
  unregister = runtime.value.registerAnchor?.(props.id, element.value) ?? null
  runtime.value.measureAnchors?.()
}

watch(runtime, registerAnchor, { flush: 'post' })
onMounted(registerAnchor)
onBeforeUnmount(() => unregister?.())
</script>

<template><div ref="element" :class="props.class"><slot /></div></template>
