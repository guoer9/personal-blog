<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getAdminPosts } from '@/api/posts'
import { getTags } from '@/api/tags'
import { getFiles } from '@/api/files'

const stats = ref({
  posts: 0,
  tags: 0,
  files: 0,
})

onMounted(async () => {
  try {
    const [postsRes, tagsRes, filesRes] = await Promise.all([
      getAdminPosts({ page: 1, page_size: 1 }),
      getTags(),
      getFiles({ page: 1, page_size: 1 }),
    ])
    
    stats.value = {
      posts: postsRes.data.total,
      tags: tagsRes.data.length,
      files: filesRes.data.total,
    }
  } catch (error) {
    console.error('获取统计数据失败', error)
  }
})
</script>

<template>
  <div class="dashboard-page">
    <h1 class="page-title">仪表盘</h1>
    
    <el-row :gutter="20">
      <el-col :xs="24" :sm="8">
        <el-card class="stat-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <el-icon size="24" color="#409eff"><Document /></el-icon>
              <span>文章数量</span>
            </div>
          </template>
          <div class="stat-value">{{ stats.posts }}</div>
        </el-card>
      </el-col>
      
      <el-col :xs="24" :sm="8">
        <el-card class="stat-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <el-icon size="24" color="#67c23a"><PriceTag /></el-icon>
              <span>标签数量</span>
            </div>
          </template>
          <div class="stat-value">{{ stats.tags }}</div>
        </el-card>
      </el-col>
      
      <el-col :xs="24" :sm="8">
        <el-card class="stat-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <el-icon size="24" color="#e6a23c"><FolderOpened /></el-icon>
              <span>文件数量</span>
            </div>
          </template>
          <div class="stat-value">{{ stats.files }}</div>
        </el-card>
      </el-col>
    </el-row>
    
    <el-card class="quick-actions" shadow="hover">
      <template #header>
        <span>快捷操作</span>
      </template>
      <el-space wrap>
        <el-button type="primary" @click="$router.push('/admin/posts/new')">
          <el-icon><Plus /></el-icon>
          写文章
        </el-button>
        <el-button @click="$router.push('/admin/posts')">
          <el-icon><Document /></el-icon>
          管理文章
        </el-button>
        <el-button @click="$router.push('/admin/files')">
          <el-icon><Upload /></el-icon>
          上传文件
        </el-button>
        <el-button @click="$router.push('/')">
          <el-icon><View /></el-icon>
          查看博客
        </el-button>
      </el-space>
    </el-card>
  </div>
</template>

<style scoped>
.dashboard-page {
  max-width: 1200px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 24px;
  color: #303133;
}

.stat-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-value {
  font-size: 36px;
  font-weight: 600;
  color: #303133;
}

.quick-actions {
  margin-top: 20px;
}
</style>
