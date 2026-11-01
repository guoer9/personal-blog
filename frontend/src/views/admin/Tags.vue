<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getTags, createTag, deleteTag, type Tag } from '@/api/tags'
import { confirmAction, showError, showSuccess, showWarning } from '@/ui/feedback'

const tags = ref<Tag[]>([])
const loading = ref(false)
const newTagName = ref('')
const creating = ref(false)

async function fetchTags() {
  loading.value = true
  try {
    const response = await getTags()
    tags.value = response.data
  } catch (error) {
    console.error('获取标签失败', error)
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!newTagName.value.trim()) {
    await showWarning('请输入标签名称')
    return
  }
  
  creating.value = true
  try {
    await createTag({ name: newTagName.value.trim() })
    await showSuccess('创建成功')
    newTagName.value = ''
    fetchTags()
  } catch (error: any) {
    await showError(error.response?.data?.detail || '创建失败')
  } finally {
    creating.value = false
  }
}

async function handleDelete(tag: Tag) {
  try {
    if (!await confirmAction(`确定要删除标签"${tag.name}"吗？`, '删除确认')) return
    
    await deleteTag(tag.id)
    await showSuccess('删除成功')
    fetchTags()
  } catch (error: any) {
    await showError('删除失败')
  }
}

onMounted(() => {
  fetchTags()
})
</script>

<template>
  <div class="tags-page">
    <div class="page-header">
      <h1 class="page-title">标签管理</h1>
    </div>
    
    <el-card shadow="never">
      <div class="create-form">
        <el-input
          v-model="newTagName"
          placeholder="输入新标签名称"
          style="width: 200px"
          @keyup.enter="handleCreate"
        />
        <el-button type="primary" :loading="creating" @click="handleCreate">
          <el-icon><Plus /></el-icon>
          添加标签
        </el-button>
      </div>
      
      <el-divider />
      
      <div v-loading="loading" class="tags-list">
        <el-tag
          v-for="tag in tags"
          :key="tag.id"
          size="large"
          closable
          @close="handleDelete(tag)"
          class="tag-item"
        >
          {{ tag.name }}
        </el-tag>
        
        <el-empty v-if="!loading && tags.length === 0" description="暂无标签" />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.tags-page {
  max-width: 800px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.create-form {
  display: flex;
  gap: 12px;
  align-items: center;
}

.tags-list {
  min-height: 100px;
}

.tag-item {
  margin-right: 12px;
  margin-bottom: 12px;
}
</style>
