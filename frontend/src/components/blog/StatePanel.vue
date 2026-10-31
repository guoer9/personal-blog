<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow?: string
  title: string
  description: string
  actionLabel?: string
  compact?: boolean
}>(), {
  eyebrow: 'NOTHING HERE / YET',
  actionLabel: '',
  compact: false,
})
defineEmits<{ action: [] }>()
</script>

<template>
  <div class="state-panel" :class="{ 'state-panel--compact': compact }">
    <div class="state-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
    <div>
      <p class="eyebrow">{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <p class="state-description">{{ description }}</p>
      <button v-if="actionLabel" class="text-action" type="button" @click="$emit('action')">
        {{ actionLabel }} <span aria-hidden="true">↗</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.state-panel {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 28px;
  min-height: 240px;
  padding: 38px;
  border: 1px solid var(--line);
  background: var(--paper);
}
.state-panel--compact { min-height: 180px; padding: 26px; }
.state-mark {
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  border: 1px solid var(--ink);
  border-radius: 50%;
  transform: rotate(18deg);
}
.state-mark span {
  position: absolute;
  width: 44px;
  height: 1px;
  background: var(--ink);
}
.state-mark span:nth-child(2) { transform: rotate(60deg); }
.state-mark span:nth-child(3) { transform: rotate(-60deg); }
.eyebrow {
  margin-bottom: 10px;
  font-family: var(--mono-font);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  color: var(--muted);
}
h2 { font-family: var(--display-font); font-size: clamp(1.8rem, 3vw, 2.8rem); letter-spacing: -0.04em; }
.state-description { max-width: 620px; margin-top: 12px; color: var(--muted); }
.text-action {
  margin-top: 20px;
  padding: 0 0 6px;
  border: 0;
  border-bottom: 1px solid currentColor;
  background: transparent;
  color: var(--ink);
  font: 700 0.78rem var(--mono-font);
  cursor: pointer;
}
@media (max-width: 620px) {
  .state-panel { grid-template-columns: 1fr; gap: 20px; padding: 26px; }
}
</style>
