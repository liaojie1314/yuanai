const appJson = require('./app.json')

/**
 * 允许 EAS 在 CI 中注入真实 project ID；本地 Expo Go 继续使用 app.json 的占位配置。
 * project ID 不是凭据，但不能把未关联项目的占位值当成可发布配置。
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
