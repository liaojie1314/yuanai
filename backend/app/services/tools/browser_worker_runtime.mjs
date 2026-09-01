import { createServer } from 'node:net'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import https from 'node:https'

const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024
const MAX_SNAPSHOT_CHARS = 8_000
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal'])
const BLOCKED_EXTENSIONS = new Set(['.apk', '.bat', '.cmd', '.com', '.deb', '.dmg', '.dll', '.exe', '.js', '.msi', '.pkg', '.ps1', '.sh'])
const MIME_BY_EXTENSION = new Map([
  ['.csv', 'text/csv'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.gif', 'image/gif'],
  ['.gz', 'application/gzip'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.txt', 'text/plain'],
  ['.webp', 'image/webp'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xml', 'application/xml'],
  ['.zip', 'application/zip'],
])
class BrowserError extends Error {
  constructor(code, message = code) {
    super(message)
    this.code = code
  }
}

function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number)
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('ff')
  }
  return true
}

function normalizeHost(host) {
  return host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

function isAllowedHost(host, allowedHosts) {
  const normalized = normalizeHost(host)
  return allowedHosts.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`))
}

function parseAllowedHosts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20 || value.some((item) => typeof item !== 'string')) {
    throw new BrowserError('BROWSER_DOMAIN_POLICY_INVALID')
  }
  return [...new Set(value.map((item) => normalizeHost(item)))]
}

function createResolver(pinnedHosts, allowedHosts) {
  const cache = new Map(Object.entries(pinnedHosts || {}).map(([host, address]) => [normalizeHost(host), address]))
  return async (host) => {
    const normalized = normalizeHost(host)
    if (!isAllowedHost(normalized, allowedHosts) || BLOCKED_HOSTS.has(normalized)) {
      throw new BrowserError('BROWSER_REDIRECT_BLOCKED')
    }
    if (cache.has(normalized)) {
      return cache.get(normalized)
    }
    if (isIP(normalized)) {
      if (isPrivateAddress(normalized)) {
        throw new BrowserError('BROWSER_NAVIGATION_BLOCKED')
      }
      cache.set(normalized, normalized)
      return normalized
    }
    let addresses
    try {
      addresses = await dns.lookup(normalized, { all: true, verbatim: true })
    } catch {
      throw new BrowserError('BROWSER_DNS_RESOLUTION_FAILED')
    }
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new BrowserError('BROWSER_NAVIGATION_BLOCKED')
    }
    const address = addresses[0].address
    cache.set(normalized, address)
    return address
  }
}

async function validateRequestUrl(value, allowedHosts, resolveAddress) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new BrowserError('BROWSER_NAVIGATION_BLOCKED')
  }
  if (parsed.protocol === 'about:' && parsed.href === 'about:blank') {
    return parsed
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443') {
    throw new BrowserError('BROWSER_NAVIGATION_BLOCKED')
  }
  if (!isAllowedHost(parsed.hostname, allowedHosts)) {
    throw new BrowserError('BROWSER_REDIRECT_BLOCKED')
  }
  await resolveAddress(parsed.hostname)
  return parsed
}

function startPinnedProxy({ allowedHosts, pinnedHosts }) {
  const resolveAddress = createResolver(pinnedHosts, allowedHosts)
  const server = createServer()
  const sockets = new Set()
  server.on('connection', (socket) => sockets.add(socket))
  server.on('close', () => sockets.clear())
  server.on('connection', (socket) => {
    let buffered = Buffer.alloc(0)
    let connected = false
    const fail = () => socket.destroy()
    socket.on('error', fail)
    socket.on('data', async (chunk) => {
      if (connected) return
      buffered = Buffer.concat([buffered, chunk])
      const separator = buffered.indexOf('\r\n\r\n')
      if (separator < 0) {
        if (buffered.length > 64 * 1024) fail()
        return
      }
      connected = true
      socket.pause()
      const header = buffered.subarray(0, separator).toString('latin1')
      const [requestLine] = header.split('\r\n')
      const [method, authority] = requestLine.split(' ')
      if (method !== 'CONNECT' || typeof authority !== 'string') {
        fail()
        return
      }
      const portSeparator = authority.lastIndexOf(':')
      const host = portSeparator > 0 ? authority.slice(0, portSeparator) : authority
      const port = portSeparator > 0 ? Number(authority.slice(portSeparator + 1)) : 443
      if (!Number.isInteger(port) || port !== 443) {
        fail()
        return
      }
      try {
        const address = await resolveAddress(host)
        const upstream = (await import('node:net')).connect({ host: address, port })
        upstream.on('error', fail)
        upstream.once('connect', () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          socket.pipe(upstream)
          upstream.pipe(socket)
          const remainder = buffered.subarray(separator + 4)
          if (remainder.length > 0) upstream.write(remainder)
          socket.resume()
        })
      } catch {
        fail()
      }
    })
  })
  server.on('request', async (request, response) => {
    let parsed
    try {
      parsed = new URL(request.url)
      if (parsed.protocol !== 'http:' || parsed.port && parsed.port !== '80') throw new BrowserError('BROWSER_NAVIGATION_BLOCKED')
      if (!isAllowedHost(parsed.hostname, allowedHosts)) throw new BrowserError('BROWSER_REDIRECT_BLOCKED')
      const address = await resolveAddress(parsed.hostname)
      const transport = parsed.protocol === 'https:' ? https : http
      const upstream = transport.request({
        hostname: address,
        port: parsed.port || 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: request.method,
        headers: { ...request.headers, host: parsed.host },
        servername: parsed.hostname,
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      })
      upstream.on('error', () => response.destroy())
      request.pipe(upstream)
    } catch {
      response.writeHead(403)
      response.end()
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new BrowserError('BROWSER_PROXY_UNAVAILABLE'))
        return
      }
      resolve({
        server,
        sockets,
        address: `http://127.0.0.1:${address.port}`,
        resolveAddress,
      })
    })
  })
}

