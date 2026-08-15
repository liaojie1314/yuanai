import { CameraView, useCameraPermissions } from 'expo-camera'
import type { BarcodeScanningResult } from 'expo-camera'
import { ScanLine, ShieldCheck, X } from 'lucide-react-native'
import React, { type ComponentType, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'

import {
  approveQrLoginChallenge,
  denyQrLoginChallenge,
  inspectQrLoginChallenge,
  parseQrLoginPayload,
} from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'
import type { ParsedQrLoginPayload, QrLoginInspection, QrLoginStatus } from '@yuanai/types'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

type ScannerStage =
  'camera' | 'inspecting' | 'review' | 'approving' | 'denying' | 'denied' | 'expired' | 'error'

const QR_ACTION_TIMEOUT_MS = 15_000
const QR_APPROVAL_RECONCILIATION_DELAY_MS = 750

interface ReviewData {
  inspection: QrLoginInspection
  payload: ParsedQrLoginPayload
}

interface NativeCameraViewProps {
  barcodeScannerSettings: { barcodeTypes: readonly ['qr'] }
  facing: 'back'
  onBarcodeScanned: (result: BarcodeScanningResult) => void
  style: object
  testID: string
}

// expo-camera 的声明使用与本项目不同版本的 React 类型包；运行时组件契约不变，
// 在平台边界收窄为本组件实际传入的 props，避免将该不兼容传播到共享包。
const NativeCameraView = CameraView as unknown as ComponentType<NativeCameraViewProps>

/** 扫码登录界面的可选回退行为。 */
export interface QrLoginScannerProps {
  /** 用户完成、取消或关闭扫码流程后的导航回调。 */
  onClose?: () => void
}

/**
 * 由已登录的移动端扫描二维码，并在展示目标设备、账号和有效期后明确批准或拒绝登录。
 * @param props 用户关闭、批准或拒绝流程时的导航回调
 */
export function QrLoginScanner({ onClose }: QrLoginScannerProps): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useTheme()
  const user = useAuthStore((state) => state.user)
  const [permission, requestPermission] = useCameraPermissions()
  const [stage, setStage] = useState<ScannerStage>('camera')
  const [review, setReview] = useState<ReviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const scanLocked = useRef(false)

  useEffect(
    () => () => {
      requestVersion.current += 1
    },
    []
  )

  // 二维码到期后必须主动退出确认态。否则开发热更新、网络暂停或系统恢复时，组件会
  // 保留一个已不可批准的“正在确认”按钮，用户只能强制关闭应用才能恢复。
  useEffect(() => {
    if (!review || (stage !== 'review' && stage !== 'approving' && stage !== 'denying')) return

    const expiresAt = Date.parse(review.inspection.expiresAt)
    const remainingMs = expiresAt - Date.now()
    if (!Number.isFinite(expiresAt) || remainingMs <= 0) {
      requestVersion.current += 1
      setStage('expired')
      return
    }

    const timeout = setTimeout(() => {
      requestVersion.current += 1
      setStage('expired')
    }, remainingMs)
    return () => clearTimeout(timeout)
  }, [review, stage])

  const returnToChat = useCallback((): void => {
    requestVersion.current += 1
    onClose?.()
  }, [onClose])

  const resetScanner = useCallback((): void => {
    requestVersion.current += 1
    scanLocked.current = false
    setError(null)
    setReview(null)
    setStage('camera')
  }, [])

  // Android 上批准请求偶发在服务端提交 204 后仍保持 pending。将核对绑定到
  // approving 状态，可在 Fast Refresh、应用恢复和目标端快速兑换后统一收尾。
  useEffect(() => {
    if (!review || stage !== 'approving') return

    let cancelled = false
    const timeout = setTimeout(() => {
      void inspectApprovalStatus(review)
        .then((status) => {
          if (!cancelled) completeApprovalStatus(status, setStage, returnToChat)
        })
        .catch(() => undefined)
    }, QR_APPROVAL_RECONCILIATION_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [returnToChat, review, stage])

  const onBarcodeScanned = useCallback(
    async (result: BarcodeScanningResult): Promise<void> => {
      if (scanLocked.current) return
      scanLocked.current = true
      const version = ++requestVersion.current
      setError(null)
      setStage('inspecting')

      try {
        const payload = parseQrLoginPayload(result.data)
        const inspection = await inspectQrLoginChallenge(payload.challenge, {
          apiBaseUrl: payload.apiBaseUrl,
        })
        if (version !== requestVersion.current) return

        if (inspection.status === 'pending') {
          setReview({ inspection, payload })
          setStage('review')
          return
        }
        setStage(inspection.status === 'expired' ? 'expired' : 'denied')
      } catch {
        if (version !== requestVersion.current) return
        scanLocked.current = false
        setError(t('qrLogin.error'))
        setStage('error')
      }
    },
    [t]
  )

  const approve = useCallback(async (): Promise<void> => {
    if (!review || stage !== 'review') return
    const version = ++requestVersion.current
    setError(null)
    setStage('approving')

    try {
      await withActionTimeout(
        approveQrLoginChallenge(review.payload.challenge, {
          apiBaseUrl: review.payload.apiBaseUrl,
        })
      )
      if (version === requestVersion.current) {
        returnToChat()
      }
    } catch {
      if (version !== requestVersion.current) return
      try {
        const status = await inspectApprovalStatus(review)
        if (version !== requestVersion.current) return
        if (completeApprovalStatus(status, setStage, returnToChat)) return
      } catch {
        // 原请求错误会在下方转为可重试状态；避免覆盖原始网络错误。
      }
      if (version === requestVersion.current) {
        setError(t('qrLogin.actionFailed'))
        setStage('review')
      }
    }
  }, [returnToChat, review, stage, t])

  const deny = useCallback(async (): Promise<void> => {
    if (!review || stage !== 'review') return
    const version = ++requestVersion.current
    setError(null)
    setStage('denying')
    try {
      await withActionTimeout(
        denyQrLoginChallenge(review.payload.challenge, {
          apiBaseUrl: review.payload.apiBaseUrl,
        })
      )
      if (version === requestVersion.current) setStage('denied')
    } catch {
      if (version === requestVersion.current) {
        setError(t('qrLogin.actionFailed'))
        setStage('review')
      }
    }
  }, [review, stage, t])

  const requestCameraPermission = useCallback(async (): Promise<void> => {
    try {
      await requestPermission()
    } catch {
      setError(t('qrLogin.permissionFailed'))
    }
  }, [requestPermission, t])

  const openSystemSettings = useCallback((): void => {
    void Linking.openSettings().catch(() => setError(t('qrLogin.permissionFailed')))
  }, [t])

  if (permission === null) {
    return <StatusSurface title={t('qrLogin.title')} message={t('qrLogin.permissionPreparing')} />
  }

  if (!permission.granted) {
    return (
      <StatusSurface
        title={t('qrLogin.title')}
        message={t('qrLogin.cameraDenied')}
        description={error ?? t('qrLogin.cameraDeniedDescription')}
        actions={
          <>
            {permission.canAskAgain ? (
              <PrimaryButton
                label={t('qrLogin.requestPermission')}
                onPress={() => void requestCameraPermission()}
              />
            ) : (
              <PrimaryButton label={t('qrLogin.openSettings')} onPress={openSystemSettings} />
            )}
            <SecondaryButton label={t('qrLogin.close')} onPress={returnToChat} />
          </>
        }
      />
    )
  }

  if (stage === 'camera') {
    return (
      <View style={styles.cameraScreen}>
        <NativeCameraView
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          facing="back"
          onBarcodeScanned={onBarcodeScanned}
          style={styles.camera}
          testID="qr-login-camera"
        />
        <SafeAreaView style={styles.cameraOverlay} pointerEvents="box-none">
          <View style={styles.cameraHeader}>
            <View style={styles.cameraHeading} pointerEvents="none">
              <View style={styles.cameraTitleIcon}>
                <ScanLine color="#FFFFFF" size={18} strokeWidth={2.4} />
              </View>
              <View>
                <Text style={styles.cameraTitle}>{t('qrLogin.title')}</Text>
                <Text style={styles.cameraSubtitle}>{t('qrLogin.scanningHint')}</Text>
              </View>
            </View>
            <Pressable
              accessibilityLabel={t('qrLogin.close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={returnToChat}
              style={styles.cameraCloseButton}
            >
              <X color="#FFFFFF" size={20} strokeWidth={2.4} />
            </Pressable>
          </View>
          <View style={styles.cameraTargetArea} pointerEvents="none">
            <View style={styles.cameraGuide}>
              <View style={[styles.guideCorner, styles.guideCornerTopLeft]} />
              <View style={[styles.guideCorner, styles.guideCornerTopRight]} />
              <View style={[styles.guideCorner, styles.guideCornerBottomLeft]} />
              <View style={[styles.guideCorner, styles.guideCornerBottomRight]} />
            </View>
          </View>
          <View style={styles.cameraFooter} pointerEvents="none">
            <View style={styles.cameraHintSurface}>
              <ScanLine color="#FFFFFF" size={17} strokeWidth={2.2} />
              <Text style={styles.cameraHint}>{t('qrLogin.scanningHint')}</Text>
            </View>
            <View style={styles.cameraSecurityHint}>
              <ShieldCheck color="rgba(255,255,255,0.8)" size={14} strokeWidth={2.2} />
              <Text style={styles.cameraSecurityText}>{t('qrLogin.reviewDescription')}</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  if (stage === 'inspecting') {
    return <StatusSurface title={t('qrLogin.title')} message={t('qrLogin.inspecting')} />
  }

  if (stage === 'review' || stage === 'approving' || stage === 'denying') {
    if (!review) return <StatusSurface title={t('qrLogin.title')} message={t('qrLogin.error')} />
    const busy = stage === 'approving' || stage === 'denying'
    return (
      <StatusSurface
        title={t('qrLogin.reviewTitle', { deviceName: review.inspection.deviceName })}
        message={t('qrLogin.reviewDescription')}
        description={error ?? undefined}
        details={
          <View
            style={[
              styles.details,
              { borderColor: theme.border.default, backgroundColor: theme.bg.surface },
            ]}
          >
            <Detail
              label={t('qrLogin.targetPlatform')}
              value={targetPlatformLabel(t, review.inspection.targetPlatform)}
            />
            <Detail label={t('qrLogin.account', { email: user?.email ?? '—' })} value="" />
            <Detail
              label={t('qrLogin.expiresAt', { time: formatExpiresAt(review.inspection.expiresAt) })}
              value=""
            />
          </View>
        }
        actions={
          <>
            <PrimaryButton
              disabled={busy}
              label={stage === 'approving' ? t('qrLogin.approving') : t('qrLogin.approve')}
              onPress={() => void approve()}
            />
            <SecondaryButton
              disabled={busy}
              label={stage === 'denying' ? t('qrLogin.denying') : t('qrLogin.deny')}
              onPress={() => void deny()}
            />
          </>
        }
      />
    )
  }

  if (stage === 'denied' || stage === 'expired') {
    return (
      <StatusSurface
        title={stage === 'denied' ? t('qrLogin.denied') : t('qrLogin.expired')}
        message={
          stage === 'denied' ? t('qrLogin.deniedDescription') : t('qrLogin.expiredDescription')
        }
        actions={
          <>
            <PrimaryButton label={t('qrLogin.retry')} onPress={resetScanner} />
            <SecondaryButton label={t('qrLogin.close')} onPress={returnToChat} />
          </>
        }
      />
    )
  }

  return (
    <StatusSurface
      title={t('qrLogin.title')}
      message={error ?? t('qrLogin.error')}
      actions={
        <>
          <PrimaryButton label={t('qrLogin.retry')} onPress={resetScanner} />
          <SecondaryButton label={t('qrLogin.close')} onPress={returnToChat} />
        </>
      }
    />
  )
}

function targetPlatformLabel(
  translate: (key: string) => string,
  platform: 'web' | 'desktop'
): string {
  return platform === 'web' ? translate('qrLogin.web') : translate('qrLogin.desktop')
}

function formatExpiresAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

/** 为扫码批准/拒绝请求设置上限，避免网络层异常后按钮永久禁用。 */
function withActionTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('QR_LOGIN_ACTION_TIMEOUT')),
      QR_ACTION_TIMEOUT_MS
    )
    operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

/** 读取当前账号有权查看的挑战状态；网络异常交由调用方显示可重试状态。 */
async function inspectApprovalStatus(review: ReviewData): Promise<QrLoginStatus> {
  const inspection = await inspectQrLoginChallenge(review.payload.challenge, {
    apiBaseUrl: review.payload.apiBaseUrl,
  })
  return inspection.status
}

/** 根据挑战终态完成扫码页面；返回 true 表示调用方不再继续等待原始请求。 */
function completeApprovalStatus(
  status: QrLoginStatus,
  setStage: (stage: ScannerStage) => void,
  returnToChat: () => void
): boolean {
  if (status === 'approved' || status === 'consumed') {
    returnToChat()
    return true
  }
  if (status === 'expired') {
    setStage('expired')
    return true
  }
  if (status === 'denied') {
    setStage('denied')
    return true
  }
  return false
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.text.secondary }]}>{label}</Text>
      {value ? (
        <Text style={[styles.detailValue, { color: theme.text.primary }]}>{value}</Text>
      ) : null}
    </View>
  )
}

