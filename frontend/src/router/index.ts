import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(),
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
      path: '/login',
      name: 'Login',
      component: () => import('@/views/auth/Login.vue'),
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

// 路由守卫
router.beforeEach(async (to, from, next) => {
  const userStore = useUserStore()
  
  // 如果需要认证
  if (to.meta.requiresAuth) {
    if (!userStore.isLoggedIn) {
      return next({ name: 'Login', query: { redirect: to.fullPath } })
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
