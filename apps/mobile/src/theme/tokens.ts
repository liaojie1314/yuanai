/**
 * 全局颜色 / 圆角 / 间距 token（与 tailwind.config.js 保持一致）。
 *
 * NativeWind 提供 className 样式驱动主流场景；仍有需要 StyleSheet 内嵌颜色
 * 的地方（如 gradient 起止色、Animated 值），从本文件读取以保持单一真相源。
 */

export const brand = {
  from: '#6366F1',
  to: '#8B5CF6',
  solid: '#7C3AED',
  light: '#EDE9FE',
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
  focus: '#6366F1',
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
