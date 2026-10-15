import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 助理人格链路 E2E —— 跑在**真实后端**上，不用 `api-mock.ts` 的路由拦截。
 *
 * 其余 E2E 一律 mock 后端，但人格最大的风险恰好是「前后端各自 mock 都绿、真跑起来契约不对」：
 * 本轮预览接口一侧发 `GET` + 查询参数、另一侧只实现 `POST` + 请求体，两边单测全绿，
 * 只有真打后端才暴露。所以这条链路必须用真实后端。
 *
 * CI 的 `web-e2e` job 只起 Next 开发服务器，没有 FastAPI 也没有数据库，
 * 因此默认跳过；本机验证时用 `E2E_REAL_BACKEND=1` 显式开启：
 *
 * ```bash
 * pnpm dev:real                                                  # 另一个终端
 * E2E_REAL_BACKEND=1 pnpm --filter @yuanai/web test:e2e persona --project=chromium
 * ```
 */
const API_BASE = process.env['E2E_API_BASE'] ?? 'http://localhost:8000/api/v1'

/** 本机真实后端开启了验证码调试后门，注册不需要真发邮件。 */
const VERIFY_CODE = '888888'
const PASSWORD = 'Persona1234!'

/** 新建一个独立账号，避免用例之间互相看到对方的助理。 */
async function registerFreshUser(request: APIRequestContext): Promise<string> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const email = `persona-e2e-${suffix}@yuanai.dev`
  const response = await request.post(`${API_BASE}/auth/register`, {
    data: {
      email,
      password: PASSWORD,
      username: `persona${suffix}`.slice(0, 20),
      verifyCode: VERIFY_CODE,
    },
  })
  expect(response.ok(), `注册失败：HTTP ${response.status()} ${await response.text()}`).toBe(true)
  return email
}

/** 走真实登录表单，让应用自己写 `yuanai-auth` cookie 与访问令牌。 */
async function loginWithRealBackend(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.click('.a-tab:nth-child(2)')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/auth/login') && response.status() === 200,
      { timeout: 30_000 }
    ),
    page.waitForURL((url) => url.pathname.startsWith('/chat'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ])
}

