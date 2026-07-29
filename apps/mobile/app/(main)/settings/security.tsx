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
  const t = useTheme()
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
      message: err instanceof Error ? err.message : '请稍后重试',
    })
  }

  const onSubmitPassword = async (): Promise<void> => {
    if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
      void dialog.alert({ title: '新密码不符合要求', message: '至少 8 位，且包含大写字母和数字' })
      return
    }
    if (newPw !== confPw) {
      void dialog.alert({ title: '两次输入不一致', message: '请重新确认新密码' })
      return
    }
    try {
      await changePassword.mutateAsync({ oldPassword: oldPw, newPassword: newPw })
      setPanel(null)
      setOldPw('')
      setNewPw('')
      setConfPw('')
      void dialog.alert({ title: '密码已修改', message: '下次登录请使用新密码' })
    } catch (err) {
      alertErr('修改失败', err)
    }
  }

  const onSendEmailCode = async (): Promise<void> => {
    const email = newEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      void dialog.alert({ title: '邮箱格式不正确', message: '请先填写有效的新邮箱' })
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
      alertErr('验证码发送失败', err)
    }
  }

  const onSubmitEmail = async (): Promise<void> => {
    try {
      await changeEmail.mutateAsync({ newEmail: newEmail.trim(), verifyCode: emailCode })
      setPanel(null)
      setNewEmail('')
      setEmailCode('')
      void dialog.alert({ title: '邮箱已更换', message: '之后请用新邮箱登录' })
    } catch (err) {
      alertErr('更换失败', err)
    }
  }

  const onUnlink = (provider: 'github' | 'google'): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: `解绑 ${provider === 'github' ? 'GitHub' : 'Google'}`,
        message: '解绑后将无法使用该账号快捷登录，确定解绑？',
        confirmText: '解绑',
        destructive: true,
      })
      if (!ok) return
      try {
        if (provider === 'github') await unlinkGithub.mutateAsync()
        else await unlinkGoogle.mutateAsync()
      } catch (err) {
        alertErr('解绑失败', err)
      }
    })()
  }

  const onClearConversations = (): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: '清空所有对话',
        message: '所有会话与消息将被删除，不可恢复。确定清空？',
        confirmText: '清空',
        destructive: true,
      })
      if (!ok) return
      try {
        const res = await clearConvs.mutateAsync()
        void dialog.alert({ title: '已清空', message: `共删除 ${res.deleted} 个会话` })
      } catch (err) {
        alertErr('清空失败', err)
      }
    })()
  }

  const onDeleteAccount = (): void => {
    void (async () => {
      const ok = await dialog.confirm({
        title: '注销账号',
        message: '账号与全部数据将被永久删除，不可恢复。确定注销？',
        confirmText: '注销',
        destructive: true,
      })
      if (!ok) return
      const typed = await dialog.prompt({
        title: '再次确认',
        message: `输入你的邮箱 ${user?.email ?? ''} 以确认注销`,
        placeholder: user?.email ?? '',
      })
      if (typed?.trim() !== user?.email) {
        if (typed !== null) {
          void dialog.alert({ title: '邮箱不匹配', message: '注销已取消' })
        }
        return
      }
      try {
        await deleteMe.mutateAsync()
        router.replace('/(auth)/login')
      } catch (err) {
        alertErr('注销失败', err)
      }
    })()
  }

  return (
    <SettingsShell title="安全">
      <SettingsGroup label="登录凭据">
        <SettingsRow
          label="修改密码"
          icon={<KeyRound size={18} color={t.text.secondary} />}
          sublabel={
            user?.passwordChangedAt ? `上次修改 ${formatDate(user.passwordChangedAt)}` : undefined
          }
          onPress={() => setPanel(panel === 'password' ? null : 'password')}
        />
        <SettingsRow
          label="更换邮箱"
          icon={<Mail size={18} color={t.text.secondary} />}
          value={user?.email ?? ''}
          divider={false}
          onPress={() => setPanel(panel === 'email' ? null : 'email')}
        />
      </SettingsGroup>

      {panel === 'password' ? (
        <View style={styles.panel}>
          <AuthTextInput
            label="当前密码"
            placeholder="输入当前密码"
            secureTextEntry
            value={oldPw}
            onChangeText={setOldPw}
          />
          <AuthTextInput
            label="新密码"
            placeholder="至少 8 位，含大写字母和数字"
            secureTextEntry
            value={newPw}
            onChangeText={setNewPw}
          />
          <AuthTextInput
            label="确认新密码"
            placeholder="再次输入新密码"
            secureTextEntry
            value={confPw}
            onChangeText={setConfPw}
          />
          <AuthButton
            label="确认修改"
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
            label="新邮箱"
            placeholder="new@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={newEmail}
            onChangeText={setNewEmail}
          />
          <AuthTextInput
            label="邮箱验证码"
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
                style={[styles.codeBtn, codeCd > 0 && { color: t.text.muted }]}
              >
                {codeCd > 0 ? `${codeCd}s` : '获取验证码'}
              </Text>
            }
          />
          <AuthButton
            label="确认更换"
            loading={changeEmail.isPending}
            onPress={() => {
              void onSubmitEmail()
            }}
          />
        </View>
      ) : null}

      <SettingsGroup label="第三方登录">
        <SettingsRow
          label="GitHub"
          icon={<Link2 size={18} color={t.text.secondary} />}
          value={user?.githubId ? '已绑定' : '未绑定'}
          disabled={!user?.githubId}
          onPress={() => onUnlink('github')}
        />
        <SettingsRow
          label="Google"
          icon={<Link2 size={18} color={t.text.secondary} />}
          value={user?.googleId ? '已绑定' : '未绑定'}
          disabled={!user?.googleId}
          divider={false}
          onPress={() => onUnlink('google')}
        />
      </SettingsGroup>

      <SettingsGroup label="危险区">
        <SettingsRow
          label="清空所有对话"
          icon={<Trash2 size={18} color={border.danger} />}
          destructive
          onPress={onClearConversations}
        />
        <SettingsRow
          label="注销账号"
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
