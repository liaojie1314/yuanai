'use client'

import type { JSX } from 'react'
import { useTranslations } from '@/i18n/client'

function calcScore(pwd: string): number {
  let s = 0
  if (pwd.length >= 8) s++
  if (/[A-Z]/.test(pwd)) s++
  if (/[0-9]/.test(pwd)) s++
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) s++
  return s
}

const COLORS = ['', '#ef4444', '#f59e0b', '#3b82f6', '#10b981']
const BAR_CLS = ['', 's1', 's2', 's3', 's4']

export default function StrengthBar({ password }: { password: string }): JSX.Element | null {
  const t = useTranslations('auth.passwordStrength')

  if (!password) return null
  const score = calcScore(password)

  const labels = ['', t('weak'), t('medium'), t('strong'), t('veryStrong')]

  return (
    <div className="strength-wrap">
      <div className="bars">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={['bar', i < score ? BAR_CLS[score] : ''].filter(Boolean).join(' ')}
          />
        ))}
      </div>
      <span className="str-lbl" style={{ color: COLORS[score] }}>
        {labels[score] ?? labels[1]}
      </span>
    </div>
  )
}
