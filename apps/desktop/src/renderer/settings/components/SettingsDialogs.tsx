import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import '../../shared/i18n'

/** 设置中需要二次确认的操作。 */
export type SettingsDialogMode =
  | 'change-email'
  | 'change-password'
  | 'clear-conversations'
  | 'delete-account'
  | 'unlink-github'
  | 'unlink-google'

type DialogMode = SettingsDialogMode | 'remove-execution-node'

/** 设置确认对话框属性。 */
export interface SettingsDialogsProps {
  /** 当前打开的对话框。 */
  dialog: SettingsDialogMode | null
  /** 关闭对话框。 */
  onClose(): void
  /** 发送邮箱验证码。 */
  onSendVerifyCode(email: string): Promise<void>
  /** 更换邮箱。 */
  onChangeEmail(values: { newEmail: string; verifyCode: string }): Promise<void>
  /** 修改密码。 */
  onChangePassword(values: { oldPassword: string; newPassword: string }): Promise<void>
  /** 清空会话。 */
  onClearConversations(): Promise<void>
  /** 注销账号。 */
  onDeleteAccount(): Promise<void>
  /** 解除 GitHub 关联。 */
  onUnlinkGithub(): Promise<void>
  /** 解除 Google 关联。 */
  onUnlinkGoogle(): Promise<void>
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function isDestructive(dialog: DialogMode): boolean {
  return (
    dialog === 'clear-conversations' ||
    dialog === 'delete-account' ||
    dialog === 'remove-execution-node' ||
    dialog.startsWith('unlink')
  )
}

/** 在关闭后将焦点返回到触发控件的通用对话框外壳。 */
export function DialogFrame({
  children,
  dialog,
  onClose,
  title,
}: {
  children: ReactNode
  dialog: DialogMode
  onClose(): void
  title: string
}): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFirst = (): void => {
      dialogRef.current?.querySelector<HTMLElement>('button, input, textarea, select')?.focus()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
        ) ?? []
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    queueMicrotask(focusFirst)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="settings-dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role={isDestructive(dialog) ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="settings-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** 渲染账号安全相关的确认和凭据修改对话框。 */
export function SettingsDialogs(props: SettingsDialogsProps): ReactElement | null {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)
  const dialog = props.dialog

  useEffect(() => {
    setEmail('')
    setVerifyCode('')
    setOldPassword('')
    setNewPassword('')
    setConfirmation('')
    setError('')
    setIsPending(false)
  }, [dialog])

  if (!dialog) return null
  const close = (): void => {
    if (!isPending) props.onClose()
  }
  const run = async (operation: () => Promise<void>, success?: string): Promise<void> => {
    setIsPending(true)
    setError('')
    try {
      await operation()
      props.onClose()
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, success ?? t('desktop.security.actionFailed')))
    } finally {
      setIsPending(false)
    }
  }
  if (dialog === 'change-email') {
    const submit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(verifyCode)) {
        setError(t('desktop.security.invalidEmailCode'))
        return
      }
      void run(() => props.onChangeEmail({ newEmail: email.trim(), verifyCode }))
    }
    return (
      <DialogFrame dialog={dialog} onClose={close} title={t('settings.security.changeEmail')}>
        <form onSubmit={submit}>
          <p>{t('desktop.security.emailUpdating')}</p>
          <label className="settings-field">
            <span>{t('desktop.security.newEmail')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="settings-field">
            <span>{t('settings.dialogs.changeEmail.code')}</span>
            <div className="settings-inline-field">
              <input
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(event) => setVerifyCode(event.target.value)}
              />
              <button
                type="button"
                className="settings-button settings-button--secondary"
                disabled={isPending || !/^\S+@\S+\.\S+$/.test(email)}
                onClick={() =>
                  void run(
                    () => props.onSendVerifyCode(email.trim()),
                    t('desktop.security.codeSendFailed')
                  )
                }
              >
                {t('auth.sendCode')}
              </button>
            </div>
          </label>
          {error ? (
            <p className="settings-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div className="settings-dialog__actions">
            <button
              type="button"
              className="settings-button settings-button--secondary"
              onClick={close}
            >
              {t('common.cancel')}
            </button>
            <button className="settings-button settings-button--primary" disabled={isPending}>
              {t('desktop.security.changeConfirm')}
            </button>
          </div>
        </form>
      </DialogFrame>
    )
  }
  if (dialog === 'change-password') {
    const submit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      if (newPassword.length < 8) {
        setError(t('desktop.security.newPasswordTooShort'))
        return
      }
      void run(() => props.onChangePassword({ oldPassword, newPassword }))
    }
    return (
      <DialogFrame dialog={dialog} onClose={close} title={t('settings.security.changePassword')}>
        <form onSubmit={submit}>
          <label className="settings-field">
            <span>{t('desktop.security.currentPassword')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>{t('desktop.auth.newPassword')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          {error ? (
            <p className="settings-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div className="settings-dialog__actions">
            <button
              type="button"
              className="settings-button settings-button--secondary"
              onClick={close}
            >
              {t('common.cancel')}
            </button>
            <button className="settings-button settings-button--primary" disabled={isPending}>
              {t('desktop.security.passwordSave')}
            </button>
          </div>
        </form>
      </DialogFrame>
    )
  }
  const action =
    dialog === 'clear-conversations'
      ? props.onClearConversations
      : dialog === 'delete-account'
        ? props.onDeleteAccount
        : dialog === 'unlink-github'
          ? props.onUnlinkGithub
          : props.onUnlinkGoogle
  const title =
    dialog === 'clear-conversations'
      ? t('desktop.security.clearAll')
      : dialog === 'delete-account'
        ? t('settings.security.deleteAccount')
        : dialog === 'unlink-github'
          ? `${t('desktop.security.unlink')} GitHub`
          : `${t('desktop.security.unlink')} Google`
  const needsConfirmation = dialog === 'delete-account'
  const confirm = (): void => {
    if (needsConfirmation && confirmation !== t('desktop.security.deleteAccountText')) {
      setError(t('desktop.security.deleteAccountPrompt'))
      return
    }
    void run(action)
  }
  return (
    <DialogFrame dialog={dialog} onClose={close} title={title}>
      <p>
        {dialog === 'clear-conversations'
          ? t('desktop.security.clearWarning')
          : dialog === 'delete-account'
            ? t('desktop.security.deleteWarning')
            : t('desktop.security.unlinkWarning')}
      </p>
      {needsConfirmation ? (
        <label className="settings-field">
          <span>{t('desktop.security.deleteAccountHelp')}</span>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
      ) : null}
      {error ? (
        <p className="settings-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-dialog__actions">
        <button
          type="button"
          className="settings-button settings-button--secondary"
          onClick={close}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="settings-button settings-button--danger"
          disabled={isPending}
          onClick={confirm}
        >
          {t('desktop.security.confirmAction')}
        </button>
      </div>
    </DialogFrame>
  )
}
