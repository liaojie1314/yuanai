# apps/mobile/assets

品牌资产放置目录。当前占位，Phase 3 后续 UI 阶段替换为真实资源。

| 文件                    | 用途                                | 规格                                        |
| ----------------------- | ----------------------------------- | ------------------------------------------- |
| `icon.png`              | 应用图标（iOS 通用 + Android 兜底） | 1024×1024 PNG，透明背景                     |
| `adaptive-icon.png`     | Android 自适应图标前景              | 1024×1024 PNG，安全区 660×660 居中          |
| `splash.png`            | Splash 屏图（浅色）                 | 1284×2778 PNG（或 vector）                  |
| `splash-dark.png`       | Splash 屏图（深色）                 | 同上                                        |
| `notification-icon.png` | Android 通知栏图标                  | 96×96 白色 PNG（Android 只保留 alpha 通道） |

放入后需回到 `app.json` 里把 `icon` / `splash.image` / `plugins.expo-notifications.icon`
等字段的引用打开；当前 app.json 为使 Expo 能在无资产状态下 `expo start`
成功，暂时省略了对这些文件的直接引用。
