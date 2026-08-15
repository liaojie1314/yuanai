import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const camera = vi.hoisted(() => ({
  openSettings: vi.fn(),
  permission: { granted: true, canAskAgain: true },
  requestPermission: vi.fn(),
}))

const qrApi = vi.hoisted(() => ({
  approve: vi.fn(),
  deny: vi.fn(),
  inspect: vi.fn(),
  parse: vi.fn(),
}))

vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [camera.permission, camera.requestPermission],
}))

vi.mock('react-native', () => ({
  Linking: { openSettings: camera.openSettings },
  Pressable: 'Pressable',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}))

vi.mock('lucide-react-native', () => ({
  ScanLine: 'ScanLine',
  ShieldCheck: 'ShieldCheck',
  X: 'X',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>): string => {
      if (key === 'qrLogin.reviewTitle') return `正在登录到 ${values?.['deviceName'] ?? ''}`
      if (key === 'qrLogin.account') return `当前账号：${values?.['email'] ?? ''}`
      if (key === 'qrLogin.expiresAt') return `有效期至 ${values?.['time'] ?? ''}`
      const messages: Record<string, string> = {
        'qrLogin.actionFailed': '操作未完成，请重试',
        'qrLogin.approve': '确认登录',
        'qrLogin.cameraDenied': '未获得相机权限',
        'qrLogin.cameraDeniedDescription': '请允许相机权限以扫描登录二维码',
        'qrLogin.close': '返回聊天',
        'qrLogin.deny': '拒绝登录',
        'qrLogin.error': '二维码无法使用，请重试',
        'qrLogin.expired': '二维码已过期',
        'qrLogin.expiredDescription': '请让目标设备重新生成二维码。',
        'qrLogin.openSettings': '打开系统设置',
        'qrLogin.permissionPreparing': '正在准备相机权限',
        'qrLogin.retry': '重新扫描',
        'qrLogin.scanningHint': '将二维码放入取景框内',
        'qrLogin.success': '登录已批准',
        'qrLogin.title': '扫码登录',
      }
      return messages[key] ?? key
    },
  }),
}))

vi.mock('@yuanai/core/api', () => ({
  approveQrLoginChallenge: qrApi.approve,
  denyQrLoginChallenge: qrApi.deny,
  inspectQrLoginChallenge: qrApi.inspect,
  parseQrLoginPayload: qrApi.parse,
}))

vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: (selector: (state: { user: { email: string } }) => unknown) =>
    selector({ user: { email: 'yuanyuanblog@163.com' } }),
}))

vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    bg: { base: '#ffffff', surface: '#f8fafc' },
    border: { default: '#d1d5db' },
    brand: { solid: '#2563eb' },
    text: { muted: '#6b7280', primary: '#111827', secondary: '#374151' },
  }),
}))

import { QrLoginScanner } from './QrLoginScanner'

const scannedPayload =
  'yuanai://qr-login?challenge=valid&api=http%3A%2F%2F192.168.1.4%3A8000%2Fapi%2Fv1'
const parsedPayload = {
  challenge: 'x'.repeat(43),
  apiBaseUrl: 'http://192.168.1.4:8000/api/v1',
}
const inspection = {
  targetPlatform: 'web' as const,
  deviceName: 'Firefox on Ubuntu',
  expiresAt: '',
  status: 'pending' as const,
}

function press(root: ReactTestInstance, label: string): void {
  const target = root.findByProps({ accessibilityLabel: label })
  const handler = target.props['onPress']
  if (typeof handler !== 'function') throw new Error(`No press handler for ${label}`)
  act(() => handler())
}

async function scan(root: ReactTestInstance, data = scannedPayload): Promise<void> {
  const target = root.findByProps({ testID: 'qr-login-camera' })
  const handler = target.props['onBarcodeScanned']
  if (typeof handler !== 'function') throw new Error('No QR scan handler')
  await act(async () => {
    handler({ data })
    await Promise.resolve()
  })
}

function textContent(root: ReactTestInstance): string {
  return root
    .findAllByType('Text' as never)
    .map((node) => String(node.props['children']))
    .join(' ')
}

