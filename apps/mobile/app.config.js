const appJson = require('./app.json')

/**
 * 允许本地或手动 EAS 构建环境注入真实 project ID；Expo Go 继续使用 app.json 的占位配置。
 * Android Release 默认走本机 Gradle，不依赖这个 project ID；project ID 不是凭据，但不能把
 * 未关联项目的占位值当成可发布配置。
 */
const projectId = process.env.EXPO_PROJECT_ID

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      eas: {
        ...appJson.expo.extra.eas,
        ...(projectId && projectId !== 'PROJECT_ID_PLACEHOLDER' ? { projectId } : {}),
      },
    },
  },
}
