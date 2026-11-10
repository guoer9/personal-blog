<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { createWork, getAdminWork, openPreviewSession, prepareWorkAsset, previewWork, publishWork, saveWork, unpublishWork, type AdminWork, type WorkDraft } from '@/api/works'
import request from '@/utils/request'
import type { Work } from '@/data/works'
import WorkPlayer from '@/components/works/WorkPlayer.vue'
import WorkCard from '@/components/works/WorkCard.vue'

interface LibraryItem { id: string; name: string; kind: 'file' | 'folder'; parent_id: string | null; size: number; mime_type: string | null }
const route = useRoute()
const router = useRouter()
const empty = (): WorkDraft => ({ title: '', category: 'code', caption: '', description: '', tags: [], accent: 'paper', repository: null, externalWatch: null, notes: [], featured: false, sort_order: 0, cover_asset_id: null, video_asset_id: null, audio_asset_id: null })
const form = ref<WorkDraft>(empty())
const slug = ref('')
const record = ref<AdminWork | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const saved = ref(JSON.stringify(empty()))
const preview = ref<Work | null>(null)
const tagsText = computed({ get: () => form.value.tags.join(', '), set: (value: string) => { form.value.tags = value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) } })
const notesText = computed({ get: () => form.value.notes.join('\n'), set: (value: string) => { form.value.notes = value.split('\n').map((item) => item.trim()).filter(Boolean) } })
const dirty = computed(() => JSON.stringify(form.value) !== saved.value)
const canEdit = ref(true)
const conflict = ref(false)
let sequence = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined

function explain(cause: any) { const detail = cause.response?.data?.detail; return typeof detail === 'string' ? detail : '操作失败，请检查表单或连接后重试。' }
const copyDraft = (value: WorkDraft): WorkDraft => JSON.parse(JSON.stringify(value))
function setRecord(value: AdminWork) { record.value = value; slug.value = value.slug; form.value = copyDraft(value.draft); saved.value = JSON.stringify(value.draft) }
async function load() {
  const current = ++sequence
  loading.value = true; error.value = ''; conflict.value = false; preview.value = null
  if (!route.params.id) { record.value = null; form.value = empty(); slug.value = ''; saved.value = JSON.stringify(form.value); loading.value = false; canEdit.value = true; return }
  try { const response = await getAdminWork(String(route.params.id)); if (current === sequence) { setRecord(response.data); canEdit.value = true } }
  catch (cause) { if (current === sequence) { error.value = explain(cause); canEdit.value = false } }
  finally { if (current === sequence) loading.value = false }
}
async function save() {
  if (!form.value.title.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value)) { error.value = '请填写标题和英文短链（小写字母、数字、连字符）。'; return false }
  const data = copyDraft(form.value)
  const response = record.value ? await saveWork(record.value.id, record.value.version, data) : await createWork(slug.value, data)
  setRecord(response.data)
  return true
}
async function perform(action: 'save' | 'preview' | 'publish' | 'unpublish') {
  if (busy.value || loading.value || !canEdit.value) return
  busy.value = true; error.value = ''; message.value = ''; preview.value = null
  try {
    if (action === 'unpublish') {
      if (record.value) { const result = await unpublishWork(record.value.id, record.value.version); record.value = result.data; message.value = '作品已下架，草稿和原文件保留。' }
      return
    }
    if (!await save()) return
    if (action === 'publish') { const response = await publishWork(record.value!.id, record.value!.version); setRecord(response.data); message.value = '已发布，公开站点将读取这个版本。' }
    else if (action === 'preview') { await openPreviewSession(); preview.value = (await previewWork(record.value!.id)).data; clearTimeout(previewTimer); previewTimer = setTimeout(() => { preview.value = null; message.value = '预览已到期，请再次点击预览。' }, 290000) }
    else message.value = '草稿已保存，公开版本保持不变。'
    if (route.name === 'AdminWorkCreate') await router.replace(`/admin/works/${record.value!.id}/edit`)
  } catch (cause: any) { error.value = explain(cause); conflict.value = cause.response?.status === 409 }
  finally { busy.value = false }
}

