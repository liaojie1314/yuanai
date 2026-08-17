import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Application from 'expo-application'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import { createMobileUpdateService, type MobileUpdateStatus } from '@/lib/appUpdates'

/** 关于屏：logo + 版本号 + 协议/隐私入口（v1 文案先内置弹窗展示） */
export default function AboutScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useTheme()
  const dialog = useDialog()
  const version = Application.nativeApplicationVersion ?? '—'
  const build = Application.nativeBuildVersion ?? '—'
  const updateService = useMemo(() => createMobileUpdateService(), [])
  const [updateStatus, setUpdateStatus] = useState<MobileUpdateStatus>({
    state: 'idle',
    currentVersion: version,
  })

  async function checkForUpdates(): Promise<void> {
    const next = await updateService.check()
    setUpdateStatus(next)
    if (next.state === 'error') {
      await dialog.alert({
        title: t('settings.updateErrorTitle'),
        message: next.message ?? t('settings.updateError'),
      })
    }
  }

  async function downloadUpdate(): Promise<void> {
    const next = await updateService.download()
    setUpdateStatus(next)
    if (next.state === 'error') {
      await dialog.alert({
        title: t('settings.updateErrorTitle'),
        message: next.message ?? t('settings.updateDownloadFailed'),
      })
    }
  }

  async function installUpdate(): Promise<void> {
    await updateService.install()
  }

  async function skipUpdate(): Promise<void> {
    setUpdateStatus(await updateService.skip())
  }

  function updateStatusText(): string {
    if (updateStatus.state === 'checking') return t('settings.updateChecking')
    if (updateStatus.state === 'not-available') {
      if (updateStatus.message === 'DEV_BUILD') return t('settings.updateDevBuild')
      if (updateStatus.message === 'EAS_NOT_CONFIGURED') return t('settings.updateNotConfigured')
      return t('settings.updateNotAvailable')
    }
    if (updateStatus.state === 'available') {
      return t('settings.updateAvailable', { version: updateStatus.info?.version ?? '' })
    }
    if (updateStatus.state === 'downloading') return t('settings.updateDownloading')
    if (updateStatus.state === 'downloaded') {
      return t('settings.updateDownloaded', { version: updateStatus.info?.version ?? '' })
    }
    if (updateStatus.state === 'skipped') {
      return t('settings.updateSkipped', { version: updateStatus.info?.version ?? '' })
    }
    if (updateStatus.state === 'error') return t('settings.updateError')
    return t('settings.updateIdle')
  }

  return (
    <SettingsShell title={t('settings.about')}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>元</Text>
        </View>
        <Text style={[styles.appName, { color: theme.text.primary }]}>元AI</Text>
        <Text style={[styles.version, { color: theme.text.secondary }]}>
          版本 {version} (build {build})
        </Text>
      </View>

      <SettingsGroup>
        <SettingsRow
          label={t('settings.userAgreement')}
          onPress={() => {
            void dialog.alert({
              title: t('settings.userAgreement'),
              message: t('settings.placeholderLegal'),
            })
          }}
        />
        <SettingsRow
          label={t('settings.privacyPolicy')}
          divider={false}
          onPress={() => {
            void dialog.alert({
              title: t('settings.privacyPolicy'),
              message: t('settings.placeholderLegal'),
            })
          }}
        />
      </SettingsGroup>

      <SettingsGroup label={t('settings.appUpdates')}>
        <SettingsRow
          label={t('settings.currentVersion')}
          value={version}
          sublabel={t('settings.buildVersion', { build })}
          disabled
          onPress={() => undefined}
        />
        <SettingsRow
          label={t('settings.checkForUpdates')}
          sublabel={updateStatusText()}
          disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
          onPress={() => void checkForUpdates()}
        />
        {updateStatus.state === 'available' ? (
          <SettingsRow
            label={t('settings.downloadUpdate')}
            sublabel={t('settings.updateAvailable', {
              version: updateStatus.info?.version ?? '',
            })}
            onPress={() => void downloadUpdate()}
          />
        ) : null}
        {updateStatus.state === 'downloaded' ? (
          <SettingsRow
            label={t('settings.installUpdate')}
            sublabel={t('settings.updateDownloaded', {
              version: updateStatus.info?.version ?? '',
            })}
            onPress={() => void installUpdate()}
          />
        ) : null}
        {updateStatus.state === 'available' && updateStatus.info?.canSkip ? (
          <SettingsRow
            label={t('settings.skipUpdate')}
            sublabel={t('settings.skipUpdateDescription')}
            divider={false}
            onPress={() => void skipUpdate()}
          />
        ) : null}
        {updateStatus.state === 'checking' || updateStatus.state === 'downloading' ? (
          <View style={styles.updateProgress} accessibilityLabel={updateStatusText()}>
            <ActivityIndicator color={brand.solid} />
          </View>
        ) : null}
      </SettingsGroup>

      <Text style={[styles.copyright, { color: theme.text.muted }]}>© 2026 yuanai</Text>
    </SettingsShell>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: spacing.xxl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 30, fontWeight: '700', color: '#FFFFFF' },
  appName: { fontSize: 18, fontWeight: '700', marginTop: spacing.md },
  version: { fontSize: 13, marginTop: 4 },
  copyright: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  updateProgress: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
