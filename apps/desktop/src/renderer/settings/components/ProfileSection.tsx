import { Camera, Save, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'

import type { User, UserStats } from '@yuanai/types'

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
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    setUsername(user?.username ?? '')
    setBio(user?.bio ?? '')
  }, [user?.bio, user?.username])

  async function submitProfile(): Promise<void> {
    const normalizedUsername = username.trim()
    if (normalizedUsername.length < 2 || normalizedUsername.length > 20) {
      setError('昵称需要 2 至 20 个字符')
      return
    }
    setError('')
    await onSave({ bio: bio.trim(), username: normalizedUsername })
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('头像文件不能超过 5 MB')
      return
    }
    setError('')
    await onUploadAvatar(file)
  }

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>个人资料</h2>
        <p>管理你的公开身份和个人简介。</p>
      </div>
      <section className="settings-block" aria-labelledby="profile-avatar-title">
        <h3 id="profile-avatar-title">头像</h3>
        <div className="profile-avatar-row">
          <div className="profile-avatar" aria-hidden="true">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <UserRound size={28} />}
          </div>
          <div>
            <button
              type="button"
              className="settings-button settings-button--secondary"
              onClick={() => avatarInputRef.current?.click()}
            >
              <Camera size={16} aria-hidden="true" /> 更换头像
            </button>
            <p>支持 JPG、PNG、WebP 或 GIF，最大 5 MB。</p>
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
        <h3 id="profile-details-title">基本信息</h3>
        <div className="settings-field-grid">
          <label>
            <span>邮箱</span>
            <input value={user?.email ?? ''} disabled aria-label="邮箱" />
          </label>
          <label>
            <span>昵称</span>
            <input
              value={username}
              maxLength={20}
              aria-label="昵称"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
        </div>
        <label className="settings-field">
          <span>个人简介</span>
          <textarea
            value={bio}
            maxLength={200}
            aria-label="个人简介"
            rows={4}
            onChange={(event) => setBio(event.target.value)}
          />
        </label>
        {error ? (
          <p className="settings-alert" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="settings-button settings-button--primary"
          disabled={!user || isSaving}
          onClick={() => void submitProfile()}
        >
          <Save size={16} aria-hidden="true" /> 保存资料
        </button>
      </section>
      <section className="settings-block" aria-labelledby="profile-stats-title">
        <h3 id="profile-stats-title">使用统计</h3>
        <dl className="settings-stats">
          <div>
            <dt>会话</dt>
            <dd>{stats?.conversationCount ?? '--'}</dd>
          </div>
          <div>
            <dt>已用令牌</dt>
            <dd>{stats?.totalTokens.toLocaleString() ?? '--'}</dd>
          </div>
          <div>
            <dt>文件</dt>
            <dd>{stats?.fileCount ?? '--'}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
