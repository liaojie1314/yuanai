import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // Playwright e2e 用 `pnpm test:e2e` 单独跑；在配置里排除，避免 vitest 收集到
    // `test.describe()` 而报 "Playwright Test did not expect test.describe()"
    exclude: ['node_modules/**', 'dist/**', 'out/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main/**', 'src/preload/**'],
      // 防退化棘轮：阈值取当前实测值向下取整，只用于拦住「覆盖率变差」。
      thresholds: {
        lines: 81,
        functions: 64,
        branches: 75,
        statements: 81,
      },
    },
  },
})