test.describe('助理人格', () => {
  test.skip(
    !process.env['E2E_REAL_BACKEND'],
    '需要真实后端：E2E_REAL_BACKEND=1 pnpm --filter @yuanai/web test:e2e'
  )

  // 钉死视口：README 的界面预览全是 1440×900 视口 + 整页截图，而 chromium project 用的
  // `devices['Desktop Chrome']` 是 1280×720。不钉的话重跑这条用例会把预览图换成窄一截的版本。
  test.use({ viewport: { width: 1440, height: 900 } })

  test('新用户开箱即有助理，人格可编辑、可预览、可保存、可回滚', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', '人格页按桌面视口验证，移动视口归 Task 12')
    test.setTimeout(120_000)

    const email = await registerFreshUser(request)
    await loginWithRealBackend(page, email)

    // 截图规范：Web 统一 1440×900 视口 + 整页。
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/agent/assistants')
    await expect(page.getByRole('heading', { name: '助理与人格' })).toBeVisible()

    // M12 后端半边：从未调用过创建接口的新用户，列表里也必须已经有一个默认助理。
    await expect(page.locator('.persona-card')).toHaveCount(1)
    await expect(page.locator('.persona-card .persona-badge')).toHaveText('默认')

    await page.getByLabel('助理名称').fill('工作助理')
    await page.getByRole('button', { name: '创建助理' }).click()
    await expect(page.locator('.persona-card')).toHaveCount(2)

    // 新建的助理会被自动选中，人格编辑器直接出现。
    await expect(page.getByRole('heading', { name: '人格', exact: true })).toBeVisible()

    await page.getByLabel('语气').selectOption('lively')
    await page.getByLabel('开场白').fill('嗨，今天想聊点什么')

    // 预览是后端装配出来的真实片段：改表单不保存也要跟着变（防抖 300ms）。
    await expect(page.locator('pre.persona-fragment')).toContainText('嗨，今天想聊点什么', {
      timeout: 15_000,
    })
    await expect(page.locator('pre.persona-fragment')).toContainText('轻松活泼')

    await page.getByRole('button', { name: '保存人格' }).click()
    await expect(page.getByRole('status')).toContainText('已保存为第 2 版')
    await expect(page.getByRole('button', { name: '回滚到第 1 版' })).toBeVisible()

    // README 界面预览的证据图：拆成两张视口图而不是一张整页图 —— 整页高 1586，
    // 和其余 1440×900 的预览图不同比例，在 README 的表格里会被拉成满宽巨图。
    // 两张合起来覆盖 0–900 与 686–1586，整页内容都在，没有截掉任何区域。
    // 必须先回到顶部：前面的断言会把页面自动滚下去，直接截就少了页面标题与助理列表。
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
    await page.screenshot({ path: '../../docs/assets/screenshots/web-assistant-persona.png' })
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
    })
    await expect(page.getByRole('button', { name: '回滚到第 1 版' })).toBeInViewport()
    await page.screenshot({ path: '../../docs/assets/screenshots/web-persona-history.png' })

    // 回滚到第 1 版 = 以第 1 版内容生成第 3 版，语气回到默认的「简洁直接」。
    await page.getByRole('button', { name: '回滚到第 1 版' }).click()
    await expect(page.getByLabel('语气')).toHaveValue('concise', { timeout: 15_000 })
    await expect(page.getByLabel('开场白')).toHaveValue('')
  })

  test('空态屏就能选助理并绑进新会话，已有会话切换走 PATCH', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', '侧栏切换器按桌面视口验证')
    test.setTimeout(180_000)

    const email = await registerFreshUser(request)
    await loginWithRealBackend(page, email)

    await page.goto('/agent/assistants')
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/agent/assistants') && response.request().method() === 'POST'
    )
    await page.getByLabel('助理名称').fill('第二助理')
    await page.getByRole('button', { name: '创建助理' }).click()
    await expect(page.locator('.persona-card')).toHaveCount(2)
    const secondAssistantId = String(((await (await created).json()) as { id: string }).id)

    await page.goto('/chat')

    // 空态屏也必须能选：会话还不存在没法 PATCH，选择先记在本地、建会话时作为 assistantId 带出。
    // 控件曾经在没有会话时整块隐藏、且只在侧栏出现，等于欢迎页根本看不到助理。
    const switcher = page.getByLabel('切换助理')
    await expect(switcher).toBeVisible()
    await expect(switcher).toHaveText(/我的助理/)

    // 选单与顶栏模型下拉同款自绘面板，不是原生 select
    await switcher.click()
    await page.getByRole('option', { name: '第二助理' }).click()
    await expect(switcher).toHaveText(/第二助理/)
    await expect(page.getByRole('option')).toHaveCount(0)

    const createdConversation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/chat/conversations') && response.request().method() === 'POST'
    )
    await page.locator('.ch-input-ta').fill('你好')
    await page.locator('.ch-send-btn.on').click()

    // 真正的断言落在服务端返回的会话上，而不是界面记住了什么：
    // 两侧各自 mock 都绿、真跑契约不对，正是这条链路上出过的事。
    const conversation = (await (await createdConversation).json()) as { assistantId: string }
    expect(conversation.assistantId).toBe(secondAssistantId)

    // 真实模型回复：只断言助理气泡出现并且**真的有文字**，不断言内容。
    // 气泡会在流式开始时先以空壳渲染，所以光断言可见会放过「后端 500、一个字都没来」。
    await expect
      .poll(
        async () => {
          const body = page.locator('.ch-msg-ai .ch-msg-body').first()
          return (await body.count()) === 0 ? 0 : (await body.innerText()).trim().length
        },
        { message: '助理气泡始终没有文字', timeout: 90_000 }
      )
      .toBeGreaterThan(0)

    // 会话已存在：这次切换走 PATCH，标签读的是接口返回的绑定结果
    await switcher.click()
    // 助理增删改的唯一入口挂在面板底部，只有一个助理的新用户也得能点到
    await expect(page.getByRole('link', { name: '管理助理' })).toHaveAttribute(
      'href',
      '/agent/assistants'
    )
    await page.getByRole('option', { name: '我的助理' }).click()
    await expect(switcher).toHaveText(/我的助理/)
    await expect(page.getByRole('option')).toHaveCount(0)
  })
})
