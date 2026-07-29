import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import {
  Bell,
  Camera,
  ChevronRight,
  Globe,
  Info,
  Palette,
  Shield,
  User as UserIcon,
} from 'lucide-react-native'
import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { useCurrentUser, useMyStats, useUpdateMe, useUploadAvatar } from '@yuanai/core'

import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * 设置首屏：个人资料卡（头像/用户名/简介直接编辑）+ 5 个子屏入口。
 */
export default function SettingsIndexScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useTheme()
  const router = useRouter()
  const dialog = useDialog()
  const { data: user } = useCurrentUser()
  const { data: stats } = useMyStats()
  const updateMe = useUpdateMe()
  const uploadAvatar = useUploadAvatar()
  const [avatarBusy, setAvatarBusy] = useState(false)

  const onEditUsername = async (): Promise<void> => {
    const next = await dialog.prompt({
      title: t('settings.editUsername'),
      placeholder: '2 - 20 个字符',
      defaultValue: user?.username ?? '',
      confirmText: t('common.save'),
      maxLength: 20,
    })
    const trimmed = next?.trim()
    if (!trimmed || trimmed === user?.username) return
    if (trimmed.length < 2) {
      void dialog.alert({
        title: t('settings.usernameTooShort'),
        message: t('settings.usernameMin'),
      })
      return
    }
    updateMe.mutate(
      { username: trimmed },
      {
        onError: (err) => {
          void dialog.alert({
            title: t('settings.updateFailed'),
            message: err instanceof Error ? err.message : t('common.retryLater'),
          })
        },
      }
    )
  }

  const onEditBio = async (): Promise<void> => {
    const next = await dialog.prompt({
      title: t('settings.editBio'),
      placeholder: t('settings.bioPlaceholder'),
      defaultValue: user?.bio ?? '',
      confirmText: t('common.save'),
      maxLength: 80,
    })
    if (next === null || next === user?.bio) return
    updateMe.mutate(
      { bio: next },
      {
        onError: (err) => {
          void dialog.alert({
            title: t('settings.updateFailed'),
            message: err instanceof Error ? err.message : t('common.retryLater'),
          })
        },
      }
    )
  }

  const onPickAvatar = async (): Promise<void> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      void dialog.alert({
        title: t('settings.noAlbumPermission'),
        message: t('settings.grantInSystem'),
      })
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    const asset = result.assets?.[0]
    if (result.canceled || !asset) return
    setAvatarBusy(true)
    try {
      // RN 的 FormData 接受 {uri,name,type} 形状；核心包签名按 Web File 声明，此处桥接
      const rnFile = {
        uri: asset.uri,
        name: asset.fileName ?? 'avatar.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as File
      await uploadAvatar.mutateAsync(rnFile)
    } catch (err) {
      void dialog.alert({
        title: t('settings.avatarFailed'),
        message: err instanceof Error ? err.message : t('common.retryLater'),
      })
    } finally {
      setAvatarBusy(false)
    }
  }

  const initial = user?.username?.charAt(0).toUpperCase() ?? '?'

  return (
    <SettingsShell title={t('settings.title')}>
      {/* 个人资料卡 */}
      <View
        style={[
          styles.profileCard,
          { backgroundColor: theme.bg.surface, borderColor: theme.border.default },
        ]}
      >
        <Pressable
          onPress={() => {
            void onPickAvatar()
          }}
          style={styles.avatarWrap}
          accessibilityLabel={t('settings.profile')}
          disabled={avatarBusy}
        >
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={[styles.avatarBadge, { borderColor: theme.bg.surface }]}>
            <Camera size={12} color="#FFFFFF" />
          </View>
        </Pressable>

        <Pressable
          onPress={() => {
            void onEditUsername()
          }}
          style={styles.nameRow}
        >
          <Text style={[styles.nameText, { color: theme.text.primary }]}>
            {user?.username ?? '—'}
          </Text>
          <ChevronRight size={16} color={theme.text.muted} />
        </Pressable>
        <Text style={[styles.emailText, { color: theme.text.secondary }]}>{user?.email ?? ''}</Text>

        <Pressable
          onPress={() => {
            void onEditBio()
          }}
          style={styles.bioRow}
        >
          <Text
            style={
              user?.bio
                ? [styles.bioText, { color: theme.text.primary }]
                : [styles.bioPlaceholder, { color: theme.text.muted }]
            }
            numberOfLines={2}
          >
            {user?.bio || t('settings.bioPlaceholder')}
          </Text>
        </Pressable>

        {stats ? (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: theme.text.primary }]}>
                {stats.conversationCount}
              </Text>
              <Text style={[styles.statLabel, { color: theme.text.muted }]}>会话</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.border.default }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: theme.text.primary }]}>
                {stats.totalTokens}
              </Text>
              <Text style={[styles.statLabel, { color: theme.text.muted }]}>Tokens</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.border.default }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: theme.text.primary }]}>{stats.fileCount}</Text>
              <Text style={[styles.statLabel, { color: theme.text.muted }]}>文件</Text>
            </View>
          </View>
        ) : null}
      </View>

      <SettingsGroup>
        <SettingsRow
          label={t('settings.security')}
          icon={<Shield size={18} color={theme.text.secondary} />}
          onPress={() => router.push('/(main)/settings/security')}
        />
        <SettingsRow
          label={t('settings.appearance')}
          icon={<Palette size={18} color={theme.text.secondary} />}
          onPress={() => router.push('/(main)/settings/appearance')}
        />
        <SettingsRow
          label={t('settings.notifications')}
          icon={<Bell size={18} color={theme.text.secondary} />}
          onPress={() => router.push('/(main)/settings/notifications')}
        />
        <SettingsRow
          label={t('settings.language')}
          icon={<Globe size={18} color={theme.text.secondary} />}
          onPress={() => router.push('/(main)/settings/language')}
        />
        <SettingsRow
          label={t('settings.about')}
          icon={<Info size={18} color={theme.text.secondary} />}
          divider={false}
          onPress={() => router.push('/(main)/settings/about')}
        />
      </SettingsGroup>

      <View style={styles.footerHint}>
        <UserIcon size={12} color={theme.text.muted} />
        <Text style={[styles.footerHintText, { color: theme.text.muted }]}>
          注册于 {formatDate(user?.createdAt)}
        </Text>
      </View>
    </SettingsShell>
  )
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  profileCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  avatarWrap: { width: 72, height: 72 },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: brand.solid,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
  },
  nameText: { fontSize: 18, fontWeight: '700' },
  emailText: { fontSize: 13, marginTop: 2 },
  bioRow: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
  bioText: { fontSize: 13, textAlign: 'center' },
  bioPlaceholder: { fontSize: 13, textAlign: 'center' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: 16, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28 },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.sm,
  },
  footerHintText: { fontSize: 12 },
})
