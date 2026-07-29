import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * 统一弹窗系统，替代原生 `Alert.alert` / `Alert.prompt`（后者 Android 不支持）。
 *
 * 设计目标：
 * - 命令式 API（返回 Promise），迁移原 Alert 调用点是机械替换，无需在每个组件里
 *   维护 visible state。
 * - 视觉统一：居中卡片 + 半透明遮罩 + 与设计系统一致的圆角/配色。
 * - 四种形态：
 *   - `confirm` → Promise<boolean>（确定/取消，可选 destructive 红色）
 *   - `alert`   → Promise<void>（单个确定按钮）
 *   - `prompt`  → Promise<string | null>（文本输入，取消返回 null）
 *   - `actionSheet` → Promise<number>（选项列表，返回选中下标，取消返回 -1）
 *
 * Provider 挂在 root layout；任意组件用 `useDialog()` 取到方法。
 */

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 确定按钮红色（删除等破坏性操作） */
  destructive?: boolean
}

export interface AlertOptions {
  title: string
  message?: string
  okText?: string
}

export interface PromptOptions {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  maxLength?: number
}

export interface ActionSheetItem {
  label: string
  destructive?: boolean
}

export interface ActionSheetOptions {
  title?: string
  message?: string
  actions: ActionSheetItem[]
  /** 是否显示取消项（返回 -1）；默认 true */
  cancelable?: boolean
  cancelText?: string
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  alert: (opts: AlertOptions) => Promise<void>
  prompt: (opts: PromptOptions) => Promise<string | null>
  actionSheet: (opts: ActionSheetOptions) => Promise<number>
}

const DialogContext = createContext<DialogApi | null>(null)

/** 内部：当前正在展示的弹窗描述（discriminated union） */
type ActiveDialog =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'actionSheet'; opts: ActionSheetOptions; resolve: (v: number) => void }

export function DialogProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useTheme()
  const [active, setActive] = useState<ActiveDialog | null>(null)
  const [inputValue, setInputValue] = useState('')
  // 保存 resolve 用于「点遮罩关闭」时按取消语义兜底
  const activeRef = useRef<ActiveDialog | null>(null)
  activeRef.current = active

  const close = useCallback((): void => {
    setActive(null)
    setInputValue('')
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setActive({ kind: 'confirm', opts, resolve })
      }),
    []
  )

  const alert = useCallback(
    (opts: AlertOptions) =>
      new Promise<void>((resolve) => {
        setActive({ kind: 'alert', opts, resolve })
      }),
    []
  )

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setInputValue(opts.defaultValue ?? '')
        setActive({ kind: 'prompt', opts, resolve })
      }),
    []
  )

  const actionSheet = useCallback(
    (opts: ActionSheetOptions) =>
      new Promise<number>((resolve) => {
        setActive({ kind: 'actionSheet', opts, resolve })
      }),
    []
  )

  const api = useMemo<DialogApi>(
    () => ({ confirm, alert, prompt, actionSheet }),
    [confirm, alert, prompt, actionSheet]
  )

  // 遮罩点击/系统返回：按各形态的「取消」语义 resolve
  const onDismiss = useCallback((): void => {
    const cur = activeRef.current
    if (!cur) return
    if (cur.kind === 'confirm') cur.resolve(false)
    else if (cur.kind === 'alert') cur.resolve()
    else if (cur.kind === 'prompt') cur.resolve(null)
    else cur.resolve(-1)
    close()
  }, [close])

  // Android 硬件返回键 = 取消（原生 Modal 的 onRequestClose 等价物）
  useEffect(() => {
    if (active === null) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss()
      return true
    })
    return () => sub.remove()
  }, [active, onDismiss])

  // 不用 RN <Modal>：RN 0.76 Fabric 上首帧后再挂载的 Modal 不给内容根节点
  // 窗口约束，flex:1 塌缩成 0 尺寸 → 弹窗隐形但整屏挡触摸（根 layout 常驻
  // visible 的 Modal 则正常）。改为 DialogProvider（root layout）内的绝对
  // 定位 overlay，天然覆盖全屏且不受该缺陷影响。
  return (
    <DialogContext.Provider value={api}>
      {children}
      {active !== null && (
        <KeyboardAvoidingView behavior="padding" style={styles.overlayWrap}>
          <Pressable style={styles.backdrop} onPress={onDismiss} />
          {active.kind === 'actionSheet' ? (
            <View style={[styles.sheetCard, { backgroundColor: t.bg.surface }]}>
              <ActionSheetBody
                opts={active.opts}
                onPick={(i) => {
                  active.resolve(i)
                  close()
                }}
              />
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: t.bg.surface }]}>
              <CenterDialogBody
                active={active}
                inputValue={inputValue}
                setInputValue={setInputValue}
                onClose={close}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </DialogContext.Provider>
  )
}