function StatusSurface({
  actions,
  description,
  details,
  message,
  title,
}: {
  actions?: React.ReactNode
  description?: string | undefined
  details?: React.ReactNode | undefined
  message: string
  title: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={[styles.statusScreen, { backgroundColor: theme.bg.base }]}>
      <View
        style={[
          styles.statusContent,
          { backgroundColor: theme.bg.surface, borderColor: theme.border.default },
        ]}
      >
        <Text style={[styles.title, { color: theme.text.primary }]}>{title}</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: theme.text.secondary }]}
        >
          {message}
        </Text>
        {description ? (
          <Text style={[styles.description, { color: theme.text.muted }]}>{description}</Text>
        ) : null}
        {details}
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  )
}

function PrimaryButton({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean
  label: string
  onPress: () => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: theme.brand.solid },
        disabled && styles.disabledButton,
      ]}
    >
      <Text style={styles.primaryButtonLabel}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean
  label: string
  onPress: () => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { borderColor: theme.border.default, borderWidth: StyleSheet.hairlineWidth },
        disabled && styles.disabledButton,
      ]}
    >
      <Text style={[styles.secondaryButtonLabel, { color: theme.text.primary }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginTop: spacing.xl, width: '100%' },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.lg,
  },
  camera: { ...StyleSheet.absoluteFillObject },
  cameraCloseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.56)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cameraFooter: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  cameraGuide: { aspectRatio: 1, maxWidth: 280, position: 'relative', width: '70%' },
  cameraHeader: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cameraHeading: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  cameraHint: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  cameraHintSurface: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  cameraScreen: { flex: 1 },
  cameraSecurityHint: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  cameraSecurityText: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 12, lineHeight: 18 },
  cameraSubtitle: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 12, marginTop: 1 },
  cameraTargetArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  cameraTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  cameraTitleIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  description: { fontSize: 14, lineHeight: 20, marginTop: spacing.sm, textAlign: 'center' },
  detailLabel: { flex: 1, fontSize: 14 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  detailValue: { fontSize: 14, fontWeight: '600' },
  details: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  disabledButton: { opacity: 0.55 },
  guideCorner: { borderColor: '#FFFFFF', height: 42, position: 'absolute', width: 42 },
  guideCornerBottomLeft: {
    borderBottomLeftRadius: 9,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    bottom: 0,
    left: 0,
  },
  guideCornerBottomRight: {
    borderBottomRightRadius: 9,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    bottom: 0,
    right: 0,
  },
  guideCornerTopLeft: {
    borderLeftWidth: 4,
    borderTopLeftRadius: 9,
    borderTopWidth: 4,
    left: 0,
    top: 0,
  },
  guideCornerTopRight: {
    borderRightWidth: 4,
    borderTopRightRadius: 9,
    borderTopWidth: 4,
    right: 0,
    top: 0,
  },
  message: { fontSize: 16, lineHeight: 24, marginTop: spacing.md, textAlign: 'center' },
  primaryButtonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondaryButtonLabel: { fontSize: 15, fontWeight: '600' },
  statusContent: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 440,
    padding: spacing.xl,
    width: '100%',
  },
  statusScreen: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.lg },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
})
