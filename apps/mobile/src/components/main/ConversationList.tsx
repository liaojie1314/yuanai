import { useRouter } from 'expo-router'
import {
  Check,
  CheckSquare,
  LogOut,
  MoreVertical,
  Pin,
  Search,
  Settings,
  Square,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  groupConversations,
  useAuthStore,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useDeleteConversations,
  useLogout,
  useUpdateConversation,
  type ConvGroup,
} from '@yuanai/core'

import { bg, border, brand, radius, spacing, text } from '@/theme/tokens'

const GROUP_ORDER: readonly ConvGroup[] = ['pinned', 'today', 'yesterday', 'week']
const GROUP_LABEL: Record<ConvGroup, string> = {
  pinned: '置顶',
  today: '今天',
  yesterday: '昨天',
  week: '本周',
}

interface ConversationListProps {
  /** 当前活跃会话 ID，用于高亮 */
  activeId?: string | undefined
  /** 用户点击会话 → 通知父级切换（平板双栏用），未提供则默认 router.push */
  onPickConversation?: (id: string) => void
  /** 侧边栏关闭回调，用于手机 Drawer 场景 */
  onClose?: () => void
}

/**
 * 会话列表侧边栏。
 *
 * 常规模式：
 * - 顶部：品牌 logo + 「新建对话」按钮
 * - 搜索：本地对 title 做 includes 过滤（长列表体验用户后续可换 fuzzy）
 * - 分组：置顶 / 今天 / 昨天 / 本周，同组按 updatedAt 倒序
 * - 每项 ⋮ 按钮：Alert.alert 呈现原生 ActionSheet 语义（置顶 / 重命名 / 删除）
 * - 底部：用户信息 + 设置入口 + 退出
 *
 * 多选模式（Step 7 新增）：
 * - 触发：任一行长按 → 进入 selectionMode，并把该行加入 `selected`
 * - 视觉：
 *   - 头部替换为「取消 · N 已选中 · 全选 · 删除」
 *   - 每行 pin/checkmark 位置渲染 checkbox
 * - 常规点击 → 切换选中；长按不再触发单项菜单
 * - 完成/取消 → 清空 `selected` 并退出模式；批量删除后自动退出
 *
 * 平板双栏由父组件把 `activeId` + `onPickConversation` 注入；手机 Drawer 场景
 * 由 expo-router 的 `Drawer` navigator 挂在 drawer content 里，切换会话前调用
 * `onClose` 关闭抽屉。
 */
