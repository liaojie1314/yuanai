import { Camera, Check, MessageSquare, Paperclip, Pencil, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { User, UserStats } from '@yuanai/types'

import '../../shared/i18n'

/** 个人资料分区属性。 */
export interface ProfileSectionProps {
  /** 当前用户。 */
  user: User | undefined
  /** 使用统计。 */
  stats: UserStats | undefined
  /** 提交个人资料。 */
  onSave(values: { username: string; bio: string }): Promise<void>
  /** 上传头像。 */
  onUploadAvatar(file: File): Promise<void>
  /** 提交中状态。 */
  isSaving: boolean
}

/** 展示并修改桌面端个人资料和使用统计。 */
export function ProfileSection({
  user,
  stats,
  onSave,
  onUploadAvatar,
  isSaving,
}: ProfileSectionProps): ReactElement {
  const { t } = useTranslation()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [editingField, setEditingField] = useState<'username' | 'bio' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setUsername(user?.username ?? '')
    setBio(user?.bio ?? '')
  }, [user?.bio, user?.username])

  async function saveProfile(field: 'username' | 'bio'): Promise<void> {
    const normalizedUsername = username.trim()
    if (field === 'username' && (normalizedUsername.length < 2 || normalizedUsername.length > 20)) {
      setError(t('desktop.profile.invalidDisplayName'))
      return
    }
    setError('')
    await onSave({ bio: bio.trim(), username: normalizedUsername })
    setEditingField(null)
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError(t('desktop.profile.imageOnly'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t('desktop.profile.avatarTooLarge'))
      return
    }
    setError('')
    await onUploadAvatar(file)
  }

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>{t('settings.sections.profile')}</h2>
      </div>
      <div className="settings-section__body">
        <section className="settings-block" aria-labelledby="profile-avatar-title">
          <h3 id="profile-avatar-title">{t('settings.profile.avatar')}</h3>
          <div className="profile-avatar-row">
            <button
              type="button"
              className="profile-avatar"
              aria-label={t('settings.profile.changeAvatar')}
              disabled={isSaving}
              onClick={() => avatarInputRef.current?.click()}
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" />
              ) : (
                <span>{user?.username?.slice(0, 1).toUpperCase() ?? '元'}</span>
              )}
              <span className="profile-avatar__overlay">
                <Camera size={16} aria-hidden="true" />
              </span>
            </button>
            <div className="profile-avatar-row__meta">
              <strong>{user?.username || t('desktop.profile.unsetDisplayName')}</strong>
              <p>{user?.email ?? t('common.loading')}</p>
              <span>{t('desktop.profile.plan')}</span>
            </div>
            <input
              ref={avatarInputRef}
              className="settings-visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => void handleAvatarChange(event)}
            />
          </div>
        </section>
        <section className="settings-block" aria-labelledby="profile-details-title">
          <h3 id="profile-details-title">{t('settings.sections.profile')}</h3>
          <div className="settings-row profile-edit-row">
            <span className="profile-edit-row__label">{t('desktop.profile.displayName')}</span>
            {editingField === 'username' ? (
              <div className="profile-edit-row__editor">
                <input
                  value={username}
                  maxLength={20}
                  aria-label={t('desktop.profile.displayName')}
                  autoFocus
                  onChange={(event) => setUsername(event.target.value)}
                />
                <button
                  type="button"
                  className="settings-button settings-button--secondary"
                  onClick={() => {
                    setUsername(user?.username ?? '')
                    setEditingField(null)
                  }}
                >
                  <X size={15} aria-hidden="true" /> {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="settings-button settings-button--primary"
                  disabled={!user || isSaving}
                  onClick={() => void saveProfile('username')}
                >
                  <Check size={15} aria-hidden="true" /> {t('common.save')}
                </button>
              </div>
            ) : (
              <div className="profile-edit-row__value">
                <span>{user?.username || t('desktop.profile.unsetDisplayName')}</span>
                <button
                  type="button"
                  aria-label={`${t('common.edit')}${t('desktop.profile.displayName')}`}
                  onClick={() => setEditingField('username')}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          <div className="settings-row profile-edit-row">
            <span className="profile-edit-row__label">{t('settings.profile.bio')}</span>
            {editingField === 'bio' ? (
              <div className="profile-edit-row__editor">
                <input
                  value={bio}
                  maxLength={200}
                  aria-label={t('settings.profile.bio')}
                  autoFocus
                  placeholder={t('settings.profile.bioPlaceholder')}
                  onChange={(event) => setBio(event.target.value)}
                />
                <button
                  type="button"
                  className="settings-button settings-button--secondary"
                  onClick={() => {
                    setBio(user?.bio ?? '')
                    setEditingField(null)
                  }}
                >
                  <X size={15} aria-hidden="true" /> {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="settings-button settings-button--primary"
                  disabled={!user || isSaving}
                  onClick={() => void saveProfile('bio')}
                >
                  <Check size={15} aria-hidden="true" /> {t('common.save')}
                </button>
              </div>
            ) : (
              <div className="profile-edit-row__value">
                <span className={user?.bio ? undefined : 'is-muted'}>
                  {user?.bio || t('settings.profile.bioPlaceholder')}
                </span>
                <button
                  type="button"
                  aria-label={`${t('common.edit')}${t('settings.profile.bio')}`}
                  onClick={() => setEditingField('bio')}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          {error ? (
            <p className="settings-alert" role="alert">
              {error}
            </p>
          ) : null}
        </section>
        <section className="settings-block" aria-labelledby="profile-stats-title">
          <h3 id="profile-stats-title">{t('desktop.profile.usage')}</h3>
          <dl className="settings-stats">
            <div>
              <MessageSquare size={18} aria-hidden="true" />
              <dd>{stats?.conversationCount ?? '--'}</dd>
              <dt>{t('desktop.profile.conversations')}</dt>
            </div>
            <div>
              <Zap size={18} aria-hidden="true" />
              <dd>{stats?.totalTokens.toLocaleString() ?? '--'}</dd>
              <dt>Token</dt>
            </div>
            <div>
              <Paperclip size={18} aria-hidden="true" />
              <dd>{stats?.fileCount ?? '--'}</dd>
              <dt>{t('desktop.profile.files')}</dt>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}
