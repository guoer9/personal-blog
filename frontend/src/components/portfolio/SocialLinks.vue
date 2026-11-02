<script setup lang="ts">
import { ref } from 'vue'
const status = ref('')
const contacts = [
  { label: '抖音', name: '小果', value: '70840915005' },
  { label: 'QQ', name: '联系我', value: '2100670295' },
  { label: '微信', name: '联系我', value: 'guoer2100670295' },
]
async function copy(label: string, value: string) {
  try { await navigator.clipboard.writeText(value); status.value = `${label}账号已复制` }
  catch { status.value = `无法自动复制，请手动复制${label}账号：${value}` }
}
</script>

<template>
  <section id="connect" class="connect-section" aria-labelledby="connect-title">
    <div class="connect-heading"><p class="section-kicker">Elsewhere / Stay in touch</p><h2 id="connect-title">在别处，<em>也在这里。</em></h2><p>项目留在 GitHub，日常与音乐也在 Bilibili。欢迎来打个招呼。</p></div>
    <div class="social-grid">
      <a href="https://github.com/guoer9" target="_blank" rel="noopener noreferrer"><span class="eyebrow">GitHub ↗</span><strong>guoer9</strong><span>代码、项目与实验</span></a>
      <a href="https://space.bilibili.com/693922070" target="_blank" rel="noopener noreferrer"><span class="eyebrow">Bilibili ↗</span><strong>小果Fruit</strong><span>Vlog、音乐与生活</span></a>
      <div v-for="contact in contacts" :key="contact.label" class="contact-card"><span class="eyebrow">{{ contact.label }} / {{ contact.name }}</span><strong>{{ contact.value }}</strong><button type="button" class="text-action" @click="copy(contact.label, contact.value)">复制{{ contact.label }}账号 <span aria-hidden="true">↗</span></button></div>
    </div>
    <p class="copy-status" role="status" aria-live="polite">{{ status }}</p>
  </section>
</template>

<style scoped>
.connect-section { padding-top: var(--section-space); }
.connect-heading h2 { margin: 0 0 20px; font: 400 clamp(2.5rem, 5vw, 4rem)/1.2 var(--display-font); letter-spacing: -.05em; }
.connect-heading em { color: var(--electric-blue); font-weight: 400; }
.connect-heading > p:last-child { color: var(--muted); font-size: .9rem; }
.social-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; border: 1px solid var(--line); margin-top: 30px; background: var(--line); }
.social-grid > * { display: flex; grid-column: span 2; flex-direction: column; align-items: flex-start; gap: 20px; padding: 26px; background: var(--paper); min-width: 0; text-decoration: none; }
.social-grid > a { grid-column: span 3; background: var(--paper-soft); transition: background-color 180ms; }
.social-grid > a:hover { background: var(--acid); }
.social-grid strong { font-size: clamp(.9rem, 2vw, 1.5rem); overflow-wrap: anywhere; font-weight: 500; }
.social-grid > a > span:last-child { color: var(--muted); font-size: .8rem; }
.copy-status { min-height: 2em; margin-top: 16px; color: var(--muted); font-size: .8rem; overflow-wrap: anywhere; }
@media (max-width: 650px) { .social-grid { grid-template-columns: 1fr; } .social-grid > *, .social-grid > a { grid-column: auto; padding: 22px; } }
</style>
