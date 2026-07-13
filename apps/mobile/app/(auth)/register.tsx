import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useRouter } from 'expo-router'
import { Eye, EyeOff, KeyRound, Mail, User } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Alert, Pressable, Text, View } from 'react-native'
import { z } from 'zod'

import { useRegister, useSendVerifyCode } from '@yuanai/core'

import { AuthButton } from '@/components/auth/AuthButton'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthTextInput } from '@/components/auth/AuthTextInput'
import { brand, spacing, text } from '@/theme/tokens'

const schema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  username: z.string().min(2, '用户名至少 2 个字符').max(20, '用户名不能超过 20 个字符'),
  password: z
    .string()
    .min(8, '密码至少 8 位')
    .regex(/[A-Z]/, '密码需包含大写字母')
    .regex(/[0-9]/, '密码需包含数字'),
  verifyCode: z.string().regex(/^\d{6}$/, '请输入 6 位数字验证码'),
})

type FormValues = z.infer<typeof schema>

const RESEND_INTERVAL = 60

/**
 * 注册屏。字段与后端 RegisterRequest 对齐（email + username + password + verifyCode）。
 *
 * 交互：
 * - 邮箱输入后点"获取验证码" → 后端发一封邮件；按钮 60s 倒计时禁用
 * - 密码强度按 zod 规则前端校验，视觉不强调分级
 * - 注册成功后端返回 access/refresh token → useRegister 自动写 auth store →
 *   router.replace 到主界面
 */
export default function RegisterScreen(): React.JSX.Element {
  const router = useRouter()
  const registerMutation = useRegister()
  const sendCodeMutation = useSendVerifyCode()

  const [showPwd, setShowPwd] = useState(false)
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
    defaultValues: { email: '', username: '', password: '', verifyCode: '' },
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
      await sendCodeMutation.mutateAsync({ email, scene: 'register' })
      startCountdown()
      Alert.alert('验证码已发送', `我们已向 ${email} 发送 6 位验证码，5 分钟内有效。`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '验证码发送失败'
      Alert.alert('发送失败', msg)
    }
  }

  const onSubmit = async (values: FormValues): Promise<void> => {
    try {
      await registerMutation.mutateAsync({
        email: values.email.trim(),
        username: values.username.trim(),
        password: values.password,
        verifyCode: values.verifyCode,
      })
      router.replace('/(main)/chat')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '注册失败，请稍后重试'
      Alert.alert('注册失败', msg)
    }
  }

  const codeButtonLabel = countdown > 0 ? `${countdown}s` : '获取验证码'
  const codeButtonDisabled = countdown > 0 || sendCodeMutation.isPending

  return (
    <AuthShell
      title="创建账号"
      subtitle="加入元AI，开始你的智能对话"
      footer={
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: text.secondary }}>
            已有账号？{' '}
            <Link href="/(auth)/login" replace>
              <Text style={{ color: brand.solid, fontWeight: '600' }}>去登录</Text>
            </Link>
          </Text>
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
            rightAdornment={
              <View style={{ paddingRight: spacing.md }}>
                <Mail size={16} color={text.muted} />
              </View>
            }
          />
        )}
      />

      <Controller
        control={control}
        name="username"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="用户名"
            placeholder="2 - 20 个字符"
            autoCapitalize="none"
            autoCorrect={false}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.username?.message}
            rightAdornment={
              <View style={{ paddingRight: spacing.md }}>
                <User size={16} color={text.muted} />
              </View>
            }
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="密码"
            placeholder="至少 8 位，含大写字母和数字"
            secureTextEntry={!showPwd}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
            rightAdornment={
              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                hitSlop={8}
                style={{ paddingRight: spacing.md, paddingLeft: spacing.sm }}
              >
                {showPwd ? (
                  <EyeOff size={18} color={text.muted} />
                ) : (
                  <Eye size={18} color={text.muted} />
                )}
              </Pressable>
            }
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
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  opacity: codeButtonDisabled ? 0.4 : 1,
                }}
              >
                <KeyRound size={14} color={brand.solid} />
                <Text
                  style={{
                    fontSize: 12,
                    color: brand.solid,
                    marginTop: 2,
                    fontWeight: '600',
                  }}
                >
                  {codeButtonLabel}
                </Text>
              </Pressable>
            }
          />
        )}
      />

      <View style={{ marginTop: spacing.md }}>
        <AuthButton
          label="注册并登录"
          onPress={handleSubmit(onSubmit)}
          loading={registerMutation.isPending}
        />
      </View>
    </AuthShell>
  )
}
