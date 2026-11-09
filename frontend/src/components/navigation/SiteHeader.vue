<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getStageArtwork, stageAssets, stageIdentity } from '@/data/stage'
import { navigation, profile } from '@/data/portfolio'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const emit = defineEmits<{ 'menu-change': [open: boolean] }>()
const header = ref<HTMLElement | null>(null)
const menuPanel = ref<HTMLElement | null>(null)
const primaryNavigation = navigation.filter((item) => item.priority === 'primary')
const secondaryNavigation = navigation.filter((item) => item.priority === 'secondary')
const contactTarget = '/about#connect'
const isHome = computed(() => route.name === 'Home')
const previewTarget = ref('/works?type=music')
const preview = computed(() => {
  if (previewTarget.value === '/works?type=film') return { image: '/stage/cover-freestyle.svg', caption: 'Moving images / 影像' }
  if (previewTarget.value === '/about') return { image: stageAssets.artistPortrait || getStageArtwork(), caption: `${stageIdentity.name} / ${stageIdentity.alias}` }
  return { image: '/stage/cover-rain.svg', caption: 'Sound in motion / 音乐' }
})
const failedPreviewSources = ref<string[]>([])
const previewImage = computed(() => [preview.value.image, getStageArtwork()].find(src => !failedPreviewSources.value.includes(src)))
function onPreviewError() { if (previewImage.value) failedPreviewSources.value.push(previewImage.value) }
watch(() => preview.value.image, () => { failedPreviewSources.value = [] })
const menuOpen = ref(false)
const searchOpen = ref(false)
const searchKeyword = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const searchToggle = ref<HTMLButtonElement | null>(null)
const menuToggle = ref<HTMLButtonElement | null>(null)

function closePanels() {
  if (menuOpen.value && menuPanel.value?.contains(document.activeElement)) menuToggle.value?.focus()
  if (searchOpen.value && document.activeElement === searchInput.value) searchToggle.value?.focus()
  menuOpen.value = false
  searchOpen.value = false
}

function submitSearch() {
  const query = searchKeyword.value.trim()
  if (!query) return
  closePanels()
  router.push({ name: 'Search', query: { q: query } })
}

function logout() {
  userStore.logout()
  closePanels()
}

async function toggleSearch() {
  menuOpen.value = false
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    await nextTick()
    if (searchOpen.value) searchInput.value?.focus()
  }
}

async function toggleMenu() {
  searchOpen.value = false
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    await nextTick()
    if (menuOpen.value) menuPanel.value?.querySelector<HTMLAnchorElement>('a[href]')?.focus()
  } else menuToggle.value?.focus()
}

function isActive(to: string) {
  const target = router.resolve(to)
  if (target.path === '/works') {
    return route.path === '/works' && (route.query.type ?? 'music') === target.query.type
  }
  if (to === '/writing') return ['/writing', '/documents'].includes(route.path) || route.path.startsWith('/documents/') || route.path.startsWith('/tag/')
  return route.path === target.path
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    const trigger = searchOpen.value ? searchToggle.value : menuOpen.value ? menuToggle.value : null
    closePanels()
    trigger?.focus()
    return
  }
  if (event.key !== 'Tab' || !menuOpen.value || !header.value) return
  const focusable = Array.from(header.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]'))
    .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert], [hidden], [style*="display: none"]'))
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  } else if (!focusable.includes(document.activeElement as HTMLElement)) {
    event.preventDefault()
    first.focus()
  }
}

watch(menuOpen, (open) => emit('menu-change', open))
watch(() => route.fullPath, closePanels)
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (menuOpen.value) emit('menu-change', false)
})
</script>

