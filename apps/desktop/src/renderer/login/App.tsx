import {
  CheckCircle2,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  LockKeyhole,
  Mail,
  UserRound,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'

import { useLogin, useRegister, useResetPassword, useSendVerifyCode } from '@yuanai/core/hooks'

import googleIcon from './google.svg'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VERIFICATION_CODE_PATTERN = /^\d{6}$/
const VERIFICATION_CODE_COOLDOWN_SECONDS = 60

type AuthMode = 'login' | 'register' | 'forgot'

interface AuthFrameProps {
  title: string
  subtitle: string
  children: ReactElement
}

interface FieldProps {
  id: string
  label: string
  value: string
  placeholder: string
  autoComplete: string
  error: string
  onChange(value: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error) || !isRecord(error['response']) || !isRecord(error['response']['data'])) {
    return fallback
  }
  const data = error['response']['data']
  if (typeof data['message'] === 'string') return data['message']
  if (isRecord(data['detail']) && typeof data['detail']['message'] === 'string') {
    return data['detail']['message']
  }
  return fallback
}

function getModeFromLocation(): AuthMode {
  switch (window.location.hash) {
    case '#/register':
      return 'register'
    case '#/forgot':
      return 'forgot'
    default:
      return 'login'
  }
}

function getPasswordError(password: string): string {
  if (password.length < 8) return '密码至少需要 8 位'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码须同时包含字母和数字'
  return ''
}

function AuthFrame({ title, subtitle, children }: AuthFrameProps): ReactElement {
  return (
    <main className="desktop-auth" aria-label={title}>
      <section className="desktop-auth__content">
        <div className="desktop-auth__form">
          <header className="desktop-auth__heading">
            <div className="desktop-auth__logo" aria-hidden="true">
              元
            </div>
            <h1>{title}</h1>
            <p className="desktop-auth__subtitle">{subtitle}</p>
          </header>
          {children}
        </div>
      </section>
    </main>
  )
}

function FieldError({ id, message }: { id: string; message: string }): ReactElement {
  return (
    <p id={id} className="desktop-auth__field-error" aria-live="polite">
      {message}
    </p>
  )
}

