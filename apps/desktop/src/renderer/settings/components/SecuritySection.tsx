import { KeyRound, Link2Off, Mail, ShieldAlert, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'

import type { User } from '@yuanai/types'

import type { SettingsDialogMode } from './SettingsDialogs'

/** 账号安全分区属性。 */
export interface SecuritySectionProps {
  /** 当前用户。 */
  user: User | undefined
  /** 打开二次确认对话框。 */
  onOpenDialog(mode: SettingsDialogMode): void
}

/** 展示账号凭据、关联账号和危险操作入口。 */
export function SecuritySection({ user, onOpenDialog }: SecuritySectionProps): ReactElement {
  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>账号安全</h2>
        <p>管理登录凭据与账户数据。</p>
      </div>
      <section className="settings-block">
        <h3>登录方式</h3>
        <div className="settings-row">
          <div>
            <strong>邮箱</strong>
            <p>{user?.email ?? '正在加载'}</p>
          </div>
          <button
            type="button"
            className="settings-text-button"
            onClick={() => onOpenDialog('change-email')}
          >
            <Mail size={16} aria-hidden="true" /> 更换邮箱
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>登录密码</strong>
            <p>定期更新密码可提高账号安全性。</p>
          </div>
          <button
            type="button"
            className="settings-text-button"
            onClick={() => onOpenDialog('change-password')}
          >
            <KeyRound size={16} aria-hidden="true" /> 修改密码
          </button>
        </div>
      </section>
      <section className="settings-block">
        <h3>已关联账号</h3>
        <div className="settings-row">
          <div>
            <strong>GitHub</strong>
            <p>{user?.githubId ? '已关联' : '未关联'}</p>
          </div>
          {user?.githubId ? (
            <button
              type="button"
              className="settings-text-button"
              onClick={() => onOpenDialog('unlink-github')}
            >
              <Link2Off size={16} aria-hidden="true" /> 解除关联
            </button>
          ) : null}
        </div>
        <div className="settings-row">
          <div>
            <strong>Google</strong>
            <p>{user?.googleId ? '已关联' : '未关联'}</p>
          </div>
          {user?.googleId ? (
            <button
              type="button"
              className="settings-text-button"
              onClick={() => onOpenDialog('unlink-google')}
            >
              <Link2Off size={16} aria-hidden="true" /> 解除关联
            </button>
          ) : null}
        </div>
      </section>
      <section className="settings-block settings-block--danger">
        <h3>危险操作</h3>
        <div className="settings-row">
          <div>
            <strong>清空全部会话</strong>
            <p>此操作会永久删除当前账号的所有聊天记录。</p>
          </div>
          <button
            type="button"
            className="settings-text-button settings-text-button--danger"
            onClick={() => onOpenDialog('clear-conversations')}
          >
            <Trash2 size={16} aria-hidden="true" /> 清空会话
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>注销账号</strong>
            <p>账号和关联数据将被永久删除，无法恢复。</p>
          </div>
          <button
            type="button"
            className="settings-text-button settings-text-button--danger"
            onClick={() => onOpenDialog('delete-account')}
          >
            <ShieldAlert size={16} aria-hidden="true" /> 注销账号
          </button>
        </div>
      </section>
    </div>
  )
}
