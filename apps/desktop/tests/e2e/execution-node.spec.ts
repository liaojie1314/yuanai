/**
 * 桌面执行节点端到端验收：真实 Electron 进程 + 真实后端。
 *
 * 覆盖：登录 → 设置页启用执行节点（自配对 + Ed25519 登记 + WSS challenge）→
 * 通过 API 下发 browser_open_url 任务 → 本地审批允许 → 节点执行并签名回传 →
 * 服务端持久化为 succeeded 且节点 ACK；以及审批待决时强制杀死进程后，
 * 依赖服务端投递过期重投与节点身份持久化在重启后恢复同一任务且恰好完成一次；
 * 还覆盖只存节点的本地记忆：节点拒绝写入时云端不留孤儿元数据，节点在线时检索取回
 * 只存在于本机的正文，节点不告而别后检索明确报告本地不可用而不是空等满作业超时。
 * 运行前提：真实后端运行在 YUANAI_API_URL（默认 http://localhost:8000/api/v1），
 * 且后端允许创建测试账号。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { _electron } from '@playwright/test'

const API_BASE_URL = process.env['YUANAI_API_URL'] ?? 'http://localhost:8000/api/v1'
const E2E_EMAIL = process.env['YUANAI_E2E_EMAIL']
const E2E_PASSWORD = process.env['YUANAI_E2E_PASSWORD']
/**
 * 节点不可用时检索必须立刻返回的耗时上限。
 * 后端 memory_node.MEMORY_NODE_TIMEOUT_SECONDS 为 15 秒：节点已关闭却仍被当作在线时，
 * 每次检索都要空等满这个超时，所以预算取它的三分之一即可把两种行为区分开。
 */
const LOCAL_UNAVAILABLE_BUDGET_MS = 5_000
/** 心跳过期阈值默认 60 秒，心跳间隔 25 秒；留足两者之和再加一次轮询的余量。 */
const NODE_STALE_TIMEOUT_MS = 150_000

interface TestUser {
  email: string
  password: string
  token: string
}

function readVerifyCodeBypass(): string {
  const envPath = join(__dirname, '../../../../backend/.env')
  try {
    const env = readFileSync(envPath, 'utf8')
    return env.match(/^VERIFY_CODE_DEBUG_BYPASS=(.*)$/m)?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

async function createTestUser(): Promise<TestUser> {
  if (E2E_EMAIL !== undefined || E2E_PASSWORD !== undefined) {
    if (!E2E_EMAIL || !E2E_PASSWORD) {
      throw new Error('YUANAI_E2E_EMAIL and YUANAI_E2E_PASSWORD must be provided together')
    }
    const loggedIn = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
    })
    if (!loggedIn.ok) {
      throw new Error(`configured e2e login failed: ${loggedIn.status}`)
    }
    const payload = (await loggedIn.json()) as { access_token: string }
    return { email: E2E_EMAIL, password: E2E_PASSWORD, token: payload.access_token }
  }

  const suffix = Math.random().toString(36).slice(2, 10)
  const email = `desktop-e2e-${suffix}@example.com`
  const password = `E2e-${suffix}-Pass!`
  const bypass = readVerifyCodeBypass()
  const sendCode = await fetch(`${API_BASE_URL}/auth/send-verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, scene: 'register' }),
  })
  if (!sendCode.ok) throw new Error(`send-verify-code failed: ${sendCode.status}`)
  const registered = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, username: `e2e${suffix}`, verifyCode: bypass }),
  })
  if (!registered.ok)
    throw new Error(`register failed: ${registered.status} ${await registered.text()}`)
  const payload = (await registered.json()) as { access_token: string }
  return { email, password, token: payload.access_token }
}

async function api(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok)
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`)
  return payload
}

async function launchApp(
  userDataDir?: string
): Promise<{ app: ElectronApplication; userDataDir: string }> {
  const profileDir = userDataDir ?? mkdtempSync(join(tmpdir(), 'yuanai-desktop-e2e-'))
  const app = await _electron.launch({
    args: ['--password-store=gnome-libsecret', join(__dirname, '../../out/main/index.js')],
    env: {
      ...process.env,
      YUANAI_API_URL: API_BASE_URL,
      YUANAI_USER_DATA_DIR: profileDir,
    },
  })
  return { app, userDataDir: profileDir }
}

