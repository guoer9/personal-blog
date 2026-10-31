<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { navigation, profile } from '@/data/portfolio'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const menuOpen = ref(false)
const searchOpen = ref(false)
const searchKeyword = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const isDark = computed(() => ['PostDetail'].includes(String(route.name)))

function submitSearch() {
  const query = searchKeyword.value.trim()
  if (!query) return
  menuOpen.value = false
  searchOpen.value = false
  router.push({ name: 'Search', query: { q: query } })
}

async function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    searchInput.value?.focus()
  }
}

function isActive(to: string) {
  if (to === '/writing') return String(route.name).includes('Archive') || route.path === '/writing'
  if (to === '/about') return route.path === '/about'
  return false
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    menuOpen.value = false
    searchOpen.value = false
  }
}

onMounted(() => document.addEventListener('keydown', closeOnEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', closeOnEscape))
</script>

<template>
  <header class="site-header" :class="{ 'site-header--dark': isDark, 'site-header--open': menuOpen }">
    <div class="header-inner">
      <router-link to="/" class="brand" aria-label="返回首页">
        <span class="brand-mark">{{ profile.monogram }}</span>
        <span class="brand-name">{{ profile.name }}</span>
      </router-link>

      <nav class="desktop-navigation" aria-label="主导航">
        <router-link
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ 'is-active': isActive(item.to) }"
        >
          <span>{{ item.label }}</span>
          <small>{{ item.caption }}</small>
        </router-link>
      </nav>

      <div class="header-actions">
        <button class="icon-button search-toggle" type="button" :aria-expanded="searchOpen" aria-controls="site-search" @click="toggleSearch">
          <span class="sr-only">搜索文章</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7" /><path d="m16 16 5 5" /></svg>
        </button>
        <router-link v-if="userStore.isAdmin" to="/admin" class="admin-link">控制台</router-link>
        <button class="menu-toggle" type="button" :aria-expanded="menuOpen" aria-controls="mobile-navigation" :aria-label="menuOpen ? '关闭导航' : '打开导航'" @click="menuOpen = !menuOpen">
          <span class="bar" aria-hidden="true" />
          <span class="bar" aria-hidden="true" />
        </button>
      </div>
    </div>

    <form id="site-search" v-show="searchOpen" class="header-search" role="search" @submit.prevent="submitSearch">
      <label for="header-search-input">检索文章</label>
      <input id="header-search-input" ref="searchInput" v-model="searchKeyword" name="q" type="search" autocomplete="off" placeholder="输入关键词，按 Enter 开始" />
      <button type="submit">SEARCH ↗</button>
    </form>

    <nav id="mobile-navigation" v-show="menuOpen" class="mobile-navigation" aria-label="移动端导航">
      <router-link v-for="(item, index) in navigation" :key="item.to" :to="item.to" @click="menuOpen = false">
        <span>{{ String(index + 1).padStart(2, '0') }}</span>{{ item.caption }}
      </router-link>
      <router-link to="/writing" @click="menuOpen = false"><span>04</span>Archive</router-link>
      <router-link v-if="userStore.isAdmin" to="/admin" @click="menuOpen = false"><span>05</span>Admin</router-link>
    </nav>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid var(--line);
  background: rgba(244, 241, 234, 0.9);
  backdrop-filter: blur(18px);
}
.site-header--dark {
  border-color: rgba(255, 255, 255, 0.16);
  color: #f4f1ea;
  background: rgba(16, 17, 18, 0.92);
}
.header-inner {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 26px;
  width: var(--page-width);
  min-height: 76px;
  margin: 0 auto;
}
.brand { display: inline-flex; align-items: center; gap: 12px; width: fit-content; color: inherit; text-decoration: none; }
.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--acid);
  font: 800 0.78rem var(--mono-font);
}
.site-header--dark .brand-mark { background: var(--acid); color: var(--ink); }
.brand-name { font: 700 0.76rem var(--mono-font); letter-spacing: 0.14em; }
.desktop-navigation { display: flex; align-items: stretch; gap: 34px; }
.nav-link {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 27px 0 24px;
  color: inherit;
  text-decoration: none;
}
.nav-link::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: right;
  transition: transform 220ms ease;
}
.nav-link:hover::after, .nav-link.is-active::after { transform: scaleX(1); transform-origin: left; }
.nav-link span { font-size: 0.86rem; }
.nav-link small { color: var(--muted); font: 0.59rem var(--mono-font); letter-spacing: 0.04em; text-transform: uppercase; }
.site-header--dark .nav-link small { color: #979b9b; }
.header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 16px; }
.icon-button, .menu-toggle { border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
.icon-button { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; }
.icon-button svg { width: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; }
.admin-link { color: inherit; font: 0.68rem var(--mono-font); letter-spacing: 0.04em; text-decoration: none; }
.menu-toggle { display: none; width: 36px; height: 36px; padding: 10px; }
.menu-toggle > .bar { display: block; width: 100%; height: 1px; background: currentColor; margin: 5px 0; transition: transform 180ms ease; }
.header-search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  width: var(--page-width);
  margin: 0 auto;
  padding: 18px 0;
  border-top: 1px solid var(--line);
}
.header-search label, .header-search button { font: 0.65rem var(--mono-font); letter-spacing: 0.08em; }
.header-search input { width: 100%; border: 0; border-bottom: 1px solid currentColor; background: transparent; color: inherit; font: 1rem var(--body-font); outline: none; }
.header-search button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.mobile-navigation { display: none; }
@media (max-width: 820px) {
  .header-inner { grid-template-columns: 1fr auto; min-height: 66px; }
  .desktop-navigation, .admin-link { display: none; }
  .menu-toggle { display: block; }
  .mobile-navigation { display: grid; width: var(--page-width); margin: 0 auto; padding: 10px 0 28px; border-top: 1px solid var(--line); }
  .mobile-navigation a { display: flex; align-items: baseline; gap: 14px; padding: 15px 0; border-bottom: 1px solid var(--line); color: inherit; font-family: var(--display-font); font-size: 2rem; letter-spacing: -0.04em; text-decoration: none; }
  .mobile-navigation a span { font: 0.63rem var(--mono-font); color: var(--muted); }
  .site-header--open .menu-toggle > .bar:first-of-type { transform: translateY(3px) rotate(45deg); }
  .site-header--open .menu-toggle > .bar:last-of-type { transform: translateY(-3px) rotate(-45deg); }
  .header-search { grid-template-columns: 1fr auto; gap: 12px; }
  .header-search label { grid-column: 1 / -1; }
}
@media (max-width: 520px) {
  .brand-name { display: none; }
  .header-actions { gap: 10px; }
  .header-search { grid-template-columns: 1fr auto; }
}
</style>
