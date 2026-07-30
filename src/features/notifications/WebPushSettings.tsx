import { useEffect, useMemo, useState } from 'react'
import { Bell, BellOff, LoaderCircle, MonitorSmartphone } from 'lucide-react'
import {
  prioriApi,
  userFacingError,
  type ApiWebPushStatus,
  type ApiWebPushSubscriptionInput,
} from '../../lib/api'

type Locale = 'vi' | 'en'
type PushApi = Pick<
  typeof prioriApi,
  'webPushStatus' | 'checkWebPushSubscription' | 'enableWebPush' | 'disableWebPush' | 'disableAllWebPush'
>

type WebPushSettingsProps = {
  locale: Locale
  api?: PushApi
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const decoded = window.atob(base64)
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  return new Uint8Array(bytes.buffer)
}

function sameServerKey(subscription: PushSubscription, expected: Uint8Array<ArrayBuffer>): boolean {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const currentBytes = new Uint8Array(current)
  return currentBytes.length === expected.length && currentBytes.every((byte, index) => byte === expected[index])
}

function subscriptionInput(subscription: PushSubscription): ApiWebPushSubscriptionInput {
  const serialized = subscription.toJSON()
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
    throw new Error('PUSH_SUBSCRIPTION_INCOMPLETE')
  }
  return {
    endpoint: serialized.endpoint,
    expirationTime: serialized.expirationTime,
    keys: {
      p256dh: serialized.keys.p256dh,
      auth: serialized.keys.auth,
    },
  }
}

