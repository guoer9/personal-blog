<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { showSuccess } from '@/ui/feedback'
import { closePreviewSession } from '@/api/works'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const isMobile = ref(false)
let mediaQuery: MediaQueryList | null = null
function setMobile() { isMobile.value = mediaQuery?.matches ?? false }
onMounted(() => { mediaQuery = window.matchMedia('(max-width: 760px)'); setMobile(); mediaQuery.addEventListener('change', setMobile) })
onBeforeUnmount(() => mediaQuery?.removeEventListener('change', setMobile))

async function handleLogout() {
  await closePreviewSession().catch(() => undefined)
  userStore.logout()
  await showSuccess('已退出登录')
  router.push('/')
}
</script>

<template>
  <el-container class="admin-layout">
    <!-- 侧边栏 -->
    <el-aside width="220px" class="sidebar">
      <nav aria-label="后台导航">
      <div class="sidebar-header">
        <router-link to="/" class="sidebar-brand">博客管理</router-link>
      </div>
      
      <el-menu
        :mode="isMobile ? 'horizontal' : 'vertical'"
        :ellipsis="false"
        :default-active="route.path"
        router
        class="sidebar-menu"
      >
        <el-menu-item index="/admin">
          <el-icon><DataBoard /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/admin/posts">
          <el-icon><Document /></el-icon>
          <span>文章管理</span>
        </el-menu-item>
        <el-menu-item index="/admin/notion">
          <el-icon><Document /></el-icon>
          <span>Notion 连接与资料库</span>
        </el-menu-item>
        <el-menu-item index="/admin/comments">
          <el-icon><ChatDotRound /></el-icon>
          <span>评论管理</span>
        </el-menu-item>
        <el-menu-item index="/admin/files">
          <el-icon><FolderOpened /></el-icon>
          <span>公开文章附件</span>
        </el-menu-item>
        <el-menu-item index="/admin/library">
          <el-icon><FolderOpened /></el-icon>
          <span>私有文件库</span>
        </el-menu-item>
        <el-menu-item index="/admin/works">
          <el-icon><Document /></el-icon>
          <span>作品管理</span>
        </el-menu-item>
        <el-menu-item index="/admin/tags">
          <el-icon><PriceTag /></el-icon>
          <span>标签管理</span>
        </el-menu-item>
      </el-menu>
      </nav>
    </el-aside>
    
    <!-- 主内容区 -->
    <el-container>
      <el-header class="admin-header">
        <div class="header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item>管理后台</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        
        <div class="header-right">
          <el-dropdown>
            <span class="user-dropdown">
              <el-avatar :size="32">
                {{ userStore.userInfo?.username?.charAt(0).toUpperCase() }}
              </el-avatar>
              <span class="username">{{ userStore.userInfo?.username }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/')">
                  返回博客
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      
      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
}

.sidebar {
  background: #304156;
}

.sidebar-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-brand {
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}

.sidebar-menu {
  border-right: none;
  background: transparent;
}

.sidebar-menu :deep(.el-menu-item) {
  color: #bfcbd9;
}

.sidebar-menu :deep(.el-menu-item:hover),
.sidebar-menu :deep(.el-menu-item.is-active) {
  background-color: #263445;
  color: #409eff;
}

.admin-header {
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.admin-main {
  background: #f0f2f5;
  padding: 24px;
}
:global(.el-message--success) { --el-message-text-color: #245a35; }
@media (max-width: 760px) {
  .admin-layout { flex-direction: column; }
  .sidebar { width: 100% !important; }
  .sidebar-header { height: 48px; }
  .sidebar-menu { overflow-x: auto; }
  .sidebar-menu :deep(.el-menu-item) { padding: 0 14px; }
  .admin-header { padding: 0 16px; }
  .admin-main { padding: 18px; }
  .username { display: none; }
}
</style>
