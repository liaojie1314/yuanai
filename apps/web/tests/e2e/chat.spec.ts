import { test, expect, type Page } from '@playwright/test'
import { setupApiMocks, loginViaForm, MOCK_TOKEN } from './api-mock'

/** Set Zustand auth state + cookie so middleware allows /chat without the form login flow. */
async function setupAuth(page: Page): Promise<void> {
  // Cookie for Next.js middleware (Edge runtime)
  await page.context().addCookies([
    {
      name: 'yuanai-auth',
      value: encodeURIComponent(MOCK_TOKEN),
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  // Set up route mocks before any page navigation
  await setupApiMocks(page)
  // Navigate to login page (PUBLIC) to initialize localStorage on the domain
  await page.goto('/login')
  // Write Zustand persist state to localStorage
  await page.evaluate((token) => {
    localStorage.setItem(
      'yuanai-auth',
      JSON.stringify({
        state: {
          user: {
            id: 'user-e2e-001',
            email: 'demo@yuanai.dev',
            username: 'demo',
            avatarUrl: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
          accessToken: token,
          refreshToken: 'e2e-mock-refresh-token',
        },
        version: 0,
      })
    )
  }, MOCK_TOKEN)
  // Now navigate to /chat — cookie lets middleware pass
  await page.goto('/chat')
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

  // ── Loading messages ─────────────────────────────────────────

  test('loads existing messages when clicking a conversation', async ({ page }) => {
    await page.locator('.ch-cv-item').first().click()
    await expect(page.locator('.ch-msg').first()).toBeVisible({ timeout: 8_000 })
  })

  test('existing AI messages render as markdown', async ({ page }) => {
    // conv-001 has markdown content with **bold** text
    await page.locator('.ch-cv-item').first().click()
    await expect(page.locator('.ch-msg-ai .md-body').first()).toBeVisible({ timeout: 8_000 })
    // Mock data has **阻断不必要的渲染触发** → <strong>
    await expect(page.locator('.ch-msg-ai .md-body strong').first()).toBeVisible()
  })

  // ── Sending messages ─────────────────────────────────────────

  test('sends a message via Enter key', async ({ page }) => {
    await page.locator('.ch-cv-item').first().click()
    await page.locator('.ch-input-ta').fill('What is React?')
    await page.keyboard.press('Enter')
    await expect(
      page.locator('.ch-msg-user .ch-msg-bubble').filter({ hasText: 'What is React?' })
    ).toBeVisible({ timeout: 5_000 })
  })

  test('sends a message via send button', async ({ page }) => {
    await page.locator('.ch-cv-item').first().click()
    await page.locator('.ch-input-ta').fill('Test send button')
    await page.locator('.ch-send-btn.on').click()
    await expect(
      page.locator('.ch-msg-user .ch-msg-bubble').filter({ hasText: 'Test send button' })
    ).toBeVisible({ timeout: 5_000 })
  })

  // ── AI reply — markdown rendering ─────────────────────────────

  test('AI reply renders with markdown after streaming completes', async ({ page }) => {
    await page.locator('.ch-cv-item').first().click()
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
    await page.locator('.ch-cv-item').first().click()
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
    await page.locator('.ch-cv-item').first().click()
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
    await page.locator('.ch-cv-item').first().click()

    // First message
    await page.locator('.ch-input-ta').fill('First question')
    await page.keyboard.press('Enter')
    // Wait for first AI reply
    await expect(page.locator('.ch-msg-ai .md-body').last()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.ch-cursor')).not.toBeVisible({ timeout: 5_000 })

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
    await expect(page.locator('.ch-cursor')).not.toBeVisible({ timeout: 5_000 })

    // Total AI messages: at least 2 (original + new from sending)
    const count = await aiMessages.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  // ── Delete conversation ───────────────────────────────────────

  test('delete conversation: cancel keeps conversation count unchanged', async ({ page }) => {
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
    const convCount = await page.locator('.ch-cv-item').count()

    // Open context menu on first conversation
    await page.locator('.ch-cv-item').first().hover()
    await page.locator('.ch-cv-item').first().locator('.ch-cv-more').click()
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
    await page.locator('.ch-cv-item').first().hover()
    await page.locator('.ch-cv-item').first().locator('.ch-cv-more').click()
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
    await page.locator('.ch-cv-item').nth(1).click()
    await page.waitForURL('**/chat/**', { timeout: 5_000 })

    // Delete that conversation (it's active)
    await page.locator('.ch-cv-item.active').hover()
    await page.locator('.ch-cv-item.active').locator('.ch-cv-more').click()
    await expect(page.locator('.ch-cvmenu.open')).toBeVisible()
    await page.locator('.ch-cvm-row.danger').click()
    await acceptConfirmDialog(page)

    // Should redirect to welcome page
    await page.waitForURL('**/chat', { timeout: 5_000 })
    await expect(page.locator('.ch-empty-state')).toBeVisible({ timeout: 5_000 })
  })

  // ── Toolbar ──────────────────────────────────────────────────

  test('top right toolbar has only the share button', async ({ page }) => {
    await page.locator('.ch-cv-item').first().click()
    const rightToolbar = page.locator('.ch-tb-r')
    await expect(rightToolbar).toBeVisible()
    const buttons = rightToolbar.locator('button')
    await expect(buttons).toHaveCount(1)
    await expect(buttons.first()).toHaveAttribute('title', '分享对话')
  })
})

test.describe('Login form flow', () => {
  test('correct credentials login and redirect to /chat', async ({ page }) => {
    await loginViaForm(page)
    await expect(page).toHaveURL(/\/chat/)
    await expect(page.locator('.ch-cv-item').first()).toBeVisible({ timeout: 5_000 })
  })
})
