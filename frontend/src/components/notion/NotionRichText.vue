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
span { white-space: pre-wrap; }
.is-bold { font-weight: 650; }
.is-italic { font-style: italic; }
.is-underline { text-decoration: underline; text-underline-offset: 3px; }
.is-strike { text-decoration: line-through; }
.is-strike.is-underline { text-decoration: line-through underline; }
.is-code { font-family: var(--mono-font, monospace); font-size: .87em; background: var(--notion-inline-code-background, #eeeae5); color: var(--notion-inline-code, #a32d42); padding: 2px 5px; border-radius: 3px; }
a { color: var(--notion-block-color, var(--notion-link, inherit)); text-decoration-color: var(--notion-link-underline, #b6b4af); text-underline-offset: 3px; }
.color-gray { color: var(--notion-gray, #67645e); }
.color-brown { color: var(--notion-brown, #85543c); }
.color-orange { color: var(--notion-orange, #9e4c15); }
.color-yellow { color: var(--notion-yellow, #86631a); }
.color-green { color: var(--notion-green, #276448); }
.color-blue { color: var(--notion-blue, #2359a8); }
.color-purple { color: var(--notion-purple, #734399); }
.color-pink { color: var(--notion-pink, #a33a72); }
.color-red { color: var(--notion-red, #b13b35); }
.color-gray_background { background: var(--notion-gray-background, #e8e7e4); }
.color-brown_background { background: var(--notion-brown-background, #eee0d7); }
.color-orange_background { background: var(--notion-orange-background, #fae2cf); }
.color-yellow_background { background: var(--notion-yellow-background, #f9edc7); }
.color-green_background { background: var(--notion-green-background, #dbece1); }
.color-blue_background { background: var(--notion-blue-background, #dce9f7); }
.color-purple_background { background: var(--notion-purple-background, #e9dff3); }
.color-pink_background { background: var(--notion-pink-background, #f3ddeb); }
.color-red_background { background: var(--notion-red-background, #f5dfdc); }
</style>
