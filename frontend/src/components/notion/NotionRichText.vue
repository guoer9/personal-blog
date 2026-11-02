<script setup lang="ts">
import type { NotionText } from '@/api/documents'
defineProps<{ text: NotionText[] }>()
function href(value: string | null) {
  if (!value) return undefined
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? value : undefined } catch { return undefined }
}
function color(value: string) { return /^(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?$/.test(value) ? 'color-' + value : '' }
</script>
<template><template v-for="(item, index) in text" :key="index"><a v-if="href(item.href)" :href="href(item.href)" target="_blank" rel="noopener noreferrer"><span :class="[color(item.color), { 'is-bold': item.bold, 'is-italic': item.italic, 'is-underline': item.underline, 'is-strike': item.strikethrough, 'is-code': item.code }]">{{ item.text }}</span></a><span v-else :class="[color(item.color), { 'is-bold': item.bold, 'is-italic': item.italic, 'is-underline': item.underline, 'is-strike': item.strikethrough, 'is-code': item.code }]">{{ item.text }}</span></template></template>
<style scoped>
span { white-space: pre-wrap; }.is-bold { font-weight: 650; }.is-italic { font-style: italic; }.is-underline { text-decoration: underline; text-underline-offset: 3px; }.is-strike { text-decoration: line-through; }.is-strike.is-underline { text-decoration: line-through underline; }.is-code { font-family: var(--mono-font, monospace); font-size: .87em; background: #eeeae5; color: #a32d42; padding: 2px 5px; border-radius: 3px; }a { color: inherit; text-decoration-color: #b6b4af; text-underline-offset: 3px; }.color-gray { color: #67645e; }.color-brown { color: #85543c; }.color-orange { color: #9e4c15; }.color-yellow { color: #86631a; }.color-green { color: #276448; }.color-blue { color: #2359a8; }.color-purple { color: #734399; }.color-pink { color: #a33a72; }.color-red { color: #b13b35; }.color-gray_background { background: #e8e7e4; }.color-brown_background { background: #eee0d7; }.color-orange_background { background: #fae2cf; }.color-yellow_background { background: #f9edc7; }.color-green_background { background: #dbece1; }.color-blue_background { background: #dce9f7; }.color-purple_background { background: #e9dff3; }.color-pink_background { background: #f3ddeb; }.color-red_background { background: #f5dfdc; }
</style>
