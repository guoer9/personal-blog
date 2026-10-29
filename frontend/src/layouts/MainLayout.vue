<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const searchKeyword = ref('')

function handleSearch() {
  if (searchKeyword.value.trim()) {
    router.push({ name: 'Search', query: { q: searchKeyword.value.trim() } })
  }
}

function handleLogout() {
  userStore.logout()
  ElMessage.success('已退出登录')
  router.push('/')
}
</script>

<template>
  <div class="main-layout">
    <!-- 顶部导航 -->
    <el-header class="header">
      <div class="container header-content">
        <div class="logo" @click="router.push('/')">
          <span class="logo-text">我的博客</span>
        </div>
        
        <nav class="nav">
          <router-link to="/" class="nav-link">首页</router-link>
          <router-link to="/about" class="nav-link">关于</router-link>
          <router-link v-if="userStore.isAdmin" to="/admin" class="nav-link">管理</router-link>
        </nav>
        
        <div class="header-right">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索文章..."
            class="search-input"
            @keyup.enter="handleSearch"
          >
            <template #append>
              <el-button :icon="'Search'" @click="handleSearch" />
            </template>
          </el-input>
          
          <template v-if="userStore.isLoggedIn">
            <el-dropdown>
              <span class="user-dropdown">
                <el-avatar :size="32" :src="userStore.userInfo?.avatar">
                  {{ userStore.userInfo?.username?.charAt(0).toUpperCase() }}
                </el-avatar>
                <span class="username">{{ userStore.userInfo?.username }}</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="userStore.isAdmin" @click="router.push('/admin')">
                    管理后台
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="handleLogout">
                    退出登录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <el-button type="primary" text @click="router.push('/login')">登录</el-button>
            <el-button type="primary" @click="router.push('/register')">注册</el-button>
          </template>
        </div>
      </div>
    </el-header>
    
    <!-- 主内容区 -->
    <el-main class="main">
      <router-view />
    </el-main>
    
    <!-- 页脚 -->
    <el-footer class="footer">
      <div class="container">
        <p>&copy; {{ new Date().getFullYear() }} 我的博客. All rights reserved.</p>
      </div>
    </el-footer>
  </div>
</template>

<style scoped>
.main-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 24px;
}

.logo {
  cursor: pointer;
}

.logo-text {
  font-size: 20px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.nav {
  display: flex;
  gap: 24px;
}

.nav-link {
  color: var(--el-text-color-regular);
  font-size: 15px;
  transition: color 0.2s;
}

.nav-link:hover,
.nav-link.router-link-active {
  color: var(--el-color-primary);
  text-decoration: none;
}

.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
}

.search-input {
  width: 200px;
}

.user-dropdown {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.main {
  flex: 1;
  padding: 24px 0;
}

.footer {
  background: #fff;
  border-top: 1px solid var(--el-border-color-lighter);
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
</style>
