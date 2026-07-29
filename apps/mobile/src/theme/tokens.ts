/**
 * 全局颜色 / 圆角 / 间距 token（与 tailwind.config.js 保持一致）。
 *
 * NativeWind 提供 className 样式驱动主流场景；仍有需要 StyleSheet 内嵌颜色
 * 的地方（如 gradient 起止色、Animated 值），从本文件读取以保持单一真相源。
 */

// 与 web `apps/web/src/app/globals.css` 的 --brand / --brand-h / --brand-light
// 保持一致：主色 blue-500，hover blue-600，light blue-50。
// from/to 用于极少数需要渐变的场景（如启动屏、logo），使用 web 的 --auth-grad
// 深浅两端色以保持视觉延续。
export const brand = {
  from: '#1d4ed8', // blue-700
  to: '#3b82f6', // blue-500
  solid: '#3b82f6', // = web --brand
  hover: '#2563eb', // = web --brand-h
  light: '#eff6ff', // = web --brand-light
} as const

export const bg = {
  base: '#FAFAF8',
  surface: '#FFFFFF',
  elevated: '#F4F4F2',
} as const

export const bgDark = {
  base: '#0F1117',
  surface: '#171A22',
  elevated: '#20242E',
} as const

export const text = {
  primary: '#1A1A2E',
  secondary: '#6B7280',
  muted: '#9CA3AF',
  onDarkPrimary: '#F5F5F5',
  onDarkSecondary: '#9AA0A6',
} as const

export const border = {
  default: '#E5E7EB',
  focus: '#3b82f6',
  danger: '#EF4444',
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  chat: 18,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

// ─────────────────────────────────────────────────────
// ThemeTokens — 动态主题接口（明色 / 暗色双套）
// useTheme() hook 消费；colorScheme 字段用于少数需要条件判断的场景（如 ripple 颜色）
// ─────────────────────────────────────────────────────
export interface ThemeTokens {
  colorScheme: 'light' | 'dark'
  bg: { base: string; surface: string; elevated: string }
  text: { primary: string; secondary: string; muted: string; inverse: string }
  border: { default: string; focus: string; danger: string }
  brand: typeof brand
  radius: typeof radius
  spacing: typeof spacing
}

export const lightTheme: ThemeTokens = {
  colorScheme: 'light',
  bg: { base: '#FAFAF8', surface: '#FFFFFF', elevated: '#F4F4F2' },
  text: { primary: '#1A1A2E', secondary: '#6B7280', muted: '#9CA3AF', inverse: '#FFFFFF' },
  border: { default: '#E5E7EB', focus: '#3b82f6', danger: '#EF4444' },
  brand,
  radius,
  spacing,
}

export const darkTheme: ThemeTokens = {
  colorScheme: 'dark',
  bg: { base: '#0F1117', surface: '#171A22', elevated: '#20242E' },
  text: { primary: '#F5F5F5', secondary: '#9AA0A6', muted: '#6B7280', inverse: '#0F1117' },
  border: { default: '#2A2F3A', focus: '#60A5FA', danger: '#F87171' },
  brand,
  radius,
  spacing,
}
