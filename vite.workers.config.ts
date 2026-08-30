import { defineConfig } from 'vitest/config'

export default defineConfig({
  logLevel: 'error',
  test: {
    globals: true,
    environment: 'node',
    include: ['functions/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules'],
    setupFiles: ['./functions/_lib/test-setup.ts'],
  },
})
