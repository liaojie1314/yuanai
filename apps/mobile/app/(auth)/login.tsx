import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Eye, EyeOff, Github, Mail } from 'lucide-react-native'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Pressable, Text, View } from 'react-native'
import { z } from 'zod'

import { API_BASE_URL, useLogin } from '@yuanai/core'

import { AuthButton } from '@/components/auth/AuthButton'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthTextInput } from '@/components/auth/AuthTextInput'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing, text } from '@/theme/tokens'

const schema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
})

type FormValues = z.infer<typeof schema>

/**
 * 登录屏。
 *
 * 后端契约：
 * - POST /auth/login { email, password } → { access_token, refresh_token, user }
 * - GET  /auth/github → 302 到 GitHub 授权；回调后写 cookie；mobile 场景由后端
 *   302 到 yuanai://oauth/callback?access_token=...&refresh_token=... 由
 *   `oauth-callback` 屏消费
 * - GET  /auth/google → 同上
 *
 * mobile 端 OAuth 走 `WebBrowser.openAuthSessionAsync`：拉起系统浏览器 → 用户完成授权
 * → 系统识别 yuanai:// scheme → 回到 App，Linking 事件由 `useLinkingHandler` 处理。
 */
export default function LoginScreen(): React.JSX.Element {
  const router = useRouter()
  const loginMutation = useLogin()
  const dialog = useDialog()
  const [showPwd, setShowPwd] = useState(false)

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  })

  const onSubmit = async (values: FormValues): Promise<void> => {
    try {
      // 移动端 access token 走 SecureStore，此处 remember=true 语义即"始终记住"
      await loginMutation.mutateAsync({ ...values, remember: true })
      // 登录成功后 auth store 已写入 accessToken；根 index.tsx 的 <Redirect> 会
      // 自动把用户从 (auth) 分组带走。这里显式 replace 一次，避免用户返回按钮
      // 又回到登录页。
      router.replace('/(main)/chat')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录失败，请检查邮箱和密码'
      void dialog.alert({ title: '登录失败', message: msg })
    }
  }

  const handleOAuth = async (provider: 'github' | 'google'): Promise<void> => {
    // 后端登录端点会自动 302 到 provider 授权页；provider 完成后再 302 回后端 callback；
    // callback 里读 mobile=1 参数 → 302 到 yuanai://oauth/callback?token=...；
    // openAuthSessionAsync 监听 scheme 命中即返回，随后 Linking 事件由
    // useLinkingHandler 分派到 (auth)/oauth-callback。
    const authUrl = `${API_BASE_URL}/auth/${provider}?mobile=1`
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, 'yuanai://oauth/callback')
      // result.type: 'cancel' | 'dismiss' | 'success'；cancel 时静默返回，不弹 Alert
      if (result.type === 'success' && result.url) {
        // 交给全局 Linking handler；这里不解析 token
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '三方登录失败'
      void dialog.alert({ title: '三方登录失败', message: msg })
    }
  }

  return (
    <AuthShell
      title="欢迎回来"
      subtitle="登录你的元AI 账号"
      footer={
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: text.secondary }}>
            还没有账号？{' '}
            <Link href="/(auth)/register" replace>
              <Text style={{ color: brand.solid, fontWeight: '600' }}>立即注册</Text>
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
            rightAdornment={<Mail size={16} color={brand.solid} />}
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <AuthTextInput
            label="密码"
            placeholder="至少 8 位"
            secureTextEntry={!showPwd}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
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

      <View style={{ alignItems: 'flex-end', marginBottom: spacing.lg }}>
        <Link href="/(auth)/forgot-password" asChild>
          <Pressable hitSlop={8}>
            <Text style={{ fontSize: 13, color: brand.solid }}>忘记密码？</Text>
          </Pressable>
        </Link>
      </View>

      <AuthButton label="登录" onPress={handleSubmit(onSubmit)} loading={loginMutation.isPending} />

      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl }}>
        <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
        <Text style={{ marginHorizontal: spacing.md, fontSize: 12, color: text.muted }}>
          或使用三方登录
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Pressable
          onPress={() => {
            void handleOAuth('github')
          }}
          style={{
            flex: 1,
            height: 46,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#E5E7EB',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
          }}
        >
          <Github size={18} color={text.primary} />
          <Text style={{ fontSize: 14, color: text.primary }}>GitHub</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void handleOAuth('google')
          }}
          style={{
            flex: 1,
            height: 46,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#E5E7EB',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
          }}
        >
          <Text style={{ fontSize: 16, color: text.primary, fontWeight: '600' }}>G</Text>
          <Text style={{ fontSize: 14, color: text.primary }}>Google</Text>
        </Pressable>
      </View>
    </AuthShell>
  )
}
