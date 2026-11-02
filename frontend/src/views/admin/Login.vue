<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showError, showSuccess } from '@/ui/feedback'
import type { FormInstance, FormRules } from 'element-plus'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await userStore.login(form)
    if (!userStore.isAdmin) {
      userStore.logout()
      await showError('该账号没有后台访问权限')
      return
    }

    await showSuccess('已进入内容控制台')
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/admin')
      ? route.query.redirect
      : '/admin'
    await router.replace(redirect)
  } catch (error: any) {
    await showError(error.response?.data?.detail || '登录失败，请检查账号与密码')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="admin-login">
    <div class="login-grid" aria-hidden="true" />
    <header class="login-header">
      <router-link to="/" class="brand" aria-label="返回博客首页">
        <span>G</span>
        <b>GUOER / FIELD NOTES</b>
      </router-link>
      <p>PRIVATE ACCESS · 2026</p>
    </header>

    <section class="login-panel" aria-labelledby="admin-login-title">
      <p class="eyebrow">Administration / 01</p>
      <h1 id="admin-login-title">内容<br /><em>控制台.</em></h1>
      <p class="intro">维护文章与作品集，管理私有文件和创作素材。访客无需登录即可浏览已发布的内容。</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="handleSubmit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" autocomplete="username" placeholder="用户名或邮箱" size="large" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" autocomplete="current-password" placeholder="输入密码" size="large" show-password />
        </el-form-item>
        <el-button native-type="submit" :loading="loading" class="login-submit">
          {{ loading ? '正在验证…' : '进入控制台 ↗' }}
        </el-button>
      </el-form>

      <router-link to="/" class="back-link">← 返回公开博客</router-link>
    </section>

    <aside class="login-note" aria-label="访问说明">
      <span>01</span>
      <p>公开博客不显示登录或注册入口。只有管理员访问 <code>/admin</code> 时，系统才会要求认证。</p>
      <span>02</span>
      <p>会话失效后，后台请求会回到此页面，并在验证成功后恢复原管理路径。</p>
    </aside>

    <p class="login-footer">GUOER · AUTHOR CMS / SECURE SESSION</p>
  </main>
</template>

<style scoped>
.admin-login {
  --login-paper: #efebe1;
  --login-ink: #171816;
  --login-acid: #c8ff38;
  position: relative;
  display: grid;
  grid-template: auto 1fr auto / minmax(0, 1.2fr) minmax(280px, .8fr);
  min-height: 100svh;
  padding: 0 clamp(24px, 5vw, 82px);
  overflow: hidden;
  background: var(--login-paper);
  color: var(--login-ink);
}
.login-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(23, 24, 22, .075) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 24, 22, .075) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: linear-gradient(100deg, #000, transparent 72%);
}
.login-header, .login-panel, .login-note, .login-footer { position: relative; z-index: 1; }
.login-header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; min-height: 86px; border-bottom: 1px solid rgba(23, 24, 22, .25); }
.brand { display: flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; }
.brand span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--login-ink); color: var(--login-acid); font: 800 .72rem var(--mono-font); }
.brand b, .login-header p { font: .64rem var(--mono-font); letter-spacing: .12em; }
.login-header p { margin: 0; color: rgba(23, 24, 22, .58); }
.login-panel { align-self: center; width: min(600px, 100%); padding: 72px 0 64px; }
.eyebrow { margin: 0 0 25px; font: .63rem var(--mono-font); letter-spacing: .1em; text-transform: uppercase; }
h1 { margin: 0; font: 400 clamp(4.6rem, 9vw, 9rem)/.79 var(--display-font); letter-spacing: -.075em; }
h1 em { font-weight: 400; }
.intro { max-width: 475px; margin: 42px 0 42px; color: rgba(23, 24, 22, .67); font-size: .88rem; line-height: 1.8; }
.login-panel :deep(.el-form-item__label) { padding-bottom: 8px; color: rgba(23, 24, 22, .6); font: .59rem var(--mono-font); letter-spacing: .08em; text-transform: uppercase; }
.login-panel :deep(.el-input__wrapper) { min-height: 52px; border-radius: 0; background: rgba(255, 255, 255, .5); box-shadow: 0 0 0 1px rgba(23, 24, 22, .25) inset; }
.login-panel :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--login-ink) inset; }
.login-submit { width: 100%; min-height: 52px; margin-top: 9px; border: 0; border-radius: 0; background: var(--login-ink); color: var(--login-paper); font: .67rem var(--mono-font); letter-spacing: .06em; }
.login-submit:hover, .login-submit:focus-visible { background: var(--login-acid); color: var(--login-ink); }
.back-link { display: inline-block; margin-top: 27px; border-bottom: 1px solid currentColor; color: inherit; font: .61rem var(--mono-font); text-decoration: none; }
.login-note { align-self: center; display: grid; grid-template-columns: 42px 1fr; gap: 0 18px; padding: 28px 0 28px 34px; border-left: 1px solid rgba(23, 24, 22, .25); }
.login-note span { display: grid; place-items: center; align-self: start; width: 32px; height: 32px; border-radius: 50%; background: var(--login-acid); font: .59rem var(--mono-font); }
.login-note p { margin: 3px 0 28px; color: rgba(23, 24, 22, .66); font-size: .78rem; line-height: 1.75; }
.login-note code { padding: 2px 4px; background: rgba(23, 24, 22, .08); color: var(--login-ink); }
.login-footer { grid-column: 1 / -1; margin: 0; padding: 23px 0; border-top: 1px solid rgba(23, 24, 22, .25); color: rgba(23, 24, 22, .52); font: .55rem var(--mono-font); letter-spacing: .1em; }
@media (max-width: 760px) {
  .admin-login { grid-template: auto 1fr auto / 1fr; padding: 0 20px; }
  .login-header p, .login-note { display: none; }
  .login-panel { padding: 54px 0; }
  h1 { font-size: clamp(3.45rem, 18vw, 5.8rem); }
  .intro { margin: 32px 0; }
  .login-footer { font-size: .49rem; }
}
</style>