export function ConversationList({
  activeId,
  onPickConversation,
  onClose,
}: ConversationListProps): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [search, setSearch] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const user = useAuthStore((s) => s.user)
  const { data: conversations = [] } = useConversations()
  const createConv = useCreateConversation()
  const deleteConv = useDeleteConversation()
  const deleteConvs = useDeleteConversations()
  const updateConv = useUpdateConversation()
  const { mutate: doLogout } = useLogout()

  const groups = useMemo(() => {
    const filtered = search ? conversations.filter((c) => c.title.includes(search)) : conversations
    return groupConversations(filtered)
  }, [conversations, search])

  const totalCount =
    groups.pinned.length + groups.today.length + groups.yesterday.length + groups.week.length
  const visibleIds = useMemo(
    () => [...groups.pinned, ...groups.today, ...groups.yesterday, ...groups.week].map((c) => c.id),
    [groups]
  )
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const exitSelection = (): void => {
    setSelectionMode(false)
    setSelected(new Set())
  }

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const enterSelectionWith = (id: string): void => {
    setSelectionMode(true)
    setSelected(new Set([id]))
  }

  const toggleSelectAll = (): void => {
    setSelected((prev) => {
      // 全部命中 → 反选清空；否则 → 全选可见
      if (visibleIds.every((id) => prev.has(id))) return new Set()
      return new Set(visibleIds)
    })
  }

  const handlePick = (id: string): void => {
    // 多选模式下"点击"改为切换选中；否则走原来的跳转逻辑
    if (selectionMode) {
      toggleSelect(id)
      return
    }
    onClose?.()
    if (onPickConversation) onPickConversation(id)
    else router.push(`/(main)/chat/${id}`)
  }

  const handleLongPress = (id: string, title: string, isPinned: boolean): void => {
    // 已经在多选态里：长按无操作（避免与切换选中冲突）
    if (selectionMode) return
    // 首次长按 → 进入多选，同时把该行选上
    enterSelectionWith(id)
    // 记忆锚点：如果只是想操作单项，用户可点右侧 ⋮ 走原 context menu
    void title
    void isPinned
  }

  const handleBatchDelete = (): void => {
    const ids = [...selected]
    if (ids.length === 0) return
    Alert.alert('批量删除', `确定删除已选中的 ${ids.length} 个会话？删除后不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteConvs.mutate(ids, {
            onSuccess: () => {
              // 若当前活跃会话在被删列表里，回到空态
              if (activeId && ids.includes(activeId)) router.replace('/(main)/chat')
              exitSelection()
            },
            onError: (err) => {
              Alert.alert('删除失败', err instanceof Error ? err.message : '请稍后重试')
            },
          })
        },
      },
    ])
  }

  const handleNew = async (): Promise<void> => {
    try {
      // model 默认走 web 端一致的 deepseek-v4-flash；Step 7 会实现"新对话前不建 conv、
      // 首次发送时按输入创建"的路径，届时移除这里的直接 create。
      const conv = await createConv.mutateAsync({ model: 'deepseek-v4-flash' })
      handlePick(conv.id)
    } catch (err) {
      Alert.alert('新建对话失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  const openContextMenu = (id: string, title: string, isPinned: boolean): void => {
    Alert.alert(title, undefined, [
      {
        text: isPinned ? '取消置顶' : '置顶',
        onPress: () => {
          updateConv.mutate({ id, isPinned: !isPinned })
        },
      },
      {
        text: '重命名',
        onPress: () => {
          // 简版：Alert.prompt 只在 iOS 支持；先用一个通用的 prompt 占位，
          // Step 7 UI 阶段再替换为 BottomSheet 输入框
          Alert.prompt?.(
            '重命名会话',
            '',
            (newTitle) => {
              const trimmed = newTitle?.trim()
              if (trimmed && trimmed !== title) {
                updateConv.mutate({ id, title: trimmed })
              }
            },
            'plain-text',
            title
          )
        },
      },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          Alert.alert('删除会话', '删除后不可恢复，确定要删除吗？', [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: () => {
                deleteConv.mutate(id)
                if (activeId === id) router.replace('/(main)/chat')
              },
            },
          ])
        },
      },
      { text: '取消', style: 'cancel' },
    ])
  }

  const openLogout = (): void => {
    Alert.alert('退出登录', '确认退出当前账号？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          doLogout(undefined, {
            onSettled: () => {
              router.replace('/(auth)/login')
            },
          })
        },
      },
    ])
  }

  const userInitial = user?.username?.charAt(0).toUpperCase() ?? '?'
  const userName = user?.username ?? '未登录'
  const userEmail = user?.email ?? ''

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header：常规态 / 多选态双分支 */}
      {selectionMode ? (
        <View style={styles.header}>
          <Pressable
            onPress={exitSelection}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityLabel="退出多选"
          >
            <X size={18} color={text.primary} />
          </Pressable>
          <Text style={styles.selectionCount}>{selected.size} 已选中</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={toggleSelectAll}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityLabel={allSelected ? '取消全选' : '全选'}
            >
              {allSelected ? (
                <CheckSquare size={18} color={brand.solid} />
              ) : (
                <Square size={18} color={text.primary} />
              )}
            </Pressable>
            <Pressable
              onPress={handleBatchDelete}
              disabled={selected.size === 0 || deleteConvs.isPending}
              hitSlop={8}
              style={[
                styles.iconBtn,
                (selected.size === 0 || deleteConvs.isPending) && { opacity: 0.4 },
              ]}
              accessibilityLabel="删除已选中"
            >
              <Trash2 size={18} color={border.danger} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoText}>元</Text>
            </View>
            <Text style={styles.brandName}>元AI</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={() => {
                void handleNew()
              }}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityLabel="新建对话"
            >
              <SquarePen size={18} color={text.primary} />
            </Pressable>
            {onClose ? (
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel="关闭侧边栏"
              >
                <X size={18} color={text.primary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={14} color={text.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索对话"
          placeholderTextColor={text.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!selectionMode}
        />
      </View>

      {/* Conversation groups */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        keyboardShouldPersistTaps="handled"
      >
        {totalCount === 0 ? (
          <View style={{ padding: spacing.lg, alignItems: 'center' }}>
            <Text style={{ fontSize: 13, color: text.muted }}>
              {search ? '没有匹配的对话' : '还没有对话，点右上角开始'}
            </Text>
          </View>
        ) : (
          GROUP_ORDER.map((g) => {
            const items = groups[g]
            if (items.length === 0) return null
            return (
              <View key={g} style={{ marginBottom: spacing.md }}>
                <Text style={styles.groupLabel}>{GROUP_LABEL[g]}</Text>
                {items.map((c) => {
                  const isActive = c.id === activeId
                  const isSelected = selected.has(c.id)
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => handlePick(c.id)}
                      onLongPress={() => handleLongPress(c.id, c.title, c.isPinned)}
                      style={[
                        styles.convItem,
                        isActive && !selectionMode && styles.convItemActive,
                        selectionMode && isSelected && styles.convItemSelected,
                      ]}
                    >
                      {/* 前导：多选态显示 checkbox，否则显示 pin 或占位 */}
                      {selectionMode ? (
                        isSelected ? (
                          <CheckSquare size={14} color={brand.solid} />
                        ) : (
                          <Square size={14} color={text.muted} />
                        )
                      ) : c.isPinned ? (
                        <Pin size={12} color={brand.solid} fill={brand.solid} />
                      ) : (
                        <View style={{ width: 12 }} />
                      )}
                      <Text
                        style={[styles.convTitle, isActive && styles.convTitleActive]}
                        numberOfLines={1}
                      >
                        {c.title}
                      </Text>
                      {/* 尾部：常规态显示 ⋮；多选态显示 check 指示 */}
                      {selectionMode ? (
                        <View style={styles.convMore}>
                          {isSelected ? <Check size={14} color={brand.solid} /> : null}
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => openContextMenu(c.id, c.title, c.isPinned)}
                          hitSlop={8}
                          style={styles.convMore}
                          accessibilityLabel="更多操作"
                        >
                          <MoreVertical size={14} color={text.muted} />
                        </Pressable>
                      )}
                    </Pressable>
                  )
                })}
              </View>
            )
          })
        )}
      </ScrollView>

      {/* User footer：多选态隐藏，避免误触 */}
      {selectionMode ? null : (
        <View style={styles.footer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{userInitial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {userName}
            </Text>
            {userEmail ? (
              <Text style={styles.userEmail} numberOfLines={1}>
                {userEmail}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => router.push('/(main)/settings')}
            hitSlop={6}
            style={styles.iconBtn}
            accessibilityLabel="设置"
          >
            <Settings size={16} color={text.secondary} />
          </Pressable>
          <Pressable
            onPress={openLogout}
            hitSlop={6}
            style={styles.iconBtn}
            accessibilityLabel="退出登录"
          >
            <LogOut size={16} color={text.secondary} />
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: bg.surface,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.default,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logoBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  brandName: { fontSize: 15, fontWeight: '600', color: text.primary },
  selectionCount: { fontSize: 14, fontWeight: '600', color: text.primary },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: bg.elevated,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: text.primary,
    padding: 0,
  },
  groupLabel: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    fontSize: 11,
    fontWeight: '600',
    color: text.muted,
    textTransform: 'uppercase',
  },
  convItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  convItemActive: { backgroundColor: brand.light },
  convItemSelected: { backgroundColor: brand.light },
  convTitle: { flex: 1, fontSize: 14, color: text.primary },
  convTitleActive: { color: brand.solid, fontWeight: '600' },
  convMore: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.default,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  userName: { fontSize: 13, fontWeight: '600', color: text.primary },
  userEmail: { fontSize: 11, color: text.secondary, marginTop: 1 },
})
