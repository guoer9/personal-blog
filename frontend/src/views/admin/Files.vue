<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getFiles, uploadFile, deleteFile, type FileInfo } from '@/api/files'
import { formatDate, formatFileSize } from '@/utils/format'
import { confirmAction, showError, showSuccess } from '@/ui/feedback'
import type { UploadProps } from 'element-plus'

const files = ref<FileInfo[]>([])
const loading = ref(false)
const uploading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

async function fetchFiles() {
  loading.value = true
  try {
    const response = await getFiles({
      page: currentPage.value,
      page_size: pageSize.value,
    })
    files.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    console.error('获取文件列表失败', error)
  } finally {
    loading.value = false
  }
}

const handleUpload: UploadProps['beforeUpload'] = async (file) => {
  uploading.value = true
  try {
    await uploadFile(file)
    await showSuccess('上传成功')
    fetchFiles()
  } catch (error: any) {
    await showError(error.response?.data?.detail || '上传失败')
  } finally {
    uploading.value = false
  }
  return false // 阻止默认上传
}

async function handleDelete(file: FileInfo) {
  try {
    if (!await confirmAction(`确定要删除文件 "${file.original_name}" 吗？`, '删除确认')) return
    
    await deleteFile(file.id)
    await showSuccess('删除成功')
    fetchFiles()
  } catch (error: any) {
    await showError('删除失败')
  }
}

function copyUrl(file: FileInfo) {
  const url = `/uploads/${file.filename}`
  navigator.clipboard.writeText(url)
  void showSuccess('已复制到剪贴板')
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchFiles()
}

function isImage(file: FileInfo): boolean {
  return file.mime_type?.startsWith('image/') || false
}

onMounted(() => {
  fetchFiles()
})
</script>

<template>
  <div class="files-page">
    <div class="page-header">
      <h1 class="page-title">文件管理</h1>
      <el-upload
        :before-upload="handleUpload"
        :show-file-list="false"
      >
        <el-button type="primary" :loading="uploading">
          <el-icon><Upload /></el-icon>
          上传文件
        </el-button>
      </el-upload>
    </div>
    
    <el-card shadow="never">
      <el-table :data="files" v-loading="loading" stripe>
        <el-table-column label="预览" width="80">
          <template #default="{ row }">
            <el-image
              v-if="isImage(row)"
              :src="`/uploads/${row.filename}`"
              :preview-src-list="[`/uploads/${row.filename}`]"
              fit="cover"
              style="width: 50px; height: 50px; border-radius: 4px"
            />
            <el-icon v-else size="24" color="#909399"><Document /></el-icon>
          </template>
        </el-table-column>
        
        <el-table-column prop="original_name" label="文件名" min-width="200">
          <template #default="{ row }">
            <a :href="`/uploads/${row.filename}`" target="_blank">
              {{ row.original_name }}
            </a>
          </template>
        </el-table-column>
        
        <el-table-column prop="size" label="大小" width="100">
          <template #default="{ row }">
            {{ formatFileSize(row.size) }}
          </template>
        </el-table-column>
        
        <el-table-column prop="mime_type" label="类型" width="150" />
        
        <el-table-column prop="created_at" label="上传时间" width="150">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="copyUrl(row)">
              复制链接
            </el-button>
            <el-button text type="danger" size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.files-page {
  max-width: 1200px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--admin-text);
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
