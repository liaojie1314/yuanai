/**
 * Artifact 沙箱运行时集中定义。
 *
 * 统一收敛所有 esm.sh CDN 地址与各语言 iframe `srcdoc` 文档模板，
 * 使 `utils.ts` 的 `buildRunSrcDoc` 只负责按语言分发，模板细节在此维护。
 * 所有模板都在 `<head>` 注入 {@link CONSOLE_BOOTSTRAP} 控制台桥，
 * 把 iframe 内的 console / 未捕获错误经 `postMessage` 回传父窗口。
 */

/**
 * 固定大版本的 esm.sh CDN 地址集合。
 *
 * 固定主版本可在保证 API 稳定的同时享受补丁更新；沙箱离线时相关运行时会加载失败，
 * 错误会经控制台桥回传，不影响面板本身。
 */
export const ESM_CDN = {
  /** React 运行时 */
  react: 'https://esm.sh/react@18',
  /** ReactDOM 运行时 */
  reactDom: 'https://esm.sh/react-dom@18',
  /** ReactDOM 客户端渲染入口（createRoot） */
  reactDomClient: 'https://esm.sh/react-dom@18/client',
  /** Vue 3 含模板编译器的浏览器 ESM 构建 */
  vue: 'https://esm.sh/vue@3/dist/vue.esm-browser.js',
  /** Svelte 编译器（在 iframe 内即时编译用户源码） */
  svelteCompiler: 'https://esm.sh/svelte@4/compiler',
  /** Svelte 运行时根入口 */
  svelte: 'https://esm.sh/svelte@4',
  /** Svelte 生成代码所依赖的内部运行时 */
  svelteInternal: 'https://esm.sh/svelte@4/internal',
  /** Mermaid 图表渲染 */
  mermaid: 'https://esm.sh/mermaid@11',
  /** Marked Markdown 解析 */
  marked: 'https://esm.sh/marked@14',
  /** Babel Standalone，用于在浏览器内转译 JSX/TSX */
  babel: 'https://esm.sh/@babel/standalone@7',
} as const

/** 控制台桥消息的固定 source 标识，父窗口据此过滤可信消息 */
export const ARTIFACT_MSG_SOURCE = 'yuanai-artifact'

/**
 * 控制台桥引导脚本（普通 `<script>`，非 module）。
 *
 * 在 iframe 内改写 `console.log/info/warn/error`，并挂接 `window.onerror` 与
 * `onunhandledrejection`，把序列化后的文本经 `postMessage({source})` 回传父窗口。
 * 序列化对循环引用与不可序列化对象做兜底，绝不因日志本身抛错。
 * 用 `'<' + 'script>'` 拼接标签，避免源码里出现字面 `</script>` 干扰宿主 HTML 解析。
 */
export const CONSOLE_BOOTSTRAP =
  '<' +
  'script>(function(){' +
  'var SRC=' +
  JSON.stringify(ARTIFACT_MSG_SOURCE) +
  ';' +
  'function ser(v){try{' +
  'if(typeof v==="string")return v;' +
  'if(v instanceof Error)return v.name+": "+v.message;' +
  'if(typeof v==="function")return "[Function "+(v.name||"anonymous")+"]";' +
  'if(typeof v==="undefined")return "undefined";' +
  'if(v===null)return "null";' +
  'if(typeof v==="object"){var seen=[];return JSON.stringify(v,function(k,val){' +
  'if(typeof val==="object"&&val!==null){if(seen.indexOf(val)>=0)return "[Circular]";seen.push(val);}' +
  'if(typeof val==="function")return "[Function]";return val;});}' +
  'return String(v);}catch(e){return String(v);}}' +
  'function post(level,args){try{' +
  'var text=Array.prototype.map.call(args,ser).join(" ");' +
  'parent.postMessage({source:SRC,level:level,text:text},"*");}catch(e){}}' +
  'var levels=["log","info","warn","error"];' +
  'levels.forEach(function(name){var orig=console[name];' +
  'console[name]=function(){post(name,arguments);' +
  'try{if(orig)orig.apply(console,arguments);}catch(e){}};});' +
  'window.onerror=function(msg,src,line,col,err){' +
  'post("error",[err&&err.stack?err.stack:(msg+" ("+line+":"+col+")")]);return false;};' +
  'window.onunhandledrejection=function(ev){' +
  'var r=ev&&ev.reason;post("error",[r&&r.stack?r.stack:ser(r)]);};' +
  '})();</' +
  'script>'

