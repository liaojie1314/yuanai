'use client'

import { useTranslations as useNextIntlTranslations } from 'next-intl'
import { defaultLocale, locales, type Locale } from './config'

export { locales, defaultLocale, type Locale }

export function useTranslations(namespace?: string) {
  return useNextIntlTranslations(namespace)
}

export function getLocaleFromCookie(): Locale {
  if (typeof document === 'undefined') return defaultLocale
  const cookie = document.cookie
    .split('; ')
    .find((row) => row.startsWith('NEXT_LOCALE='))
    ?.split('=')[1]
  return (cookie as Locale) ?? defaultLocale
}

export function setLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`
}
