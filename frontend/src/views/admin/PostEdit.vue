<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { getPostById, createPost, updatePost, type PostCreate, type PostUpdate } from '@/api/posts'
import { getTags, type Tag } from '@/api/tags'
import { uploadFile } from '@/api/files'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

const route = useRoute()
const router = useRouter()

const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)
const tags = ref<Tag[]>([])

const postId = computed(() => route.params.id as string | undefined)
const isEdit = computed(() => !!postId.value)

const form = ref<PostCreate>({
  title: '',
  content: '',
  summary: '',
  cover_image: '',
  is_published: false,
  tag_ids: [],
})

const rules: FormRules = {
  title: [{ required: true, message: '请输入文章标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入文章内容', trigger: 'blur' }],
}

async function fetchPost() {
  if (!postId.value) return
  
  loading.value = true
  try {
    const response = await getPostById(parseInt(postId.value, 10))
    form.value = {
      title: response.data.title,
      content: response.data.content || '',
      summary: response.data.summary || '',
      cover_image: response.data.cover_image || '',
      is_published: response.data.is_published,
      tag_ids: response.data.tags.map(t => t.id),
    }
  } catch (error) {
    ElMessage.error('获取文章失败')
    router.push('/admin/posts')
  } finally {
    loading.value = false
  }
}

async function fetchTags() {
  try {
    const response = await getTags()
    tags.value = response.data
  } catch (error) {
    console.error('获取标签失败', error)
  }
}

async function handleUpload(files: File[], callback: (urls: string[]) => void) {
  try {
    const urls: string[] = []
    for (const file of files) {
      const response = await uploadFile(file)
      urls.push(response.data.url)
    }
    callback(urls)
  } catch (error) {
    ElMessage.error('上传失败')
  }
}

async function handleSubmit() {
  const valid = await formRef.value?.validate()
  if (!valid) return
  
  saving.value = true
  try {
    if (isEdit.value) {
      await updatePost(parseInt(postId.value!), form.value as PostUpdate)
      ElMessage.success('更新成功')
    } else {
      await createPost(form.value)
      ElMessage.success('创建成功')
    }
    router.push('/admin/posts')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  fetchTags()
  if (isEdit.value) {
    fetchPost()
  }
})
</script>

<template>
  <div class="post-edit-page">
    <div class="page-header">
      <el-button text @click="router.push('/admin/posts')">
        <el-icon><ArrowLeft /></el-icon>
        返回
      </el-button>
      <h1 class="page-title">{{ isEdit ? '编辑文章' : '写文章' }}</h1>
    </div>
    
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      v-loading="loading"
    >
      <el-row :gutter="20">
        <el-col :xs="24" :lg="18">
          <el-card shadow="never" class="editor-card">
            <el-form-item label="标题" prop="title">
              <el-input
                v-model="form.title"
                placeholder="请输入文章标题"
                size="large"
              />
            </el-form-item>
            
            <el-form-item label="内容" prop="content">
              <MdEditor
                v-model="form.content"
                style="height: 500px"
                :on-upload-img="handleUpload"
              />
            </el-form-item>
          </el-card>
        </el-col>
        
        <el-col :xs="24" :lg="6">
          <el-card shadow="never" class="settings-card">
            <template #header>
              <span>文章设置</span>
            </template>
            
            <el-form-item label="摘要">
              <el-input
                v-model="form.summary"
                type="textarea"
                :rows="3"
                placeholder="文章摘要（可选）"
              />
            </el-form-item>
            
            <el-form-item label="封面图">
              <el-input
                v-model="form.cover_image"
                placeholder="封面图 URL"
              />
            </el-form-item>
            
            <el-form-item label="标签">
              <el-select
                v-model="form.tag_ids"
                multiple
                placeholder="选择标签"
                style="width: 100%"
              >
                <el-option
                  v-for="tag in tags"
                  :key="tag.id"
                  :label="tag.name"
                  :value="tag.id"
                />
              </el-select>
            </el-form-item>
            
            <el-form-item label="发布状态">
              <el-switch
                v-model="form.is_published"
                active-text="发布"
                inactive-text="草稿"
              />
            </el-form-item>
            
            <el-button
              type="primary"
              size="large"
              :loading="saving"
              style="width: 100%"
              @click="handleSubmit"
            >
              {{ isEdit ? '保存修改' : '发布文章' }}
            </el-button>
          </el-card>
        </el-col>
      </el-row>
    </el-form>
  </div>
</template>

<style scoped>
.post-edit-page {
  max-width: 1400px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  margin-top: 16px;
  color: #303133;
}

.editor-card {
  margin-bottom: 20px;
}

.settings-card {
  position: sticky;
  top: 80px;
}

@media (max-width: 992px) {
  .settings-card {
    position: static;
    margin-top: 20px;
  }
}
</style>
