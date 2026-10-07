import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

// 变体与尺寸对应 docs/ui-spec.md「核心组件规范 / Button」。
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] text-white hover:opacity-90 active:scale-[0.98]',
        secondary:
          'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--border-default)]',
        ghost: 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
        danger: 'bg-[var(--color-error)] text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
)

/** 共享按钮组件的属性。 */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 为真时把样式与属性透传给唯一子元素，而不是渲染 `button`。 */
  asChild?: boolean
  /** 加载态：置 `aria-busy`、禁用点击，并在文案左侧渲染 spinner。 */
  loading?: boolean
}

/**
 * 跨端共享的基础按钮，样式全部走 `tokens.css` 的 CSS 变量，因此自动跟随明暗主题。
 *
 * `asChild` 模式下由 Radix `Slot` 透传属性，此时不注入 spinner、也不透传 `disabled` ——
 * `Slot` 只接受单个子元素，且子元素未必是可禁用的表单控件。
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled = false,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className)

  if (asChild) {
    return (
      <Slot className={classes} aria-busy={loading} {...props}>
        {children}
      </Slot>
    )
  }

  return (
    <button className={classes} aria-busy={loading} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  )
}