<template>
  <header ref="header" class="site-header" :class="{ 'site-header--open': menuOpen, 'site-header--home': isHome }">
    <div class="header-inner">
      <div class="header-identity">
        <router-link to="/" class="brand" title="返回首页" @click="closePanels">
          <span class="brand-mark">{{ profile.monogram }}</span>
          <span class="brand-copy">
            <span class="brand-name">{{ profile.name }}</span>
            <span class="brand-role">{{ profile.role }}</span>
          </span>
        </router-link>
        <div class="header-account">
          <router-link v-if="!userStore.isLoggedIn" to="/login" class="account-link" @click="closePanels">登录</router-link>
          <template v-else>
            <span class="account-link account-link--user" :title="userStore.userInfo?.username || '正在读取用户信息'">
              {{ userStore.userInfo?.username || '读取中…' }}
            </span>
            <button class="logout-button" data-action="logout" type="button" @click="logout">退出</button>
          </template>
        </div>
      </div>

      <div class="header-actions">
        <router-link :to="contactTarget" class="contact-link header-contact" @click="closePanels">
          <span>Contact</span><span class="contact-label">联系</span><span aria-hidden="true">↗</span>
        </router-link>
        <button ref="searchToggle" class="icon-button search-toggle" type="button" :aria-expanded="searchOpen" aria-controls="site-search" @click="toggleSearch">
          <span class="sr-only">搜索文章</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7" /><path d="m16 16 5 5" /></svg>
        </button>
        <button ref="menuToggle" class="menu-toggle" type="button" :aria-expanded="menuOpen" aria-controls="mobile-navigation" :aria-label="menuOpen ? '关闭导航' : '打开导航'" @click="toggleMenu">
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

    <nav id="mobile-navigation" ref="menuPanel" v-show="menuOpen" class="mobile-navigation" aria-label="页面导航" :inert="!menuOpen" data-lenis-prevent>
      <figure class="menu-preview" aria-hidden="true">
        <img v-if="previewImage" :key="previewImage" :src="previewImage" alt="" width="720" height="900" decoding="async" @error="onPreviewError" />
        <figcaption><span>{{ preview.caption }}</span><span>GUOER / SELECTED WORK</span></figcaption>
      </figure>
      <div class="menu-directory">
      <p class="menu-kicker">Explore / {{ stageIdentity.name }}</p>
      <router-link
        v-for="(item, index) in primaryNavigation"
        :key="item.to"
        :to="item.to"
        class="mobile-nav-link mobile-nav-link--primary" @focus="previewTarget = item.to" @pointerenter="previewTarget = item.to"
        :class="{ 'is-active': isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : 'false'" :aria-current-value="isActive(item.to) ? 'page' : 'false'"
        @click="closePanels"
      >
        <span class="mobile-nav-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="mobile-nav-caption">{{ item.caption }}</span>
        <small>{{ item.label }}</small>
      </router-link>
      <router-link :to="contactTarget" class="contact-link mobile-contact" aria-current-value="false" @click="closePanels">
        <span>Contact <small>联系</small></span><span aria-hidden="true">↗</span>
      </router-link>
      <div class="mobile-secondary">
        <router-link
          v-for="(item, index) in secondaryNavigation"
          :key="item.to"
          :to="item.to"
          class="mobile-nav-link mobile-nav-link--secondary"
          :class="{ 'is-active': isActive(item.to) }"
          :aria-current="isActive(item.to) ? 'page' : 'false'" :aria-current-value="isActive(item.to) ? 'page' : 'false'"
          @click="closePanels"
        >
          <span class="mobile-nav-index">{{ String(primaryNavigation.length + index + 1).padStart(2, '0') }}</span>
          <span class="mobile-nav-caption">{{ item.caption }}</span>
          <small>{{ item.label }}</small>
        </router-link>
      </div>
      <div class="mobile-identity">
        <p>{{ profile.name }} <span>{{ profile.role }}</span></p>
        <span>{{ profile.availability }}</span>
      </div>
      </div>
    </nav>
  </header>
</template>

