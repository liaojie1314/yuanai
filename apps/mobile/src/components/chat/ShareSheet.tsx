import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, Link2, Share2, Trash2 } from 'lucide-react-native'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { useCreateShareLink, useRevokeShareLink, useShareLink } from '@yuanai/core'

import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { buildShareWebUrl } from '@/lib/publicWebOrigin'
import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

type ExpiryOption = 0 | 1 | 7 | 30

interface ShareSheetProps {
  convId: string
}

/**
 * 会话分享 BottomSheet：有效期 / 密码 / 生成链接 / 复制 / 系统分享 / 撤销。
 * 对外 URL 使用 Web origin（EXPO_PUBLIC_WEB_APP_URL），对齐 web ShareDialog。
 */
export const ShareSheet = forwardRef<BottomSheetModal, ShareSheetProps>(function ShareSheet(
  { convId },
  ref
) {
  const theme = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const dialog = useDialog()

  const { data: existingLink, isLoading, isFetching } = useShareLink(convId)
  const createMut = useCreateShareLink()
  const revokeMut = useRevokeShareLink()

  const [expiresInDays, setExpiresInDays] = useState<ExpiryOption>(0)
  const [enablePassword, setEnablePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)

  const currentLink = createMut.data ?? existingLink ?? null
  const shareUrl = currentLink ? buildShareWebUrl(currentLink.shareToken) : null

  useEffect(() => {
    if (!existingLink) return
    if (existingLink.hasPassword) setEnablePassword(true)
    if (existingLink.expiresAt) {
      const remainDays = Math.ceil(
        (new Date(existingLink.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000)
      )
      if (remainDays <= 1) setExpiresInDays(1)
      else if (remainDays <= 7) setExpiresInDays(7)
      else setExpiresInDays(30)
    } else {
      setExpiresInDays(0)
    }
  }, [existingLink])

  const expiryOptions = useMemo(
    () =>
      [
        { value: 0 as const, label: t('share.permanent') },
        { value: 1 as const, label: t('share.day1') },
        { value: 7 as const, label: t('share.day7') },
        { value: 30 as const, label: t('share.day30') },
      ] as const,
    [t]
  )

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  )

  const buildOpts = (): { expiresInDays: number | null; password: string } | null => {
    if (enablePassword && password.trim().length > 0 && password.trim().length < 4) {
      toast.show(t('share.passwordMin'))
      return null
    }
    return {
      expiresInDays: expiresInDays === 0 ? null : expiresInDays,
      password: enablePassword ? password.trim() : '',
    }
  }

  const handleCreateOrUpdate = (isUpdate: boolean): void => {
    const opts = buildOpts()
    if (!opts) return
    createMut.mutate(
      { convId, opts },
      {
        onSuccess: () => toast.show(isUpdate ? t('share.update') : t('share.linkReady')),
        onError: (err) => toast.show(err instanceof Error ? err.message : t('common.retryLater')),
      }
    )
  }

  const handleCopy = async (): Promise<void> => {
    if (!shareUrl) return
    await Clipboard.setStringAsync(shareUrl)
    setCopied(true)
    toast.show(t('chat.copiedToast'))
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSystemShare = async (): Promise<void> => {
    if (!shareUrl) return
    try {
      await Share.share({ message: shareUrl, url: shareUrl })
    } catch {
      /* 用户取消系统面板 */
    }
  }

  const handleRevoke = (): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: t('share.revokeConfirmTitle'),
        message: t('share.revokeConfirmMessage'),
        confirmText: t('share.revoke'),
        destructive: true,
      })
      if (!ok) return
      revokeMut.mutate(convId, {
        onSuccess: () => {
          createMut.reset()
          setPassword('')
          setEnablePassword(false)
          toast.show(t('share.revoke'))
        },
        onError: (err) => toast.show(err instanceof Error ? err.message : t('common.retryLater')),
      })
    })()
  }

  const busy = createMut.isPending || revokeMut.isPending || isFetching

  return (
    <BottomSheetModal
      ref={ref}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      backgroundStyle={[styles.sheetBg, { backgroundColor: theme.bg.surface }]}
      handleIndicatorStyle={[styles.handle, { backgroundColor: theme.border.default }]}
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <View style={styles.titleRow}>
          <Share2 size={18} color={theme.brand.solid} />
          <Text style={[styles.title, { color: theme.text.primary }]}>{t('share.title')}</Text>
        </View>

        {isLoading && !currentLink ? (
          <ActivityIndicator color={theme.brand.solid} style={{ marginVertical: spacing.xl }} />
        ) : (
          <>
            <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>
              {t('share.expires')}
            </Text>
            <View style={styles.chipRow}>
              {expiryOptions.map((opt) => {
                const active = expiresInDays === opt.value
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setExpiresInDays(opt.value)}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? theme.brand.solid : theme.border.default,
                        backgroundColor: active ? theme.brand.selected : theme.bg.base,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? theme.brand.selectedFg : theme.text.secondary,
                        fontSize: 13,
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={styles.passwordRow}>
              <Text style={[styles.fieldLabel, { color: theme.text.secondary, marginBottom: 0 }]}>
                {t('share.enablePassword')}
              </Text>
              <Switch
                value={enablePassword}
                onValueChange={setEnablePassword}
                trackColor={{ false: theme.border.default, true: brand.solid }}
                thumbColor="#FFFFFF"
              />
            </View>
            {enablePassword ? (
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t('share.passwordPlaceholder')}
                placeholderTextColor={theme.text.muted}
                secureTextEntry
                style={[
                  styles.input,
                  {
                    color: theme.text.primary,
                    borderColor: theme.border.default,
                    backgroundColor: theme.bg.base,
                  },
                ]}
              />
            ) : null}

            <Pressable
              onPress={() => handleCreateOrUpdate(!!currentLink)}
              disabled={busy}
              android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
              style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            >
              {createMut.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {currentLink ? t('share.update') : t('share.create')}
                </Text>
              )}
            </Pressable>

            {shareUrl ? (
              <View
                style={[
                  styles.linkBox,
                  { borderColor: theme.border.default, backgroundColor: theme.bg.base },
                ]}
              >
                <Link2 size={14} color={theme.text.muted} />
                <Text
                  style={[styles.linkText, { color: theme.text.primary }]}
                  numberOfLines={2}
                  selectable
                >
                  {shareUrl}
                </Text>
              </View>
            ) : null}

            {shareUrl ? (
              <View style={styles.actions}>
                <Pressable
                  onPress={() => {
                    void handleCopy()
                  }}
                  style={[styles.secondaryBtn, { borderColor: theme.border.default }]}
                >
                  {copied ? (
                    <Check size={15} color={theme.brand.solid} />
                  ) : (
                    <Copy size={15} color={theme.text.secondary} />
                  )}
                  <Text style={{ color: theme.text.primary, fontWeight: '600' }}>
                    {t('share.copyLink')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void handleSystemShare()
                  }}
                  style={[styles.secondaryBtn, { borderColor: theme.border.default }]}
                >
                  <Share2 size={15} color={theme.text.secondary} />
                  <Text style={{ color: theme.text.primary, fontWeight: '600' }}>
                    {t('share.systemShare')}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {currentLink ? (
              <Pressable
                onPress={handleRevoke}
                disabled={revokeMut.isPending}
                style={[styles.revokeBtn, { borderColor: theme.border.danger }]}
              >
                <Trash2 size={15} color={theme.border.danger} />
                <Text style={{ color: theme.border.danger, fontWeight: '600' }}>
                  {t('share.revoke')}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  )
})

const styles = StyleSheet.create({
  sheetBg: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  handle: { width: 36 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 17, fontWeight: '700' },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  primaryBtn: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  linkText: { flex: 1, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  secondaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  revokeBtn: {
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
})
