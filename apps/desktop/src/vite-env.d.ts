declare module '*.svg' {
  const source: string
  export default source
}

/** 构建期从 package.json 注入的应用版本号。 */
declare const __APP_VERSION__: string
