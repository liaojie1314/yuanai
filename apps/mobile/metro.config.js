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

// 强制 React / React Native 走 apps/mobile 本地那份，防止 pnpm hoist 出
// apps/web 用的 React 19 混进 bundle，导致 "Cannot read property 'useMemo'
// of null"（React 只能有一份 dispatcher 实例）。
const singletons = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
}

const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = coreExports[moduleName]
  if (target) {
    return { type: 'sourceFile', filePath: target }
  }
  if (singletons[moduleName]) {
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
