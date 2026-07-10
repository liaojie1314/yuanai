import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { Alert, Linking, Platform } from 'react-native'

/**
 * 通用权限请求策略：
 * - 已授权 → 直接返回 true
 * - 未询问过 → 拉起系统权限弹窗
 * - 用户之前拒绝且勾选"不再询问" → 引导跳系统设置
 *
 * `type` 决定错误弹窗文案；`request` 由调用方注入具体的 requestXxxAsync 函数。
 * 返回值仅表示"当前是否已获得权限"，不表示"是否弹了系统对话"。
 */
async function ensurePermission(params: {
  label: string
  get: () => Promise<ImagePicker.PermissionResponse>
  request: () => Promise<ImagePicker.PermissionResponse>
}): Promise<boolean> {
  const { get, request, label } = params
  const current = await get()
  if (current.status === 'granted') return true
  if (current.canAskAgain) {
    const next = await request()
    return next.status === 'granted'
  }
  Alert.alert(`${label}权限未开启`, `请到系统设置中开启元AI 的${label}权限。`, [
    { text: '取消', style: 'cancel' },
    {
      text: '去设置',
      onPress: () => {
        void Linking.openSettings()
      },
    },
  ])
  return false
}

/** 请求相机权限（拍照上传） */
export function ensureCameraPermission(): Promise<boolean> {
  return ensurePermission({
    label: '相机',
    get: () => ImagePicker.getCameraPermissionsAsync(),
    request: () => ImagePicker.requestCameraPermissionsAsync(),
  })
}

/** 请求相册（媒体库）权限 */
export function ensureMediaLibraryPermission(): Promise<boolean> {
  return ensurePermission({
    label: '相册',
    get: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    request: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
  })
}

/**
 * 请求文档选择权限。
 *
 * iOS 使用系统 UIDocumentPicker，无需运行时权限；
 * Android 通过 SAF 也不需要，DocumentPicker.getDocumentAsync 会直接工作。
 * 保留函数是为了给上层一个统一入口——将来若接入云文档（如需授权）不必改调用点。
 */
export function ensureDocumentPickerReady(): Promise<boolean> {
  // 目前平台均无需显式授权
  void DocumentPicker
  return Promise.resolve(true)
}

/** 判断当前平台是否原生支持系统级二次确认（用来选 Alert.alert vs 自定义 modal） */
export function hasNativeConfirm(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}
