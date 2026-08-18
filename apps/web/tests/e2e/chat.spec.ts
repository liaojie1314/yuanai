import { test, expect, type Page } from '@playwright/test'
import { loginViaForm } from './api-mock'

/** 通过真实登录表单建立认证状态，覆盖中间件和客户端持久化链路。 */
async function setupAuth(page: Page): Promise<void> {
  // Use the same browser login path as a user. This avoids WebKit-specific
  // cookie timing races when navigating from the public login route.
  await loginViaForm(page)
}

/** 移动端会话列表位于抽屉内，点击会话前确保抽屉已打开。 */
async function openConversationSidebar(page: Page): Promise<void> {
  const hamburger = page.locator('.ch-hamburger')
  if (await hamburger.isVisible()) {
    // openSidebar is idempotent; always click so a stale transformed sidebar
    // cannot make the test believe the drawer is already open.
    await hamburger.click({ force: true })
    await expect(page.locator('.ch-sidebar.open')).toBeVisible()
  }
}

async function conversationItem(page: Page, index = 0) {
  await openConversationSidebar(page)
  const item = page.locator('.ch-cv-item').nth(index)
  await expect(item).toBeInViewport()
  return item
}

async function clickConversation(page: Page, index = 0): Promise<void> {
  const item = await conversationItem(page, index)
  await item.click()
}

/** Helper: wait for the custom confirm dialog and click the confirm (danger) button. */
async function acceptConfirmDialog(page: Page): Promise<void> {
  await expect(page.locator('.ch-confirm-dialog')).toBeVisible({ timeout: 3_000 })
  await page.locator('.ch-confirm-ok.danger').click()
}

/** Helper: wait for the custom confirm dialog and click cancel. */
async function dismissConfirmDialog(page: Page): Promise<void> {
  await expect(page.locator('.ch-confirm-dialog')).toBeVisible({ timeout: 3_000 })
  await page.locator('.ch-confirm-cancel').click()
}

