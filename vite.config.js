import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/mlb': {
        target: 'https://statsapi.mlb.com/api/v1',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://x');
          const apiPath = url.searchParams.get('path');
          url.searchParams.delete('path');
          return `/${apiPath}?${url.searchParams.toString()}`;
        },
      }
    }
  }
})
