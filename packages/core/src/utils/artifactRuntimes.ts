/**
 * Artifact 沙箱运行时集中定义（Web iframe srcdoc 与移动端 WebView source.html 共用）。
 *
 * 统一收敛所有 esm.sh CDN 地址与各语言沙箱文档模板，`buildRunSrcDoc`
 * 按语言分发，模板细节在此维护。所有模板都在 `<head>` 注入
 * {@link CONSOLE_BOOTSTRAP} 控制台桥，把沙箱内的 console / 未捕获错误经
 * `postMessage` 回传宿主（Web 父窗口 postMessage / RN WebView onMessage）。
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
 * 在沙箱内改写 `console.log/info/warn/error`，并挂接 `window.onerror` 与
 * `onunhandledrejection`，把序列化后的消息回传宿主：
 * - RN WebView：`window.ReactNativeWebView.postMessage(JSON 字符串)`
 * - Web iframe：`parent.postMessage(对象)`
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
  'var msg={source:SRC,level:level,text:text};' +
  'if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){' +
  'window.ReactNativeWebView.postMessage(JSON.stringify(msg));}' +
  'else{parent.postMessage(msg,"*");}}catch(e){}}' +
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

/** 模板可选项：dark 时沙箱外壳使用暗色底/前景（完整 HTML 文档不受影响） */
export interface RunDocOptions {
  dark?: boolean
}

