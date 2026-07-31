import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * Vitest 配置 —— 仅覆盖平台无关的纯 TypeScript 模块。
 *
 * React Native 组件（含 native module）不在此运行，
 * 需要通过原生 RN 测试渲染器（Detox / RTL-native）在后续阶段搭建。
 * 目前只跑：
 * - `src/lib/mobileAdapter.ts` 及类似的纯逻辑模块（依赖用 `vi.mock` 替身）
 * - `src/utils/**` 纯工具函数
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
