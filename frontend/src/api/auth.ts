import request from '@/utils/request'

export interface LoginData {
  username: string
  password: string
}

export interface RegisterData {
  username: string
  email: string
  password: string
  verification_phrase: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface UserInfo {
  id: number
  username: string
  email: string
  is_admin: boolean
  is_active: boolean
  avatar?: string
  bio?: string
  created_at: string
}

// 登录
export function login(data: LoginData) {
  return request.post<TokenResponse>('/auth/login/json', data)
}

// 注册
export function register(data: RegisterData) {
  return request.post<UserInfo>('/auth/register', data)
}

// 刷新 Token
export function refreshToken(refresh_token: string) {
  return request.post<TokenResponse>('/auth/refresh', { refresh_token })
}

// 获取当前用户信息
export function getCurrentUser() {
  return request.get<UserInfo>('/auth/me')
}