async function ensureSingleLocator(locator) {
  const count = await locator.count()
  if (count === 0) throw new BrowserError('BROWSER_SELECTOR_NOT_FOUND')
  if (count !== 1) throw new BrowserError('BROWSER_SELECTOR_AMBIGUOUS')
  return locator
}

function semanticLocator(page, target, allowedRoles) {
  if (!target || typeof target !== 'object' || typeof target.role !== 'string' || typeof target.name !== 'string' || !allowedRoles.has(target.role)) {
    throw new BrowserError('BROWSER_SELECTOR_INVALID')
  }
  if (target.name.length === 0 || target.name.length > 200) throw new BrowserError('BROWSER_SELECTOR_INVALID')
  return page.getByRole(target.role, { name: target.name, exact: target.exact !== false })
}

async function humanTakeoverReason(page) {
  const bodyText = (await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')).toLowerCase()
  const captcha = await page.locator('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], [data-sitekey]').count()
  if (captcha > 0 || /captcha|i am not a robot|verify you are human|人机验证/.test(bodyText)) return 'BROWSER_CAPTCHA_HUMAN_TAKEOVER_REQUIRED'
  const otp = await page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="mfa" i], input[id*="otp" i], input[id*="mfa" i]').count()
  if (otp > 0 || /multi-factor|two-factor|one-time code|verification code|security key|多因素|二次验证|验证码/.test(bodyText)) return 'BROWSER_MFA_HUMAN_TAKEOVER_REQUIRED'
  return null
}

async function snapshot(page) {
  const text = (await page.locator('body').innerText().catch(() => '')).slice(0, MAX_SNAPSHOT_CHARS)
  const dom = (await page.locator('html').evaluate((element) => element.outerHTML).catch(() => '')).slice(0, MAX_SNAPSHOT_CHARS)
  const aria = (await page.locator('body').ariaSnapshot().catch(() => '')).slice(0, MAX_SNAPSHOT_CHARS)
  return { title: await page.title(), url: page.url(), text, dom_snapshot: dom, accessibility_snapshot: aria }
}

async function navigate(page, request, resolveAddress) {
  const allowedHosts = request.allowed_hosts
  await validateRequestUrl(request.url, allowedHosts, resolveAddress)
  try {
    await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: request.timeout_ms })
  } catch (error) {
    if (error instanceof BrowserError) throw error
    throw new BrowserError('BROWSER_NAVIGATION_BLOCKED')
  }
  const reason = await humanTakeoverReason(page)
  if (reason) throw new BrowserError(reason)
}

