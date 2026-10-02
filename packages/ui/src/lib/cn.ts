import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并条件类名并消解 Tailwind 冲突（后出现的工具类胜出）。
 *
 * @param inputs - 任意 clsx 可接受的类名片段
 * @returns 去重后的类名字符串
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