/** confirm / alert / prompt 三种居中卡片的正文 */
function CenterDialogBody({
  active,
  inputValue,
  setInputValue,
  onClose,
}: {
  active: Exclude<ActiveDialog, { kind: 'actionSheet' }>
  inputValue: string
  setInputValue: (v: string) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useTheme()
  const { opts } = active
  const message = 'message' in opts ? opts.message : undefined

  return (
    <>
      <Text style={[styles.title, { color: t.text.primary }]}>{opts.title}</Text>
      {message ? (
        <Text style={[styles.message, { color: t.text.secondary }]}>{message}</Text>
      ) : null}

      {active.kind === 'prompt' ? (
        <TextInput
          value={inputValue}
          onChangeText={setInputValue}
          placeholder={active.opts.placeholder}
          placeholderTextColor={t.text.muted}
          style={[
            styles.input,
            { borderColor: t.border.default, color: t.text.primary, backgroundColor: t.bg.base },
          ]}
          autoFocus
          maxLength={active.opts.maxLength ?? 100}
          selectTextOnFocus
          onSubmitEditing={() => {
            const trimmed = inputValue.trim()
            active.resolve(trimmed.length > 0 ? trimmed : null)
            onClose()
          }}
        />
      ) : null}

      <View style={styles.btnRow}>
        {active.kind === 'alert' ? (
          <DialogButton
            label={active.opts.okText ?? '好'}
            variant="primary"
            onPress={() => {
              active.resolve()
              onClose()
            }}
          />
        ) : (
          <>
            <DialogButton
              label={active.opts.cancelText ?? '取消'}
              variant="ghost"
              onPress={() => {
                if (active.kind === 'confirm') active.resolve(false)
                else active.resolve(null)
                onClose()
              }}
            />
            <DialogButton
              label={active.opts.confirmText ?? '确定'}
              variant={active.kind === 'confirm' && active.opts.destructive ? 'danger' : 'primary'}
              onPress={() => {
                if (active.kind === 'confirm') {
                  active.resolve(true)
                } else {
                  const trimmed = inputValue.trim()
                  active.resolve(trimmed.length > 0 ? trimmed : null)
                }
                onClose()
              }}
            />
          </>
        )}
      </View>
    </>
  )
}

/** actionSheet 正文：标题 + 选项列表 + 取消 */
function ActionSheetBody({
  opts,
  onPick,
}: {
  opts: ActionSheetOptions
  onPick: (index: number) => void
}): React.JSX.Element {
  const t = useTheme()
  return (
    <>
      {opts.title ? (
        <Text style={[styles.sheetTitle, { color: t.text.primary }]}>{opts.title}</Text>
      ) : null}
      {opts.message ? (
        <Text style={[styles.sheetMessage, { color: t.text.secondary }]}>{opts.message}</Text>
      ) : null}
      <View style={styles.sheetActions}>
        {opts.actions.map((a, i) => (
          <Pressable
            key={`${a.label}-${i}`}
            onPress={() => onPick(i)}
            android_ripple={{
              color: t.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            }}
            style={[
              styles.sheetItem,
              i > 0 && styles.sheetItemDivider,
              i > 0 && { borderTopColor: t.border.default },
            ]}
          >
            <Text
              style={[
                styles.sheetItemText,
                { color: t.text.primary },
                a.destructive && { color: t.border.danger },
              ]}
            >
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {opts.cancelable !== false ? (
        <Pressable
          onPress={() => onPick(-1)}
          android_ripple={{
            color: t.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          }}
          style={[styles.sheetCancel, { borderTopColor: t.border.default }]}
        >
          <Text style={[styles.sheetCancelText, { color: t.text.secondary }]}>
            {opts.cancelText ?? '取消'}
          </Text>
        </Pressable>
      ) : null}
    </>
  )
}

function DialogButton({
  label,
  variant,
  onPress,
}: {
  label: string
  variant: 'primary' | 'danger' | 'ghost'
  onPress: () => void
}): React.JSX.Element {
  const t = useTheme()
  const bgColor =
    variant === 'primary' ? brand.solid : variant === 'danger' ? t.border.danger : t.bg.elevated
  const fgColor = variant === 'ghost' ? t.text.secondary : '#FFFFFF'
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
      style={[styles.btn, { backgroundColor: bgColor }]}
    >
      <Text style={[styles.btnText, { color: fgColor }]}>{label}</Text>
    </Pressable>
  )
}

/** 读取弹窗 API。必须在 DialogProvider 内使用。 */
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog 必须在 DialogProvider 内使用')
  return ctx
}

const styles = StyleSheet.create({
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    width: '84%',
    maxWidth: 400,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  input: {
    marginTop: spacing.lg,
    height: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '600' },
  sheetCard: {
    width: '84%',
    maxWidth: 400,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetMessage: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sheetActions: { marginTop: spacing.xs },
  sheetItem: { minHeight: 52, justifyContent: 'center' },
  sheetItemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetItemText: { fontSize: 16, textAlign: 'center', width: '100%' },
  sheetCancel: {
    minHeight: 52,
    justifyContent: 'center',
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetCancelText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
})
