'use client'

import { useEffect, useState, type JSX } from 'react'
import { Check, Copy, Link as LinkIcon, Loader2, Lock, Trash2, X } from 'lucide-react'
import { useCreateShareLink, useRevokeShareLink, useShareLink } from '@yuanai/core/hooks'
import ConfirmDialog from '@/components/ConfirmDialog'

export interface ShareDialogProps {
  open: boolean
  convId: string | null
  onClose: () => void
}

type ExpiryOption = 0 | 1 | 7 | 30

const EXPIRY_OPTIONS: Array<{ value: ExpiryOption; label: string }> = [
  { value: 0, label: '永久有效' },
  { value: 1, label: '1 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
]

/**
 * 会话公开分享弹窗。
 *
 * - 首次打开自动查询已有分享；无则允许配置有效期与访问密码后生成链接。
 * - 生成后展示只读的分享链接 URL + 复制按钮 + 撤销按钮（带边框）。
 * - 修改有效期/密码时保持 token 不变，仅更新 metadata。
 */
export function ShareDialog({ open, convId, onClose }: ShareDialogProps): JSX.Element | null {
  const { data: existingLink, isLoading } = useShareLink(open && convId ? convId : undefined)
  const createMut = useCreateShareLink()
  const revokeMut = useRevokeShareLink()

  const [expiresInDays, setExpiresInDays] = useState<ExpiryOption>(0)
  const [enablePassword, setEnablePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCopied(false)
      setConfirmRevoke(false)
      setToast(null)
      setExpiresInDays(0)
      setEnablePassword(false)
      setPassword('')
      createMut.reset()
      revokeMut.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 已存在分享时把当前配置回填
  useEffect(() => {
    if (!existingLink) return
    if (existingLink.hasPassword) setEnablePassword(true)
    if (existingLink.expiresAt) {
      const remainDays = Math.ceil(
        (new Date(existingLink.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000)
      )
      if (remainDays <= 1) setExpiresInDays(1)
      else if (remainDays <= 7) setExpiresInDays(7)
      else setExpiresInDays(30)
    }
  }, [existingLink])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open || !convId) return null

  const currentLink = createMut.data ?? existingLink ?? null
  const shareUrl = currentLink
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/share/${currentLink.shareToken}`
      : `/share/${currentLink.shareToken}`
    : null

  const expiresLabel = currentLink?.expiresAt
    ? `到期于 ${new Date(currentLink.expiresAt).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '永久有效'

  const extractErrorMsg = (err: unknown): string => {
    const detail = (err as { response?: { data?: { detail?: { message?: string } | string } } })
      ?.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && detail.message) return detail.message
    return '请求失败，请稍后再试'
  }

  const buildOpts = (): { expiresInDays: number | null; password: string } | null => {
    if (enablePassword && password.trim().length < 4) {
      setToast('密码至少 4 位')
      return null
    }
    return {
      expiresInDays: expiresInDays === 0 ? null : expiresInDays,
      password: enablePassword ? password.trim() : '',
    }
  }

  const handleCreate = (): void => {
    const opts = buildOpts()
    if (!opts) return
    createMut.mutate(
      { convId, opts },
      {
        onSuccess: () => setToast('分享链接已生成'),
        onError: (err) => setToast(extractErrorMsg(err)),
      }
    )
  }

  const handleUpdate = (): void => {
    const opts = buildOpts()
    if (!opts) return
    createMut.mutate(
      { convId, opts },
      {
        onSuccess: () => setToast('设置已更新'),
        onError: (err) => setToast(extractErrorMsg(err)),
      }
    )
  }

  const handleCopy = async (): Promise<void> => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setToast('链接已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setToast('复制失败，请手动选择链接')
    }
  }

  const handleRevoke = (): void => {
    revokeMut.mutate(convId, {
      onSuccess: () => {
        setConfirmRevoke(false)
        setToast('分享已取消')
      },
      onError: () => setToast('取消失败'),
    })
  }

  return (
    <>
      <div className="st-sub-ov" onClick={onClose}>
        <div className="sh-modal" onClick={(e) => e.stopPropagation()}>
          <div className="st-sub-hd">
            <span className="st-sub-title">分享此对话</span>
            <button className="st-close-btn" onClick={onClose} aria-label="关闭">
              <X size={15} />
            </button>
          </div>

          <div className="st-sub-body">
            <p className="sh-desc">
              生成公开链接，任何人无需登录即可查看当前对话的完整内容（只读）。你可以设置有效期与访问密码，也可随时撤销。
            </p>

            {isLoading && !currentLink ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <Loader2 size={20} className="ch-spin" />
              </div>
            ) : (
              <>
                {/* 有效期 */}
                <div className="sh-field">
                  <label className="st-field-label">有效期</label>
                  <div className="sh-expiry-grid">
                    {EXPIRY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`sh-expiry-btn ${expiresInDays === opt.value ? 'sel' : ''}`}
                        onClick={() => setExpiresInDays(opt.value)}
                        type="button"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 访问密码 */}
                <div className="sh-field">
                  <div className="sh-pw-hd">
                    <label
                      className="st-field-label"
                      style={{
                        marginBottom: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Lock size={12} />
                      <span>访问密码</span>
                    </label>
                    <button
                      className={`st-toggle ${enablePassword ? 'on' : ''}`}
                      onClick={() => {
                        setEnablePassword((v) => !v)
                        if (enablePassword) setPassword('')
                      }}
                      role="switch"
                      aria-checked={enablePassword}
                      aria-label="启用访问密码"
                      type="button"
                    />
                  </div>
                  {enablePassword && (
                    <input
                      className="st-field-inp"
                      type="text"
                      placeholder="设置 4 位以上密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      maxLength={40}
                      style={{ marginTop: 8 }}
                    />
                  )}
                  {!enablePassword && (
                    <p className="sh-hint">未启用密码时，任何拿到链接的人均可查看</p>
                  )}
                </div>

                {/* 分享链接 */}
                {currentLink && shareUrl ? (
                  <div className="sh-field">
                    <label className="st-field-label">分享链接</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="st-field-inp"
                        value={shareUrl}
                        readOnly
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="st-btn st-btn-primary"
                        style={{ flexShrink: 0, height: 44, padding: '0 14px', gap: 6 }}
                        onClick={() => void handleCopy()}
                        type="button"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? '已复制' : '复制'}
                      </button>
                    </div>
                    <p className="sh-hint">{expiresLabel}</p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="st-sub-ft sh-footer">
            <div>
              {currentLink && (
                <button
                  className="st-btn-danger"
                  style={{ gap: 6 }}
                  onClick={() => setConfirmRevoke(true)}
                  disabled={revokeMut.isPending}
                  type="button"
                >
                  <Trash2 size={13} />
                  取消分享
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="st-btn st-btn-ghost" onClick={onClose} type="button">
                关闭
              </button>
              {currentLink ? (
                <button
                  className="st-btn st-btn-primary"
                  onClick={handleUpdate}
                  disabled={createMut.isPending}
                  type="button"
                >
                  {createMut.isPending ? <Loader2 size={14} className="ch-spin" /> : null}
                  更新设置
                </button>
              ) : (
                <button
                  className="st-btn st-btn-primary"
                  onClick={handleCreate}
                  disabled={createMut.isPending}
                  style={{ gap: 6 }}
                  type="button"
                >
                  {createMut.isPending ? (
                    <Loader2 size={14} className="ch-spin" />
                  ) : (
                    <LinkIcon size={14} />
                  )}
                  {createMut.isPending ? '正在生成...' : '生成分享链接'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRevoke}
        title="取消分享"
        message="链接将立即失效，所有已保存链接的人都将无法再访问此对话。"
        confirmText="取消分享"
        danger
        onConfirm={handleRevoke}
        onCancel={() => setConfirmRevoke(false)}
      />

      {toast && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 700,
          }}
        >
          <div className="st-toast ok show">
            <Check size={14} />
            {toast}
          </div>
        </div>
      )}
    </>
  )
}
