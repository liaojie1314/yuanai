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
// 禁止向上层目录溯源查找 node_modules，避免 pnpm 上下文里
// 无意间解析到别的 workspace 的旧副本
config.resolver.disableHierarchicalLookup = true

// packages/core 使用 `.js` 相对导入指向 `.ts` 源，
// Metro 需要允许把 `.js` 请求解析回 `.ts`/`.tsx` 源文件
config.resolver.sourceExts = [...(config.resolver.sourceExts ?? []), 'ts', 'tsx']

module.exports = config