/** iframe 文档统一基础样式：重置边距、系统字体、浅色背景 */
const BASE_STYLE =
  '<style>body{margin:0;padding:16px;font-family:system-ui,-apple-system,' +
  '"PingFang SC","Microsoft YaHei",sans-serif;color:#1a2540;background:#fff}' +
  '#app{min-height:1px}</style>'

/**
 * 把用户代码编码为 JS 字符串字面量，并转义 `<` 与行分隔符。
 *
 * 经 `JSON.stringify` 后再把 `<` 转成 `<`，即便代码含 `</script>`
 * 也不会提前终止宿主 `<script>`；同时转义 U+2028/U+2029 避免脚本换行错误。
 */
function encodeSrc(code: string): string {
  return JSON.stringify(code)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * 组装完整 HTML 文档：`<head>` 含控制台桥与基础样式，`<body>` 为传入内容。
 */
function docShell(headExtra: string, bodyHtml: string): string {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    CONSOLE_BOOTSTRAP +
    BASE_STYLE +
    headExtra +
    '</head><body>' +
    bodyHtml +
    '</body></html>'
  )
}

/**
 * 构造模块脚本字符串（`type=module`），用 `'<' + 'script'` 拼接避免标签污染。
 */
function moduleScript(body: string): string {
  return '<' + 'script type="module">' + body + '</' + 'script>'
}

/**
 * HTML 预览文档。
 *
 * 已是完整文档（`<!doctype` / `<html>` 开头）时，把控制台桥注入其 `<head>`，
 * 保留用户原始结构；否则作为 body 片段包进统一外壳。
 */
export function buildHtmlDoc(code: string): string {
  const trimmed = code.trim()
  const isFull = /^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)
  if (isFull) {
    if (/<head[\s>]/i.test(code)) {
      return code.replace(/<head([^>]*)>/i, (m) => m + CONSOLE_BOOTSTRAP)
    }
    if (/<html[^>]*>/i.test(code)) {
      return code.replace(/<html[^>]*>/i, (m) => m + '<head>' + CONSOLE_BOOTSTRAP + '</head>')
    }
    return CONSOLE_BOOTSTRAP + code
  }
  return docShell('', code)
}

/**
 * CSS 预览文档：注入用户样式，并给出示例 DOM 便于直观查看效果。
 */
export function buildCssDoc(code: string): string {
  return docShell(
    '<style>' + code + '</style>',
    '<h1>元 AI 预览</h1><p>已应用上面的样式规则。</p><button>示例按钮</button>'
  )
}

/**
 * JS 预览文档：把源码作为字符串在全局作用域间接 eval 执行，错误经控制台桥回传。
 */
export function buildJsDoc(code: string): string {
  const body =
    'const __src = ' +
    encodeSrc(code) +
    ';try{(0,eval)(__src);}catch(e){console.error(e&&e.stack?e.stack:String(e));}'
  return docShell('', '<div id="app"></div>' + jsScript(body))
}

/** 普通脚本包裹（非 module），供 JS 运行时使用 */
function jsScript(body: string): string {
  return '<' + 'script>' + body + '</' + 'script>'
}

/**
 * React/JSX/TSX 预览文档。
 *
 * 通过 importmap 把 `react` / `react-dom/client` 指向 esm.sh，加载 `@babel/standalone`
 * 转译用户 JSX/TSX，再以 Blob module 形式 `import()`（Blob 模块导入遵循 importmap）。
 */
export function buildReactDoc(code: string): string {
  const importmap =
    '<' +
    'script type="importmap">' +
    JSON.stringify({
      imports: {
        react: ESM_CDN.react,
        'react-dom': ESM_CDN.reactDom,
        'react-dom/client': ESM_CDN.reactDomClient,
      },
    }) +
    '</' +
    'script>'
  const loader = '<' + 'script src="' + ESM_CDN.babel + '"></' + 'script>'
  const runner = jsScript(
    'const __src = ' +
      encodeSrc(code) +
      ';(async function(){try{' +
      'const out = Babel.transform(__src,{presets:[["react"],' +
      '["typescript",{allExtensions:true,isTSX:true}]],filename:"app.tsx"}).code;' +
      'const blob = new Blob([out],{type:"text/javascript"});' +
      'const url = URL.createObjectURL(blob);' +
      'await import(url);URL.revokeObjectURL(url);' +
      '}catch(e){console.error(e&&e.stack?e.stack:String(e));}})();'
  )
  return docShell(importmap, '<div id="app"></div>' + loader + runner)
}