/** 沙箱文档统一基础样式：重置边距、系统字体，按主题给底色/前景色 */
function baseStyle(dark: boolean): string {
  const palette = dark ? 'color:#d7dde8;background:#10151f' : 'color:#1a2540;background:#fff'
  return (
    '<style>body{margin:0;padding:16px;font-family:system-ui,-apple-system,' +
    '"PingFang SC","Microsoft YaHei",sans-serif;' +
    palette +
    '}#app{min-height:1px}</style>'
  )
}

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
function docShell(headExtra: string, bodyHtml: string, opts?: RunDocOptions): string {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    CONSOLE_BOOTSTRAP +
    baseStyle(opts?.dark === true) +
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
export function buildHtmlDoc(code: string, opts?: RunDocOptions): string {
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
  return docShell('', code, opts)
}

/**
 * CSS 预览文档：注入用户样式，并给出示例 DOM 便于直观查看效果。
 */
export function buildCssDoc(code: string, opts?: RunDocOptions): string {
  return docShell(
    '<style>' + code + '</style>',
    '<h1>元 AI 预览</h1><p>已应用上面的样式规则。</p><button>示例按钮</button>',
    opts
  )
}

/**
 * JS 预览文档：把源码作为字符串在全局作用域间接 eval 执行，错误经控制台桥回传。
 *
 * 纯计算脚本（不写 DOM）执行完页面会是全白，容易被误认为运行失败；
 * 执行后延时检查 body 无可视内容时注入「无可视输出」提示。
 */
export function buildJsDoc(code: string, opts?: RunDocOptions): string {
  const body =
    'const __src = ' +
    encodeSrc(code) +
    ';try{(0,eval)(__src);}catch(e){console.error(e&&e.stack?e.stack:String(e));}' +
    'setTimeout(function(){try{' +
    'if(document.body.innerText.trim())return;' +
    'if(document.body.querySelector("canvas,img,svg,video,iframe"))return;' +
    'var app=document.getElementById("app")||document.body;' +
    'var p=document.createElement("p");' +
    'p.style.cssText="color:#8a94ad;font-size:14px;font-family:system-ui";' +
    'p.textContent="代码已执行，无可视输出；console 输出见控制台。";' +
    'app.appendChild(p);' +
    '}catch(e){}},80);'
  return docShell('', '<div id="app"></div>' + jsScript(body), opts)
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
export function buildReactDoc(code: string, opts?: RunDocOptions): string {
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
  return docShell(importmap, '<div id="app"></div>' + loader + runner, opts)
}

/**
 * Vue 3 预览文档。
 *
 * 加载含编译器的 Vue 浏览器构建，尽力兼容两种写法：默认导出组件选项对象，
 * 或直接返回模板字符串；出错时经控制台桥回传。
 */
export function buildVueDoc(code: string, opts?: RunDocOptions): string {
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
  return docShell('', '<div id="app"></div>' + runner, opts)
}

/**
 * Svelte 预览文档。
 *
 * 在 iframe 内用 Svelte 编译器即时 `compile()` 用户源码，再以 Blob module 导入生成结果，
 * 挂载到 `#app`；内部依赖经 importmap 指向 esm.sh，尽力而为，出错回传控制台。
 */
export function buildSvelteDoc(code: string, opts?: RunDocOptions): string {
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
  return docShell(importmap, '<div id="app"></div>' + runner, opts)
}

/**
 * Markdown 预览文档：用 `marked` 解析为 HTML 渲染到样式化容器。
 */
export function buildMarkdownDoc(code: string, opts?: RunDocOptions): string {
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
  return docShell(style, '<div id="app"></div>' + runner, opts)
}

/**
 * Mermaid 图表预览文档：`initialize({startOnLoad:false})` 后手动 `render` 到 `#app`。
 */
export function buildMermaidDoc(code: string, opts?: RunDocOptions): string {
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
  return docShell('', '<div id="app"></div>' + runner, opts)
}

/**
 * 判断代码语言是否支持沙箱运行。
 *
 * 覆盖 HTML/CSS/JS 及需运行时渲染的 JSX/TSX、Vue、Svelte、Markdown、Mermaid。
 * JSON/CSV 不在此列——Web 端走非 iframe 的数据预览分支。
 */
export function isRunnableLang(lang: string): boolean {
  const l = lang.toLowerCase()
  return (
    l === 'html' ||
    l === 'htm' ||
    l === 'css' ||
    l === 'js' ||
    l === 'javascript' ||
    l === 'mjs' ||
    l === 'cjs' ||
    l === 'jsx' ||
    l === 'tsx' ||
    l === 'vue' ||
    l === 'svelte' ||
    l === 'markdown' ||
    l === 'md' ||
    l === 'mermaid'
  )
}

/**
 * 根据代码语言构造沙箱文档（Web iframe `srcdoc` / RN WebView `source.html`）。
 *
 * 按小写语言分发到对应文档模板；所有产物均已在 `<head>` 注入控制台桥。
 * 未识别语言回退为 JS 运行时。
 */
export function buildRunSrcDoc(lang: string, code: string, opts?: RunDocOptions): string {
  const l = lang.toLowerCase()
  switch (l) {
    case 'html':
    case 'htm':
      return buildHtmlDoc(code, opts)
    case 'css':
      return buildCssDoc(code, opts)
    case 'js':
    case 'javascript':
    case 'mjs':
    case 'cjs':
      return buildJsDoc(code, opts)
    case 'jsx':
    case 'tsx':
      return buildReactDoc(code, opts)
    case 'vue':
      return buildVueDoc(code, opts)
    case 'svelte':
      return buildSvelteDoc(code, opts)
    case 'markdown':
    case 'md':
      return buildMarkdownDoc(code, opts)
    case 'mermaid':
      return buildMermaidDoc(code, opts)
    default:
      return buildJsDoc(code, opts)
  }
}

/**
 * 判断代码语言是否走「数据预览」分支（非沙箱运行，直接在面板内渲染）。
 *
 * JSON 渲染为可折叠树，CSV 渲染为表格。
 */
export function isDataPreviewLang(lang: string): boolean {
  const l = lang.toLowerCase()
  return l === 'json' || l === 'csv'
}

/**
 * 解析 CSV 文本为二维数组（RFC 4180 子集：支持引号包裹、转义引号、\r\n）。
 * 过滤纯空行；与 web ArtifactPanel 原实现行为一致，供两端数据预览共用。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '')
}
