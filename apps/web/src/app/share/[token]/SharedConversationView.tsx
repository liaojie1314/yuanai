'use client'

import { useEffect, useState, type JSX } from 'react'
import Link from 'next/link'
import { AlertCircle, Loader2, Lock, LogIn, MessageSquare } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import ReactMarkdownRaw from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkGemoji from 'remark-gemoji'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  useSharedConversation,
  useSharedMeta,
  useUnlockSharedConversation,
} from '@yuanai/core/hooks'
import type { Message } from '@yuanai/types'
import type { SharedConversation } from '@yuanai/core/api'
import { ShareCodeBlock } from './ShareCodeBlock'
import './share.css'

// react-markdown v10 peer dep targets React 16-18；cast 修 React 19 类型不匹配（与 MarkdownContent 一致）
interface MarkdownProps {
  children: string
  remarkPlugins?: unknown[]
  rehypePlugins?: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, (props: any) => JSX.Element | null>
}
const ReactMarkdown = ReactMarkdownRaw as unknown as (props: MarkdownProps) => JSX.Element

// 虚拟滚动阈值：消息数超过该值启用 Virtuoso（少量时用普通渲染有更好体验）
const VIRTUAL_THRESHOLD = 30

export interface SharedConversationViewProps {
  token: string
}

/**
 * 只读分享内容渲染器。
 *
 * 流程：
 * 1. 先拉 meta（无需密码即可看到标题/作者/是否需要密码）
 * 2. 若无密码 → 自动拉正文；有密码 → 展示密码解锁表单
 * 3. 正文渲染：< VIRTUAL_THRESHOLD 直接列表，>= 阈值启用虚拟滚动
 */
export default function SharedConversationView({
  token,
}: SharedConversationViewProps): JSX.Element {
  const { data: meta, isLoading: metaLoading, error: metaError } = useSharedMeta(token)

  const needPassword = meta?.requiresPassword ?? false
  const [unlockedData, setUnlockedData] = useState<SharedConversation | null>(null)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)

  // 无密码情况下自动拉正文
  const {
    data: publicData,
    isLoading: contentLoading,
    error: contentError,
  } = useSharedConversation(token, meta ? !needPassword : false)

  const unlockMut = useUnlockSharedConversation(token)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  }, [])

  const handleUnlock = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!password) {
      setPwError('请输入访问密码')
      return
    }
    setPwError(null)
    unlockMut.mutate(password, {
      onSuccess: (data) => setUnlockedData(data),
      onError: (err: unknown) => {
        const code = (err as { response?: { data?: { detail?: { code?: string } } } })?.response
          ?.data?.detail?.code
        setPwError(code === 'SHARE_PASSWORD_INVALID' ? '访问密码错误' : '解锁失败，请重试')
      },
    })
  }

  const data: SharedConversation | null = unlockedData ?? publicData ?? null

  // Loading meta
  if (metaLoading) {
    return (
      <div className="share-loading">
        <Loader2 size={24} className="share-spin" />
        <span>正在加载分享内容…</span>
      </div>
    )
  }

  // meta error → 链接不可用
  if (metaError || !meta) {
    return <ShareUnavailable />
  }

  // 需要密码 & 尚未解锁 → 显示密码表单
  if (needPassword && !unlockedData) {
    return (
      <PasswordGate
        meta={meta}
        password={password}
        setPassword={setPassword}
        pwError={pwError}
        pending={unlockMut.isPending}
        onSubmit={handleUnlock}
      />
    )
  }

  // 正文加载中
  if (contentLoading && !data) {
    return (
      <div className="share-loading">
        <Loader2 size={24} className="share-spin" />
        <span>正在加载对话…</span>
      </div>
    )
  }

  // 正文错误
  if (contentError && !data) {
    return <ShareUnavailable />
  }

  if (!data) return <ShareUnavailable />

  const sharedAtLabel = new Date(data.sharedAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const messages = data.messages
  const useVirtual = messages.length >= VIRTUAL_THRESHOLD

  return (
    <div className="share-page">
      <ShareHeader />

      <main className="share-main">
        <div className="share-meta">
          <div className="share-title">{data.title}</div>
          <div className="share-meta-row">
            <span className="share-tag">
              <MessageSquare size={12} />
              {data.model}
            </span>
            <span className="share-meta-text">
              由 <strong>{data.authorUsername}</strong> 分享于 {sharedAtLabel}
              {data.expiresAt && (
                <>
                  {' '}
                  · 有效期至{' '}
                  {new Date(data.expiresAt).toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </>
              )}
            </span>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="share-empty">该对话尚无消息内容。</div>
        ) : useVirtual ? (
          <Virtuoso
            useWindowScroll
            data={messages}
            itemContent={(_, msg) => (
              <div style={{ padding: '12px 0' }}>
                <SharedMessage msg={msg} />
              </div>
            )}
            components={{
              Footer: () => <ShareCTA />,
            }}
          />
        ) : (
          <>
            <div className="share-messages">
              {messages.map((msg) => (
                <SharedMessage key={msg.id} msg={msg} />
              ))}
            </div>
            <ShareCTA />
          </>
        )}
      </main>
    </div>
  )
}

