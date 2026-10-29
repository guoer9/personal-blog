import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi, register as registerApi, refreshToken, getCurrentUser, type UserInfo, type LoginData, type RegisterData } from '@/api/auth'

export const useUserStore = defineStore('user', () => {
  // 状态
  const token = ref<string | null>(localStorage.getItem('token'))
  const refreshTokenValue = ref<string | null>(localStorage.getItem('refreshToken'))
  const userInfo = ref<UserInfo | null>(null)

  // 计算属性
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value?.is_admin ?? false)

  // 登录
  async function login(data: LoginData) {
    const response = await loginApi(data)
    token.value = response.data.access_token
    refreshTokenValue.value = response.data.refresh_token
    
    localStorage.setItem('token', response.data.access_token)
    localStorage.setItem('refreshToken', response.data.refresh_token)
    
    await fetchUserInfo()
  }

  // 注册
  async function register(data: RegisterData) {
    await registerApi(data)
  }

  // 获取用户信息
  async function fetchUserInfo() {
    if (!token.value) return
    try {
      const response = await getCurrentUser()
      userInfo.value = response.data
    } catch {
      logout()
    }
  }

  // 刷新 Token
  async function refreshAccessToken() {
    if (!refreshTokenValue.value) throw new Error('No refresh token')
    
    const response = await refreshToken(refreshTokenValue.value)
    token.value = response.data.access_token
    refreshTokenValue.value = response.data.refresh_token
    
    localStorage.setItem('token', response.data.access_token)
    localStorage.setItem('refreshToken', response.data.refresh_token)
  }

  // 登出
  function logout() {
    token.value = null
    refreshTokenValue.value = null
    userInfo.value = null
    
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
  }

  // 初始化时获取用户信息
  if (token.value) {
    fetchUserInfo()
  }

  return {
    token,
    refreshToken: refreshTokenValue,
    userInfo,
    isLoggedIn,
    isAdmin,
    login,
    register,
    fetchUserInfo,
    refreshAccessToken,
    logout,
  }
})
