<template>
  <section class="add-connection" :aria-labelledby="`${formId}-heading`">
    <h2 :id="`${formId}-heading`">添加 Notion 连接</h2>
    <p :id="`${formId}-help`" class="help">填写连接名称和 Notion 密钥，验证成功后即可选择该连接。</p>
    <form :aria-describedby="`${formId}-help`" :aria-busy="busy" autocomplete="off" @submit.prevent="submit">
      <label :for="`${formId}-label`">连接名称</label>
      <input :id="`${formId}-label`" v-model="label" name="label" type="text" required maxlength="100" :disabled="busy" />
      <label :for="`${formId}-token`">Notion 密钥</label>
      <input :id="`${formId}-token`" v-model="token" name="token" type="password" autocomplete="off" autocapitalize="none" :spellcheck="false" required maxlength="4096" :disabled="busy" />
      <button type="submit" :disabled="busy || !label.trim() || !token.trim()">{{ busy ? '验证中…' : '添加连接' }}</button>
    </form>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="success" class="notice success" role="status">连接已添加</p>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from 'vue'
import { createNotionConnection, NotionConnectionCreateError } from '@/api/notion-connections'
import type { NotionConnection } from '@/api/notion'

const emit = defineEmits<{ created: [connection: NotionConnection] }>()
const formId = `notion-add-${useId()}`
const label = ref('')
const token = ref('')
const busy = ref(false)
const error = ref('')
const success = ref(false)
let controller: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let mounted = true

async function submit() {
  if (busy.value || !label.value.trim() || !token.value.trim()) return
  busy.value = true
  error.value = ''
  success.value = false
  const current = new AbortController()
  controller = current
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        current.abort()
        reject(new NotionConnectionCreateError(504))
      }, 30000)
    })
    const connection = await Promise.race([
      createNotionConnection({ label: label.value.trim(), token: token.value.trim() }, current.signal),
      timeout,
    ])
    if (!mounted || current.signal.aborted) return
    success.value = true
    emit('created', { id: connection.id, label: connection.label, configured: connection.configured })
  } catch (failure: unknown) {
    if (mounted) {
      error.value = failure instanceof NotionConnectionCreateError
        ? failure.message : '添加连接失败，请稍后重试'
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    token.value = ''
    busy.value = false
    controller = undefined
  }
}

onBeforeUnmount(() => {
  mounted = false
  controller?.abort()
  if (timer !== undefined) clearTimeout(timer)
  token.value = ''
})
</script>

<style scoped>
.add-connection { padding: 26px; border: 1px solid var(--admin-border-soft); border-radius: 12px; background: var(--admin-surface); margin: 20px 0; color: var(--admin-text); }
h2 { font-size: 19px; margin: 0 0 15px; }
.help { color: var(--admin-muted); font-size: 13px; line-height: 1.7; }
label { display: block; font-size: 14px; margin: 16px 0 8px; }
input { display: block; box-sizing: border-box; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--admin-border); border-radius: 6px; font: inherit; background: var(--admin-surface); color: var(--admin-text); }
button { min-height: 44px; margin-top: 18px; padding: 10px 15px; border: 1px solid var(--admin-border); border-radius: 6px; background: var(--admin-surface); color: var(--admin-text); font: inherit; font-size: 14px; cursor: pointer; }
button:not(:disabled):hover { background: var(--admin-accent-soft); }
button:disabled { opacity: .55; cursor: default; }
:is(button, input):focus-visible { outline: 3px solid var(--admin-accent); outline-offset: 3px; }
.notice { margin: 16px 0 0; padding: 14px 18px; border-radius: 6px; line-height: 1.7; }
.error { background: var(--admin-danger-bg); color: var(--admin-danger); }
.success { background: var(--admin-success-bg); color: var(--admin-success); }
@media (max-width: 700px) { .add-connection { padding: 18px; } }
</style>