const picking = ref<'cover' | 'video' | 'audio' | null>(null)
const pickerItems = ref<LibraryItem[]>([])
const pickerParents = ref<Array<{ id: string | null; name: string }>>([{ id: null, name: '文件库根目录' }])
const pickerLoading = ref(false)
async function pick(role: 'cover' | 'video' | 'audio') { picking.value = role; pickerParents.value = [{ id: null, name: '文件库根目录' }]; await listFolder(null) }
async function listFolder(id: string | null) {
  pickerLoading.value = true
  try { pickerItems.value = (await request.get<{ items: LibraryItem[] }>('/library/entries', { params: id ? { parent_id: id } : {}, suppressErrorToast: true })).data.items }
  catch (cause) { error.value = explain(cause) }
  finally { pickerLoading.value = false }
}
async function into(item: LibraryItem) { pickerParents.value.push({ id: item.id, name: item.name }); await listFolder(item.id) }
async function back(index: number) { pickerParents.value = pickerParents.value.slice(0, index + 1); await listFolder(pickerParents.value[index]!.id) }
async function select(item: LibraryItem) {
  if (!picking.value || busy.value) return
  busy.value = true; error.value = ''
  const role = picking.value
  try { const response = await prepareWorkAsset(item.id, role); form.value[`${role}_asset_id`] = response.data.id; preview.value = null; picking.value = null; message.value = `${item.name} 已准备为发布素材，保存或发布前仍不会公开。` }
  catch (cause) { error.value = explain(cause) }
  finally { busy.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) event.preventDefault() }
