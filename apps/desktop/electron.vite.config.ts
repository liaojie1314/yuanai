import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

import { RENDERER_ENTRIES } from './src/shared/window-entry'

const rendererRoot = resolve(__dirname, 'src/renderer')
const rendererInputs = Object.fromEntries(
  RENDERER_ENTRIES.map((entry) => [entry, resolve(rendererRoot, entry, 'index.html')])
)

// 以 package.json 版本注入构建期常量；dev/E2E 以文件路径启动 Electron 时
// app.getVersion() 会退回 Electron 自身版本，不能用作品版本来源。
const { version: appVersion } = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8')
) as {
  version: string
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: rendererRoot,
    resolve: {
      alias: {
        '@renderer': rendererRoot,
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: rendererInputs,
      },
    },
    plugins: [react()],
  },
})
