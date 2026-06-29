import { notFound } from 'next/navigation'
import { getRequestConfig } from 'next-intl/server'

export const locales = ['zh-CN', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'zh-CN'

export const localeNames: Record<Locale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
}

export default getRequestConfig(async ({ locale }) => {
  if (!locale || !locales.includes(locale as Locale)) notFound()

  return {
    locale: locale as string,
    messages: (await import(`./locales/${locale}.json`)).default,
  }
})
