'use client'

import { useState, type JSX } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean
  ref?: React.Ref<HTMLInputElement>
}

/** 密码输入框（含显示/隐藏切换），兼容 React 19 ref-as-prop */
export default function PasswordInput({
  hasError,
  className,
  ref,
  ...props
}: PasswordInputProps): JSX.Element {
  const [show, setShow] = useState(false)

  return (
    <div className="relative flex items-center">
      {/* 锁图标 */}
      <span
        className="pointer-events-none absolute left-[14px] flex transition-colors"
        style={{ color: 'var(--fg3)' }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>
      <input
        ref={ref}
        type={show ? 'text' : 'password'}
        className={cn('auth-input w-full', hasError && 'auth-input-error', className)}
        style={{ paddingLeft: 42, paddingRight: 44 }}
        {...props}
      />
      <button
        type="button"
        aria-label={show ? '隐藏密码' : '显示密码'}
        onClick={() => setShow((s) => !s)}
        className="absolute right-0.5 flex h-11 w-11 items-center justify-center transition-colors"
        style={{ color: 'var(--fg3)', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