describe('QrLoginScanner', () => {
  beforeEach(() => {
    camera.permission = { granted: true, canAskAgain: true }
    camera.openSettings.mockReset().mockResolvedValue(undefined)
    camera.requestPermission.mockReset()
    qrApi.approve.mockReset()
    qrApi.deny.mockReset()
    qrApi.inspect.mockReset()
    qrApi.parse.mockReset()
    qrApi.parse.mockReturnValue(parsedPayload)
    qrApi.inspect.mockResolvedValue({
      ...inspection,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    qrApi.approve.mockResolvedValue(undefined)
    qrApi.deny.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('扫描后必须经用户确认才批准目标设备登录，并在成功后返回聊天', async () => {
    const onClose = vi.fn()
    const renderer = create(createElement(QrLoginScanner, { onClose }))

    await scan(renderer.root)

    expect(textContent(renderer.root)).toContain('正在登录到 Firefox on Ubuntu')
    expect(textContent(renderer.root)).toContain('当前账号：yuanyuanblog@163.com')
    expect(qrApi.approve).not.toHaveBeenCalled()

    await act(async () => {
      press(renderer.root, '确认登录')
      await Promise.resolve()
    })

    expect(qrApi.approve).toHaveBeenCalledWith(parsedPayload.challenge, {
      apiBaseUrl: parsedPayload.apiBaseUrl,
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('拒绝重复扫描和格式不合法的二维码', async () => {
    const renderer = create(createElement(QrLoginScanner))
    const cameraView = renderer.root.findByProps({ testID: 'qr-login-camera' })
    const onBarcodeScanned = cameraView.props['onBarcodeScanned']
    if (typeof onBarcodeScanned !== 'function') throw new Error('No QR scan handler')

    await act(async () => {
      onBarcodeScanned({ data: scannedPayload })
      onBarcodeScanned({ data: scannedPayload })
      await Promise.resolve()
    })
    expect(qrApi.inspect).toHaveBeenCalledOnce()

    qrApi.parse.mockImplementation(() => {
      throw new Error('QR_LOGIN_INVALID_PAYLOAD')
    })
    const invalidRenderer = create(createElement(QrLoginScanner))
    await scan(invalidRenderer.root, 'https://untrusted.example/qr-login')

    expect(qrApi.inspect).toHaveBeenCalledOnce()
    expect(textContent(invalidRenderer.root)).toContain('二维码无法使用，请重试')
  })

  it('相机权限被永久拒绝时提供系统设置入口', () => {
    camera.permission = { granted: false, canAskAgain: false }
    const renderer = create(createElement(QrLoginScanner))

    expect(textContent(renderer.root)).toContain('未获得相机权限')
    press(renderer.root, '打开系统设置')

    expect(camera.openSettings).toHaveBeenCalledOnce()
  })

  it('用户拒绝时仅调用拒绝接口且不批准', async () => {
    const renderer = create(createElement(QrLoginScanner))
    await scan(renderer.root)

    await act(async () => {
      press(renderer.root, '拒绝登录')
      await Promise.resolve()
    })

    expect(qrApi.deny).toHaveBeenCalledWith(parsedPayload.challenge, {
      apiBaseUrl: parsedPayload.apiBaseUrl,
    })
    expect(qrApi.approve).not.toHaveBeenCalled()
  })

  it('在二维码过期后退出确认状态并允许重新扫描', async () => {
    qrApi.inspect.mockResolvedValue({
      ...inspection,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    const renderer = create(createElement(QrLoginScanner))

    await scan(renderer.root)

    expect(textContent(renderer.root)).toContain('二维码已过期')
    expect(renderer.root.findByProps({ accessibilityLabel: '重新扫描' }).props['disabled']).toBe(
      false
    )
  })

  it('新的扫码会话挂载时不会复用上一轮的过期状态', async () => {
    qrApi.inspect.mockResolvedValue({
      ...inspection,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    const renderer = create(createElement(QrLoginScanner, { key: 'first' }))
    await scan(renderer.root)
    expect(textContent(renderer.root)).toContain('二维码已过期')

    await act(async () => {
      renderer.update(createElement(QrLoginScanner, { key: 'second' }))
    })

    expect(renderer.root.findByProps({ testID: 'qr-login-camera' })).toBeDefined()
  })

  it('在批准请求超时后重新启用确认操作', async () => {
    vi.useFakeTimers()
    qrApi.approve.mockReturnValue(new Promise<void>(() => undefined))
    const renderer = create(createElement(QrLoginScanner))
    await scan(renderer.root)

    await act(async () => {
      press(renderer.root, '确认登录')
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(textContent(renderer.root)).toContain('操作未完成，请重试')
    expect(renderer.root.findByProps({ accessibilityLabel: '确认登录' }).props['disabled']).toBe(
      false
    )
  })

  it('服务端已消费挑战但批准请求未结束时返回聊天', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    qrApi.approve.mockReturnValue(new Promise<void>(() => undefined))
    qrApi.inspect
      .mockResolvedValueOnce({
        ...inspection,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce({
        ...inspection,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: 'consumed',
      })
    const renderer = create(createElement(QrLoginScanner, { onClose }))
    await scan(renderer.root)

    await act(async () => {
      press(renderer.root, '确认登录')
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(qrApi.inspect).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
