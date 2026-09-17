import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // 防退化棘轮：阈值取当前实测值向下取整，只用于拦住「覆盖率变差」。
      thresholds: {
        lines: 42,
        functions: 68,
        branches: 75,
        statements: 42,
      },
    },
  },
})
