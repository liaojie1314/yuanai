import { KeyRound, Link2Off, Mail, ShieldAlert, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { User } from '@yuanai/types'

import type { SettingsDialogMode } from './SettingsDialogs'
import '../../shared/i18n'

/** 账号安全分区属性。 */
export interface SecuritySectionProps {
  /** 当前用户。 */
  user: User | undefined
  /** 打开二次确认对话框。 */
  onOpenDialog(mode: SettingsDialogMode): void
}

/** 展示账号凭据、关联账号和危险操作入口。 */
export function SecuritySection({ user, onOpenDialog }: SecuritySectionProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>{t('settings.sections.security')}</h2>
        <p>{t('desktop.security.description')}</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>{t('desktop.security.loginMethods')}</h3>
          <div className="settings-row">
            <div>
              <strong>{t('settings.security.email')}</strong>
              <p>{user?.email ?? t('common.loading')}</p>
            </div>
            <button
              type="button"
              className="settings-text-button"
              onClick={() => onOpenDialog('change-email')}
            >
              <Mail size={16} aria-hidden="true" /> {t('settings.security.changeEmail')}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t('settings.security.password')}</strong>
              <p>{t('desktop.security.passwordDescription')}</p>
            </div>
            <button
              type="button"
              className="settings-text-button"
              onClick={() => onOpenDialog('change-password')}
            >
              <KeyRound size={16} aria-hidden="true" /> {t('settings.security.changePassword')}
            </button>
          </div>
        </section>
        <section className="settings-block">
          <h3>{t('desktop.security.linkedAccounts')}</h3>
          <div className="settings-row">
            <div>
              <strong>GitHub</strong>
              <p>
                {user?.githubId ? t('desktop.security.linked') : t('desktop.security.unlinked')}
              </p>
            </div>
            {user?.githubId ? (
              <button
                type="button"
                className="settings-text-button"
                onClick={() => onOpenDialog('unlink-github')}
              >
                <Link2Off size={16} aria-hidden="true" /> {t('desktop.security.unlink')}
              </button>
            ) : null}
          </div>
          <div className="settings-row">
            <div>
              <strong>Google</strong>
              <p>
                {user?.googleId ? t('desktop.security.linked') : t('desktop.security.unlinked')}
              </p>
            </div>
            {user?.googleId ? (
              <button
                type="button"
                className="settings-text-button"
                onClick={() => onOpenDialog('unlink-google')}
              >
                <Link2Off size={16} aria-hidden="true" /> {t('desktop.security.unlink')}
              </button>
            ) : null}
          </div>
        </section>
        <section className="settings-block settings-block--danger">
          <h3>{t('settings.security.dangerousOps')}</h3>
          <div className="settings-row">
            <div>
              <strong>{t('desktop.security.clearAll')}</strong>
              <p>{t('desktop.security.clearDescription')}</p>
            </div>
            <button
              type="button"
              className="settings-text-button settings-text-button--danger"
              onClick={() => onOpenDialog('clear-conversations')}
            >
              <Trash2 size={16} aria-hidden="true" /> {t('desktop.security.clearAction')}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t('settings.security.deleteAccount')}</strong>
              <p>{t('desktop.security.deleteDescription')}</p>
            </div>
            <button
              type="button"
              className="settings-text-button settings-text-button--danger"
              onClick={() => onOpenDialog('delete-account')}
            >
              <ShieldAlert size={16} aria-hidden="true" /> {t('settings.security.deleteAccount')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
