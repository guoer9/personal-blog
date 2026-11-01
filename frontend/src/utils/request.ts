import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { useUserStore } from '@/stores/user'
import router from '@/router'
import { showError } from '@/ui/feedback'

// 创建 axios 实例
const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    return response
  },
  async (error) => {
    const { response } = error
    const suppressErrorToast = error.config?.suppressErrorToast === true

    if (response) {
      const { status, data } = response
      
      switch (status) {
        case 401:
          // Token 过期，尝试刷新
          const userStore = useUserStore()
          if (userStore.refreshToken) {
            try {
              await userStore.refreshAccessToken()
              // 重试原请求
              return request(error.config)
            } catch {
              userStore.logout()
              if (router.currentRoute.value.path.startsWith('/admin')) {
                router.push('/admin/login')
              }
            }
          } else {
            userStore.logout()
            if (router.currentRoute.value.path.startsWith('/admin')) {
              router.push('/admin/login')
            }
          }
          break
        default:
          if (!suppressErrorToast) {
            const messages: Record<number, string> = {
              403: data.detail || '没有权限',
              404: data.detail || '资源不存在',
              422: '请求参数错误',
            }
            try {
              await showError(messages[status] || data.detail || '服务器错误')
            } catch {
              // A failed UI chunk must not replace the original request error.
            }
          }
      }
    } else if (!suppressErrorToast) {
      try {
        await showError('网络错误，请检查网络连接')
      } catch {
        // Preserve the network error even when notification loading fails.
      }
    }
    
    return Promise.reject(error)
  }
)

export default request