function EmailField({
  id,
  label,
  value,
  placeholder,
  autoComplete,
  error,
  onChange,
}: FieldProps): ReactElement {
  const errorId = `${id}-error`
  return (
    <div className="desktop-auth__field">
      <label htmlFor={id}>{label}</label>
      <div className="desktop-auth__input-wrap">
        <Mail aria-hidden="true" size={17} />
        <input
          id={id}
          type="email"
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  placeholder,
  autoComplete,
  error,
  onChange,
}: FieldProps): ReactElement {
  const errorId = `${id}-error`
  return (
    <div className="desktop-auth__field">
      <label htmlFor={id}>{label}</label>
      <div className="desktop-auth__input-wrap">
        <UserRound aria-hidden="true" size={17} />
        <input
          id={id}
          type="text"
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={value}
          placeholder={placeholder}
          maxLength={20}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function PasswordField({
  id,
  label,
  value,
  placeholder,
  autoComplete,
  error,
  onChange,
}: FieldProps): ReactElement {
  const [visible, setVisible] = useState(false)
  const errorId = `${id}-error`
  return (
    <div className="desktop-auth__field">
      <label htmlFor={id}>{label}</label>
      <div className="desktop-auth__input-wrap">
        <LockKeyhole aria-hidden="true" size={17} />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="desktop-auth__icon-button"
          type="button"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function VerificationCodeField({
  value,
  error,
  onChange,
  requestCodeLabel,
  requestCodeDisabled,
  onRequestCode,
}: {
  value: string
  error: string
  onChange(value: string): void
  requestCodeLabel: string
  requestCodeDisabled: boolean
  onRequestCode(): void
}): ReactElement {
  const errorId = 'verify-code-error'
  return (
    <div className="desktop-auth__field">
      <label htmlFor="verify-code">邮箱验证码</label>
      <div className="desktop-auth__input-wrap desktop-auth__input-wrap--verification-code">
        <KeyRound aria-hidden="true" size={17} />
        <input
          id="verify-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={value}
          placeholder="输入 6 位验证码"
          maxLength={6}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        />
        <button
          className="desktop-auth__code-button"
          type="button"
          disabled={requestCodeDisabled}
          onClick={onRequestCode}
        >
          {requestCodeLabel}
        </button>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function LoginForm({ onNavigate }: { onNavigate(mode: AuthMode): void }): ReactElement {
  const loginMutation = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [oauthProvider, setOauthProvider] = useState<'github' | 'google' | null>(null)

  async function handleOAuth(provider: 'github' | 'google'): Promise<void> {
    setRequestError('')
    setOauthProvider(provider)
    try {
      await window.yuanai.oauth.start(provider)
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, '无法打开第三方登录，请稍后重试'))
    } finally {
      setOauthProvider(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRequestError('')
    const normalizedEmail = email.trim().toLowerCase()
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : '请输入正确的邮箱地址'
    const nextPasswordError = password ? '' : '请输入密码'
    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    if (nextEmailError || nextPasswordError) return

    try {
      await loginMutation.mutateAsync({ email: normalizedEmail, password, remember })
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, '登录失败，请检查邮箱和密码后重试'))
    }
  }

  return (
    <AuthFrame title="登录元AI" subtitle="使用你的账号继续">
      <form
        className="desktop-auth__form-fields"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {requestError ? (
          <p className="desktop-auth__alert" role="alert">
            {requestError}
          </p>
        ) : null}
        <EmailField
          id="login-email"
          label="邮箱"
          value={email}
          placeholder="name@example.com"
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />
        <PasswordField
          id="login-password"
          label="密码"
          value={password}
          placeholder="输入密码"
          autoComplete="current-password"
          error={passwordError}
          onChange={setPassword}
        />
        <div className="desktop-auth__options">
          <label className="desktop-auth__checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>保持登录</span>
          </label>
          <button type="button" className="desktop-auth__link" onClick={() => onNavigate('forgot')}>
            忘记密码？
          </button>
        </div>
        <button className="desktop-auth__submit" type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? '登录中...' : '登录'}
        </button>
        <div className="desktop-auth__divider" role="separator">
          <span>或使用以下方式登录</span>
        </div>
        <div className="desktop-auth__social-row">
          <button
            className="desktop-auth__social-button"
            type="button"
            disabled={oauthProvider !== null}
            onClick={() => void handleOAuth('github')}
          >
            <Github aria-hidden="true" size={18} />
            {oauthProvider === 'github' ? '正在打开 GitHub...' : 'GitHub'}
          </button>
          <button
            className="desktop-auth__social-button"
            type="button"
            disabled={oauthProvider !== null}
            onClick={() => void handleOAuth('google')}
          >
            <img src={googleIcon} alt="" />
            {oauthProvider === 'google' ? '正在打开 Google...' : 'Google'}
          </button>
        </div>
        <p className="desktop-auth__switch">
          还没有账号？
          <button
            type="button"
            className="desktop-auth__link"
            onClick={() => onNavigate('register')}
          >
            创建账号
          </button>
        </p>
      </form>
    </AuthFrame>
  )
}

function RegisterForm({ onNavigate }: { onNavigate(mode: AuthMode): void }): ReactElement {
  const registerMutation = useRegister()
  const sendCodeMutation = useSendVerifyCode()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [usernameError, setUsernameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [termsError, setTermsError] = useState('')
  const [requestError, setRequestError] = useState('')

  useEffect(() => {
    if (cooldown === 0) return undefined
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function sendVerificationCode(): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase()
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : '请输入正确的邮箱地址'
    setEmailError(nextEmailError)
    setRequestError('')
    if (nextEmailError) return
    try {
      await sendCodeMutation.mutateAsync({ email: normalizedEmail, scene: 'register' })
      setCooldown(VERIFICATION_CODE_COOLDOWN_SECONDS)
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, '验证码发送失败，请稍后重试'))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRequestError('')
    const normalizedEmail = email.trim().toLowerCase()
    const nextUsernameError = username.trim().length >= 2 ? '' : '用户名至少需要 2 个字符'
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : '请输入正确的邮箱地址'
    const nextCodeError = VERIFICATION_CODE_PATTERN.test(verifyCode) ? '' : '请输入 6 位验证码'
    const nextPasswordError = getPasswordError(password)
    const nextConfirmationError = confirmation === password ? '' : '两次输入的密码不一致'
    const nextTermsError = acceptedTerms ? '' : '请先同意服务条款和隐私政策'
    setUsernameError(nextUsernameError)
    setEmailError(nextEmailError)
    setCodeError(nextCodeError)
    setPasswordError(nextPasswordError)
    setConfirmationError(nextConfirmationError)
    setTermsError(nextTermsError)
    if (
      nextUsernameError ||
      nextEmailError ||
      nextCodeError ||
      nextPasswordError ||
      nextConfirmationError ||
      nextTermsError
    ) {
      return
    }

    try {
      await registerMutation.mutateAsync({
        username: username.trim(),
        email: normalizedEmail,
        verifyCode,
        password,
      })
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, '注册失败，请稍后重试'))
    }
  }

  return (
    <AuthFrame title="创建账号" subtitle="开始使用元AI">
      <form
        className="desktop-auth__form-fields"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {requestError ? (
          <p className="desktop-auth__alert" role="alert">
            {requestError}
          </p>
        ) : null}
        <TextField
          id="register-username"
          label="用户名"
          value={username}
          placeholder="输入用户名"
          autoComplete="username"
          error={usernameError}
          onChange={setUsername}
        />
        <EmailField
          id="register-email"
          label="邮箱"
          value={email}
          placeholder="name@example.com"
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />
        <VerificationCodeField
          value={verifyCode}
          error={codeError}
          requestCodeLabel={
            sendCodeMutation.isPending
              ? '发送中...'
              : cooldown > 0
                ? `${cooldown} 秒后重发`
                : '发送验证码'
          }
          requestCodeDisabled={cooldown > 0 || sendCodeMutation.isPending}
          onChange={setVerifyCode}
          onRequestCode={() => void sendVerificationCode()}
        />
        <PasswordField
          id="register-password"
          label="密码"
          value={password}
          placeholder="至少 8 位，含字母和数字"
          autoComplete="new-password"
          error={passwordError}
          onChange={setPassword}
        />
        <PasswordField
          id="register-confirmation"
          label="确认密码"
          value={confirmation}
          placeholder="再次输入密码"
          autoComplete="new-password"
          error={confirmationError}
          onChange={setConfirmation}
        />
        <label className="desktop-auth__checkbox desktop-auth__checkbox--terms">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
          />
          <span>我已阅读并同意服务条款与隐私政策</span>
        </label>
        <FieldError id="terms-error" message={termsError} />
        <button
          className="desktop-auth__submit"
          type="submit"
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending ? '创建中...' : '创建账号'}
        </button>
        <p className="desktop-auth__switch">
          已有账号？
          <button type="button" className="desktop-auth__link" onClick={() => onNavigate('login')}>
            去登录
          </button>
        </p>
      </form>
    </AuthFrame>
  )
}

function ForgotPasswordForm({ onNavigate }: { onNavigate(mode: AuthMode): void }): ReactElement {
  const resetPasswordMutation = useResetPassword()
  const sendCodeMutation = useSendVerifyCode()
  const [email, setEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [emailError, setEmailError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    if (cooldown === 0) return undefined
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function sendVerificationCode(): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase()
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : '请输入正确的邮箱地址'
    setEmailError(nextEmailError)
    setRequestError('')
    if (nextEmailError) return
    try {
      await sendCodeMutation.mutateAsync({ email: normalizedEmail, scene: 'reset_password' })
      setCooldown(VERIFICATION_CODE_COOLDOWN_SECONDS)
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, '验证码发送失败，请稍后重试'))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRequestError('')
    const normalizedEmail = email.trim().toLowerCase()
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : '请输入正确的邮箱地址'
    const nextCodeError = VERIFICATION_CODE_PATTERN.test(verifyCode) ? '' : '请输入 6 位验证码'
    const nextPasswordError = getPasswordError(password)
    const nextConfirmationError = confirmation === password ? '' : '两次输入的密码不一致'
    setEmailError(nextEmailError)
    setCodeError(nextCodeError)
    setPasswordError(nextPasswordError)
    setConfirmationError(nextConfirmationError)
    if (nextEmailError || nextCodeError || nextPasswordError || nextConfirmationError) return

    try {
      await resetPasswordMutation.mutateAsync({
        email: normalizedEmail,
        verifyCode,
        newPassword: password,
      })
      setCompleted(true)
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, '密码重置失败，请稍后重试'))
    }
  }

  if (completed) {
    return (
      <AuthFrame title="密码已重置" subtitle="现在可以使用新密码登录">
        <div className="desktop-auth__success">
          <CheckCircle2 aria-hidden="true" size={42} />
          <button
            className="desktop-auth__submit"
            type="button"
            onClick={() => onNavigate('login')}
          >
            返回登录
          </button>
        </div>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title="重置密码" subtitle="验证邮箱后设置新密码">
      <form
        className="desktop-auth__form-fields"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {requestError ? (
          <p className="desktop-auth__alert" role="alert">
            {requestError}
          </p>
        ) : null}
        <EmailField
          id="forgot-email"
          label="注册邮箱"
          value={email}
          placeholder="name@example.com"
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />
        <VerificationCodeField
          value={verifyCode}
          error={codeError}
          requestCodeLabel={
            sendCodeMutation.isPending
              ? '发送中...'
              : cooldown > 0
                ? `${cooldown} 秒后重发`
                : '发送验证码'
          }
          requestCodeDisabled={cooldown > 0 || sendCodeMutation.isPending}
          onChange={setVerifyCode}
          onRequestCode={() => void sendVerificationCode()}
        />
        <PasswordField
          id="forgot-password"
          label="新密码"
          value={password}
          placeholder="至少 8 位，含字母和数字"
          autoComplete="new-password"
          error={passwordError}
          onChange={setPassword}
        />
        <PasswordField
          id="forgot-confirmation"
          label="确认新密码"
          value={confirmation}
          placeholder="再次输入新密码"
          autoComplete="new-password"
          error={confirmationError}
          onChange={setConfirmation}
        />
        <button
          className="desktop-auth__submit"
          type="submit"
          disabled={resetPasswordMutation.isPending}
        >
          {resetPasswordMutation.isPending ? '重置中...' : '重置密码'}
        </button>
        <p className="desktop-auth__switch">
          想起密码了？
          <button type="button" className="desktop-auth__link" onClick={() => onNavigate('login')}>
            返回登录
          </button>
        </p>
      </form>
    </AuthFrame>
  )
}

/** 提供登录、注册和邮箱验证码重置密码的桌面认证界面。 */
export function App(): ReactElement {
  const [mode, setMode] = useState<AuthMode>(getModeFromLocation)

  useEffect(() => {
    const syncMode = (): void => setMode(getModeFromLocation())
    window.addEventListener('hashchange', syncMode)
    return () => window.removeEventListener('hashchange', syncMode)
  }, [])

  function navigate(modeToNavigate: AuthMode): void {
    const openWindow =
      modeToNavigate === 'register'
        ? window.yuanai.window.openRegister
        : modeToNavigate === 'forgot'
          ? window.yuanai.window.openForgot
          : window.yuanai.window.openLogin
    void openWindow().catch((error: unknown) => {
      console.error('Failed to open authentication window', error)
    })
  }

  if (mode === 'register') return <RegisterForm onNavigate={navigate} />
  if (mode === 'forgot') return <ForgotPasswordForm onNavigate={navigate} />
  return <LoginForm onNavigate={navigate} />
}
