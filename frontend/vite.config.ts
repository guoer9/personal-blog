import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // The isolated local template exposes FastAPI on 8001. Keep the
        // environment override for other deployments, but make the default
        // match the documented local startup path.
        target: process.env.BLOG_API_PROXY || 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.BLOG_API_PROXY || 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