/**
 * Vue 3 预览文档。
 *
 * 加载含编译器的 Vue 浏览器构建，尽力兼容两种写法：默认导出组件选项对象，
 * 或直接返回模板字符串；出错时经控制台桥回传。
 */
export function buildVueDoc(code: string): string {
  const runner = moduleScript(
    'import { createApp, defineComponent } from ' +
      JSON.stringify(ESM_CDN.vue) +
      ';const __src = ' +
      encodeSrc(code) +
      ';(async function(){try{' +
      'const blob = new Blob([__src],{type:"text/javascript"});' +
      'const url = URL.createObjectURL(blob);' +
      'const mod = await import(url);URL.revokeObjectURL(url);' +
      'let comp = mod.default;' +
      'if(typeof comp==="string"){comp=defineComponent({template:comp});}' +
      'if(!comp){throw new Error("Vue 组件需通过 export default 导出组件选项或模板字符串");}' +
      'createApp(comp).mount("#app");' +
      '}catch(e){console.error(e&&e.stack?e.stack:String(e));}})();'
  )
  return docShell('', '<div id="app"></div>' + runner)
}

/**
 * Svelte 预览文档。
 *
 * 在 iframe 内用 Svelte 编译器即时 `compile()` 用户源码，再以 Blob module 导入生成结果，
 * 挂载到 `#app`；内部依赖经 importmap 指向 esm.sh，尽力而为，出错回传控制台。
 */
export function buildSvelteDoc(code: string): string {
  const importmap =
    '<' +
    'script type="importmap">' +
    JSON.stringify({
      imports: {
        svelte: ESM_CDN.svelte,
        'svelte/internal': ESM_CDN.svelteInternal,
      },
    }) +
    '</' +
    'script>'
  const runner = moduleScript(
    'import { compile } from ' +
      JSON.stringify(ESM_CDN.svelteCompiler) +
      ';const __src = ' +
      encodeSrc(code) +
      ';(async function(){try{' +
      'const { js } = compile(__src,{generate:"dom",format:"esm"});' +
      'const blob = new Blob([js.code],{type:"text/javascript"});' +
      'const url = URL.createObjectURL(blob);' +
      'const mod = await import(url);URL.revokeObjectURL(url);' +
      'new mod.default({target:document.getElementById("app")});' +
      '}catch(e){console.error(e&&e.stack?e.stack:String(e));}})();'
  )
  return docShell(importmap, '<div id="app"></div>' + runner)
}

/**
 * Markdown 预览文档：用 `marked` 解析为 HTML 渲染到样式化容器。
 */
export function buildMarkdownDoc(code: string): string {
  const style =
    '<style>#app{max-width:760px;margin:0 auto;line-height:1.7}' +
    '#app pre{background:#f4f6fb;padding:12px;border-radius:8px;overflow:auto}' +
    '#app code{font-family:"SF Mono",monospace}' +
    '#app blockquote{border-left:3px solid #7c9cf5;margin:0;padding-left:12px;color:#5a6785}' +
    '</style>'
  const runner = moduleScript(
    'import { marked } from ' +
      JSON.stringify(ESM_CDN.marked) +
      ';const __src = ' +
      encodeSrc(code) +
      ';(async function(){try{' +
      'document.getElementById("app").innerHTML = await marked.parse(__src);' +
      '}catch(e){console.error(e&&e.stack?e.stack:String(e));}})();'
  )
  return docShell(style, '<div id="app"></div>' + runner)
}

/**
 * Mermaid 图表预览文档：`initialize({startOnLoad:false})` 后手动 `render` 到 `#app`。
 */
export function buildMermaidDoc(code: string): string {
  const runner = moduleScript(
    'import mermaid from ' +
      JSON.stringify(ESM_CDN.mermaid) +
      ';const __src = ' +
      encodeSrc(code) +
      ';(async function(){try{' +
      'mermaid.initialize({startOnLoad:false});' +
      'const { svg } = await mermaid.render("yuanai-mermaid", __src);' +
      'document.getElementById("app").innerHTML = svg;' +
      '}catch(e){console.error(e&&e.stack?e.stack:String(e));}})();'
  )
  return docShell('', '<div id="app"></div>' + runner)
}
