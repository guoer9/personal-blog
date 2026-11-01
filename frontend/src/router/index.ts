import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { installElementPlusForRoute } from '@/ui/element-plus'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth', top: 92 }
    }
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        {
          path: '',
          name: 'Home',
          component: () => import('@/views/blog/Home.vue'),
        },
        {
          path: 'post/:slug',
          name: 'PostDetail',
          component: () => import('@/views/blog/PostDetail.vue'),
        },
        {
          path: 'writing',
          name: 'Archive',
          component: () => import('@/views/blog/Archive.vue'),
        },
        {
          path: 'tag/:slug',
          name: 'TagPosts',
          component: () => import('@/views/blog/TagPosts.vue'),
        },
        {
          path: 'search',
          name: 'Search',
          component: () => import('@/views/blog/Search.vue'),
        },
        {
          path: 'about',
          name: 'About',
          component: () => import('@/views/blog/About.vue'),
        },
      ],
    },
    {
      path: '/admin/login',
      name: 'AdminLogin',
      component: () => import('@/views/admin/Login.vue'),
      meta: { title: '后台登录' },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/auth/Register.vue'),
    },
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        {
          path: '',
          name: 'AdminDashboard',
          component: () => import('@/views/admin/Dashboard.vue'),
        },
        {
          path: 'posts',
          name: 'AdminPosts',
          component: () => import('@/views/admin/Posts.vue'),
        },
        {
          path: 'posts/new',
          name: 'AdminPostCreate',
          component: () => import('@/views/admin/PostEdit.vue'),
        },
        {
          path: 'posts/:id/edit',
          name: 'AdminPostEdit',
          component: () => import('@/views/admin/PostEdit.vue'),
        },
        {
          path: 'comments',
          name: 'AdminComments',
          component: () => import('@/views/admin/Comments.vue'),
        },
        {
          path: 'files',
          name: 'AdminFiles',
          component: () => import('@/views/admin/Files.vue'),
        },
        {
          path: 'tags',
          name: 'AdminTags',
          component: () => import('@/views/admin/Tags.vue'),
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/NotFound.vue'),
    },
  ],
})

const siteTitle = 'GUOER · Field Notes'
const pageTitles: Record<string, string> = {
  Home: siteTitle,
  Archive: `文章归档 · ${siteTitle}`,
  About: `关于 · ${siteTitle}`,
  Search: `搜索 · ${siteTitle}`,
  TagPosts: `标签 · ${siteTitle}`,
  PostDetail: siteTitle,
  NotFound: `页面未找到 · ${siteTitle}`,
  AdminLogin: `后台登录 · ${siteTitle}`,
}

router.afterEach((to) => {
  document.title = pageTitles[String(to.name)] || siteTitle
})

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  await installElementPlusForRoute(to.path)
  const userStore = useUserStore()
  
  // 如果需要认证
  if (to.meta.requiresAuth) {
    if (!userStore.isLoggedIn) {
      return next({ name: 'AdminLogin', query: { redirect: to.fullPath } })
    }
    
    // 等待用户信息加载
    if (!userStore.userInfo) {
      await userStore.fetchUserInfo()
    }
    
    // 如果需要管理员权限
    if (to.meta.requiresAdmin && !userStore.isAdmin) {
      return next({ name: 'Home' })
    }
  }
  
  next()
})

export default router
