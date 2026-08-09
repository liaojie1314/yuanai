/** Electron renderer 构建入口，顺序用于构建和契约测试。 */
export const RENDERER_ENTRIES = ['main', 'login', 'settings', 'about', 'artifact', 'oauth'] as const

/** 可创建的 renderer 入口。 */
export type RendererEntry = (typeof RENDERER_ENTRIES)[number]
