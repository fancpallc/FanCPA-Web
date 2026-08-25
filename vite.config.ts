/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  logLevel: 'error',
  plugins: [react()],
  server: {
    allowedHosts: ['localhost', 'frontend', 'host.docker.internal'],
    proxy: { '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8788', changeOrigin: true } },
  },
  // @ts-ignore
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['functions/**/*', 'node_modules'],
  },
})

