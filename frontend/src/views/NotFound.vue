<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="not-found-page">
    <div class="content">
      <h1 class="error-code">404</h1>
      <p class="message">抱歉，您访问的页面不存在</p>
      <el-button type="primary" size="large" @click="router.push('/')">
        返回首页
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.content {
  text-align: center;
  color: #fff;
}

.error-code {
  font-size: 120px;
  font-weight: 700;
  margin-bottom: 16px;
  text-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.message {
  font-size: 20px;
  margin-bottom: 32px;
  opacity: 0.9;
}
</style>