function reloadDraft() { if (!dirty.value || window.confirm('放弃本地修改并重新载入草稿？')) void load() }
window.addEventListener('beforeunload', beforeUnload)
onBeforeRouteLeave((to) => {
  const openingSavedDraft = route.name === 'AdminWorkCreate' && to.name === 'AdminWorkEdit' && to.params.id === record.value?.id && !dirty.value
  if (busy.value && !openingSavedDraft) return false
  if (dirty.value) return window.confirm('草稿有未保存的修改，确定离开？')
})
watch(() => route.params.id, (id) => { if (id && id === record.value?.id) return; void load() }, { immediate: true })
onBeforeUnmount(() => { sequence++; clearTimeout(previewTimer); window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <div class="work-editor">
    <router-link to="/admin/works">← 返回作品管理</router-link>
    <header><div><h1>{{ record ? '编辑作品' : '新建作品' }}</h1><p>{{ record?.published ? '已有公开版本；保存草稿不会改变访客看到的内容。' : '这是一份草稿，发布前仅管理员可见。' }}</p></div><a v-if="record?.published" :href="`/works/${record.slug}`" target="_blank" rel="noopener noreferrer">查看公开页 ↗</a></header>
    <p v-if="loading" role="status">正在读取草稿…</p>
    <p v-if="error" class="editor-error" role="alert">{{ error }} <button v-if="!canEdit || conflict" type="button" @click="reloadDraft">重新载入草稿</button></p>
    <p v-if="message" class="editor-message" role="status">{{ message }}</p>
    <form @submit.prevent="perform('save')"><fieldset :disabled="loading || busy || !canEdit">
      <div class="form-grid"><label>作品标题<input v-model="form.title" required maxlength="150" /></label><label>英文短链<input v-model="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" :disabled="!!record" maxlength="100" placeholder="例如 line-time-03" /><small>创建后固定，用于 /works/短链</small></label><label>分类<select v-model="form.category"><option value="code">代码</option><option value="film">影像</option><option value="music">音乐</option></select></label><label>副标题<input v-model="form.caption" maxlength="150" placeholder="例如 Original music / 2026" /></label><label class="span-two">作品简介<textarea v-model="form.description" rows="3" maxlength="2000" /></label><label>标签（逗号分隔）<input v-model="tagsText" /></label><label>卡片颜色<select v-model="form.accent"><option value="paper">纸白</option><option value="lime">青柠</option><option value="blue">电光蓝</option></select></label><label>代码仓库 HTTPS 地址<input v-model="form.repository" type="url" placeholder="https://github.com/…" /></label><label>外站观看 HTTPS 地址<input v-model="form.externalWatch" type="url" placeholder="https://www.bilibili.com/video/…" /></label><label class="span-two">作品说明（每行一段）<textarea v-model="notesText" rows="4" /></label><label>排序（数字越小越靠前）<input v-model.number="form.sort_order" type="number" min="-10000" max="10000" /></label><label class="check-label"><input v-model="form.featured" type="checkbox" />在首页精选展示</label></div>
      <section class="asset-settings" aria-labelledby="asset-title"><h2 id="asset-title">发布素材</h2><p>先到<router-link to="/admin/library">私有文件库</router-link>上传文件，再在这里选择。视频需 MP4（H.264/AAC），音乐需 M4A/MP3；原始 MOV 留在私有库。</p><div v-for="role in (['cover', 'video', 'audio'] as const)" :key="role" class="asset-row"><span>{{ role === 'cover' ? '封面' : role === 'video' ? '视频' : '音频' }}</span><code>{{ form[`${role}_asset_id`] ? '已准备素材 ' + form[`${role}_asset_id`]?.slice(0, 8) : '尚未选择' }}</code><button type="button" @click="pick(role)">从文件库选择</button><button v-if="form[`${role}_asset_id`]" type="button" @click="form[`${role}_asset_id`] = null; preview = null">移除引用</button></div></section>
      <div class="editor-actions"><button type="submit" class="editorial-button">保存草稿</button><button type="button" class="editorial-button" @click="perform('preview')">保存并预览</button><button type="button" class="editorial-button editorial-button--acid" @click="perform('publish')">{{ record?.published ? '发布更新' : '发布作品' }}</button><button v-if="record?.published" type="button" class="editorial-button" @click="perform('unpublish')">下架作品</button></div>
    </fieldset></form>
    <p v-if="busy" role="status">正在处理，请稍候…</p>
    <section v-if="picking" class="asset-picker" aria-labelledby="picker-title"><header><h2 id="picker-title">选择{{ picking === 'cover' ? '封面' : picking === 'video' ? '视频' : '音频' }}</h2><button type="button" :disabled="busy" @click="picking = null">关闭选择</button></header><nav aria-label="素材文件夹"><button v-for="(parent, index) in pickerParents" :key="parent.id || 'root'" type="button" :disabled="busy" @click="back(index)">{{ parent.name }} /</button></nav><p v-if="pickerLoading">正在读取文件夹…</p><p v-else-if="!pickerItems.length">这个文件夹没有文件，请先到私有文件库上传。</p><ul><li v-for="item in pickerItems" :key="item.id"><span>{{ item.kind === 'folder' ? '文件夹' : '文件' }}</span><strong>{{ item.name }}</strong><button type="button" :disabled="busy" @click="item.kind === 'folder' ? into(item) : select(item)">{{ item.kind === 'folder' ? '打开文件夹' : '选择并准备' }}</button></li></ul></section>
    <section v-if="preview" class="draft-preview" aria-labelledby="preview-title"><header><h2 id="preview-title">草稿预览 · 仅自己可见</h2><button type="button" @click="preview = null">关闭预览</button></header><div class="preview-card"><WorkCard :work="preview" :index="0" preview-mode /></div><WorkPlayer v-if="preview.video || preview.audio" :key="JSON.stringify(preview)" :work="preview" /><p v-for="note in preview.notes" :key="note">{{ note }}</p></section>
  </div>
</template>

<style scoped>
.work-editor { max-width: 1100px; }
header { display: flex; justify-content: space-between; align-items: start; gap: 25px; margin: 26px 0; }
h1 { font-size: 1.6rem; margin-bottom: 10px; } header p, small, .asset-settings > p { color: var(--admin-muted); font-size: .85rem; }
fieldset { min-width: 0; padding: 25px; border: 1px solid var(--admin-border-soft); background: var(--admin-surface); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.form-grid label { display: flex; flex-direction: column; align-items: stretch; gap: 8px; font-size: .9rem; }
.form-grid input, .form-grid textarea, .form-grid select { min-width: 0; width: 100%; padding: 9px 12px; border: 1px solid var(--admin-border); background: var(--admin-surface); color: var(--admin-text); border-radius: 0; }
.form-grid .check-label { flex-direction: row; align-items: center; }.check-label input { width: auto; }
.span-two { grid-column: 1 / -1; }
.asset-settings { margin-top: 35px; padding-top: 25px; border-top: 1px solid var(--admin-border-soft); }
h2 { font-size: 1.15rem; }
.asset-row { display: flex; flex-wrap: wrap; align-items: center; gap: 15px; padding: 12px 0; border-bottom: 1px solid var(--admin-border-soft); }
.asset-row code { font-size: .75rem; }
.asset-row button, .asset-picker button, .draft-preview header button { color: var(--admin-text); padding: 7px 12px; border: 1px solid var(--admin-border); background: var(--admin-surface); cursor: pointer; }
.editor-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }.editor-actions button { cursor: pointer; }
.editor-error, .editor-message { padding: 15px; overflow-wrap: anywhere; }.editor-error { background: var(--admin-danger-bg); color: var(--admin-danger); }.editor-message { background: var(--admin-success-bg); color: var(--admin-success); }
.asset-picker, .draft-preview { margin-top: 30px; padding: 25px; border: 1px solid var(--admin-border); background: var(--paper); }.asset-picker ul { list-style: none; padding: 0; }.asset-picker li { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 15px 0; border-bottom: 1px solid var(--admin-border-soft); }.asset-picker li > strong { flex: 1; overflow-wrap: anywhere; }.asset-picker nav { display: flex; flex-wrap: wrap; gap: 7px; }.preview-card { max-width: 480px; margin-bottom: 30px; }
@media (max-width: 750px) { .form-grid { grid-template-columns: 1fr; }.span-two { grid-column: auto; } fieldset { padding: 18px; } }
</style>
