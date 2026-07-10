/**
 * 布局断点（像素）。
 *
 * 与 Tailwind 默认 md 断点一致，供 Web / Mobile 共享。
 * Web 侧走 CSS `@media` 或 Tailwind `md:`；Mobile 侧靠 `useWindowDimensions()`
 * 手工比对：`isTablet = width >= TABLET_MIN_WIDTH`。
 */
export const TABLET_MIN_WIDTH = 768
export const DESKTOP_MIN_WIDTH = 1024
