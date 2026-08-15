import { ChevronLeft, ChevronRight, X } from 'lucide-react-native'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import type { ListRenderItem } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { MessageFile } from '@yuanai/types'
import { useAuthStore } from '@yuanai/core/stores'

import { getMobileImageSource } from '@/lib/filePreview'
import { spacing } from '@/theme/tokens'

interface PreviewImage {
  id: string
  filename: string
  source: ReturnType<typeof getMobileImageSource>
}

interface ActivePreview {
  images: readonly PreviewImage[]
  initialIndex: number
  key: string
}

interface ImagePreviewApi {
  /** 在全屏浏览器中打开一组同消息图片。 */
  open: (files: readonly MessageFile[], focusId: string) => void
}

const ImagePreviewContext = createContext<ImagePreviewApi | null>(null)

/**
 * 根级图片预览器。
 *
 * 不使用 React Native `Modal`，避开 Fabric 环境中动态挂载 Modal 可能塌缩为零尺寸的
 * 已知问题。它作为根布局的绝对定位 sibling，因此可从任意聊天列表项打开。
 */
export function ImagePreviewProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [active, setActive] = useState<ActivePreview | null>(null)
  const accessToken = useAuthStore((state) => state.accessToken)

  const open = useCallback(
    (files: readonly MessageFile[], focusId: string): void => {
      const images = files
        .filter((file) => isPreviewImage(file))
        .map<PreviewImage>((file) => ({
          id: file.id,
          filename: file.filename,
          source: getMobileImageSource(file, accessToken),
        }))
      const initialIndex = Math.max(
        0,
        images.findIndex((image) => image.id === focusId)
      )

      if (images.length === 0) return
      setActive({ images, initialIndex, key: `${focusId}-${Date.now()}` })
    },
    [accessToken]
  )

  return (
    <ImagePreviewContext.Provider value={{ open }}>
      {children}
      {active ? <ImagePreviewOverlay active={active} onClose={() => setActive(null)} /> : null}
    </ImagePreviewContext.Provider>
  )
}

/** 访问全局图片预览器。必须在 ImagePreviewProvider 内调用。 */
export function useImagePreview(): ImagePreviewApi {
  const context = useContext(ImagePreviewContext)
  if (!context) throw new Error('useImagePreview 必须在 ImagePreviewProvider 内使用')
  return context
}

function isPreviewImage(file: MessageFile): boolean {
  return (
    file.mimeType.toLocaleLowerCase().startsWith('image/') ||
    /\.(avif|gif|jpe?g|png|webp)$/i.test(file.filename)
  )
}

function ImagePreviewOverlay({
  active,
  onClose,
}: {
  active: ActivePreview
  onClose: () => void
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const listRef = useRef<FlatList<PreviewImage> | null>(null)
  const [index, setIndex] = useState(active.initialIndex)

  useEffect(() => {
    listRef.current?.scrollToIndex({ index, animated: true })
  }, [index])

  const renderItem = useCallback<ListRenderItem<PreviewImage>>(
    ({ item }) => (
      <View style={[styles.imagePage, { width }]}>
        <Image source={item.source} style={styles.image} resizeMode="contain" />
      </View>
    ),
    [width]
  )

  const current = active.images[index]
  const previousAvailable = index > 0
  const nextAvailable = index < active.images.length - 1

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title} numberOfLines={1}>
          {current?.filename}
        </Text>
        <Pressable
          onPress={onClose}
          style={styles.closeButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="关闭图片预览"
        >
          <X size={23} color="#FFFFFF" aria-hidden />
        </Pressable>
      </View>

      <FlatList
        key={active.key}
        ref={listRef}
        data={active.images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        renderItem={renderItem}
        initialScrollIndex={active.initialIndex}
        getItemLayout={(_data, itemIndex) => ({
          length: width,
          offset: width * itemIndex,
          index: itemIndex,
        })}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
        }}
      />

      {active.images.length > 1 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            onPress={() => setIndex((value) => value - 1)}
            disabled={!previousAvailable}
            style={[styles.pagerButton, !previousAvailable && styles.pagerButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="查看上一张图片"
            accessibilityState={{ disabled: !previousAvailable }}
          >
            <ChevronLeft size={22} color="#FFFFFF" aria-hidden />
          </Pressable>
          <Text style={styles.counter} accessibilityLiveRegion="polite">
            {index + 1} / {active.images.length}
          </Text>
          <Pressable
            onPress={() => setIndex((value) => value + 1)}
            disabled={!nextAvailable}
            style={[styles.pagerButton, !nextAvailable && styles.pagerButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="查看下一张图片"
            accessibilityState={{ disabled: !nextAvailable }}
          >
            <ChevronRight size={22} color="#FFFFFF" aria-hidden />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: '#09090B',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingRight: 62,
    justifyContent: 'center',
    backgroundColor: 'rgba(9,9,11,0.82)',
  },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  imagePage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 62 },
  image: { width: '100%', height: '100%' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(9,9,11,0.82)',
  },
  pagerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pagerButtonDisabled: { opacity: 0.35 },
  counter: {
    minWidth: 52,
    color: '#FFFFFF',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
})
