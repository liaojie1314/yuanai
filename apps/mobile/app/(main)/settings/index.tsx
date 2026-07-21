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
import { bg, border, brand, spacing, text } from '@/theme/tokens'

/**
 * 设置首屏：个人资料卡（头像/用户名/简介直接编辑）+ 5 个子屏入口。
 */
export default function SettingsIndexScreen(): React.JSX.Element {
  const router = useRouter()
  const dialog = useDialog()
  const { data: user } = useCurrentUser()
  const { data: stats } = useMyStats()
  const updateMe = useUpdateMe()
  const uploadAvatar = useUploadAvatar()
  const [avatarBusy, setAvatarBusy] = useState(false)

  const onEditUsername = async (): Promise<void> => {
    const next = await dialog.prompt({
      title: '修改用户名',
      placeholder: '2 - 20 个字符',
      defaultValue: user?.username ?? '',
      confirmText: '保存',
      maxLength: 20,
    })
    const trimmed = next?.trim()
    if (!trimmed || trimmed === user?.username) return
    if (trimmed.length < 2) {
      void dialog.alert({ title: '用户名太短', message: '至少 2 个字符' })
      return
    }
    updateMe.mutate(
      { username: trimmed },
      {
        onError: (err) => {
          void dialog.alert({
            title: '修改失败',
            message: err instanceof Error ? err.message : '请稍后重试',
          })
        },
      }
    )
  }

  const onEditBio = async (): Promise<void> => {
    const next = await dialog.prompt({
      title: '编辑简介',
      placeholder: '介绍一下自己（80 字内）',
      defaultValue: user?.bio ?? '',
      confirmText: '保存',
      maxLength: 80,
    })
    if (next === null || next === user?.bio) return
    updateMe.mutate(
      { bio: next },
      {
        onError: (err) => {
          void dialog.alert({
            title: '修改失败',
            message: err instanceof Error ? err.message : '请稍后重试',
          })
        },
      }
    )
  }

  const onPickAvatar = async (): Promise<void> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      void dialog.alert({ title: '无相册权限', message: '请到系统设置里授权后重试' })
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
        title: '头像上传失败',
        message: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setAvatarBusy(false)
    }
  }

  const initial = user?.username?.charAt(0).toUpperCase() ?? '?'

  return (
    <SettingsShell title="设置">
      {/* 个人资料卡 */}
      <View style={styles.profileCard}>
        <Pressable
          onPress={() => {
            void onPickAvatar()
          }}
          style={styles.avatarWrap}
          accessibilityLabel="更换头像"
          disabled={avatarBusy}
        >
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Camera size={12} color="#FFFFFF" />
          </View>
        </Pressable>

        <Pressable
          onPress={() => {
            void onEditUsername()
          }}
          style={styles.nameRow}
        >
          <Text style={styles.nameText}>{user?.username ?? '—'}</Text>
          <ChevronRight size={16} color={text.muted} />
        </Pressable>
        <Text style={styles.emailText}>{user?.email ?? ''}</Text>

        <Pressable
          onPress={() => {
            void onEditBio()
          }}
          style={styles.bioRow}
        >
          <Text style={user?.bio ? styles.bioText : styles.bioPlaceholder} numberOfLines={2}>
            {user?.bio || '点这里写一句简介…'}
          </Text>
        </Pressable>

        {stats ? (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.conversationCount}</Text>
              <Text style={styles.statLabel}>会话</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.totalTokens}</Text>
              <Text style={styles.statLabel}>Tokens</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.fileCount}</Text>
              <Text style={styles.statLabel}>文件</Text>
            </View>
          </View>
        ) : null}
      </View>

      <SettingsGroup>
        <SettingsRow
          label="安全"
          icon={<Shield size={18} color={text.secondary} />}
          onPress={() => router.push('/(main)/settings/security')}
        />
        <SettingsRow
          label="外观"
          icon={<Palette size={18} color={text.secondary} />}
          onPress={() => router.push('/(main)/settings/appearance')}
        />
        <SettingsRow
          label="通知"
          icon={<Bell size={18} color={text.secondary} />}
          onPress={() => router.push('/(main)/settings/notifications')}
        />
        <SettingsRow
          label="语言"
          icon={<Globe size={18} color={text.secondary} />}
          onPress={() => router.push('/(main)/settings/language')}
        />
        <SettingsRow
          label="关于"
          icon={<Info size={18} color={text.secondary} />}
          divider={false}
          onPress={() => router.push('/(main)/settings/about')}
        />
      </SettingsGroup>

      <View style={styles.footerHint}>
        <UserIcon size={12} color={text.muted} />
        <Text style={styles.footerHintText}>注册于 {formatDate(user?.createdAt)}</Text>
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
    backgroundColor: bg.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
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
    borderColor: bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
  },
  nameText: { fontSize: 18, fontWeight: '700', color: text.primary },
  emailText: { fontSize: 13, color: text.secondary, marginTop: 2 },
  bioRow: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
  bioText: { fontSize: 13, color: text.primary, textAlign: 'center' },
  bioPlaceholder: { fontSize: 13, color: text.muted, textAlign: 'center' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: 16, fontWeight: '700', color: text.primary },
  statLabel: { fontSize: 12, color: text.muted },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: border.default },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.sm,
  },
  footerHintText: { fontSize: 12, color: text.muted },
})