async function login(app: ElectronApplication, user: TestUser): Promise<Page> {
  const loginWindow = await app.firstWindow()
  await loginWindow.waitForLoadState('domcontentloaded')
  await loginWindow.getByRole('textbox', { name: '邮箱' }).fill(user.email)
  await loginWindow.getByRole('textbox', { name: '密码' }).fill(user.password)
  await loginWindow.getByRole('button', { name: '登录', exact: true }).click()
  await expect
    .poll(async () => app.windows().some((window) => window !== loginWindow), { timeout: 20_000 })
    .toBe(true)
  return loginWindow
}

async function openSettings(app: ElectronApplication): Promise<Page> {
  const mainWindow = app.windows().find((window) => !window.url().includes('login'))
  if (!mainWindow) throw new Error('main window not found')
  await mainWindow.evaluate(() => window.yuanai.window.openSettings())
  await expect.poll(async () => app.windows().length, { timeout: 15_000 }).toBeGreaterThan(1)
  return app.windows()[app.windows().length - 1] as Page
}

/** 重启后的应用可能保留已登录会话；仅在登录窗口出现时重新登录。 */
async function ensureLogin(app: ElectronApplication, user: TestUser): Promise<void> {
  const firstWindow = await app.firstWindow()
  await firstWindow.waitForLoadState('domcontentloaded')
  const needsLogin = await firstWindow
    .getByRole('textbox', { name: '邮箱' })
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false)
  if (!needsLogin) return
  await login(app, user)
  await firstWindow.close()
}

/** 记忆检索接口返回中本用例断言到的字段。 */
interface MemorySearchOutcome {
  results: Array<{ id: string; content: string }>
  localUnavailable: boolean
}

async function searchMemories(
  token: string,
  assistantId: string,
  query: string
): Promise<MemorySearchOutcome> {
  const payload = await api(
    token,
    'GET',
    `/memories/search?assistantId=${assistantId}&query=${encodeURIComponent(query)}&limit=8`
  )
  return payload as unknown as MemorySearchOutcome
}