function ShareHeader(): JSX.Element {
  return (
    <header className="share-header">
      <div className="share-brand">
        <div className="share-brand-logo">元</div>
        <span className="share-brand-name">元 AI</span>
      </div>
      <div className="share-header-actions">
        <Link href="/login" className="share-btn-ghost">
          <LogIn size={14} />
          登录
        </Link>
        <Link href="/register" className="share-btn-primary">
          免费注册
        </Link>
      </div>
    </header>
  )
}

function ShareCTA(): JSX.Element {
  return (
    <div className="share-cta">
      <p>喜欢这段对话？创建你自己的元 AI 账户，与 AI 展开更多可能。</p>
      <Link href="/register" className="share-btn-primary share-btn-lg">
        免费开始使用
      </Link>
    </div>
  )
}

function ShareUnavailable(): JSX.Element {
  return (
    <div className="share-error">
      <AlertCircle size={40} />
      <h1>分享链接不可用</h1>
      <p>链接可能已被撤销、过期，或分享者已删除该对话。</p>
      <Link href="/login" className="share-btn-primary">
        <LogIn size={14} />
        去登录
      </Link>
    </div>
  )
}

interface PasswordGateProps {
  meta: { title: string; authorUsername: string }
  password: string
  setPassword: (v: string) => void
  pwError: string | null
  pending: boolean
  onSubmit: (e: React.FormEvent) => void
}

function PasswordGate({
  meta,
  password,
  setPassword,
  pwError,
  pending,
  onSubmit,
}: PasswordGateProps): JSX.Element {
  return (
    <div className="share-page">
      <ShareHeader />
      <main className="share-gate">
        <div className="share-gate-card">
          <div className="share-gate-icon">
            <Lock size={22} />
          </div>
          <h1 className="share-gate-title">该分享需要密码访问</h1>
          <p className="share-gate-sub">
            <strong>{meta.title}</strong>
            <br />由 {meta.authorUsername} 分享
          </p>
          <form onSubmit={onSubmit} className="share-gate-form">
            <input
              className="share-gate-input"
              type="text"
              placeholder="请输入访问密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {pwError && <p className="share-gate-err">{pwError}</p>}
            <button
              type="submit"
              className="share-btn-primary share-btn-lg"
              disabled={pending}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {pending ? <Loader2 size={14} className="share-spin" /> : <Lock size={14} />}
              {pending ? '验证中...' : '解锁查看'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}

interface SharedMessageProps {
  msg: Message
}

function SharedMessage({ msg }: SharedMessageProps): JSX.Element {
  const isUser = msg.role === 'user'
  if (isUser) {
    return (
      <div className="share-msg share-msg-user">
        <div className="share-msg-bubble">{msg.content}</div>
      </div>
    )
  }
  return (
    <div className="share-msg share-msg-ai">
      <div className="share-msg-avatar">元</div>
      <div className="share-msg-body">
        <div className="md-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkGemoji]}
            rehypePlugins={[rehypeKatex]}
            components={{
              code({ className, children }: { className?: string; children?: React.ReactNode }) {
                const match = /language-(\w+)/.exec(className ?? '')
                const text = String(children)
                const isBlock = match !== null || text.includes('\n')
                if (isBlock) {
                  return <ShareCodeBlock lang={match?.[1] ?? ''} code={text.replace(/\n$/, '')} />
                }
                return <code className="sh-inline-code">{children}</code>
              },
              pre({ children }: { children?: React.ReactNode }) {
                return <>{children}</>
              },
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
