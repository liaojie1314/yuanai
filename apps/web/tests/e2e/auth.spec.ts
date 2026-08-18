import { test, expect } from '@playwright/test'
import { setupApiMocks } from './api-mock'

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.goto('/login')
  })

  // ── Page structure ───────────────────────────────────────────

  test('login page renders two tabs', async ({ page }) => {
    await expect(page.locator('.a-tab')).toHaveCount(2)
  })

  test('email code tab is active by default', async ({ page }) => {
    const activeTab = page.locator('.a-tab.on')
    await expect(activeTab).toContainText('邮箱验证码')
  })

  test('email+password tab is present', async ({ page }) => {
    await expect(page.locator('.a-tab').nth(1)).toContainText('邮箱密码')
  })

  // ── Email code tab ───────────────────────────────────────────

  test('email code tab: send button click without email shows validation error', async ({
    page,
  }) => {
    await page.click('button.code-btn')
    await expect(page.locator('.ferr.on').first()).toBeVisible()
  })

  test('email code tab: invalid email shows validation error', async ({ page }) => {
    await page.fill('input[type="email"]', 'not-an-email')
    await page.click('button.code-btn')
    await expect(page.locator('.ferr.on').first()).toBeVisible()
  })

  test('email code tab: valid email starts countdown on send button', async ({ page }) => {
    await page.fill('input[type="email"]', 'test@example.com')
    await page.click('button.code-btn')
    const sendBtn = page.locator('button.code-btn')
    await expect(sendBtn).toBeDisabled()
    await expect(sendBtn).toContainText(/秒/)
  })

  // ── Email+password tab ───────────────────────────────────────

  test('switches to email+password tab', async ({ page }) => {
    await page.click('.a-tab:nth-child(2)')
    await expect(page.locator('.a-tab.on')).toContainText('邮箱密码')
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('email+password: empty submit shows validation errors', async ({ page }) => {
    await page.click('.a-tab:nth-child(2)')
    await page.click('button[type="submit"]')
    await expect(page.locator('.ferr.on').first()).toBeVisible()
  })

  test('email+password: invalid email shows error', async ({ page }) => {
    await page.click('.a-tab:nth-child(2)')
    await page.fill('input[type="email"]', 'bad')
    await page.fill('input[type="password"]', 'SomePass1!')
    await page.click('button[type="submit"]')
    await expect(page.locator('.ferr.on').first()).toBeVisible()
  })

  test('email+password: password field is present', async ({ page }) => {
    await page.click('.a-tab:nth-child(2)')
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('email+password: wrong credentials show error message', async ({ page }) => {
    await page.click('.a-tab:nth-child(2)')
    await page.fill('input[type="email"]', 'wrong@example.com')
    await page.fill('input[type="password"]', 'WrongPass1!')
    await page.click('button[type="submit"]')
    await expect(page.getByRole('region', { name: '通知' }).getByRole('alert')).toContainText(
      '邮箱或密码错误',
      { timeout: 5_000 }
    )
  })

  // ── Register link ────────────────────────────────────────────

  test('register link exists on login page', async ({ page }) => {
    await expect(page.locator('a[href*="register"]')).toBeVisible()
  })
})
