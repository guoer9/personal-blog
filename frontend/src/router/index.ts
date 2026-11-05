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
          redirect: to => ({
            name: 'DocumentDetail',
            params: { slug: to.params.slug },
            query: to.query,
            hash: to.hash,
          }),
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
          path: 'works',
          name: 'Works',
          component: () => import('@/views/blog/Works.vue'),
        },
        {
          path: 'works/:slug',
          name: 'WorkDetail',
          component: () => import('@/views/blog/WorkDetail.vue'),
        },
        {
          path: 'documents',
          name: 'Documents',
          component: () => import('@/views/blog/Documents.vue'),
        },
        {
          path: 'documents/:slug',
          name: 'DocumentDetail',
          component: () => import('@/views/blog/DocumentDetail.vue'),
        },
        {
          path: 'about',
          name: 'About',
          component: () => import('@/views/blog/About.vue'),
        },
        {
          path: 'transfer',
          name: 'Transfer',
          component: () => import('@/views/blog/Transfer.vue'),
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
      path: '/login',
      name: 'Login',
      component: () => import('@/views/auth/Login.vue'),
      meta: { title: '登录' },
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
          path: 'works',
          name: 'AdminWorks',
          component: () => import('@/views/admin/Works.vue'),
        },
        {
          path: 'works/new',
          name: 'AdminWorkCreate',
          component: () => import('@/views/admin/WorkEdit.vue'),
        },
        {
          path: 'works/:id/edit',
          name: 'AdminWorkEdit',
          component: () => import('@/views/admin/WorkEdit.vue'),
        },
        {
          path: 'library',
          name: 'AdminLibrary',
          component: () => import('@/views/admin/Library.vue'),
        },
        {
          path: 'notion',
          name: 'AdminNotion',
          component: () => import('@/views/admin/NotionSync.vue'),
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
  Works: `作品集 · ${siteTitle}`,
  Documents: `公开资料库 · ${siteTitle}`,
  DocumentDetail: `资料 · ${siteTitle}`,
  WorkDetail: `作品 · ${siteTitle}`,
  About: `关于 · ${siteTitle}`,
  Transfer: `临时传输 · ${siteTitle}`,
  Search: `搜索 · ${siteTitle}`,
  TagPosts: `标签 · ${siteTitle}`,
  NotFound: `页面未找到 · ${siteTitle}`,
  AdminLogin: `后台登录 · ${siteTitle}`,
  Login: `登录 · ${siteTitle}`,
  Register: `注册 · ${siteTitle}`,
  AdminNotion: `Notion 连接与资料库 · ${siteTitle}`,
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
