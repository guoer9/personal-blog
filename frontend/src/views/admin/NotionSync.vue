<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AddConnection from '@/components/notion/AddConnection.vue'
import {
  getNotionConnections, getNotionSources, getNotionStatus, inspectNotionSource,
  importNotionSource, syncNotionSource, inspectNotionPage, importNotionPage, browseNotionWorkspace,
  type NotionConnection, type NotionSource, type NotionPreview, type NotionLibraryStatus, type NotionWorkspaceItem,
} from '@/api/notion'

const connections = ref<NotionConnection[]>([])
const sources = ref<NotionSource[]>([])
const status = ref<NotionLibraryStatus | null>(null)
const connectionId = ref('')
const sourceUrl = ref('')
const preview = ref<NotionPreview | null>(null)
const confirmed = ref(false)
const pageSource = ref<NotionSource | null>(null)
const pageUrl = ref('')
const pagePreview = ref<NotionPreview | null>(null)
const pageConfirmed = ref(false)
const directory = ref<NotionWorkspaceItem[]>([])
const nextCursor = ref<string | null>(null)
const directoryLoaded = ref(false)
const directoryQuery = ref('')
const loading = ref(true)
const busy = ref('')
const error = ref('')
const notice = ref('')
const lifecycle = new AbortController()
let inspectController: AbortController | null = null
let directoryController: AbortController | null = null
const mutating = computed(() => busy.value.startsWith('import') || busy.value.startsWith('sync'))
const available = computed(() => connections.value.some(item => item.id === connectionId.value && item.configured))
const canInspect = computed(() => available.value && sourceUrl.value.trim() && !busy.value && !loading.value)
const labels: Record<string, string> = { queried: '检查', published: '公开', updated: '更新', isolated: '隔离', archived: '归档', unpublished: '下架', skipped: '跳过', failed: '失败' }

