const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

/**
 * Monorepo 版 Metro 配置。
 *
 * Expo 的默认 config 只监听当前 app 目录；而 @yuanai/core、@yuanai/types
 * 通过 pnpm workspace 链接进来，源码位于仓库根 `packages/` 下。
 * `watchFolders` 让 Metro 感知源码变化并触发 fast refresh；
 * `nodeModulesPaths` 告诉 Metro 允许沿两条路径（本 app + 根）解析
 * 依赖，避免 pnpm 硬链接导致的 "Unable to resolve module" 报错。
 */
const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [monorepoRoot]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]
// 保留 hierarchical lookup（true 会导致 metro 内部子路径解析失败，
// 因为 pnpm 的 .pnpm/node_modules 里的 metro-cache 版本与 apps/mobile
// 走 expo SDK 52 主体的 metro 版本不一致）

// packages/core 使用 `.js` 相对导入指向 `.ts` 源，
// Metro 需要允许把 `.js` 请求解析回 `.ts`/`.tsx` 源文件
config.resolver.sourceExts = [...(config.resolver.sourceExts ?? []), 'ts', 'tsx']

// 保持 Metro 默认关闭 unstable_enablePackageExports —— 一旦开启，
// pnpm 布局下 React 会通过 exports 别名解析成"另一份"，导致
// "Cannot read property 'useMemo' of null"。子路径改在 metro
// 层做 alias（见下）。
config.resolver.unstable_enablePackageExports = false

// 把 @yuanai/core/<sub> 手动映射到 packages/core 的 src 源，
// 与 packages/core/package.json 的 exports 表保持一一对应。
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
}
const coreExports = {
  '@yuanai/core': path.resolve(monorepoRoot, 'packages/core/src/index.ts'),
  '@yuanai/core/stores': path.resolve(monorepoRoot, 'packages/core/src/stores/index.ts'),
  '@yuanai/core/hooks': path.resolve(monorepoRoot, 'packages/core/src/hooks/index.ts'),
  '@yuanai/core/api': path.resolve(monorepoRoot, 'packages/core/src/api/index.ts'),
  '@yuanai/core/utils': path.resolve(monorepoRoot, 'packages/core/src/utils/index.ts'),
  '@yuanai/core/platform': path.resolve(monorepoRoot, 'packages/core/src/platform/index.ts'),
  '@yuanai/types': path.resolve(monorepoRoot, 'packages/types/src/index.ts'),
}

// 强制单例的 npm 包：pnpm 会为 react18/19 peer 生成两份变体，
// 一份在 apps/mobile/node_modules 下（react-18），一份在
// packages/core/node_modules 下（react-19，因为 core 也被 apps/web 用）。
// 如果两份同时进 bundle：
//   - react 双份 → "Cannot read property 'useMemo' of null"
//   - @tanstack/react-query 双份 → Context 不一致，QueryClientProvider
//     在 A 变体里 set，core hooks 在 B 变体里 get 到 undefined
// 都强行走 apps/mobile 本地那份即可。
const singletons = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  '@tanstack/react-query': path.resolve(projectRoot, 'node_modules/@tanstack/react-query'),
}

const defaultResolveRequest = config.resolver.resolveRequest

// react-native-syntax-highlighter@2.1.0 按 react-syntax-highlighter@6 的旧目录
// 布局 require 子路径；v16 把实现挪进 dist/cjs 且根目录不再提供这些入口，
// 这里做一层子路径映射（dist/cjs 里的 named export 与旧版一致）。
const rshCompat = {
  // 本项目只用 hljs 高亮；v16 主入口 index.js 会连带 prism/prism-async 一起
  // 打包，而它们 require('refractor/all')（refractor v5 走 exports 子路径，
  // Metro 关闭 package exports 后解析不到）。直接映射到 default-highlight
  // （纯 hljs 组件，default export 与 v6 主入口一致）。/prism 仅在
  // highlighter="prism" 时真正渲染，本项目不用，同样指向 hljs 保证可解析。
  'react-syntax-highlighter': 'react-syntax-highlighter/dist/cjs/default-highlight',
  'react-syntax-highlighter/prism': 'react-syntax-highlighter/dist/cjs/default-highlight',
  'react-syntax-highlighter/create-element': 'react-syntax-highlighter/dist/cjs/create-element',
  'react-syntax-highlighter/styles/hljs': 'react-syntax-highlighter/dist/cjs/styles/hljs',
  'react-syntax-highlighter/styles/prism': 'react-syntax-highlighter/dist/cjs/styles/prism',
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (rshCompat[moduleName]) {
    return context.resolveRequest(context, rshCompat[moduleName], platform)
  }
  const target = coreExports[moduleName]
  if (target) {
    return { type: 'sourceFile', filePath: target }
  }
  if (singletons[moduleName]) {
    if (process.env.YUANAI_METRO_TRACE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[metro-singleton] ${moduleName} <- ${context.originModulePath} => ${singletons[moduleName]}`
      )
    }
    return context.resolveRequest(context, singletons[moduleName], platform)
  }
  // packages/core 内部 .js 相对导入 → 重定向到 .ts 源
  if (
    moduleName.endsWith('.js') &&
    moduleName.startsWith('.') &&
    context.originModulePath.includes(`${path.sep}packages${path.sep}core${path.sep}`)
  ) {
    const tsCandidate = moduleName.replace(/\.js$/, '.ts')
    try {
      return context.resolveRequest(context, tsCandidate, platform)
    } catch {
      /* fall through */
    }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