test.describe('Chat interface', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  // ── Sidebar ──────────────────────────────────────────────────

  test('sidebar shows pre-seeded conversations', async ({ page }) => {
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
    const count = await page.locator('.ch-cv-item').count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('sidebar shows pinned conversation at top', async ({ page }) => {
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
    // conv-001 "React 组件性能优化" is pinned — pin icon should be present
    await expect(page.locator('.ch-cv-item').first().locator('.ch-cv-pin')).toBeVisible()
  })

  // ── Welcome page ─────────────────────────────────────────────

  test('shows welcome state when no conversation is selected', async ({ page }) => {
    await expect(page.locator('.ch-empty-state')).toBeVisible()
  })

  test('opens only current chat models and enables web search from its quick shortcut', async ({
    page,
  }) => {
    const composerSearch = page.locator('button[title="联网搜索"]')
    await expect(composerSearch).toBeEnabled()
    await expect(composerSearch).toHaveAttribute('aria-pressed', 'false')

    await page.locator('.ch-cap').filter({ hasText: '联网搜索' }).click()
    await expect(composerSearch).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.ch-input-ta')).toHaveValue('联网搜索最新 AI 行业动态')

    await page.locator('.ch-model-btn').click()
    const modelMenu = page.locator('.ch-mdrop.open')
    await expect(modelMenu).toContainText('DeepSeek V4 Flash-0731')
    await expect(modelMenu).toContainText('DeepSeek V4 Pro-0813')
    await expect(modelMenu).toContainText('Agnes 2.5 Flash')
    await expect(modelMenu).not.toContainText('GPT-4o')
    await expect(modelMenu).not.toContainText('Claude 3.5 Sonnet')
  })

  // ── Loading messages ─────────────────────────────────────────

  test('loads existing messages when clicking a conversation', async ({ page }) => {
    await clickConversation(page)
    await expect(page.locator('.ch-msg').first()).toBeVisible({ timeout: 8_000 })
  })

  test('existing AI messages render as markdown', async ({ page }) => {
    // conv-001 has markdown content with **bold** text
    await clickConversation(page)
    await expect(page.locator('.ch-msg-ai .md-body').first()).toBeVisible({ timeout: 8_000 })
    // Mock data has **阻断不必要的渲染触发** → <strong>
    await expect(page.locator('.ch-msg-ai .md-body strong').first()).toBeVisible()
  })

  // ── Sending messages ─────────────────────────────────────────

  test('sends a message via Enter key', async ({ page }) => {
    await clickConversation(page)
    await page.locator('.ch-input-ta').fill('What is React?')
    await page.keyboard.press('Enter')
    await expect(
      page.locator('.ch-msg-user .ch-msg-bubble').filter({ hasText: 'What is React?' })
    ).toBeVisible({ timeout: 5_000 })
  })

  test('sends a message via send button', async ({ page }) => {
    await clickConversation(page)
    await page.locator('.ch-input-ta').fill('Test send button')
    await page.locator('.ch-send-btn.on').click()
    await expect(
      page.locator('.ch-msg-user .ch-msg-bubble').filter({ hasText: 'Test send button' })
    ).toBeVisible({ timeout: 5_000 })
  })

  // ── AI reply — markdown rendering ─────────────────────────────

  test('AI reply renders with markdown after streaming completes', async ({ page }) => {
    await clickConversation(page)
    await page.locator('.ch-input-ta').fill('Explain React hooks')
    await page.keyboard.press('Enter')

    // Wait for AI response body to appear (streaming may complete instantly from mock)
    const aiBody = page.locator('.ch-msg-ai .md-body').last()
    await expect(aiBody).toBeVisible({ timeout: 20_000 })

    // The mock MOCK_RESPONSE has numbered list + **bold** → should render as <ol> + <strong>
    const formatEls = aiBody.locator('strong, em, ul li, ol li, code')
    await expect(formatEls.first()).toBeVisible({ timeout: 5_000 })
  })

  test('AI reply action buttons appear after streaming', async ({ page }) => {
    await clickConversation(page)
    await page.locator('.ch-input-ta').fill('Show me actions')
    await page.keyboard.press('Enter')

    // Wait for AI response content to be non-empty
    await expect(page.locator('.ch-msg-ai .md-body').last()).toBeVisible({ timeout: 20_000 })
    // Streaming cursor should be gone
    await expect(page.locator('.ch-cursor')).not.toBeVisible({ timeout: 5_000 })
    // Action buttons should be visible
    await expect(page.locator('.ch-msg-ai .ch-msg-acts').last()).toBeVisible()
  })

  // ── Duplicate message prevention ─────────────────────────────

  test('user message appears exactly once after send', async ({ page }) => {
    await clickConversation(page)
    const testMsg = `No duplicate ${Date.now()}`
    await page.locator('.ch-input-ta').fill(testMsg)
    await page.keyboard.press('Enter')

    const userBubbles = page.locator('.ch-msg-user .ch-msg-bubble').filter({ hasText: testMsg })
    // Immediately after send: exactly 1
    await expect(userBubbles).toHaveCount(1)

    // After AI response arrives: still exactly 1
    await expect(page.locator('.ch-msg-ai .md-body').last()).toBeVisible({ timeout: 20_000 })
    await expect(userBubbles).toHaveCount(1)
  })

  // ── Second message in same conversation ──────────────────────

  test('second message receives AI reply', async ({ page }) => {
    await clickConversation(page)

    // First message
    await page.locator('.ch-input-ta').fill('First question')
    await page.keyboard.press('Enter')
    // Wait for first AI reply
    await expect(page.locator('.ch-msg-ai .md-body').last()).toBeVisible({ timeout: 20_000 })
    // AI 内容在流式开始后就会挂载；必须等待停止按钮消失，才能确认整个流已结束。
    // 不能用光标是否可见判断结束，因为 Virtuoso 可能暂时回收流式行。
    await expect(page.locator('.ch-send-btn.streaming')).not.toBeVisible({ timeout: 20_000 })

    // Input should be cleared
    await expect(page.locator('.ch-input-ta')).toHaveValue('')

    // Second message
    await page.locator('.ch-input-ta').fill('Second question')
    await page.keyboard.press('Enter')
    // Second user message appears
    await expect(
      page.locator('.ch-msg-user .ch-msg-bubble').filter({ hasText: 'Second question' })
    ).toBeVisible({ timeout: 5_000 })
    // Second AI reply appears
    const aiMessages = page.locator('.ch-msg-ai .md-body')
    await expect(aiMessages.nth(1)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.ch-send-btn.streaming')).not.toBeVisible({ timeout: 20_000 })

    // Total AI messages: at least 2 (original + new from sending)
    const count = await aiMessages.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  // ── Delete conversation ───────────────────────────────────────

  test('delete conversation: cancel keeps conversation count unchanged', async ({ page }) => {
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
    const convCount = await page.locator('.ch-cv-item').count()

    // Open context menu on first conversation
    const firstItem = await conversationItem(page)
    await firstItem.hover()
    await firstItem.locator('.ch-cv-more').click()
    await expect(page.locator('.ch-cvmenu.open')).toBeVisible()

    // Click delete → custom dialog appears → cancel
    await page.locator('.ch-cvm-row.danger').click()
    await dismissConfirmDialog(page)

    // Count should be unchanged
    await expect(page.locator('.ch-cv-item')).toHaveCount(convCount)
  })

  test('delete conversation: confirm removes it from sidebar', async ({ page }) => {
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
    const convCount = await page.locator('.ch-cv-item').count()
    const firstTitle = await page
      .locator('.ch-cv-item')
      .first()
      .locator('.ch-cv-title')
      .textContent()

    // Open context menu and confirm delete
    const firstItem = await conversationItem(page)
    await firstItem.hover()
    await firstItem.locator('.ch-cv-more').click()
    await expect(page.locator('.ch-cvmenu.open')).toBeVisible()
    await page.locator('.ch-cvm-row.danger').click()
    await acceptConfirmDialog(page)

    // Wait for the conversation to disappear
    await expect(page.locator('.ch-cv-item')).toHaveCount(convCount - 1, { timeout: 5_000 })
    // The deleted conversation's title should no longer be visible
    if (firstTitle) {
      await expect(page.locator(`.ch-cv-title:has-text("${firstTitle}")`)).not.toBeVisible()
    }
  })

  test('deleting the active conversation redirects to welcome page', async ({ page }) => {
    // Navigate into the second conversation to make it active
    await clickConversation(page, 1)
    await page.waitForURL('**/chat/**', { timeout: 5_000 })

    // Delete that conversation (it's active)
    await openConversationSidebar(page)
    const activeItem = page.locator('.ch-cv-item.active')
    await expect(activeItem).toBeInViewport()
    await activeItem.hover()
    await activeItem.locator('.ch-cv-more').click()
    await expect(page.locator('.ch-cvmenu.open')).toBeVisible()
    await page.locator('.ch-cvm-row.danger').click()
    await acceptConfirmDialog(page)

    // Should redirect to welcome page
    await page.waitForURL('**/chat', { timeout: 5_000 })
    await expect(page.locator('.ch-empty-state')).toBeVisible({ timeout: 5_000 })
  })

  // ── Toolbar ──────────────────────────────────────────────────

  test('top right toolbar has only the share button', async ({ page }) => {
    await clickConversation(page)
    const rightToolbar = page.locator('.ch-tb-r')
    await expect(rightToolbar).toBeVisible()
    const buttons = rightToolbar.locator('button')
    await expect(buttons).toHaveCount(1)
    await expect(buttons.first()).toHaveAttribute('title', '分享对话')
  })
})

test.describe('Guest chat interface', () => {
  test('does not populate a prompt from welcome shortcuts', async ({ page }) => {
    await page.goto('/chat')

    const capability = page.locator('.ch-cap').filter({ hasText: '文件分析' })
    const suggestion = page.locator('.ch-sg-card').filter({ hasText: '创意写作' })
    const input = page.locator('.ch-input-ta')

    await expect(capability).toBeDisabled()
    await expect(suggestion).toBeDisabled()
    await capability.click({ force: true })
    await suggestion.click({ force: true })
    await expect(input).toHaveValue('')
  })
})

test.describe('Login form flow', () => {
  test('correct credentials login and redirect to /chat', async ({ page }) => {
    await loginViaForm(page)
    await expect(page).toHaveURL(/\/chat/)
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
  })
})
