import {
  CheckCircle2,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  LockKeyhole,
  Mail,
  QrCode,
  UserRound,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { useLogin, useRegister, useResetPassword, useSendVerifyCode } from '@yuanai/core/hooks'

import googleIcon from './google.svg'
import { QrLoginPanel } from './QrLoginPanel'
import '../shared/i18n'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VERIFICATION_CODE_PATTERN = /^\d{6}$/
const VERIFICATION_CODE_COOLDOWN_SECONDS = 60
const REQUEST_ERROR_TIMEOUT_MS = 4000

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

function getPasswordError(password: string, translate: (key: string) => string): string {
  if (password.length < 8) return translate('auth.errors.passwordTooShort')
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return translate('desktop.auth.passwordLettersAndNumbers')
  }
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

/** 展示不会改变认证表单布局的短时请求错误提示。 */
function RequestErrorAlert({
  message,
  onDismiss,
}: {
  message: string
  onDismiss(message: string): void
}): ReactElement | null {
  const { t } = useTranslation()

  useEffect(() => {
    if (!message) return undefined
    const timeout = window.setTimeout(() => onDismiss(''), REQUEST_ERROR_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="desktop-auth__toast" role="alert">
      <span>{message}</span>
      <button type="button" aria-label={t('common.close')} onClick={() => onDismiss('')}>
        &times;
      </button>
    </div>
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
  const { t } = useTranslation()
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
          aria-label={visible ? t('desktop.auth.hidePassword') : t('desktop.auth.showPassword')}
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
  const { t } = useTranslation()
  const errorId = 'verify-code-error'
  return (
    <div className="desktop-auth__field">
      <label htmlFor="verify-code">{t('auth.emailCode')}</label>
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
          placeholder={t('auth.placeholders.code')}
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

function LoginForm({
  onNavigate,
  onShowQrLogin,
}: {
  onNavigate(mode: AuthMode): void
  onShowQrLogin(): void
}): ReactElement {
  const { t } = useTranslation()
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
      setRequestError(getApiErrorMessage(error, t('desktop.auth.oauthUnavailable')))
    } finally {
      setOauthProvider(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRequestError('')
    const normalizedEmail = email.trim().toLowerCase()
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : t('auth.errors.invalidEmail')
    const nextPasswordError = password ? '' : t('auth.errors.passwordRequired')
    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    if (nextEmailError || nextPasswordError) return

    try {
      await loginMutation.mutateAsync({ email: normalizedEmail, password, remember })
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, t('desktop.auth.invalidCredentials')))
    }
  }

  return (
    <AuthFrame title={t('desktop.auth.loginTitle')} subtitle={t('desktop.auth.loginSubtitle')}>
      <form
        className="desktop-auth__form-fields"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <RequestErrorAlert message={requestError} onDismiss={setRequestError} />
        <EmailField
          id="login-email"
          label={t('auth.email')}
          value={email}
          placeholder={t('auth.placeholders.email')}
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />
        <PasswordField
          id="login-password"
          label={t('auth.password')}
          value={password}
          placeholder={t('auth.placeholders.password')}
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
            <span>{t('desktop.auth.keepSignedIn')}</span>
          </label>
          <button type="button" className="desktop-auth__link" onClick={() => onNavigate('forgot')}>
            {t('auth.forgotPassword')}
          </button>
        </div>
        <button className="desktop-auth__submit" type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? t('auth.loggingIn') : t('auth.login')}
        </button>
        <button className="desktop-auth__qr-refresh" type="button" onClick={onShowQrLogin}>
          <QrCode aria-hidden="true" size={16} />
          {t('auth.qrLogin')}
        </button>
        <div className="desktop-auth__divider" role="separator">
          <span>{t('auth.orLoginWith')}</span>
        </div>
        <div className="desktop-auth__social-row">
          <button
            className="desktop-auth__social-button"
            type="button"
            disabled={oauthProvider !== null}
            onClick={() => void handleOAuth('github')}
          >
            <Github aria-hidden="true" size={18} />
            {oauthProvider === 'github'
              ? t('desktop.auth.openingProvider', { provider: 'GitHub' })
              : 'GitHub'}
          </button>
          <button
            className="desktop-auth__social-button"
            type="button"
            disabled={oauthProvider !== null}
            onClick={() => void handleOAuth('google')}
          >
            <img src={googleIcon} alt="" />
            {oauthProvider === 'google'
              ? t('desktop.auth.openingProvider', { provider: 'Google' })
              : 'Google'}
          </button>
        </div>
        <p className="desktop-auth__switch">
          {t('auth.noAccount')}
          <button
            type="button"
            className="desktop-auth__link"
            onClick={() => onNavigate('register')}
          >
            {t('desktop.auth.createAccount')}
          </button>
        </p>
      </form>
    </AuthFrame>
  )
}

function RegisterForm({ onNavigate }: { onNavigate(mode: AuthMode): void }): ReactElement {
  const { t } = useTranslation()
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
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : t('auth.errors.invalidEmail')
    setEmailError(nextEmailError)
    setRequestError('')
    if (nextEmailError) return
    try {
      await sendCodeMutation.mutateAsync({ email: normalizedEmail, scene: 'register' })
      setCooldown(VERIFICATION_CODE_COOLDOWN_SECONDS)
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, t('desktop.auth.codeFailed')))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRequestError('')
    const normalizedEmail = email.trim().toLowerCase()
    const nextUsernameError = username.trim().length >= 2 ? '' : t('auth.errors.usernameRequired')
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : t('auth.errors.invalidEmail')
    const nextCodeError = VERIFICATION_CODE_PATTERN.test(verifyCode)
      ? ''
      : t('auth.errors.codeRequired')
    const nextPasswordError = getPasswordError(password, t)
    const nextConfirmationError = confirmation === password ? '' : t('auth.errors.passwordMismatch')
    const nextTermsError = acceptedTerms ? '' : t('desktop.auth.termsRequired')
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
      setRequestError(getApiErrorMessage(error, t('desktop.auth.registerFailed')))
    }
  }

  return (
    <AuthFrame
      title={t('desktop.auth.registerTitle')}
      subtitle={t('desktop.auth.registerSubtitle')}
    >
      <form
        className="desktop-auth__form-fields"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <RequestErrorAlert message={requestError} onDismiss={setRequestError} />
        <TextField
          id="register-username"
          label={t('auth.username')}
          value={username}
          placeholder={t('auth.placeholders.username')}
          autoComplete="username"
          error={usernameError}
          onChange={setUsername}
        />
        <EmailField
          id="register-email"
          label={t('auth.email')}
          value={email}
          placeholder={t('auth.placeholders.email')}
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />
        <VerificationCodeField
          value={verifyCode}
          error={codeError}
          requestCodeLabel={
            sendCodeMutation.isPending
              ? t('common.loading')
              : cooldown > 0
                ? t('auth.resendIn', { seconds: cooldown })
                : t('auth.sendCode')
          }
          requestCodeDisabled={cooldown > 0 || sendCodeMutation.isPending}
          onChange={setVerifyCode}
          onRequestCode={() => void sendVerificationCode()}
        />
        <PasswordField
          id="register-password"
          label={t('auth.password')}
          value={password}
          placeholder={t('auth.placeholders.password')}
          autoComplete="new-password"
          error={passwordError}
          onChange={setPassword}
        />
        <PasswordField
          id="register-confirmation"
          label={t('auth.confirmPassword')}
          value={confirmation}
          placeholder={t('auth.placeholders.confirmPassword')}
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
          <span>{t('desktop.auth.termsFull')}</span>
        </label>
        <FieldError id="terms-error" message={termsError} />
        <button
          className="desktop-auth__submit"
          type="submit"
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending ? t('auth.registering') : t('desktop.auth.createAccount')}
        </button>
        <p className="desktop-auth__switch">
          {t('auth.hasAccount')}
          <button type="button" className="desktop-auth__link" onClick={() => onNavigate('login')}>
            {t('desktop.auth.signIn')}
          </button>
        </p>
      </form>
    </AuthFrame>
  )
}

