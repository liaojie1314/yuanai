import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'

import { radius, spacing } from '@/theme/tokens'

/**
 * 轻量 Toast：命令式 API + 底部弹入 + 淡出。
 *
 * 用途场景是「复制成功 / 点赞记录」这类**非模态、无需用户回应**的即时反馈；
 * 命令式（`toast.show(...)`）省去每个调用点维护 visible state 的样板。
 *
 * 实现要点：
 * - 不用 RN `<Modal>`：DialogProvider 已经踩过 Fabric 首帧后挂载塌缩为 0 尺寸的坑
 *   （docs-internal 第 1 条）；直接用根部绝对定位 View，行为稳定。
 * - `pointerEvents="none"`：Toast 是提示不是操作，不能挡住底下的输入区/操作行。
 * - 只维持一个 Toast：新提示直接覆盖上一个（省得排队 + 简化时序）。
 */

interface ToastApi {
  /** 弹出一条 Toast；`durationMs` 默认 1600ms */
  show: (message: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/**
 * 挂在 root layout 下（DialogProvider 同级或内层均可），全局共享一个 Toast。
 */
export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(
    (msg: string, durationMs = 1600): void => {
      // 覆盖上一个：清定时器 + 直接换文案，避免闪一下
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setMessage(msg)
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start()
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setMessage(null)
        })
      }, durationMs)
    },
    [opacity]
  )

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    []
  )

  const api = useRef<ToastApi>({ show }).current
  // show 引用稳定（依赖仅 opacity/setMessage），api 也保持稳定，避免下游 memo 失效
  api.show = show

  return (
    <ToastContext.Provider value={api}>
      {children}
      {message !== null ? (
        <View style={styles.wrap} pointerEvents="none" accessibilityLiveRegion="polite">
          <Animated.View style={[styles.toast, { opacity }]}>
            <Text style={styles.text}>{message}</Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  )
}

/** 读取 Toast API。必须在 ToastProvider 内使用。 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}

const styles = StyleSheet.create({
  // 屏幕水平垂直居中；不用 SafeAreaInsets，让 toast 视觉在整屏的几何中心。
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 900,
    elevation: 900,
  },
  // 中心 Toast 用深色底 + 白字（对齐 Android Snackbar / iOS HUD 视觉），比
  // 浅色卡片在页面中央更容易被识别为「即时反馈」而非常驻卡片。
  toast: {
    maxWidth: '80%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: 'rgba(20, 22, 30, 0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
    elevation: 8,
  },
  text: { fontSize: 14, color: '#FFFFFF', textAlign: 'center' },
})
