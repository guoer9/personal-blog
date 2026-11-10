<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAdminWorks, unpublishWork, getWorkAssetStorage, cleanupWorkAssets, type AdminWork, type WorkAssetStorage } from '@/api/works'
import { categoryLabel } from '@/data/works'
import { confirmAction } from '@/ui/feedback'
const items = ref<AdminWork[]>([])
const loading = ref(true)
const error = ref('')
const storage = ref<WorkAssetStorage | null>(null)
const cleaning = ref(false)
const notice = ref('')
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(2)
async function load() {
  loading.value = true; error.value = ''
  try { const [works, usage] = await Promise.all([getAdminWorks(), getWorkAssetStorage()]); items.value = works.data.items; storage.value = usage.data }
  catch (cause: any) { error.value = cause.response?.data?.detail || '无法读取作品，请重试。' }
  finally { loading.value = false }
}
async function clean() {
  if (cleaning.value) return
  cleaning.value = true; error.value = ''; notice.value = ''
  try { const result = (await cleanupWorkAssets()).data; storage.value = result; notice.value = `已清理 ${result.removed} 个超过24小时且未被作品引用的发布副本。` }
  catch (cause: any) { error.value = cause.response?.data?.detail || '清理失败，请重试。' }
  finally { cleaning.value = false }
}
async function withdraw(work: AdminWork) {
  if (!await confirmAction(`下架《${work.draft.title}》？草稿和原文件会保留。`, '下架作品')) return
  try { await unpublishWork(work.id, work.version); await load() }
  catch (cause: any) { error.value = cause.response?.data?.detail || '下架失败，请重试。' }
}
onMounted(load)
</script>

<template>
  <div class="admin-works">
    <header><div><h1>作品管理</h1><p>保存只改变草稿。发布后，作品才会出现在公开站点。</p></div><router-link to="/admin/works/new" class="editorial-button editorial-button--acid">新建作品</router-link></header>
    <section class="asset-storage" aria-label="发布素材空间"><p v-if="storage">发布素材：{{ gib(storage.used_bytes) }} / {{ gib(storage.quota_bytes) }} GiB</p><p>清理只删除超过24小时且未被草稿或公开版本引用的副本，私有原件保留。</p><button type="button" :disabled="cleaning" @click="clean">{{ cleaning ? '正在清理…' : '清理过期未引用副本' }}</button><p v-if="notice" role="status">{{ notice }}</p></section>
    <p v-if="error" role="alert" class="admin-error">{{ error }} <button type="button" @click="load">重新读取</button></p>
    <p v-if="loading" role="status">正在读取作品…</p>
    <p v-else-if="!items.length && !error" class="empty-works">还没有作品。点击“新建作品”，先从一张草稿卡片开始。</p>
    <div v-else class="works-table"><table><caption class="sr-only">作品草稿与发布状态</caption><thead><tr><th>作品</th><th>分类</th><th>公开状态</th><th>操作</th></tr></thead><tbody><tr v-for="work in items" :key="work.id"><td><strong>{{ work.draft.title }}</strong><small>/works/{{ work.slug }}</small></td><td>{{ categoryLabel(work.draft.category) }}</td><td><span :class="{ published: work.published }">{{ work.published ? '已发布' : '草稿 / 未公开' }}</span><small v-if="work.published && JSON.stringify(work.draft) !== JSON.stringify(work.published)">有未发布的修改</small></td><td><router-link :to="`/admin/works/${work.id}/edit`">编辑与预览</router-link><a v-if="work.published" :href="`/works/${work.slug}`" target="_blank" rel="noopener noreferrer">查看公开页 ↗</a><button v-if="work.published" type="button" @click="withdraw(work)">下架</button></td></tr></tbody></table></div>
  </div>
</template>

<style scoped>
.admin-works { max-width: 1200px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 25px; margin-bottom: 30px; }
h1 { font-size: 1.6rem; margin-bottom: 10px; }
header p, .empty-works { color: var(--admin-muted); font-size: .9rem; }
.works-table { overflow-x: auto; background: var(--admin-surface); }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: 20px; border-bottom: 1px solid var(--admin-border-soft); vertical-align: top; }
td small { display: block; margin-top: 6px; color: var(--admin-muted); }
td:last-child > * { display: inline-block; margin: 0 16px 8px 0; }
td button { color: var(--admin-text); background: var(--admin-surface); border: 1px solid var(--admin-border); padding: 3px 12px; cursor: pointer; }
.published { color: var(--admin-success); }
.admin-error { padding: 16px; color: var(--admin-danger); background: var(--admin-danger-bg); }
.asset-storage { padding: 16px; margin-bottom: 20px; background: var(--admin-surface); font-size: .85rem; }.asset-storage p { margin-bottom: 8px; }.asset-storage button { color: var(--admin-text); background: var(--admin-surface-raised); padding: 7px 12px; border: 1px solid var(--admin-border); cursor: pointer; }
@media (max-width: 650px) { header { align-items: flex-start; flex-direction: column; } }
</style>
