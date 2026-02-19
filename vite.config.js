import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mlb': {
        target: 'https://statsapi.mlb.com/api/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mlb/, ''),
      }
    }
  }
})
