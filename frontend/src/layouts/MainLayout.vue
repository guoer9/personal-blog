<script setup lang="ts">
import SiteHeader from '@/components/navigation/SiteHeader.vue'
import { profile } from '@/data/portfolio'
</script>

<template>
  <div class="main-layout">
    <a class="skip-link" href="#main-content">跳到正文</a>
    <SiteHeader />
    <main id="main-content" class="site-main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <footer class="footer">
      <div class="page-shell">
        <div class="footer-inner">
          <div>
            <router-link to="/" class="footer-mark">{{ profile.monogram }} {{ profile.name }}</router-link>
            <p class="footer-copy">{{ profile.role }} · {{ profile.location }}</p>
          </div>
          <div class="footer-links">
            <router-link to="/writing">文章归档</router-link>
            <router-link to="/about">关于</router-link>
            <router-link to="/search">搜索</router-link>
          </div>
        </div>
        <p class="footer-legal">© {{ new Date().getFullYear() }} {{ profile.name }} · Built with curiosity and code.</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.main-layout { min-height: 100vh; display: flex; flex-direction: column; }
.site-main { flex: 1; }
.skip-link { position: fixed; z-index: 1000; top: 12px; left: 12px; padding: 10px 15px; background: var(--ink); color: var(--paper); transform: translateY(-160%); }
.skip-link:focus { transform: none; }
.page-enter-active, .page-leave-active { transition: opacity 180ms ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
