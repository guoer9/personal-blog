<script setup lang="ts">
import { CODEX_CONSOLE_URL } from '@/config/codex'
</script>

<template>
  <section class="codex-page" aria-labelledby="codex-title">
    <header class="page-heading">
      <div>
        <h1 id="codex-title">Codex 控制台</h1>
        <p>通过独立控制台连接 Mac 上的 Codex 执行节点。</p>
      </div>
      <el-button tag="a" :href="CODEX_CONSOLE_URL" target="_blank" rel="noopener noreferrer" type="primary">
        <el-icon><TopRight /></el-icon>
        打开控制台
      </el-button>
    </header>

    <dl class="connection-details">
      <div>
        <dt>执行节点</dt>
        <dd>Mac 上已加载并连接的 Codex 会话</dd>
      </div>
      <div>
        <dt>节点离线</dt>
        <dd>可查看云端已同步历史；继续执行需 Mac 在线</dd>
      </div>
      <div>
        <dt>登录</dt>
        <dd>控制台使用独立 HAPI 访问令牌登录，与博客账号分开</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.codex-page { max-width: 920px; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--admin-border-soft); }
h1 { margin: 0; color: var(--admin-text); font-size: 22px; line-height: 1.35; }
.page-heading p { margin: 7px 0 0; color: var(--admin-muted); font-size: 14px; line-height: 1.6; }
.connection-details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin: 0; padding: 24px 0; }
.connection-details div { min-width: 0; }
dt { margin-bottom: 8px; color: var(--admin-muted); font-size: 12px; }
dd { margin: 0; color: var(--admin-text); font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .page-heading { align-items: flex-start; flex-direction: column; }
  .connection-details { grid-template-columns: 1fr; gap: 18px; }
}
</style>