function readableError(cause: unknown) {
  const detail = (cause as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : '操作未完成。请刷新状态后重试；已经提交的导入可能仍在服务器执行。'
}
function invalidatePreview() {
  inspectController?.abort()
  preview.value = null; confirmed.value = false
  pagePreview.value = null; pageConfirmed.value = false
  if (busy.value.startsWith('inspect')) busy.value = ''
}
watch([connectionId, sourceUrl, pageUrl, pageSource], invalidatePreview, { flush: 'sync' })
watch(connectionId, () => {
  directoryController?.abort(); directory.value = []; nextCursor.value = null; directoryLoaded.value = false
  if (busy.value === 'browse') busy.value = ''
}, { flush: 'sync' })
watch(directoryQuery, () => {
  directoryController?.abort(); directory.value = []; nextCursor.value = null; directoryLoaded.value = false
  if (busy.value === 'browse') busy.value = ''
}, { flush: 'sync' })
async function refresh() {
  if (loading.value && connections.value.length) return
  loading.value = true; error.value = ''
  const result = await Promise.allSettled([getNotionConnections(lifecycle.signal), getNotionSources(lifecycle.signal), getNotionStatus(lifecycle.signal)])
  if (lifecycle.signal.aborted) return
  const [c, s, state] = result
  if (c.status === 'fulfilled') connections.value = c.value.data
  if (s.status === 'fulfilled') sources.value = s.value.data
  if (state.status === 'fulfilled') status.value = state.value.data
  const failure = result.find(item => item.status === 'rejected')
  if (failure?.status === 'rejected') error.value = readableError(failure.reason)
  if (!connections.value.some(item => item.id === connectionId.value && item.configured)) connectionId.value = ''
  loading.value = false
}
async function connectionCreated(connection: NotionConnection) {
  await refresh()
  if (!busy.value) connectionId.value = connection.id
}
async function browse(append = false) {
  if (!available.value || busy.value) return
  directoryController?.abort()
  const controller = new AbortController(); directoryController = controller
  busy.value = 'browse'; error.value = ''; notice.value = ''
  try {
    const response = await browseNotionWorkspace(connectionId.value, { q: directoryQuery.value.trim() || undefined, cursor: append ? nextCursor.value || undefined : undefined }, controller.signal)
    if (controller.signal.aborted) return
    const rows = append ? [...directory.value, ...response.data.items] : response.data.items
    directory.value = rows.filter((item, index) => rows.findIndex(other => other.kind === item.kind && other.id === item.id) === index)
    nextCursor.value = response.data.next_cursor; directoryLoaded.value = true
  } catch (cause) { if (!controller.signal.aborted) error.value = readableError(cause) }
  finally { if (!controller.signal.aborted) busy.value = '' }
}
async function inspect(singlePage = false) {
  if (busy.value || (!singlePage && !canInspect.value) || (singlePage && (!pageSource.value || !pageUrl.value.trim()))) return
  invalidatePreview()
  const controller = new AbortController(); inspectController = controller
  busy.value = singlePage ? 'inspect-page' : 'inspect-source'; error.value = ''; notice.value = ''
  try {
    const response = singlePage
      ? await inspectNotionPage(pageSource.value!.id, pageUrl.value.trim(), controller.signal)
      : await inspectNotionSource({ connection_id: connectionId.value, url: sourceUrl.value.trim() }, controller.signal)
    if (controller.signal.aborted || lifecycle.signal.aborted) return
    if (singlePage) pagePreview.value = response.data
    else preview.value = response.data
  } catch (cause) { if (!controller.signal.aborted) error.value = readableError(cause) }
  finally { if (!controller.signal.aborted) busy.value = '' }
}
async function mutate(action: 'import-source' | 'import-page' | 'sync', source?: NotionSource) {
  if (busy.value || loading.value) return
  if (action === 'import-source' && (!preview.value || !confirmed.value || !available.value)) return
  if (action === 'import-page' && (!pagePreview.value || !pageConfirmed.value || !pageSource.value)) return
  busy.value = action; error.value = ''; notice.value = ''
  try {
    const response = action === 'sync' ? await syncNotionSource(source!.id, lifecycle.signal)
      : action === 'import-page' ? await importNotionPage(pageSource.value!.id, pageUrl.value.trim(), lifecycle.signal)
      : await importNotionSource({ connection_id: connectionId.value, url: sourceUrl.value.trim() }, lifecycle.signal)
    if (lifecycle.signal.aborted) return
    status.value = response.data; invalidatePreview()
    notice.value = '操作完成，公开资料库已更新。'
    await refresh()
  } catch (cause) {
    if (!lifecycle.signal.aborted) { error.value = readableError(cause); invalidatePreview() }
  } finally { if (!lifecycle.signal.aborted) busy.value = '' }
}
function date(value: string | null) {
  if (!value) return '尚无记录'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '时间不可用' : parsed.toLocaleString('zh-CN')
}
onMounted(refresh)
onBeforeUnmount(() => { lifecycle.abort(); inspectController?.abort(); directoryController?.abort() })
</script>

<template>
  <section class="notion-page" aria-labelledby="notion-title" :aria-busy="loading || !!busy">
    <header class="page-header"><div><p class="eyebrow">NOTION / CONNECTIONS & LIBRARY</p><h1 id="notion-title">Notion 连接与资料库</h1><p>选择连接，浏览可访问的工作空间内容。检查预览后，明确选择要公开的页面或数据库。</p></div><a href="/documents" target="_blank" rel="noopener" class="action">查看公开资料库 ↗</a></header>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <p v-if="loading" role="status">正在读取本地连接和来源…</p>
    <fieldset class="connection-form" :disabled="loading || !!busy"><AddConnection @created="connectionCreated" /></fieldset>
    <div class="panel">
      <div class="panel-heading"><h2>1. 选择连接与内容</h2><button type="button" :disabled="loading || !!busy" @click="refresh">刷新连接</button></div>
      <p class="help">添加连接后，选择要浏览的工作空间。浏览目录和导入均由你手动触发。</p>
      <label for="notion-connection">Notion 连接</label>
      <select id="notion-connection" v-model="connectionId" :disabled="loading || mutating"><option disabled value="">请选择连接</option><option v-for="item in connections" :key="item.id" :value="item.id" :disabled="!item.configured">{{ item.label }}</option></select>
      <p v-if="!loading && !connections.some(item => item.configured)" class="notice">尚未配置可用连接。请先在上方填写连接名称和密钥，添加工作空间。</p>
      <form class="directory-search" @submit.prevent="browse(false)"><label for="notion-directory-query">工作空间标题搜索</label><input id="notion-directory-query" v-model="directoryQuery" type="search" maxlength="120" :disabled="!!busy" placeholder="留空浏览全部可访问目录" /><button type="submit" data-action="browse-workspace" :disabled="!available || !!busy || loading">{{ busy === 'browse' ? '正在读取目录…' : '浏览工作空间' }}</button></form>
      <div v-if="directoryLoaded" class="directory"><p class="help" role="status">已读取 {{ directory.length }} 项{{ nextCursor ? '，还有更多内容' : '' }}。目录范围由该连接的访问权限决定。</p><ul><li v-for="item in directory" :key="`${item.kind}-${item.id}`"><div><strong>{{ item.title || '无标题' }}</strong><small>{{ item.kind === 'database' ? '数据库' : '页面' }}</small></div><button type="button" data-action="choose-workspace-item" :disabled="!!busy" @click="sourceUrl = item.url">选择{{ item.kind === 'database' ? '数据库' : '页面' }}</button><a :href="item.url" target="_blank" rel="noopener noreferrer">在 Notion 打开 ↗</a></li></ul><p v-if="!directory.length">没有匹配内容，请检查连接授权或修改关键词。</p><button v-if="nextCursor" type="button" :disabled="!!busy" @click="browse(true)">加载更多</button></div>
      <form data-action="inspect-source" @submit.prevent="inspect(false)"><label for="notion-database-url">来源链接（数据库或独立页面）</label><div class="input-row"><input id="notion-database-url" v-model="sourceUrl" type="url" required maxlength="2048" placeholder="从目录选择，或粘贴 Notion 分享链接" :disabled="mutating" /><button type="submit" :disabled="!canInspect">{{ busy === 'inspect-source' ? '正在检查…' : '检查并预览' }}</button></div></form>
      <section v-if="preview" class="preview" data-testid="source-preview" aria-label="来源导入预览"><p class="eyebrow">2. 检查结果</p><h3>{{ preview.title }}</h3><p>{{ preview.source_type === 'page' ? '独立页面' : `${preview.data_source_count} 个数据源` }} · {{ preview.page_count }} 个页面 · {{ preview.publishable_count }} 个可公开 · {{ preview.isolated_count }} 个隔离</p><p v-if="preview.categories.length">分类：{{ preview.categories.join(' / ') }}</p><ul v-if="preview.isolated_count"><li v-for="(count, reason) in preview.isolation_reasons" :key="reason">{{ reason }}：{{ count }}</li></ul><p>确认后，所选{{ preview.import_scope === 'page' || preview.source_type === 'page' ? '页面' : '数据库内所有通过检查的页面' }}将发布到公开资料库。导入时会重新读取，数量可能变化。</p><label class="check"><input id="confirm-source" v-model="confirmed" type="checkbox" :disabled="!!busy" />我确认公开上述范围内通过检查的内容</label><button type="button" data-action="import-source" :disabled="!confirmed || !!busy" @click="mutate('import-source')">{{ busy === 'import-source' ? '正在导入…' : '确认导入并公开' }}</button></section>
    </div>
    <section class="panel" aria-labelledby="sources-title"><div class="panel-heading"><h2 id="sources-title">已注册来源</h2><span>{{ sources.length }} 个来源</span></div><p class="help">手动同步会更新内容，并下架已归档或被隔离的页面。来源读取失败会保留上次成功内容。</p><p v-if="!loading && !sources.length">还没有导入来源。从上方选择内容并检查开始。</p><ul class="sources"><li v-for="source in sources" :key="source.id"><div><h3>{{ source.title }}</h3><p>{{ source.connection_label || source.connection_id }} · {{ source.source_type === 'page' ? '独立页面' : `${source.data_source_ids.length} 个数据源` }}</p><p>最近成功：{{ date(source.last_success_at) }}</p></div><div class="source-actions"><button type="button" data-action="sync-source" :disabled="!!busy || loading || !connections.some(item => item.id === source.connection_id && item.configured)" @click="mutate('sync', source)">同步此来源</button><button v-if="source.source_type !== 'page'" type="button" data-action="open-page" :disabled="!!busy" @click="pageSource = source; pageUrl = ''">导入来源内单页</button></div></li></ul>
      <section v-if="pageSource" class="page-import"><div class="panel-heading"><h3>来源内单页 · {{ pageSource.title }}</h3><button type="button" :disabled="mutating" @click="pageSource = null">关闭</button></div><form data-action="inspect-page" @submit.prevent="inspect(true)"><label for="notion-page-url">页面链接</label><div class="input-row"><input id="notion-page-url" v-model="pageUrl" type="url" maxlength="2048" required :disabled="mutating" /><button type="submit" :disabled="!pageUrl.trim() || !!busy">检查单页</button></div></form><div v-if="pagePreview" class="preview"><p>{{ pagePreview.publishable_count }} 个可公开 · {{ pagePreview.isolated_count }} 个隔离</p><label class="check"><input id="confirm-page" v-model="pageConfirmed" type="checkbox" :disabled="!!busy" />确认导入并公开这个页面的安全内容</label><button type="button" data-action="import-page" :disabled="!pageConfirmed || !!busy" @click="mutate('import-page')">确认导入单页</button></div></section>
    </section>
    <section v-if="status" class="panel" aria-labelledby="results-title"><h2 id="results-title">最近一次操作</h2><p>状态：{{ ({ never: '尚未导入', running: '执行中', success: '成功', error: '未完成' })[status.status] }} · 最近成功：{{ date(status.last_success_at) }}</p><p v-if="status.last_error" class="notice error">{{ status.last_error }}</p><dl class="counters"><div v-for="(label, key) in labels" :key="key"><dt>{{ label }}</dt><dd>{{ status.counters[key as keyof typeof status.counters] }}</dd></div></dl></section>
  </section>
</template>

<style scoped>
.notion-page { max-width: 1100px; color: var(--admin-text); }
.connection-form { border: 0; padding: 0; margin: 0; min-width: 0; }
.page-header,.panel-heading,.input-row,.source-actions { display: flex; align-items: center; gap: 16px; }
.page-header,.panel-heading { justify-content: space-between; }
.page-header { margin-bottom: 26px; align-items: flex-start; }
h1 { font-size: 28px; margin: 6px 0 12px; } h2 { font-size: 19px; margin: 0 0 15px; } h3 { font-size: 16px; margin: 0 0 8px; }
p { line-height: 1.7; margin: 8px 0; }.eyebrow { color: var(--admin-muted); font-size: 11px; letter-spacing: .12em; }
.panel { padding: 26px; border: 1px solid var(--admin-border-soft); border-radius: 12px; background: var(--admin-surface); margin: 20px 0; }
label { display: block; font-size: 14px; margin: 16px 0 8px; } input:not([type=checkbox]),select { box-sizing: border-box; min-height: 44px; padding: 10px 12px; border: 1px solid var(--admin-border); border-radius: 6px; font: inherit; max-width: 100%; background: var(--admin-surface); color: var(--admin-text); }input:not([type=checkbox]) { width: 100%; }select { min-width: 240px; }
button,.action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; box-sizing: border-box; padding: 10px 15px; border: 1px solid var(--admin-border); background: var(--admin-surface); border-radius: 6px; color: var(--admin-text); font: inherit; font-size: 14px; text-decoration: none; cursor: pointer; flex-shrink: 0; }
button:disabled { opacity: .55; cursor: default; }button:not(:disabled):hover,.action:hover { background: var(--admin-accent-soft); } :is(button,input,select,a):focus-visible { outline: 3px solid var(--admin-accent); outline-offset: 3px; }
.help,small { color: var(--admin-muted); font-size: 13px; }code { overflow-wrap: anywhere; }.notice { padding: 14px 18px; background: var(--admin-surface-raised); border-radius: 6px; }.error { background: var(--admin-danger-bg); color: var(--admin-danger); }.success { background: var(--admin-success-bg); color: var(--admin-success); }
.preview { border-left: 4px solid var(--admin-accent); padding: 20px; background: var(--admin-surface-raised); margin-top: 22px; }.check { display: flex; align-items: flex-start; gap: 10px; line-height: 1.6; margin: 18px 0; }.check input { margin-top: 4px; min-width: 18px; height: 18px; }
.sources,.directory ul { list-style: none; padding: 0; margin: 0; }.sources > li,.directory li { display: flex; align-items: center; gap: 16px; padding: 20px 0; border-top: 1px solid var(--admin-border-soft); }.sources > li > div:first-child,.directory li > div { flex: 1; min-width: 0; overflow-wrap: anywhere; }.sources p { font-size: 13px; color: var(--admin-muted); }.source-actions { flex-wrap: wrap; }.directory li small { display: block; margin-top: 5px; }.directory li a { color: var(--admin-link); font-size: 13px; }.directory { margin: 24px 0; max-height: 470px; overflow: auto; }.directory-search button { margin-top: 12px; }.page-import { border-top: 1px solid var(--admin-border-soft); padding-top: 24px; }.counters { display: grid; grid-template-columns: repeat(8,1fr); gap: 10px; }.counters dt { font-size: 13px; color: var(--admin-muted); }.counters dd { margin: 8px 0 0; font-size: 25px; }
@media(max-width:700px) { .page-header,.input-row,.sources > li,.directory li { align-items: stretch; flex-direction: column; }.panel { padding: 18px; }.counters { grid-template-columns: repeat(4,1fr); }.page-header > .action { align-self: flex-start; }select { width: 100%; min-width: 0; }.directory li a { padding: 10px 0; } }
</style>
