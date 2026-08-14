import type { WebContents } from 'electron'

import type { AppRuntimeConfig } from '../../shared/runtime-config'
import type { TrustedWebContentsRegistry } from '../ipc/guards'
import { buildContentSecurityPolicy } from './csp'
import type { MediaPermissionPrompt } from './permissions'
import { lockRendererNavigation } from './navigation'
import { installPermissionHandler } from './permissions'

function isArtifactRendererUrl(url: string): boolean {
  return url.startsWith('yuanai-app://renderer/artifact/')
}

/** 安装单个 renderer 所需的 CSP、权限和导航安全策略。 */
export function secureRenderer(
  webContents: WebContents,
  trustedWebContents: TrustedWebContentsRegistry,
  runtimeConfig: AppRuntimeConfig,
  allowDevelopmentInlineScripts = false,
  mediaPermissionPrompt: MediaPermissionPrompt
): void {
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Artifact 的 srcdoc 继承此 CSP；它仍是无同源权限的 sandbox，仅需运行自身内联脚本。
        'Content-Security-Policy': [
          buildContentSecurityPolicy(
            runtimeConfig,
            allowDevelopmentInlineScripts,
            isArtifactRendererUrl(details.url)
          ),
        ],
      },
    })
  })
  installPermissionHandler(webContents.session, trustedWebContents, mediaPermissionPrompt)
  lockRendererNavigation(webContents)
}
