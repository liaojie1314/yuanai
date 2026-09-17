import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any],
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
    setupFiles: ['./tests/setup.ts'],
    // Playwright e2e 用 `pnpm test:e2e` 单独跑；这里排除以免 vitest 尝试收集
    exclude: ['node_modules/**', 'dist/**', '.next/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.{ts,tsx}',
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
      ],
      // 防退化棘轮：阈值取当前实测值向下取整，只用于拦住「覆盖率变差」，不是目标值。
      thresholds: {
        lines: 44,
        functions: 50,
        branches: 70,
        statements: 44,
      },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
