import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useRouter } from 'expo-router'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Pressable, Text, View } from 'react-native'
import { z } from 'zod'

import { useResetPassword, useSendVerifyCode } from '@yuanai/core'

import { AuthButton } from '@/components/auth/AuthButton'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthTextInput } from '@/components/auth/AuthTextInput'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing, text } from '@/theme/tokens'

const schema = z
  .object({
    email: z.string().email('请输入有效的邮箱地址'),
    verifyCode: z.string().regex(/^\d{6}$/, '请输入 6 位数字验证码'),
    newPassword: z
      .string()
      .min(8, '密码至少 8 位')
      .regex(/[A-Z]/, '密码需包含大写字母')
      .regex(/[0-9]/, '密码需包含数字'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的密码不一致',
  })

type FormValues = z.infer<typeof schema>

const RESEND_INTERVAL = 60

/**
 * 忘记密码屏。scene = reset_password（后端要求邮箱必须已注册）。
 *
 * 交互：
 * - 请求验证码 → 60s 倒计时禁用
 * - 提交 → useResetPassword mutation → 成功后 Alert + router.replace 到登录页
 */
export default function ForgotPasswordScreen(): React.JSX.Element {
  const router = useRouter()
  const resetMutation = useResetPassword()
  const sendCodeMutation = useSendVerifyCode()
  const dialog = useDialog()

  const [showPwd, setShowPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const {
    control,
    handleSubmit,
    getValues,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', verifyCode: '', newPassword: '', confirmPassword: '' },
    mode: 'onBlur',
  })

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
    },
    []
  )

  const startCountdown = (): void => {
    if (timerRef.current) clearInterval(timerRef.current)
    setCountdown(RESEND_INTERVAL)
    timerRef.current = setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  const onSendCode = async (): Promise<void> => {
    const email = getValues('email').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('email', { message: '请先填写有效的邮箱地址' })
      return
    }
    clearErrors('email')
    try {
      await sendCodeMutation.mutateAsync({ email, scene: 'reset_password' })
      startCountdown()
      void dialog.alert({
        title: '验证码已发送',
        message: `我们已向 ${email} 发送 6 位验证码，5 分钟内有效。`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '验证码发送失败'
      void dialog.alert({ title: '发送失败', message: msg })
    }
  }

  const onSubmit = async (values: FormValues): Promise<void> => {
    try {
      await resetMutation.mutateAsync({
        email: values.email.trim(),
        verifyCode: values.verifyCode,
        newPassword: values.newPassword,
      })
      await dialog.alert({ title: '重置成功', message: '请使用新密码登录' })
      router.replace('/(auth)/login')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '密码重置失败'
      void dialog.alert({ title: '重置失败', message: msg })
    }
  }

  const codeButtonLabel = countdown > 0 ? `${countdown}s` : '获取验证码'
  const codeButtonDisabled = countdown > 0 || sendCodeMutation.isPending

  return (
    <AuthShell
      title="重置密码"
      subtitle="通过邮箱验证码设置新密码"
      footer={
        <View style={{ alignItems: 'center' }}>
          <Link href="/(auth)/login" replace>
            <Text style={{ fontSize: 13, color: brand.solid, fontWeight: '600' }}>← 返回登录</Text>
          </Link>
        </View>
      }
    >
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="邮箱"
            placeholder="your@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.email?.message}
            rightAdornment={<Mail size={16} color={brand.solid} />}
          />
        )}
      />

      <Controller
        control={control}
        name="verifyCode"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="邮箱验证码"
            placeholder="6 位数字"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            value={value}
            onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
            onBlur={onBlur}
            error={errors.verifyCode?.message}
            rightAdornment={
              <Pressable
                onPress={() => {
                  void onSendCode()
                }}
                disabled={codeButtonDisabled}
                hitSlop={6}
                android_ripple={{ color: 'rgba(59,130,246,0.15)' }}
                style={{
                  height: 36,
                  minWidth: 96,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: brand.solid,
                  backgroundColor: brand.light,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: codeButtonDisabled ? 0.55 : 1,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '500', color: brand.solid }}>
                  {codeButtonLabel}
                </Text>
              </Pressable>
            }
          />
        )}
      />

      <Controller
        control={control}
        name="newPassword"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="新密码"
            placeholder="至少 8 位，含大写字母和数字"
            secureTextEntry={!showPwd}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.newPassword?.message}
            rightAdornment={
              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                hitSlop={8}
                style={{ paddingLeft: spacing.sm }}
              >
                {showPwd ? (
                  <EyeOff size={18} color={brand.solid} />
                ) : (
                  <Eye size={18} color={brand.solid} />
                )}
              </Pressable>
            }
          />
        )}
      />

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="确认新密码"
            placeholder="再次输入新密码"
            secureTextEntry={!showConfirmPwd}
            autoCapitalize="none"
            autoCorrect={false}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.confirmPassword?.message}
            rightAdornment={
              <Pressable
                onPress={() => setShowConfirmPwd((v) => !v)}
                hitSlop={8}
                style={{ paddingLeft: spacing.sm }}
              >
                {showConfirmPwd ? (
                  <EyeOff size={18} color={brand.solid} />
                ) : (
                  <Eye size={18} color={brand.solid} />
                )}
              </Pressable>
            }
          />
        )}
      />

      <View style={{ marginTop: spacing.md }}>
        <AuthButton
          label="重置密码"
          onPress={handleSubmit(onSubmit)}
          loading={resetMutation.isPending}
        />
      </View>

      <View
        style={{
          marginTop: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <Lock size={11} color={text.muted} />
        <Text style={{ fontSize: 12, color: text.muted }}>
          提交后你的旧密码将立即失效，请使用新密码登录。
        </Text>
      </View>
    </AuthShell>
  )
}
