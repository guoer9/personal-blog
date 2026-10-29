<script setup lang="ts">
</script>

<template>
  <div class="about-page container">
    <div class="about-card">
      <h1 class="title">关于我</h1>
      
      <div class="content">
        <p>欢迎来到我的个人博客！</p>
        
        <p>这里是我分享技术文章、学习笔记和生活感悟的地方。</p>
        
        <h2>技术栈</h2>
        <ul>
          <li>前端：Vue 3 + TypeScript + Element Plus</li>
          <li>后端：FastAPI + PostgreSQL</li>
          <li>部署：Nginx + Docker</li>
        </ul>
        
        <h2>联系方式</h2>
        <ul>
          <li>GitHub: <a href="https://github.com" target="_blank">@myaccount</a></li>
          <li>Email: example@email.com</li>
        </ul>
        
        <p>感谢您的访问！</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-page {
  max-width: 800px;
  padding: 24px 20px;
}

.about-card {
  background: #fff;
  border-radius: 12px;
  padding: 40px;
}

.title {
  font-size: 28px;
  font-weight: 600;
  margin-bottom: 24px;
  color: #303133;
}

.content {
  line-height: 1.8;
  color: #606266;
}

.content h2 {
  font-size: 20px;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 12px;
  color: #303133;
}

.content p {
  margin-bottom: 16px;
}

.content ul {
  padding-left: 20px;
  margin-bottom: 16px;
}

.content li {
  margin-bottom: 8px;
}

.content a {
  color: var(--el-color-primary);
}
</style>
