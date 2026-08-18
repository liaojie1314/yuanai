/**
 * Expo SDK 52 + NativeWind v4 + Reanimated v3 的 Babel 配置。
 *
 * 关键点：
 * - `babel-preset-expo` 通过 `jsxImportSource: 'nativewind'` 让 `className` 直接编译到 NativeWind
 * - `nativewind/babel` 追加 Tailwind 类名处理
 * - `react-native-reanimated/plugin` 必须放在插件列表的最后一位，否则 Worklet 转换失效
 */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-reanimated/plugin'],
  }
}
