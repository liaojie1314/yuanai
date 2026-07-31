import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { KeyRound, Link2, Mail, Trash2 } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  useChangeEmail,
  useChangePassword,
  useClearAllConversations,
  useCurrentUser,
  useDeleteMe,
  useSendVerifyCode,
  useUnlinkGithub,
  useUnlinkGoogle,
} from '@yuanai/core'

import { AuthButton } from '@/components/auth/AuthButton'
import { AuthTextInput } from '@/components/auth/AuthTextInput'
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { useDialog } from '@/components/ui/Dialog'
import { border, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

type Panel = null | 'password' | 'email'

/**
 * 安全屏：改密 / 改邮箱（验证码）/ 解绑三方 / 清空对话 / 注销账号。
 * 危险操作统一走 dialog.confirm(destructive)（决策记录：不用系统 Alert）。
 */
export default function SecurityScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useTheme()
  const router = useRouter()
  const dialog = useDialog()
  const { data: user } = useCurrentUser()

  const changePassword = useChangePassword()
  const changeEmail = useChangeEmail()
  const sendCode = useSendVerifyCode()
  const clearConvs = useClearAllConversations()
  const deleteMe = useDeleteMe()
  const unlinkGithub = useUnlinkGithub()
  const unlinkGoogle = useUnlinkGoogle()

  const [panel, setPanel] = useState<Panel>(null)

  // 改密表单
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confPw, setConfPw] = useState('')

  // 改邮箱表单
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [codeCd, setCodeCd] = useState(0)
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const alertErr = (title: string, err: unknown): void => {
    void dialog.alert({
      title,
      message: err instanceof Error ? err.message : t('common.retryLater'),
    })
  }

  const onSubmitPassword = async (): Promise<void> => {
    if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
      void dialog.alert({
        title: t('settings.passwordInvalid'),
        message: t('settings.passwordInvalidBody'),
      })
      return
    }
    if (newPw !== confPw) {
      void dialog.alert({
        title: t('settings.passwordMismatch'),
        message: t('settings.passwordMismatchBody'),
      })
      return
    }
    try {
      await changePassword.mutateAsync({ oldPassword: oldPw, newPassword: newPw })
      setPanel(null)
      setOldPw('')
      setNewPw('')
      setConfPw('')
      void dialog.alert({
        title: t('settings.passwordChanged'),
        message: t('settings.passwordChangedBody'),
      })
    } catch (err) {
      alertErr(t('settings.updateFailed'), err)
    }
  }

  const onSendEmailCode = async (): Promise<void> => {
    const email = newEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      void dialog.alert({
        title: t('settings.emailInvalid'),
        message: t('settings.emailInvalidBody'),
      })
      return
    }
    try {
      await sendCode.mutateAsync({ email, scene: 'change_email' })
      setCodeCd(60)
      if (cdTimer.current) clearInterval(cdTimer.current)
      cdTimer.current = setInterval(() => {
        setCodeCd((s) => {
          if (s <= 1) {
            if (cdTimer.current) clearInterval(cdTimer.current)
            return 0
          }
          return s - 1
        })
      }, 1000)
    } catch (err) {
      alertErr(t('auth.sendCodeFailed'), err)
    }
  }

  const onSubmitEmail = async (): Promise<void> => {
    try {
      await changeEmail.mutateAsync({ newEmail: newEmail.trim(), verifyCode: emailCode })
      setPanel(null)
      setNewEmail('')
      setEmailCode('')
      void dialog.alert({
        title: t('settings.emailChanged'),
        message: t('settings.emailChangedBody'),
      })
    } catch (err) {
      alertErr(t('settings.changeFailed'), err)
    }
  }

  const onUnlink = (provider: 'github' | 'google'): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: t('settings.unlinkTitle', { provider: provider === 'github' ? 'GitHub' : 'Google' }),
        message: t('settings.unlinkMessage'),
        confirmText: t('settings.unlink'),
        destructive: true,
      })
      if (!ok) return
      try {
        if (provider === 'github') await unlinkGithub.mutateAsync()
        else await unlinkGoogle.mutateAsync()
      } catch (err) {
        alertErr(t('settings.unlinkFailed'), err)
      }
    })()
  }

  const onClearConversations = (): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: t('settings.clearAll'),
        message: t('settings.clearAllDesc'),
        confirmText: t('common.delete'),
        destructive: true,
      })
      if (!ok) return
      try {
        const res = await clearConvs.mutateAsync()
        void dialog.alert({ title: t('common.success'), message: String(res.deleted) })
      } catch (err) {
        alertErr(t('settings.updateFailed'), err)
      }
    })()
  }

  const onDeleteAccount = (): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: t('settings.deleteAccount'),
        message: t('settings.deleteAccountDesc'),
        confirmText: t('settings.deleteAccount'),
        destructive: true,
      })
      if (!ok) return
      const typed = await dialog.prompt({
        title: t('common.confirm'),
        message: `输入你的邮箱 ${user?.email ?? ''} 以确认注销`,
        placeholder: user?.email ?? '',
      })
      if (typed?.trim() !== user?.email) {
        if (typed !== null) {
          void dialog.alert({ title: t('settings.emailInvalid'), message: t('common.cancel') })
        }
        return
      }
      try {
        await deleteMe.mutateAsync()
        router.replace('/(auth)/login')
      } catch (err) {
        alertErr(t('settings.updateFailed'), err)
      }
    })()
  }

  return (
    <SettingsShell title={t('settings.security')}>
      <SettingsGroup label={t('settings.security')}>
        <SettingsRow
          label={t('settings.changePassword')}
          icon={<KeyRound size={18} color={theme.text.secondary} />}
          sublabel={
            user?.passwordChangedAt ? `上次修改 ${formatDate(user.passwordChangedAt)}` : undefined
          }
          onPress={() => setPanel(panel === 'password' ? null : 'password')}
        />
        <SettingsRow
          label={t('settings.changeEmail')}
          icon={<Mail size={18} color={theme.text.secondary} />}
          value={user?.email ?? ''}
          divider={false}
          onPress={() => setPanel(panel === 'email' ? null : 'email')}
        />
      </SettingsGroup>

      {panel === 'password' ? (
        <View style={styles.panel}>
          <AuthTextInput
            label={t('settings.currentPassword')}
            placeholder={t('settings.currentPassword')}
            secureTextEntry
            value={oldPw}
            onChangeText={setOldPw}
          />
          <AuthTextInput
            label={t('settings.newPassword')}
            placeholder={t('auth.passwordPlaceholderStrong')}
            secureTextEntry
            value={newPw}
            onChangeText={setNewPw}
          />
          <AuthTextInput
            label={t('settings.confirmPassword')}
            placeholder={t('auth.confirmPasswordPlaceholder')}
            secureTextEntry
            value={confPw}
            onChangeText={setConfPw}
          />
          <AuthButton
            label={t('common.confirm')}
            loading={changePassword.isPending}
            onPress={() => {
              void onSubmitPassword()
            }}
          />
        </View>
      ) : null}

      {panel === 'email' ? (
        <View style={styles.panel}>
          <AuthTextInput
            label={t('settings.newEmail')}
            placeholder="new@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={newEmail}
            onChangeText={setNewEmail}
          />
          <AuthTextInput
            label={t('settings.verifyCode')}
            placeholder="6 位数字"
            keyboardType="number-pad"
            maxLength={6}
            value={emailCode}
            onChangeText={setEmailCode}
            rightAdornment={
              <Text
                onPress={() => {
                  if (codeCd === 0 && !sendCode.isPending) void onSendEmailCode()
                }}
                style={[styles.codeBtn, codeCd > 0 && { color: theme.text.muted }]}
              >
                {codeCd > 0 ? `${codeCd}s` : t('auth.sendCode')}
              </Text>
            }
          />
          <AuthButton
            label={t('common.confirm')}
            loading={changeEmail.isPending}
            onPress={() => {
              void onSubmitEmail()
            }}
          />
        </View>
      ) : null}

      <SettingsGroup label={t('settings.thirdParty')}>
        <SettingsRow
          label="GitHub"
          icon={<Link2 size={18} color={theme.text.secondary} />}
          value={user?.githubId ? t('settings.bound') : t('settings.unbound')}
          disabled={!user?.githubId}
          onPress={() => onUnlink('github')}
        />
        <SettingsRow
          label="Google"
          icon={<Link2 size={18} color={theme.text.secondary} />}
          value={user?.googleId ? t('settings.bound') : t('settings.unbound')}
          disabled={!user?.googleId}
          divider={false}
          onPress={() => onUnlink('google')}
        />
      </SettingsGroup>

      <SettingsGroup label={t('settings.dangerous')}>
        <SettingsRow
          label={t('settings.clearAll')}
          icon={<Trash2 size={18} color={border.danger} />}
          destructive
          onPress={onClearConversations}
        />
        <SettingsRow
          label={t('settings.deleteAccount')}
          icon={<Trash2 size={18} color={border.danger} />}
          destructive
          divider={false}
          onPress={onDeleteAccount}
        />
      </SettingsGroup>
    </SettingsShell>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  panel: { marginBottom: spacing.lg },
  codeBtn: { fontSize: 13, color: '#3b82f6', fontWeight: '600', paddingHorizontal: spacing.sm },
})
