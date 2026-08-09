import type { WebContents } from 'electron'

import type { AppRuntimeConfig } from '../../shared/runtime-config'
import type { TrustedWebContentsRegistry } from '../ipc/guards'
import { buildContentSecurityPolicy } from './csp'
import { lockRendererNavigation } from './navigation'
import { installPermissionHandler } from './permissions'

/** 安装单个 renderer 所需的 CSP、权限和导航安全策略。 */
export function secureRenderer(
  webContents: WebContents,
  trustedWebContents: TrustedWebContentsRegistry,
  runtimeConfig: AppRuntimeConfig
): void {
  const contentSecurityPolicy = buildContentSecurityPolicy(runtimeConfig)
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy],
      },
    })
  })
  installPermissionHandler(webContents.session, trustedWebContents)
  lockRendererNavigation(webContents)
}
