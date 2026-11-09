<script setup lang="ts">
import { computed, useId } from 'vue'
import { signatureOutline, signatureStrokes, signatureViewBox } from './chenGuoSignatureData'

const props = defineProps<{ progress: number }>()
const maskId = `signature-ink-${useId()}`
let totalLength = 0
const timedStrokes = signatureStrokes.map((stroke) => {
  const start = totalLength
  totalLength += stroke.length
  return { ...stroke, start }
})
const drawing = computed(() => {
  const progress = Number.isFinite(props.progress) ? Math.min(1, Math.max(0, props.progress)) : 0
  const distance = progress * totalLength
  return timedStrokes.map((stroke) => ({ ...stroke, drawn: Math.min(1, Math.max(0, (distance - stroke.start) / stroke.length)) }))
})
</script>

<template>
  <svg class="chen-guo-signature" xmlns="http://www.w3.org/2000/svg" :viewBox="signatureViewBox" width="1470" height="600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="陈果签名">
    <defs>
      <mask :id="maskId" maskUnits="userSpaceOnUse" x="-18" y="60" width="1470" height="600" style="mask-type: luminance">
        <path v-for="(stroke, index) in drawing" :key="index" class="signature-pen" :d="stroke.d" fill="none" stroke="white" :stroke-width="stroke.width" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1" :stroke-dashoffset="1 - stroke.drawn" :opacity="stroke.drawn > 0 ? 1 : 0" />
      </mask>
    </defs>
    <path class="signature-ink" :d="signatureOutline" fill="var(--acid, #c7ff2e)" fill-rule="evenodd" :mask="`url(#${maskId})`" />
  </svg>
</template>

<style scoped>
.chen-guo-signature { display: block; width: 100%; height: auto; }
</style>
