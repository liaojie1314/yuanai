import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Lock } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { useSharedConversation, useSharedMeta, useUnlockSharedConversation } from '@yuanai/core'
import type { Message } from '@yuanai/types'

import { AIMessage } from '@/components/chat/AIMessage'
import { UserMessage } from '@/components/chat/UserMessage'
import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * 匿名分享会话页：meta → 密码门 → 只读消息列表。
 * Deep link：yuanai://share/:token（useLinkingHandler 已路由到此）。
 */
export default function SharedConversationScreen(): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ token?: string }>()
  const token = typeof params.token === 'string' ? params.token : undefined

  const { data: meta, isLoading: metaLoading, error: metaError } = useSharedMeta(token)
  const needPassword = meta?.requiresPassword ?? false
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)

  const {
    data: publicData,
    isLoading: contentLoading,
    error: contentError,
  } = useSharedConversation(token, !!meta && !needPassword)

  const unlockMut = useUnlockSharedConversation(token)

  const data = unlockMut.data ?? (needPassword ? null : publicData)
  const messages: readonly Message[] = data?.messages ?? []

  const loading = metaLoading || (!needPassword && contentLoading) || unlockMut.isPending

  const goBack = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/(main)/chat')
  }

  const handleUnlock = useCallback((): void => {
    if (!password.trim()) {
      return
    }
    unlockMut.mutate(password.trim(), {
      onSuccess: () => setUnlocked(true),
    })
  }, [password, unlockMut])

  const title = data?.title ?? meta?.title ?? t('share.openInApp')
  const author = data?.authorUsername ?? meta?.authorUsername

  const renderBody = (): React.JSX.Element => {
    if (!token) {
      return <Text style={{ color: theme.text.secondary }}>{t('share.loadFailed')}</Text>
    }
    if (metaError) {
      return <Text style={{ color: theme.border.danger }}>{t('share.expired')}</Text>
    }
    if (loading) {
      return <ActivityIndicator color={theme.brand.solid} />
    }
    if (needPassword && !data && !unlocked) {
      return (
        <View style={styles.gate}>
          <Lock size={28} color={theme.brand.solid} />
          <Text style={[styles.gateTitle, { color: theme.text.primary }]}>
            {t('share.needPassword')}
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={t('share.passwordPlaceholder')}
            placeholderTextColor={theme.text.muted}
            style={[
              styles.input,
              {
                color: theme.text.primary,
                borderColor: theme.border.default,
                backgroundColor: theme.bg.surface,
              },
            ]}
            onSubmitEditing={handleUnlock}
          />
          {unlockMut.isError ? (
            <Text style={{ color: theme.border.danger }}>{t('share.unlockFailed')}</Text>
          ) : null}
          <Pressable
            onPress={handleUnlock}
            style={styles.unlockBtn}
            android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
          >
            <Text style={styles.unlockText}>{t('share.unlock')}</Text>
          </Pressable>
        </View>
      )
    }
    if (contentError && !data) {
      return <Text style={{ color: theme.border.danger }}>{t('share.expired')}</Text>
    }
    if (messages.length === 0) {
      return <Text style={{ color: theme.text.muted }}>{t('chat.emptyList')}</Text>
    }
    return (
      <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
        {messages.map((m) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} content={m.content} />
          ) : (
            <AIMessage key={m.id} content={m.content} isFirst isLast />
          )
        )}
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.bg.base }]}>
      <View style={[styles.topBar, { borderBottomColor: theme.border.default }]}>
        <Pressable
          onPress={goBack}
          hitSlop={8}
          style={styles.topBtn}
          accessibilityLabel={t('common.back')}
        >
          <ChevronLeft size={22} color={theme.text.primary} />
        </Pressable>
        <View style={styles.topCenter}>
          <Text style={[styles.topTitle, { color: theme.text.primary }]} numberOfLines={1}>
            {title}
          </Text>
          {author ? (
            <Text style={[styles.topSub, { color: theme.text.muted }]} numberOfLines={1}>
              {t('share.byAuthor', { name: author })}
            </Text>
          ) : null}
        </View>
        <View style={styles.topBtn} />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.sm,
          paddingBottom: insets.bottom + spacing.xl,
          flexGrow: 1,
          justifyContent: loading || (needPassword && !data) ? 'center' : 'flex-start',
        }}
        keyboardShouldPersistTaps="handled"
      >
        {renderBody()}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topCenter: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: 15, fontWeight: '600' },
  topSub: { fontSize: 11, marginTop: 1 },
  gate: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  gateTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  unlockBtn: {
    height: 44,
    minWidth: 160,
    borderRadius: radius.md,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  unlockText: { color: '#fff', fontWeight: '700' },
})
