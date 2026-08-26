import { defineConfig } from 'vite';

// 개발 중 /api 요청은 백엔드(8787)로 프록시.
export default defineConfig({
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    target: 'es2020',
  },
});
