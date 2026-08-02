import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev only — lets the Dockerised test/browser containers reach the dev server
    // by service name instead of just localhost.
    allowedHosts: ['localhost', 'frontend', 'host.docker.internal'],
    proxy: {
      '/api': {
        // Use env var for Docker (backend service name), fallback to localhost
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['functions/**/*', 'node_modules'],
  },
})