export function WebPushSettings({ locale, api = prioriApi }: WebPushSettingsProps) {
  const supported = typeof Notification !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
  const [status, setStatus] = useState<ApiWebPushStatus | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [registered, setRegistered] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (
    supported ? Notification.permission : 'unsupported'
  ))
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      setBusy(true)
      try {
        const nextStatus = await api.webPushStatus()
        let localSubscription: PushSubscription | null = null
        let currentRegistered = false
        if (supported) {
          const registration = await navigator.serviceWorker.getRegistration('/push-service-worker.js')
          localSubscription = await registration?.pushManager.getSubscription() ?? null
          if (localSubscription) currentRegistered = await api.checkWebPushSubscription(localSubscription.endpoint)
        }
        if (!active) return
        setStatus(nextStatus)
        setSubscription(localSubscription)
        setRegistered(currentRegistered)
        setPermission(supported ? Notification.permission : 'unsupported')
        setError(null)
      } catch (cause) {
        if (active) setError(userFacingError(cause, locale, locale === 'vi' ? 'Chưa thể tải trạng thái thông báo.' : 'Could not load notification status.'))
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [api, locale, supported])

  const currentEnabled = Boolean(subscription && registered)
  const otherDeviceCount = Math.max(0, (status?.subscriptionCount ?? 0) - (registered ? 1 : 0))
  const copy = useMemo(() => locale === 'vi' ? {
    title: 'Nhắc việc trên thiết bị',
    detail: 'Gửi nhiệm vụ ưu tiên mỗi ngày tới các trình duyệt bạn bật. Tiêu đề nhiệm vụ có thể hiện trên màn hình khóa.',
    toggle: 'Thông báo trên trình duyệt này',
    enabled: 'Thiết bị này đang nhận thông báo.',
    denied: 'Trình duyệt đang chặn thông báo. Hãy cho phép lại trong cài đặt trang web.',
    unsupported: 'Trình duyệt này không hỗ trợ Web Push.',
    unconfigured: 'Máy chủ chưa có VAPID key nên thông báo đang tắt.',
    otherDevices: (count: number) => `${count} thiết bị khác đang nhận thông báo.`,
    disableAll: 'Tắt trên mọi thiết bị',
    enableFailed: 'Chưa thể bật thông báo trên thiết bị này.',
    disableFailed: 'Chưa thể tắt thông báo trên thiết bị này.',
  } : {
    title: 'Device reminders',
    detail: 'Send the daily priority to browsers you enable. Task titles may appear on the lock screen.',
    toggle: 'Notifications on this browser',
    enabled: 'This device is receiving notifications.',
    denied: 'Notifications are blocked. Allow them again in this site\'s browser settings.',
    unsupported: 'This browser does not support Web Push.',
    unconfigured: 'The server has no VAPID key, so notifications are off.',
    otherDevices: (count: number) => `${count} other device${count === 1 ? ' is' : 's are'} receiving notifications.`,
    disableAll: 'Turn off on every device',
    enableFailed: 'Could not enable notifications on this device.',
    disableFailed: 'Could not disable notifications on this device.',
  }, [locale])

  const enable = async () => {
    if (busy || !supported || !status?.configured || !status.publicKey) return
    setBusy(true)
    setError(null)
    let created: PushSubscription | null = null
    try {
      const nextPermission = await Notification.requestPermission()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') {
        setError(copy.denied)
        return
      }
      const registration = await navigator.serviceWorker.register('/push-service-worker.js', { scope: '/' })
      const expectedKey = applicationServerKey(status.publicKey)
      let nextSubscription = await registration.pushManager.getSubscription()
      if (nextSubscription && (!registered || !sameServerKey(nextSubscription, expectedKey))) {
        await nextSubscription.unsubscribe()
        nextSubscription = null
      }
      if (!nextSubscription) {
        nextSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKey,
        })
        created = nextSubscription
      }
      const nextStatus = await api.enableWebPush(subscriptionInput(nextSubscription))
      setStatus(nextStatus)
      setSubscription(nextSubscription)
      setRegistered(true)
    } catch (cause) {
      if (created) await created.unsubscribe().catch(() => false)
      setError(userFacingError(cause, locale, copy.enableFailed))
    } finally {
      setBusy(false)
    }
  }

  const disableCurrent = async () => {
    if (busy || !subscription) return
    setBusy(true)
    setError(null)
    try {
      const nextStatus = await api.disableWebPush(subscription.endpoint)
      await subscription.unsubscribe().catch(() => false)
      setStatus(nextStatus)
      setSubscription(null)
      setRegistered(false)
    } catch (cause) {
      setError(userFacingError(cause, locale, copy.disableFailed))
    } finally {
      setBusy(false)
    }
  }

  const disableAll = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const nextStatus = await api.disableAllWebPush()
      if (subscription) await subscription.unsubscribe().catch(() => false)
      setStatus(nextStatus)
      setSubscription(null)
      setRegistered(false)
    } catch (cause) {
      setError(userFacingError(cause, locale, copy.disableFailed))
    } finally {
      setBusy(false)
    }
  }

  const unavailable = permission === 'denied'
    ? copy.denied
    : !supported
      ? copy.unsupported
      : status && !status.configured
        ? copy.unconfigured
        : null

  return (
    <section className="settings-panel notification-settings" aria-labelledby="web-push-title">
      <div className="settings-panel-heading">
        <div>
          <h2 id="web-push-title"><Bell size={18} /> {copy.title}</h2>
          <p>{copy.detail}</p>
        </div>
        {busy && <LoaderCircle className="inline-spinner" size={18} />}
      </div>
      <label className="permission-row notification-toggle">
        <span>
          <strong>{copy.toggle}</strong>
          <small>{currentEnabled ? copy.enabled : unavailable ?? (otherDeviceCount > 0 ? copy.otherDevices(otherDeviceCount) : '')}</small>
        </span>
        <input
          type="checkbox"
          aria-label={copy.toggle}
          checked={currentEnabled}
          disabled={busy || !status || (!currentEnabled && Boolean(unavailable))}
          onChange={(event) => void (event.target.checked ? enable() : disableCurrent())}
        />
      </label>
      {otherDeviceCount > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={() => void disableAll()}><BellOff size={16} /> {copy.disableAll}</button>}
      {error && <p className="settings-inline-error" role="alert"><MonitorSmartphone size={16} /> {error}</p>}
    </section>
  )
}
