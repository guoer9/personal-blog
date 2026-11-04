<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PageSceneBridge } from '@/graphics/runtime/types'
import { visualPageSceneBridgeKey } from '@/graphics/runtime/visualRuntimeHandle'

const props = defineProps<{ id: string; class?: string }>()
const element = ref<HTMLElement | null>(null)
const bridge = inject<PageSceneBridge<unknown> | null>(visualPageSceneBridgeKey, null)
let unregister: (() => void) | null = null

onMounted(() => {
  if (bridge && element.value) unregister = bridge.registerAnchor(props.id, element.value)
})
onBeforeUnmount(() => unregister?.())
</script>

<template><span ref="element" :class="props.class"><slot /></span></template>
