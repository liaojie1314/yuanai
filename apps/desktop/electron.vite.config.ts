import { resolve } from 'node:path'

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

import { RENDERER_ENTRIES } from './src/shared/window-entry'

const rendererRoot = resolve(__dirname, 'src/renderer')
const rendererInputs = Object.fromEntries(
  RENDERER_ENTRIES.map((entry) => [entry, resolve(rendererRoot, entry, 'index.html')])
)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