async function execute(request) {
  if (!['open', 'click', 'fill', 'download', 'screenshot'].includes(request.action)) {
    throw new BrowserError('BROWSER_ACTION_INVALID')
  }
  const allowedHosts = parseAllowedHosts(request.allowed_hosts)
  const proxy = await startPinnedProxy({ allowedHosts, pinnedHosts: request.pinned_hosts })
  let browser
  let context
  try {
    const playwrightModule = await import(pathToFileURL(process.env.YUANAI_PLAYWRIGHT_ENTRYPOINT).href)
    const playwright = playwrightModule.default
    browser = await playwright.chromium.launch({
      executablePath: request.executable_path,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-quic', `--proxy-server=${proxy.address}`, '--proxy-bypass-list=<-loopback>'],
    })
    context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    let blockedError = null
    await page.route('**/*', async (route) => {
      try {
        await validateRequestUrl(route.request().url(), allowedHosts, proxy.resolveAddress)
        await route.continue()
      } catch (error) {
        blockedError = error instanceof BrowserError ? error : new BrowserError('BROWSER_NAVIGATION_BLOCKED')
        await route.abort('blockedbyclient').catch(() => undefined)
      }
    })
    try {
      await navigate(page, request, proxy.resolveAddress)
    } catch (error) {
      if (blockedError) throw blockedError
      throw error
    }
    if (request.action === 'open') return await snapshot(page)
    if (request.action === 'screenshot') {
      const data = await page.screenshot({ type: 'png', fullPage: request.full_page === true })
      if (data.length > MAX_DOWNLOAD_BYTES) throw new BrowserError('BROWSER_SCREENSHOT_TOO_LARGE')
      return { kind: 'screenshot', name: 'browser-screenshot.png', mime_type: 'image/png', base64: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex'), url: page.url() }
    }
    const target = request.target
    const locator = request.action === 'fill'
      ? await ensureSingleLocator(semanticLocator(page, target, new Set(['textbox', 'searchbox', 'combobox'])))
      : await ensureSingleLocator(semanticLocator(page, target, new Set(['link', 'button', 'tab', 'checkbox', 'radio', 'switch', 'menuitem'])))
    if (request.action === 'fill') {
      const metadata = await locator.evaluate((element) => ({ type: element.getAttribute('type'), name: element.getAttribute('name'), autocomplete: element.getAttribute('autocomplete') }))
      const sensitive = `${metadata.type || ''} ${metadata.name || ''} ${metadata.autocomplete || ''}`.toLowerCase()
      if (metadata.type === 'password' || /password|passcode|otp|token|secret|one-time/.test(sensitive)) throw new BrowserError('BROWSER_SENSITIVE_FIELD_BLOCKED')
      await locator.fill(request.value, { timeout: request.timeout_ms })
    } else if (request.action === 'download') {
      const downloadPromise = page.waitForEvent('download', { timeout: request.timeout_ms })
      await locator.click({ timeout: request.timeout_ms })
      const download = await downloadPromise
      const downloadPath = await download.path()
      if (!downloadPath) throw new BrowserError('BROWSER_DOWNLOAD_FAILED')
      const fileInfo = await stat(downloadPath)
      if (fileInfo.size > MAX_DOWNLOAD_BYTES) throw new BrowserError('BROWSER_DOWNLOAD_TOO_LARGE')
      const data = await readFile(downloadPath)
      if (data.length > MAX_DOWNLOAD_BYTES) throw new BrowserError('BROWSER_DOWNLOAD_TOO_LARGE')
      const name = download.suggestedFilename().replace(/[\u0000/\\]/g, '_').slice(0, 255) || 'browser-download.bin'
      const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
      if (BLOCKED_EXTENSIONS.has(extension)) throw new BrowserError('BROWSER_DOWNLOAD_TYPE_BLOCKED')
      const mimeType = MIME_BY_EXTENSION.get(extension) || 'application/octet-stream'
      return { kind: 'download', name, mime_type: mimeType, base64: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex'), url: page.url() }
    } else {
      const downloadPromise = page.waitForEvent('download', { timeout: 500 }).catch(() => null)
      await locator.click({ timeout: request.timeout_ms })
      if (request.action === 'click' && await downloadPromise) throw new BrowserError('BROWSER_DOWNLOAD_REQUIRES_EXPLICIT_ACTION')
    }
    if (blockedError) throw blockedError
    const reason = await humanTakeoverReason(page)
    if (reason) throw new BrowserError(reason)
    return await snapshot(page)
  } finally {
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    for (const socket of proxy.sockets) socket.destroy()
    await new Promise((resolve) => proxy.server.close(() => resolve()))
  }
}

async function readRequest() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const line = input.trim().split('\n')[0]
  if (!line || line.length > 512 * 1024) throw new BrowserError('BROWSER_INVALID_INPUT')
  try {
    return JSON.parse(line)
  } catch {
    throw new BrowserError('BROWSER_INVALID_INPUT')
  }
}

try {
  const request = await readRequest()
  const result = await execute(request)
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`)
} catch (error) {
  const code = error instanceof BrowserError ? error.code : 'BROWSER_WORKER_FAILED'
  process.stdout.write(`${JSON.stringify({ ok: false, error: code })}\n`)
  process.exitCode = 1
}
