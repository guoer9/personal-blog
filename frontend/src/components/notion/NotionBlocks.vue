<script setup lang="ts">
import { computed } from 'vue'
import type { NotionBlock } from '@/api/documents'
import NotionRichText from './NotionRichText.vue'
const props = defineProps<{ blocks: NotionBlock[] }>()
const groups = computed(() => {
  const result: Array<{ type: string; items: NotionBlock[] }> = []
  for (const block of props.blocks) {
    const previous = result[result.length - 1]
    if (['bulleted_list_item', 'numbered_list_item'].includes(block.type) && previous?.type === block.type) previous.items.push(block)
    else result.push({ type: block.type, items: [block] })
  }
  return result
})
function localImage(value?: string | null) { return value && /^\/api\/v1\/documents\/media\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value) ? value : undefined }
function link(value?: string) { try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : undefined } catch { return undefined } }
function plain(block: NotionBlock) { return (block.text || []).map(item => item.text).join('') }
function blockColor(value?: string) { return typeof value === 'string' && /^(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?$/.test(value) ? 'color-' + value : undefined }
const headings: Record<string, string> = { heading_1: 'h1', heading_2: 'h2', heading_3: 'h3' }
</script>

<template>
  <div class="notion-blocks">
    <template v-for="group in groups" :key="group.items[0]!.id">
      <component :is="group.type === 'numbered_list_item' ? 'ol' : 'ul'" v-if="['bulleted_list_item', 'numbered_list_item'].includes(group.type)" class="notion-list"><li v-for="block in group.items" :key="block.id" :class="blockColor(block.color)"><NotionRichText :text="block.text || []" /><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></li></component>
      <template v-else v-for="block in group.items" :key="block.id">
        <div v-if="block.type === 'paragraph'" class="notion-paragraph" :class="blockColor(block.color)"><p><NotionRichText v-if="block.text?.length" :text="block.text" /><br v-else /></p><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></div>
        <component :is="block.is_toggleable === true ? 'details' : 'div'" v-else-if="headings[block.type]" class="notion-heading" :class="[blockColor(block.color), { 'notion-toggle': block.is_toggleable === true }]">
          <summary v-if="block.is_toggleable === true"><component :is="headings[block.type]"><NotionRichText :text="block.text || []" /></component></summary>
          <component :is="headings[block.type]" v-else><NotionRichText :text="block.text || []" /></component>
          <NotionBlocks v-if="block.children?.length" :blocks="block.children" />
        </component>
        <div v-else-if="block.type === 'to_do'" class="notion-task" :class="[blockColor(block.color), { 'is-checked': block.checked }]"><label><input type="checkbox" :checked="block.checked" disabled :aria-label="plain(block) || '待办事项'" /><span><NotionRichText :text="block.text || []" /></span></label><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></div>
        <blockquote v-else-if="block.type === 'quote'" :class="blockColor(block.color)"><NotionRichText :text="block.text || []" /><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></blockquote>
        <aside v-else-if="block.type === 'callout'" class="notion-callout" :class="blockColor(block.color)"><span v-if="block.icon" class="callout-icon" aria-hidden="true">{{ block.icon }}</span><div><NotionRichText :text="block.text || []" /><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></div></aside>
        <details v-else-if="block.type === 'toggle'" class="notion-toggle" :class="blockColor(block.color)"><summary><NotionRichText :text="block.text || []" /></summary><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></details>
        <div v-else-if="block.type === 'code'" class="notion-code" :class="blockColor(block.color)"><small>{{ block.language || 'plain text' }}</small><pre tabindex="0" role="region" aria-label="代码内容"><code>{{ plain(block) }}</code></pre></div>
        <figure v-else-if="block.type === 'image' && localImage(block.url)"><img :src="localImage(block.url)" :alt="(block.caption || []).map(item => item.text).join('') || 'Notion 图片'" loading="lazy" decoding="async" /><figcaption v-if="block.caption?.length"><NotionRichText :text="block.caption" /></figcaption></figure>
        <div v-else-if="block.type === 'table'" class="notion-table" tabindex="0" role="region" aria-label="资料表格"><table><tbody><tr v-for="(row, rowIndex) in block.rows || []" :key="rowIndex"><component :is="block.has_column_header && rowIndex === 0 || block.has_row_header && cellIndex === 0 ? 'th' : 'td'" v-for="(cell, cellIndex) in row" :key="cellIndex" :scope="block.has_column_header && rowIndex === 0 ? 'col' : block.has_row_header && cellIndex === 0 ? 'row' : undefined"><NotionRichText :text="cell" /></component></tr></tbody></table></div>
        <hr v-else-if="block.type === 'divider'" />
        <div v-else-if="block.type === 'column_list' || block.type === 'column'" :class="block.type === 'column_list' ? 'notion-columns' : 'notion-column'"><NotionBlocks v-if="block.children?.length" :blocks="block.children" /></div>
        <a v-else-if="['bookmark', 'link_preview', 'embed'].includes(block.type) && link(block.url)" class="notion-bookmark" :href="link(block.url)" target="_blank" rel="noopener noreferrer"><NotionRichText v-if="block.caption?.length" :text="block.caption" /><span v-else>{{ block.url }}</span><span aria-hidden="true"> ↗</span></a>
      </template>
    </template>
  </div>
</template>

<style scoped>
.notion-blocks { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',sans-serif; font-size: 16px; line-height: 1.65; color: var(--notion-block-color, #37352f); overflow-wrap: anywhere; }.notion-blocks h1,.notion-blocks h2,.notion-blocks h3 { color: inherit; font-family: inherit; font-weight: 650; line-height: 1.35; margin: 1.7em 0 .35em; letter-spacing: -.025em; }.notion-blocks h1 { font-size: 1.875em; }.notion-blocks h2 { font-size: 1.5em; }.notion-blocks h3 { font-size: 1.25em; }.notion-paragraph > p { margin: 3px 0; min-height: 1.65em; }.notion-list { margin: 4px 0; padding-left: 1.65em; }.notion-list > li { padding: 2px 0 2px 2px; }.notion-list .notion-blocks,.notion-task > .notion-blocks { margin: 3px 0 3px 1.2em; }.notion-task { margin: 4px 0; }.notion-task label { display: flex; gap: 9px; align-items: flex-start; }.notion-task input { width: 16px; height: 16px; margin-top: 6px; accent-color: #2383e2; }.notion-task.is-checked label > span { text-decoration: line-through; color: var(--notion-block-color, #68645e); }.notion-blocks blockquote { color: inherit; margin: 14px 0; padding: 3px 16px; border-left: 3px solid #37352f; }.notion-callout { display: flex; gap: 14px; padding: 18px; border-radius: 4px; background: #efede8; margin: 15px 0; }.callout-icon { font-size: 1.3em; }.notion-toggle { margin: 5px 0; }.notion-toggle summary { cursor: pointer; padding: 3px 0; }.notion-toggle > .notion-blocks { margin-left: 25px; }.notion-code { background: #efede8; border-radius: 4px; padding: 16px 20px; margin: 14px 0; }.notion-code > small { font-size: 12px; color: #64615b; }.notion-code pre { border: 0; margin: 8px 0; padding: 0; background: transparent; font-size: .85em; line-height: 1.65; white-space: pre; overflow: auto; }.notion-code code { font-family: var(--mono-font,monospace); }.notion-blocks figure { margin: 20px 0; }.notion-blocks figure img { display: block; max-width: 100%; height: auto; margin: auto; border-radius: 2px; }.notion-blocks figcaption { color: #68645e; font-size: .85em; padding-top: 7px; }.notion-table { overflow: auto; max-width: 100%; margin: 16px 0; }.notion-table table { border-collapse: collapse; display: table; min-width: 50%; }.notion-table :is(th,td) { border: 1px solid #d9d7d0; padding: 7px 10px; min-width: 110px; text-align: left; vertical-align: top; font-weight: 400; }.notion-table th { background: #eeece7; font-weight: 600; }.notion-columns > .notion-blocks { display: flex; align-items: flex-start; gap: 28px; }.notion-columns :deep(.notion-column) { flex: 1; min-width: 0; }.notion-bookmark { display: block; border: 1px solid #d9d7d0; border-radius: 4px; padding: 16px; color: inherit; text-decoration: none; margin: 14px 0; }hr { border: 0; border-top: 1px solid #d9d7d0; margin: 20px 0; }@media(max-width:650px) { .notion-columns > .notion-blocks { display: block; }.notion-code { padding: 12px; }.notion-table table { min-width: 100%; } }
.notion-heading > summary > :is(h1,h2,h3) { display: inline; margin: 0; }
.notion-heading.notion-toggle { margin: 1.7em 0 .35em; }
/* Match NotionRichText; the inherited variable carries text color through recursive roots. */
.notion-blocks .color-gray { --notion-block-color: #67645e; color: var(--notion-block-color); }
.notion-blocks .color-brown { --notion-block-color: #85543c; color: var(--notion-block-color); }
.notion-blocks .color-orange { --notion-block-color: #9e4c15; color: var(--notion-block-color); }
.notion-blocks .color-yellow { --notion-block-color: #86631a; color: var(--notion-block-color); }
.notion-blocks .color-green { --notion-block-color: #276448; color: var(--notion-block-color); }
.notion-blocks .color-blue { --notion-block-color: #2359a8; color: var(--notion-block-color); }
.notion-blocks .color-purple { --notion-block-color: #734399; color: var(--notion-block-color); }
.notion-blocks .color-pink { --notion-block-color: #a33a72; color: var(--notion-block-color); }
.notion-blocks .color-red { --notion-block-color: #b13b35; color: var(--notion-block-color); }
.notion-blocks .color-gray_background { background: #e8e7e4; }
.notion-blocks .color-brown_background { background: #eee0d7; }
.notion-blocks .color-orange_background { background: #fae2cf; }
.notion-blocks .color-yellow_background { background: #f9edc7; }
.notion-blocks .color-green_background { background: #dbece1; }
.notion-blocks .color-blue_background { background: #dce9f7; }
.notion-blocks .color-purple_background { background: #e9dff3; }
.notion-blocks .color-pink_background { background: #f3ddeb; }
.notion-blocks .color-red_background { background: #f5dfdc; }
.notion-code pre:focus-visible { outline: 3px solid #2359a8; outline-offset: 3px; }
</style>
