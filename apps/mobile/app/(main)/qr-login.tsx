import { useLocalSearchParams, useRouter } from 'expo-router'

import { QrLoginScanner } from '@/components/auth/QrLoginScanner'

/** 已登录移动端的扫码登录路由。 */
export default function QrLoginScreen(): React.JSX.Element {
  const router = useRouter()
  const { session } = useLocalSearchParams<{ session?: string }>()

  const close = (): void => {
    router.replace('/(main)/chat')
  }

  return <QrLoginScanner key={session ?? 'initial'} onClose={close} />
}
