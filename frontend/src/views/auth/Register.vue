<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { showError, showSuccess } from '@/ui/feedback'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  verification_phrase: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
})

const validateConfirmPassword = (_rule: any, value: string, callback: any) => {
  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  verification_phrase: [
    { required: true, message: '请输入验证内容', trigger: 'blur' },
  ],
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 50, message: '用户名长度应为 3-50 个字符', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于 6 个字符', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  
  loading.value = true
  try {
    await userStore.register({
      verification_phrase: form.verification_phrase,
      username: form.username,
      email: form.email,
      password: form.password,
    })
    await showSuccess('注册成功，请使用账号和密码登录')
    router.push({ name: 'Login', query: { redirect: route.query.redirect } })
  } catch (error: any) {
    await showError(error.response?.data?.detail || '注册失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <div class="register-card">
      <h1 class="title">创建账号</h1>
      <p class="subtitle">验证内容只在注册时使用。之后登录只需账号和密码。</p>
      
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleSubmit"
      >
        <el-form-item label="验证内容" prop="verification_phrase">
          <el-input
            v-model="form.verification_phrase"
            type="text"
            autocomplete="off"
            placeholder="请输入站长提供的验证内容"
            size="large"
          />
        </el-form-item>

        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            size="large"
          />
        </el-form-item>
        
        <el-form-item label="邮箱" prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入邮箱"
            size="large"
          />
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            size="large"
            show-password
          />
        </el-form-item>
        
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            size="large"
            show-password
          />
        </el-form-item>
        
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            style="width: 100%"
            native-type="submit"
          >
            注册
          </el-button>
        </el-form-item>
      </el-form>
      
      <div class="footer">
        已有账号？
        <router-link to="/login">登录</router-link>
      </div>
      
      <div class="back-home">
        <router-link to="/">← 返回首页</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 100svh;
  overflow: hidden;
  padding: clamp(20px, 5vw, 72px);
  background: #efebe1;
  color: #171816;
}

.register-page::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(23, 24, 22, .075) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 24, 22, .075) 1px, transparent 1px);
  background-size: 64px 64px;
  content: '';
  mask-image: linear-gradient(100deg, #000, transparent 72%);
}

.register-card {
  position: relative;
  width: 100%;
  padding: clamp(28px, 5vw, 54px);
  border: 1px solid rgba(23, 24, 22, .28);
  background: rgba(255, 255, 255, .35);
}

.register-card {
  width: 100%;
  max-width: 480px;
}

.title {
  margin: 0 0 12px;
  font: 400 clamp(3.2rem, 8vw, 5.5rem)/.9 var(--display-font);
  letter-spacing: -.065em;
  color: #171816;
}

.subtitle {
  margin: 0 0 32px;
  color: rgba(23, 24, 22, .66);
  font-size: .84rem;
  line-height: 1.7;
}

.register-card :deep(.el-form-item__label) {
  padding-bottom: 7px;
  color: rgba(23, 24, 22, .62);
  font: .6rem var(--mono-font);
  letter-spacing: .07em;
}

.register-card :deep(.el-input__wrapper) {
  min-height: 50px;
  border-radius: 0;
  background: rgba(255, 255, 255, .62);
  box-shadow: 0 0 0 1px rgba(23, 24, 22, .23) inset;
}

.register-card :deep(.el-button--primary) {
  min-height: 52px;
  border: 0;
  border-radius: 0;
  background: #171816;
  color: #efebe1;
  font: .67rem var(--mono-font);
  letter-spacing: .07em;
}

.footer {
  margin-top: 21px;
  color: rgba(23, 24, 22, .62);
  font-size: .8rem;
}

.footer a {
  color: #171816;
  text-underline-offset: 4px;
}

.back-home {
  margin-top: 24px;
}

.back-home a {
  color: rgba(23, 24, 22, .62);
  font: .61rem var(--mono-font);
  text-underline-offset: 4px;
}
</style>