function ForgotPasswordForm({ onNavigate }: { onNavigate(mode: AuthMode): void }): ReactElement {
  const { t } = useTranslation()
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
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : t('auth.errors.invalidEmail')
    setEmailError(nextEmailError)
    setRequestError('')
    if (nextEmailError) return
    try {
      await sendCodeMutation.mutateAsync({ email: normalizedEmail, scene: 'reset_password' })
      setCooldown(VERIFICATION_CODE_COOLDOWN_SECONDS)
    } catch (error: unknown) {
      setRequestError(getApiErrorMessage(error, t('desktop.auth.codeFailed')))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRequestError('')
    const normalizedEmail = email.trim().toLowerCase()
    const nextEmailError = EMAIL_PATTERN.test(normalizedEmail) ? '' : t('auth.errors.invalidEmail')
    const nextCodeError = VERIFICATION_CODE_PATTERN.test(verifyCode)
      ? ''
      : t('auth.errors.codeRequired')
    const nextPasswordError = getPasswordError(password, t)
    const nextConfirmationError = confirmation === password ? '' : t('auth.errors.passwordMismatch')
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
      setRequestError(getApiErrorMessage(error, t('desktop.auth.resetFailed')))
    }
  }

  if (completed) {
    return (
      <AuthFrame
        title={t('desktop.auth.resetDoneTitle')}
        subtitle={t('desktop.auth.resetDoneSubtitle')}
      >
        <div className="desktop-auth__success">
          <CheckCircle2 aria-hidden="true" size={42} />
          <button
            className="desktop-auth__submit"
            type="button"
            onClick={() => onNavigate('login')}
          >
            {t('desktop.oauth.backToLogin')}
          </button>
        </div>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={t('desktop.auth.resetTitle')} subtitle={t('desktop.auth.resetSubtitle')}>
      <form
        className="desktop-auth__form-fields"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <RequestErrorAlert message={requestError} onDismiss={setRequestError} />
        <EmailField
          id="forgot-email"
          label={t('desktop.auth.emailForRegistration')}
          value={email}
          placeholder={t('auth.placeholders.email')}
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />
        <VerificationCodeField
          value={verifyCode}
          error={codeError}
          requestCodeLabel={
            sendCodeMutation.isPending
              ? t('common.loading')
              : cooldown > 0
                ? t('auth.resendIn', { seconds: cooldown })
                : t('auth.sendCode')
          }
          requestCodeDisabled={cooldown > 0 || sendCodeMutation.isPending}
          onChange={setVerifyCode}
          onRequestCode={() => void sendVerificationCode()}
        />
        <PasswordField
          id="forgot-password"
          label={t('desktop.auth.newPassword')}
          value={password}
          placeholder={t('auth.placeholders.password')}
          autoComplete="new-password"
          error={passwordError}
          onChange={setPassword}
        />
        <PasswordField
          id="forgot-confirmation"
          label={t('auth.confirmPassword')}
          value={confirmation}
          placeholder={t('auth.placeholders.confirmPassword')}
          autoComplete="new-password"
          error={confirmationError}
          onChange={setConfirmation}
        />
        <button
          className="desktop-auth__submit"
          type="submit"
          disabled={resetPasswordMutation.isPending}
        >
          {resetPasswordMutation.isPending
            ? t('desktop.auth.resetting')
            : t('desktop.auth.resetPassword')}
        </button>
        <p className="desktop-auth__switch">
          {t('desktop.auth.rememberedPassword')}
          <button type="button" className="desktop-auth__link" onClick={() => onNavigate('login')}>
            {t('desktop.oauth.backToLogin')}
          </button>
        </p>
      </form>
    </AuthFrame>
  )
}

/** 提供登录、注册和邮箱验证码重置密码的桌面认证界面。 */
export function App(): ReactElement {
  const [mode, setMode] = useState<AuthMode>(getModeFromLocation)
  const [showQrLogin, setShowQrLogin] = useState(false)

  useEffect(() => {
    const syncMode = (): void => {
      setShowQrLogin(false)
      setMode(getModeFromLocation())
    }
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
  if (showQrLogin) return <QrLoginPanel onBack={() => setShowQrLogin(false)} />
  return <LoginForm onNavigate={navigate} onShowQrLogin={() => setShowQrLogin(true)} />
}
