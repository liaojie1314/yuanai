import { Minus, Square, X } from 'lucide-react'
import { useLayoutEffect, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DESKTOP_PRODUCT_NAME } from './i18n'
import './desktop-titlebar.css'

/** Linux 无边框窗口使用的最小桌面标题栏。 */
export function DesktopTitlebar({ children }: { children: ReactNode }): ReactElement {
  const { t } = useTranslation()
  const usesCustomTitlebar = window.yuanai.platform === 'linux'
  const path = new URL(window.location.href).pathname
  const allowMaximize =
    !path.includes('/login/') && !path.includes('/about/') && !path.includes('/oauth/')

  const authenticationTitle =
    window.location.hash === '#/register'
      ? t('desktop.auth.registerTitle')
      : window.location.hash === '#/forgot'
        ? t('desktop.auth.resetTitle')
        : t('desktop.auth.loginTitle')
  const windowLabel = path.includes('/settings/')
    ? t('settings.title')
    : path.includes('/login/')
      ? authenticationTitle
      : path.includes('/oauth/')
        ? t('desktop.oauth.completing')
        : path.includes('/artifact/')
          ? t('desktop.artifact.preview')
          : path.includes('/about/')
            ? t('settings.sections.about')
            : ''
  const title = windowLabel ? `${windowLabel} - ${DESKTOP_PRODUCT_NAME}` : DESKTOP_PRODUCT_NAME

  useLayoutEffect(() => {
    document.title = title
  }, [title])

  return (
    <>
      {usesCustomTitlebar ? (
        <header className="desktop-titlebar" aria-label={t('desktop.titlebar.windowControls')}>
          <span className="desktop-titlebar__title">{title}</span>
          <div
            className="desktop-titlebar__controls"
            aria-label={t('desktop.titlebar.windowControls')}
          >
            <button
              type="button"
              aria-label={t('desktop.titlebar.minimize')}
              title={t('desktop.titlebar.minimize')}
              onClick={() => void window.yuanai.window.minimize()}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            {allowMaximize ? (
              <button
                type="button"
                aria-label={t('desktop.titlebar.maximize')}
                title={t('desktop.titlebar.maximize')}
                onClick={() => void window.yuanai.window.toggleMaximize()}
              >
                <Square size={13} aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="desktop-titlebar__close"
              type="button"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => void window.yuanai.window.close()}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
      ) : null}
      {children}
    </>
  )
}
