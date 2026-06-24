import type { JSX } from 'react'

interface StrengthBarProps {
  password: string
}

function calcScore(pwd: string): number {
  let score = 0
  if (pwd.length >= 8) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) score++
  return score
}

const LEVELS = ['', '弱', '中', '强', '很强'] as const
const COLORS = ['', '#EF4444', '#F59E0B', '#3B82F6', '#10B981'] as const

/** 密码强度指示条 */
export default function StrengthBar({ password }: StrengthBarProps): JSX.Element | null {
  if (!password) return null
  const score = calcScore(password)

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-sm transition-all duration-300"
            style={{
              background: i < score ? COLORS[score] : 'var(--elevated)',
            }}
          />
        ))}
      </div>
      <span className="min-w-7 whitespace-nowrap text-xs" style={{ color: COLORS[score] }}>
        {LEVELS[score]}
      </span>
    </div>
  )
}