/** 发起一次只存节点的记忆创建；失败状态由调用方断言，故不走会抛错的 api()。 */
function postLocalMemory(
  token: string,
  assistantId: string,
  content: string,
  sourceId: string
): Promise<Response> {
  return fetch(`${API_BASE_URL}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      assistantId,
      memoryType: 'semantic',
      content,
      sourceType: 'desktop-e2e',
      sourceId,
      storageLocation: 'local_node',
    }),
  })
}

async function executionSnapshot(
  token: string,
  executionId: string
): Promise<Record<string, unknown> | undefined> {
  const rows = (await api(token, 'GET', '/tool-executions?limit=20')) as unknown as Array<
    Record<string, unknown>
  >
  return rows.find((row) => row['id'] === executionId)
}

test.describe('desktop execution node', () => {
  test('pairs, acknowledges approval and cancellation, then observes node revocation', async () => {
    test.setTimeout(360_000)
    const testInfo = test.info()
    const user = await createTestUser()
    const { app, userDataDir } = await launchApp()
    try {
      // safeStorage 需要已解锁的桌面钥匙串；无钥匙串的环境会按安全规则拒绝
      // 持久化并停留在登录页，此时跳过而不是伪造验收。
      await app.firstWindow()
      const storageState = await app.evaluate(({ safeStorage }) => ({
        available: safeStorage.isEncryptionAvailable(),
        backend: safeStorage.getSelectedStorageBackend(),
      }))
      test.skip(
        !storageState.available ||
          (process.platform === 'linux' && storageState.backend === 'basic_text'),
        '需要可用且已解锁的桌面钥匙串（safeStorage）才能运行'
      )
      const loginWindow = await login(app, user)
      await loginWindow.close()
      const settings = await openSettings(app)
      await settings.getByRole('tab', { name: '桌面设置' }).click()
      const nodeName = `E2E 节点 ${Date.now()}`
      await settings.getByLabel('节点名称').fill(nodeName)
      await settings.getByRole('button', { name: '启用执行节点' }).click()
      await expect(settings.getByRole('heading', { name: '执行节点' })).toBeVisible()
      await expect(settings.getByText('在线')).toBeVisible({ timeout: 30_000 })

      const nodes = (await api(user.token, 'GET', '/execution-nodes')) as unknown as Array<{
        id: string
        name: string
        status: string
      }>
      const node = nodes.find((candidate) => candidate.name === nodeName)
      if (!node) throw new Error('paired node not registered on the backend')
      expect(node.status).toBe('online')
      const execution = (await api(user.token, 'POST', '/tool-executions', {
        toolName: 'browser_open_url',
        arguments: { url: 'https://example.com/desktop-e2e' },
        executionLocation: 'desktop',
        nodeId: node.id,
      })) as { id: string; status: string }

      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })
      await settings
        .getByRole('heading', { name: '执行节点' })
        .locator('..')
        .screenshot({ path: testInfo.outputPath('execution-node-online.png') })
      await settings.getByRole('button', { name: '允许本次执行' }).click()

      await expect
        .poll(
          async () => {
            const rows = (await api(
              user.token,
              'GET',
              '/tool-executions?limit=20'
            )) as unknown as Array<{
              id: string
              status: string
              nodeAcknowledgedAt: string | null
            }>
            return rows.find((row) => row.id === execution.id)
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toEqual(
          expect.objectContaining({
            id: execution.id,
            status: 'succeeded',
            nodeAcknowledgedAt: expect.any(String),
          })
        )
      await expect(settings.getByText('在线')).toBeVisible()

      const cancelledExecution = (await api(user.token, 'POST', '/tool-executions', {
        toolName: 'browser_open_url',
        arguments: { url: 'https://example.com/desktop-e2e-cancel' },
        executionLocation: 'desktop',
        nodeId: node.id,
      })) as { id: string }

      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })
      await api(user.token, 'POST', `/tool-executions/${cancelledExecution.id}/cancel`)
      await expect(settings.getByText('待确认任务')).toHaveCount(0, { timeout: 30_000 })
      await expect
        .poll(() => executionSnapshot(user.token, cancelledExecution.id), {
          timeout: 45_000,
          intervals: [1_000, 2_000, 5_000],
        })
        .toEqual(
          expect.objectContaining({
            id: cancelledExecution.id,
            status: 'cancelled',
            nodeDeliveryStatus: 'acknowledged',
            nodeAcknowledgedAt: expect.any(String),
          })
        )

      const revoked = await api(user.token, 'POST', `/execution-nodes/${node.id}/revoke`)
      expect(revoked['status']).toBe('revoked')
      const afterRevoke = await fetch(`${API_BASE_URL}/tool-executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({
          toolName: 'browser_open_url',
          arguments: { url: 'https://example.com/desktop-e2e-revoked' },
          executionLocation: 'desktop',
          nodeId: node.id,
        }),
      })
      expect(afterRevoke.status).toBe(422)
      await expect
        .poll(
          () =>
            settings.evaluate(() =>
              window.yuanai.executionNode.getStatus().then((snapshot) => snapshot.state)
            ),
          { timeout: 45_000, intervals: [1_000, 2_000, 5_000] }
        )
        .not.toBe('online')
    } finally {
      await app.close()
      await api(user.token, 'DELETE', '/auth/me')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('redelivers an unapproved job after a forced restart', async () => {
    test.setTimeout(420_000)
    const testInfo = test.info()
    const user = await createTestUser()
    const { app: firstApp, userDataDir } = await launchApp()
    let app = firstApp
    try {
      await app.firstWindow()
      const storageState = await app.evaluate(({ safeStorage }) => ({
        available: safeStorage.isEncryptionAvailable(),
        backend: safeStorage.getSelectedStorageBackend(),
      }))
      test.skip(
        !storageState.available ||
          (process.platform === 'linux' && storageState.backend === 'basic_text'),
        '需要可用且已解锁的桌面钥匙串（safeStorage）才能运行'
      )
      const loginWindow = await login(app, user)
      await loginWindow.close()
      const settings = await openSettings(app)
      await settings.getByRole('tab', { name: '桌面设置' }).click()
      const nodeName = `E2E 重连节点 ${Date.now()}`
      await settings.getByLabel('节点名称').fill(nodeName)
      await settings.getByRole('button', { name: '启用执行节点' }).click()
      await expect(settings.getByRole('heading', { name: '执行节点' })).toBeVisible()
      await expect(settings.getByText('在线')).toBeVisible({ timeout: 30_000 })

      const nodes = (await api(user.token, 'GET', '/execution-nodes')) as unknown as Array<{
        id: string
        name: string
      }>
      const node = nodes.find((candidate) => candidate.name === nodeName)
      if (!node) throw new Error('paired node not registered on the backend')
      const execution = (await api(user.token, 'POST', '/tool-executions', {
        toolName: 'browser_open_url',
        arguments: { url: 'https://example.com/desktop-e2e-replay' },
        executionLocation: 'desktop',
        nodeId: node.id,
      })) as { id: string }

      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })

      // 审批待决时强制杀死进程：未答复任务只能依赖服务端重投与节点身份持久化恢复。
      app.process().kill('SIGKILL')
      await expect
        .poll(() => app.process().killed || app.process().exitCode !== null, { timeout: 15_000 })
        .toBe(true)
      // SIGKILL 可能残留单例锁，不清除会让重启实例直接退出。
      for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
        rmSync(join(userDataDir, lock), { force: true })
      }
      app = (await launchApp(userDataDir)).app
      await ensureLogin(app, user)
      const restartedSettings = await openSettings(app)
      await restartedSettings.getByRole('tab', { name: '桌面设置' }).click()
      await expect(restartedSettings.getByText('在线')).toBeVisible({ timeout: 60_000 })

      // 投递过期阈值（默认 120 秒）过后，服务端在活跃连接上重新下发 job_offer。
      await expect(restartedSettings.getByText('待确认任务')).toBeVisible({
        timeout: 180_000,
      })
      await restartedSettings.getByRole('button', { name: '允许本次执行' }).click()

      await expect
        .poll(
          async () => {
            const rows = (await api(
              user.token,
              'GET',
              '/tool-executions?limit=20'
            )) as unknown as Array<{
              id: string
              status: string
              nodeDeliveryStatus: string | null
              nodeAcknowledgedAt: string | null
            }>
            return rows.find((row) => row.id === execution.id)
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toEqual(
          expect.objectContaining({
            id: execution.id,
            status: 'succeeded',
            nodeDeliveryStatus: 'acknowledged',
            nodeAcknowledgedAt: expect.any(String),
          })
        )
      // 完成后不出现重复审批或重复执行。
      await restartedSettings.waitForTimeout(10_000)
      await expect(restartedSettings.getByText('待确认任务')).toHaveCount(0)
      const settled = await executionSnapshot(user.token, execution.id)
      expect(settled).toEqual(expect.objectContaining({ id: execution.id, status: 'succeeded' }))
      await restartedSettings
        .getByRole('heading', { name: '执行节点' })
        .locator('..')
        .screenshot({ path: testInfo.outputPath('execution-node-replay.png') })
    } finally {
      await app.close().catch(() => {})
      await api(user.token, 'DELETE', '/auth/me')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('reads a local file only after the native-selector grant', async () => {
    test.setTimeout(360_000)
    const user = await createTestUser()
    const { app, userDataDir } = await launchApp()
    try {
      await app.firstWindow()
      const storageState = await app.evaluate(({ safeStorage }) => ({
        available: safeStorage.isEncryptionAvailable(),
        backend: safeStorage.getSelectedStorageBackend(),
      }))
      test.skip(
        !storageState.available ||
          (process.platform === 'linux' && storageState.backend === 'basic_text'),
        '需要可用且已解锁的桌面钥匙串（safeStorage）才能运行'
      )
      const loginWindow = await login(app, user)
      await loginWindow.close()
      const settings = await openSettings(app)
      await settings.getByRole('tab', { name: '桌面设置' }).click()
      const nodeName = `E2E 授权节点 ${Date.now()}`
      await settings.getByLabel('节点名称').fill(nodeName)
      await settings.getByRole('button', { name: '启用执行节点' }).click()
      await expect(settings.getByRole('heading', { name: '执行节点' })).toBeVisible()
      await expect(settings.getByText('在线')).toBeVisible({ timeout: 30_000 })
      await expect(settings.getByText('还没有授权本机资源')).toBeVisible()

      const grantedFile = join(userDataDir, 'granted-secret.txt')
      const grantedContent = `e2e-grant-marker-${Date.now()}`
      writeFileSync(grantedFile, grantedContent, 'utf8')
      // 系统选择器原生对话框在 E2E 中指向预置文件；授权链路（IPC→本地授权表→云端登记）保持真实。
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
      }, grantedFile)
      await settings.getByRole('button', { name: '授权文件…' }).click()
      await expect(settings.getByText('granted-secret.txt')).toBeVisible({ timeout: 15_000 })

      let grant: { nodeId: string; resourceId: string; displayName: string } | undefined
      await expect
        .poll(
          async () => {
            const grants = (await api(user.token, 'GET', '/resource-grants')) as unknown as Array<{
              nodeId: string
              resourceId: string
              displayName: string
            }>
            grant = grants.find((candidate) => candidate.displayName === 'granted-secret.txt')
            return grant?.resourceId ?? ''
          },
          { timeout: 20_000, intervals: [1_000, 2_000, 5_000] }
        )
        .not.toBe('')
      if (!grant) throw new Error('grant was not registered on the backend')

      const execution = (await api(user.token, 'POST', '/tool-executions', {
        toolName: 'read_granted_file',
        arguments: { resource_id: grant.resourceId },
        executionLocation: 'desktop',
        nodeId: grant.nodeId,
      })) as { id: string }
      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })
      await settings.getByRole('button', { name: '允许本次执行' }).click()
      await expect
        .poll(
          async () => {
            const rows = (await api(
              user.token,
              'GET',
              '/tool-executions?limit=20'
            )) as unknown as Array<{
              id: string
              status: string
              resultJson: { data?: { size_bytes?: number } } | null
            }>
            return rows.find((row) => row.id === execution.id)
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toEqual(
          expect.objectContaining({
            id: execution.id,
            status: 'succeeded',
            resultJson: expect.objectContaining({
              data: expect.objectContaining({
                size_bytes: Buffer.byteLength(grantedContent, 'utf8'),
              }),
            }),
          })
        )

      const denied = (await api(user.token, 'POST', '/tool-executions', {
        toolName: 'read_granted_file',
        arguments: { resource_id: 'e2e-not-granted-resource' },
        executionLocation: 'desktop',
        nodeId: grant.nodeId,
      })) as { id: string }
      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })
      await settings.getByRole('button', { name: '允许本次执行' }).click()
      await expect
        .poll(
          async () => {
            const rows = (await api(
              user.token,
              'GET',
              '/tool-executions?limit=20'
            )) as unknown as Array<{
              id: string
              status: string
              resultJson: { error?: { code?: string } } | null
            }>
            return rows.find((row) => row.id === denied.id)
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toEqual(
          expect.objectContaining({
            id: denied.id,
            status: 'failed',
            resultJson: expect.objectContaining({
              error: expect.objectContaining({ code: 'TOOL_GRANT_NOT_FOUND' }),
            }),
          })
        )
      await expect(settings.getByText('还没有授权本机资源')).toHaveCount(0)
    } finally {
      await app.close()
      await api(user.token, 'DELETE', '/auth/me')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('serves local memories from the node and reports them unavailable once it vanishes', async () => {
    test.setTimeout(420_000)
    const user = await createTestUser()
    const { app, userDataDir } = await launchApp()
    try {
      await app.firstWindow()
      const storageState = await app.evaluate(({ safeStorage }) => ({
        available: safeStorage.isEncryptionAvailable(),
        backend: safeStorage.getSelectedStorageBackend(),
      }))
      test.skip(
        !storageState.available ||
          (process.platform === 'linux' && storageState.backend === 'basic_text'),
        '需要可用且已解锁的桌面钥匙串（safeStorage）才能运行'
      )
      const loginWindow = await login(app, user)
      await loginWindow.close()
      const settings = await openSettings(app)
      await settings.getByRole('tab', { name: '桌面设置' }).click()
      // 能力集是登记那一刻写死的，配对必须在本用例内新做一次，旧节点不会声明 memory.*。
      const nodeName = `E2E 记忆节点 ${Date.now()}`
      await settings.getByLabel('节点名称').fill(nodeName)
      await settings.getByRole('button', { name: '启用执行节点' }).click()
      await expect(settings.getByRole('heading', { name: '执行节点' })).toBeVisible()
      await expect(settings.getByText('在线')).toBeVisible({ timeout: 30_000 })

      const nodes = (await api(user.token, 'GET', '/execution-nodes')) as unknown as Array<{
        id: string
        name: string
        capabilities: string[]
      }>
      const node = nodes.find((candidate) => candidate.name === nodeName)
      if (!node) throw new Error('paired node not registered on the backend')
      expect(node.capabilities).toEqual(
        expect.arrayContaining(['memory.search', 'memory.write', 'memory.delete'])
      )
      const assistant = (await api(user.token, 'POST', '/agent/assistants', {
        name: 'E2E 记忆助理',
        defaultModel: 'agnes-3.0-flash',
      })) as { id: string }
      const marker = `localmemory${Date.now().toString(36)}`
      const localContent = `本地专属记忆正文 ${marker}`

      // 一、节点拒绝写入：云端必须整次失败，不能留下一条没有正文的孤儿元数据行。
      const refused = postLocalMemory(user.token, assistant.id, localContent, `${marker}-refused`)
      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })
      await settings.getByRole('button', { name: '拒绝', exact: true }).click()
      const refusedResponse = await refused
      expect(refusedResponse.status).toBe(503)
      expect(await refusedResponse.json()).toEqual({ detail: 'LOCAL_MEMORY_NODE_UNAVAILABLE' })
      const listed = (await api(user.token, 'GET', '/memories')) as unknown as {
        items: unknown[]
      }
      expect(listed.items).toEqual([])
      await expect(settings.getByText('待确认任务')).toHaveCount(0, { timeout: 30_000 })

      // 二、节点接受写入：正文只落在本机，云端行的 content 必须为空。
      const accepted = postLocalMemory(user.token, assistant.id, localContent, `${marker}-stored`)
      await expect(settings.getByText('待确认任务')).toBeVisible({ timeout: 30_000 })
      await settings.getByRole('button', { name: '允许本次执行' }).click()
      const acceptedResponse = await accepted
      expect(acceptedResponse.status).toBe(201)
      const memory = (await acceptedResponse.json()) as {
        id: string
        content: string | null
        nodeId: string
        storageLocation: string
      }
      expect(memory).toEqual(
        expect.objectContaining({
          content: null,
          nodeId: node.id,
          storageLocation: 'local_node',
        })
      )
      await api(user.token, 'PATCH', `/memories/${memory.id}`, { status: 'active' })

      // 三、节点在线：检索经由节点取回只存在于本机的正文。
      const online = await searchMemories(user.token, assistant.id, marker)
      expect(online.localUnavailable).toBe(false)
      expect(online.results).toEqual([
        expect.objectContaining({ id: memory.id, content: localContent }),
      ])

      // 四、节点不告而别：SIGKILL 不会给服务端任何下线通知，只能靠心跳过期识别。
      app.process().kill('SIGKILL')
      await expect
        .poll(() => app.process().killed || app.process().exitCode !== null, { timeout: 15_000 })
        .toBe(true)
      let elapsedMs = Number.POSITIVE_INFINITY
      let outcome: MemorySearchOutcome | undefined
      // 心跳过期前节点仍被判为新鲜，检索会空等满作业超时；过期后必须立刻报不可用。
      // 因此这里同时轮询「报了不可用」与「返回得足够快」，只满足前者不算修好。
      await expect
        .poll(
          async () => {
            const startedAt = Date.now()
            outcome = await searchMemories(user.token, assistant.id, marker)
            elapsedMs = Date.now() - startedAt
            return outcome.localUnavailable && elapsedMs < LOCAL_UNAVAILABLE_BUDGET_MS
          },
          { timeout: NODE_STALE_TIMEOUT_MS, intervals: [5_000] }
        )
        .toBe(true)
      expect(elapsedMs).toBeLessThan(LOCAL_UNAVAILABLE_BUDGET_MS)
      // 本地记忆此刻读不到，但必须是「暂不可用」而不是被当作不存在。
      expect(outcome?.results).toEqual([])
    } finally {
      await app.close().catch(() => {})
      await api(user.token, 'DELETE', '/auth/me')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