<style scoped>
.site-header { --header-height: 80px; position: sticky; top: 0; z-index: 40; color: var(--ink); background: var(--void, #080808); }
.site-header--home { position: fixed; inset: 0 0 auto; background: transparent; }
.site-header--open { background: var(--void, #080808); }
.header-inner { display: flex; align-items: center; justify-content: space-between; gap: 20px; width: var(--page-width, 89%); min-height: var(--header-height); margin: auto; }
.header-identity { display: flex; align-items: center; gap: clamp(14px, 2vw, 28px); min-width: 0; }
.brand { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 10px; color: inherit; text-decoration: none; }
.brand-mark { display: grid; place-items: center; width: 34px; height: 38px; color: var(--acid); font: 800 .85rem var(--mono-font); }
.brand-copy { display: grid; gap: 5px; }
.brand-name { font: 700 .75rem var(--mono-font); letter-spacing: .14em; }
.brand-role { color: var(--muted); font: .55rem var(--body-font); }
.header-account { display: flex; align-items: center; gap: 9px; min-width: 0; }
.account-link { min-width: 0; color: var(--muted); font-size: .72rem; text-decoration: none; white-space: nowrap; }
.account-link--user { overflow: hidden; max-width: 108px; text-overflow: ellipsis; }
.logout-button { flex: 0 0 auto; min-height: 44px; padding: 5px 0; border: 0; background: transparent; color: var(--muted); font: .6rem var(--mono-font); cursor: pointer; text-decoration: underline; text-underline-offset: 4px; }
.header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 12px; }
.contact-link { display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; color: inherit; text-decoration: none; }
.header-contact { min-height: 44px; margin-right: 12px; font: .65rem var(--mono-font); }
.contact-label { color: var(--muted); font: .6rem var(--body-font); }
.icon-button, .menu-toggle { flex: 0 0 auto; width: 44px; height: 44px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
.icon-button { display: grid; place-items: center; border-radius: 50%; }
.icon-button svg { width: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; }
.menu-toggle { display: block; padding: 12px; }
.menu-toggle > .bar { display: block; width: 100%; height: 1px; margin: 5px 0; background: currentColor; transition: transform 180ms ease; }
.site-header--open .menu-toggle > .bar:first-of-type { transform: translateY(3px) rotate(45deg); }
.site-header--open .menu-toggle > .bar:last-of-type { transform: translateY(-3px) rotate(-45deg); }
.header-search { box-sizing: border-box; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 20px; width: 100%; margin: 0; padding: 20px 5.5vw; border-block: 1px solid var(--line); background: var(--void); }
.header-search label, .header-search button { font: .65rem var(--mono-font); }
.header-search input { min-width: 0; width: 100%; border: 0; border-bottom: 1px solid currentColor; border-radius: 0; background: transparent; color: inherit; font: 1rem var(--body-font); }
.header-search button { min-height: 44px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.mobile-navigation { box-sizing: border-box; position: fixed; inset: var(--header-height) 0 0; display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1fr); align-items: center; gap: 8vw; width: 100%; padding: clamp(24px, 5vh, 64px) 8vw; overflow-y: auto; overscroll-behavior: contain; background: var(--void, #080808); }
.menu-preview { position: relative; align-self: stretch; min-height: 260px; max-height: 700px; margin: 0; overflow: hidden; background: radial-gradient(ellipse at 60% 35%, #364b72, #171e21 45%, #080a0a 80%); }
.menu-preview img { position: absolute; width: 100%; height: 100%; object-fit: cover; }
.menu-preview::after { content: ''; position: absolute; inset: 50% 0 0; background: linear-gradient(transparent, #080808b3); }
.menu-preview figcaption { position: absolute; z-index: 1; inset: auto 24px 22px; display: flex; flex-direction: column; gap: 10px; font: .65rem/1.5 var(--mono-font); color: #f2f0e9; }
.menu-preview figcaption span:last-child { opacity: .6; font-size: .5rem; letter-spacing: .08em; }
.menu-directory { min-width: 0; }
.menu-kicker { margin: 0 0 22px; color: var(--muted); font: .6rem var(--mono-font); letter-spacing: .08em; }
.mobile-nav-link { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: baseline; gap: 14px; min-height: 44px; padding: 16px 0; color: inherit; text-decoration: none; }
.mobile-nav-index { color: var(--muted); font: .6rem var(--mono-font); }
.mobile-nav-caption { font: 400 clamp(3rem, 6.4vw, 7.4rem)/.95 var(--display-font); letter-spacing: -.055em; }
.mobile-nav-link small { color: var(--muted); font-size: .72rem; }
.mobile-nav-link:hover .mobile-nav-caption, .mobile-nav-link:focus-visible .mobile-nav-caption, .mobile-nav-link.is-active .mobile-nav-caption { color: var(--acid); }
.mobile-contact { min-height: 44px; margin: 24px 0; padding: 0 0 12px 38px; border-bottom: 1px solid var(--line); font: .85rem var(--mono-font); }
.mobile-contact small { margin-left: 12px; color: var(--muted); font: .65rem var(--body-font); }
.mobile-secondary { display: flex; flex-wrap: wrap; column-gap: 26px; }
.mobile-nav-link--secondary { grid-template-columns: auto auto; gap: 8px; min-height: 44px; padding: 8px 0; color: var(--muted); }
.mobile-nav-link--secondary .mobile-nav-index { display: none; }
.mobile-nav-link--secondary .mobile-nav-caption { font: .75rem var(--mono-font); letter-spacing: 0; }
.mobile-nav-link--secondary small { font-size: .6rem; }
.mobile-identity { padding-top: 24px; color: var(--muted); font: .6rem/1.7 var(--mono-font); overflow-wrap: anywhere; }
.mobile-identity p { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 0 0 6px; color: var(--ink); }
.mobile-identity p > span { color: var(--muted); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--acid); outline-offset: 5px; }
@media (max-width: 800px) {
  .site-header { --header-height: 72px; }
  .mobile-navigation { align-items: start; grid-template-columns: 1fr; gap: 24px; padding: 24px 5.5vw 36px; }
  .menu-preview { grid-row: 2; height: 150px; min-height: 150px; }
  .menu-preview img { object-position: center 44%; }
  .mobile-nav-caption { font-size: clamp(3rem, 12vw, 5rem); }
  .mobile-nav-link--primary { padding: 14px 0; }
  .mobile-contact { margin: 16px 0; }
  .mobile-identity { padding-top: 14px; }
  .header-search { grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
  .header-search label { grid-column: 1 / -1; }
}
@media (max-width: 680px) { .header-contact { display: none; } }
@media (max-width: 520px) {
  .site-header { --header-height: 66px; }
  .header-inner, .header-identity { gap: 8px; }
  .brand { gap: 4px; }
  .brand-mark { width: 24px; }
  .brand-name { font-size: .68rem; letter-spacing: .06em; }
  .brand-role { display: none; }
  .header-account { gap: 7px; }
  .account-link { font-size: .68rem; }
  .account-link--user { max-width: clamp(32px, 10vw, 70px); }
  .header-actions { gap: 6px; }
}
</style>
