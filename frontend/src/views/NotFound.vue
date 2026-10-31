<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <main class="not-found">
    <a class="skip-link" href="#lost-content">跳到正文</a>
    <header class="error-header">
      <router-link to="/" class="error-brand">G/ <span>GUOER</span></router-link>
      <p>Error / route not found</p>
      <router-link to="/" class="return-link">返回首页 ↗</router-link>
    </header>
    <div id="lost-content" class="error-stage">
      <div class="error-orbit" aria-hidden="true">
        <span />
        <span />
        <b>?</b>
      </div>
      <div class="error-copy">
        <p class="section-kicker">404 / PAGE MISSING</p>
        <h1>A blank<br /><em>in the map.</em></h1>
        <p>你访问的页面不存在，或者它已经被移动。地址是：<code>{{ route.fullPath }}</code></p>
        <div class="error-actions">
          <router-link to="/" class="error-button">返回首页</router-link>
          <router-link to="/writing" class="error-text-link">浏览全部文章 ↗</router-link>
        </div>
      </div>
    </div>
    <footer class="error-footer">
      <span>ARCHIVE / INDEX</span>
      <span>{{ new Date().getFullYear() }} — KEEP EXPLORING</span>
    </footer>
  </main>
</template>

<style scoped>
.not-found { min-width: 320px; min-height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--paper); color: var(--ink); }
.error-header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px; width: var(--page-width); min-height: 76px; margin: 0 auto; border-bottom: 1px solid var(--ink); }
.error-brand { justify-self: start; color: var(--ink); font: 700 .73rem var(--mono-font); letter-spacing: .14em; text-decoration: none; }
.error-brand span { margin-left: 8px; }
.error-header p { color: var(--muted); font: .6rem var(--mono-font); letter-spacing: .06em; text-transform: uppercase; }
.return-link { justify-self: end; color: var(--ink); font: .64rem var(--mono-font); text-decoration: none; }
.error-stage { display: grid; grid-template-columns: .95fr 1.05fr; align-items: center; flex: 1; gap: 60px; width: min(1120px, calc(100% - 64px)); margin: 0 auto; padding: 80px 0; }
.error-orbit { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 1; max-height: 570px; }
.error-orbit::before { content: ''; position: absolute; width: 77%; height: 77%; border: 1px solid var(--ink); border-radius: 47% 53% 44% 56%; background: var(--acid); transform: rotate(17deg); }
.error-orbit::after { content: ''; position: absolute; width: 67%; height: 45%; border: 2px solid var(--electric-blue); border-radius: 50%; transform: rotate(-24deg); }
.error-orbit span { position: absolute; z-index: 1; width: 90%; aspect-ratio: 1.75; border: 1px solid var(--ink); border-radius: 50%; transform: rotate(-30deg); }
.error-orbit span:first-child { transform: rotate(38deg); width: 58%; aspect-ratio: 1; border-width: 2px; }
.error-orbit b { position: relative; z-index: 2; font: 400 clamp(12rem, 25vw, 24rem)/1 var(--display-font); transform: rotate(-10deg); }
.error-copy h1 { margin-bottom: 30px; font: 400 clamp(4.2rem, 9vw, 8rem)/.85 var(--display-font); letter-spacing: -.07em; }
.error-copy h1 em { color: var(--electric-blue); font-weight: 400; }
.error-copy > p:not(.section-kicker) { max-width: 500px; color: var(--muted); }
.error-copy code { display: inline-block; max-width: 420px; overflow-wrap: anywhere; color: var(--ink); font: .7rem var(--mono-font); }
.error-actions { display: flex; flex-wrap: wrap; gap: 25px; align-items: center; margin-top: 37px; }
.error-button { display: inline-flex; align-items: center; min-height: 50px; padding: 0 22px; border: 1px solid var(--ink); background: var(--ink); color: var(--paper); font: 700 .66rem var(--mono-font); letter-spacing: .06em; text-decoration: none; }
.error-button:hover { background: var(--electric-blue); }
.error-text-link { padding-bottom: 4px; border-bottom: 1px solid currentColor; font: .64rem var(--mono-font); text-decoration: none; }
.error-footer { display: flex; justify-content: space-between; width: var(--page-width); margin: 0 auto; padding: 20px 0 26px; border-top: 1px solid var(--line); color: var(--muted); font: .57rem var(--mono-font); letter-spacing: .05em; }
.skip-link { position: fixed; z-index: 3; top: 10px; left: 10px; padding: 10px; background: var(--ink); color: var(--paper); transform: translateY(-160%); }
.skip-link:focus { transform: none; }
@media (max-width: 820px) {
  .error-header { grid-template-columns: 1fr auto; }
  .error-header > p { display: none; }
  .error-stage { grid-template-columns: 1fr; gap: 20px; padding: 45px 0; }
  .error-orbit { width: min(100%, 380px); max-height: none; justify-self: center; }
  .error-copy { text-align: center; }
  .error-copy > p:not(.section-kicker) { margin-right: auto; margin-left: auto; }
  .error-actions { justify-content: center; }
}
@media (max-width: 520px) {
  .error-header, .error-footer { width: calc(100% - 36px); }
  .error-stage { width: calc(100% - 36px); }
  .error-copy h1 { font-size: clamp(4rem, 20vw, 6rem); }
  .error-footer { flex-direction: column; gap: 7px; }
}
</style>
