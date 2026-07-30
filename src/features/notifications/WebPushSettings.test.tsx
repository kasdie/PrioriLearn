// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebPushSettings } from './WebPushSettings'

function installBrowserPush(input: {
  permission?: NotificationPermission
  registration?: ServiceWorkerRegistration | null
  registered?: ServiceWorkerRegistration
}) {
  const requestPermission = vi.fn().mockResolvedValue(input.permission ?? 'granted')
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: input.permission ?? 'default', requestPermission },
  })
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(input.registration ?? null),
      register: vi.fn().mockResolvedValue(input.registered),
    },
  })
  return { requestPermission }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Notification')
  Reflect.deleteProperty(window, 'PushManager')
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('WebPushSettings', () => {
  it('explains that server configuration is required without requesting browser permission', async () => {
    const browser = installBrowserPush({})
    const api = {
      webPushStatus: vi.fn().mockResolvedValue({ configured: false, subscriptionCount: 0, consentGranted: false }),
      checkWebPushSubscription: vi.fn(),
      enableWebPush: vi.fn(),
      disableWebPush: vi.fn(),
      disableAllWebPush: vi.fn(),
    }

    render(<WebPushSettings locale="en" api={api} />)

    const toggle = await screen.findByRole('checkbox', { name: 'Notifications on this browser' })
    expect(toggle).toBeDisabled()
    expect(screen.getByText('The server has no VAPID key, so notifications are off.')).toBeVisible()
    expect(browser.requestPermission).not.toHaveBeenCalled()
  })

  it('subscribes only after the user enables the current browser', async () => {
    const fakeSubscription = {
      endpoint: 'https://push.example.test/browser-device',
      expirationTime: null,
      options: { applicationServerKey: null },
      toJSON: () => ({
        endpoint: 'https://push.example.test/browser-device',
        expirationTime: null,
        keys: { p256dh: 'browser-public-encryption-key', auth: 'browser-auth-secret' },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(fakeSubscription),
    }
    const registration = { pushManager } as unknown as ServiceWorkerRegistration
    const browser = installBrowserPush({ registered: registration })
    const enabledStatus = {
      configured: true,
      publicKey: 'AQIDBA',
      subscriptionCount: 1,
      consentGranted: true,
    }
    const api = {
      webPushStatus: vi.fn().mockResolvedValue({
        configured: true,
        publicKey: 'AQIDBA',
        subscriptionCount: 0,
        consentGranted: false,
      }),
      checkWebPushSubscription: vi.fn(),
      enableWebPush: vi.fn().mockResolvedValue(enabledStatus),
      disableWebPush: vi.fn(),
      disableAllWebPush: vi.fn(),
    }

    render(<WebPushSettings locale="en" api={api} />)
    const toggle = await screen.findByRole('checkbox', { name: 'Notifications on this browser' })
    await waitFor(() => expect(toggle).toBeEnabled())
    await userEvent.click(toggle)

    await waitFor(() => expect(api.enableWebPush).toHaveBeenCalledWith({
      endpoint: fakeSubscription.endpoint,
      expirationTime: null,
      keys: { p256dh: 'browser-public-encryption-key', auth: 'browser-auth-secret' },
    }))
    expect(browser.requestPermission).toHaveBeenCalledOnce()
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('replaces a local subscription that is not owned by the current account', async () => {
    const staleSubscription = {
      endpoint: 'https://push.example.test/previous-account',
      options: { applicationServerKey: null },
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const freshSubscription = {
      endpoint: 'https://push.example.test/current-account',
      expirationTime: null,
      options: { applicationServerKey: null },
      toJSON: () => ({
        endpoint: 'https://push.example.test/current-account',
        expirationTime: null,
        keys: { p256dh: 'current-public-key', auth: 'current-auth-secret' },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(staleSubscription),
      subscribe: vi.fn().mockResolvedValue(freshSubscription),
    }
    const registration = { pushManager } as unknown as ServiceWorkerRegistration
    installBrowserPush({ permission: 'granted', registration, registered: registration })
    const api = {
      webPushStatus: vi.fn().mockResolvedValue({
        configured: true,
        publicKey: 'AQIDBA',
        subscriptionCount: 0,
        consentGranted: false,
      }),
      checkWebPushSubscription: vi.fn().mockResolvedValue(false),
      enableWebPush: vi.fn().mockResolvedValue({
        configured: true,
        publicKey: 'AQIDBA',
        subscriptionCount: 1,
        consentGranted: true,
      }),
      disableWebPush: vi.fn(),
      disableAllWebPush: vi.fn(),
    }

    render(<WebPushSettings locale="en" api={api} />)
    const toggle = await screen.findByRole('checkbox', { name: 'Notifications on this browser' })
    await waitFor(() => expect(toggle).toBeEnabled())
    await userEvent.click(toggle)

    await waitFor(() => expect(staleSubscription.unsubscribe).toHaveBeenCalledOnce())
    expect(pushManager.subscribe).toHaveBeenCalledOnce()
    expect(api.enableWebPush).toHaveBeenCalledWith(expect.objectContaining({ endpoint: freshSubscription.endpoint }))
  })

  it('can remove an existing device even when browser permission is later denied', async () => {
    const fakeSubscription = {
      endpoint: 'https://push.example.test/blocked-device',
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: 'https://push.example.test/blocked-device' }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const registration = {
      pushManager: { getSubscription: vi.fn().mockResolvedValue(fakeSubscription) },
    } as unknown as ServiceWorkerRegistration
    installBrowserPush({ permission: 'denied', registration })
    const api = {
      webPushStatus: vi.fn().mockResolvedValue({
        configured: false,
        subscriptionCount: 1,
        consentGranted: true,
      }),
      checkWebPushSubscription: vi.fn().mockResolvedValue(true),
      enableWebPush: vi.fn(),
      disableWebPush: vi.fn().mockResolvedValue({
        configured: false,
        subscriptionCount: 0,
        consentGranted: false,
      }),
      disableAllWebPush: vi.fn(),
    }

    render(<WebPushSettings locale="en" api={api} />)

    const toggle = await screen.findByRole('checkbox', { name: 'Notifications on this browser' })
    await waitFor(() => expect(toggle).toBeChecked())
    expect(toggle).toBeEnabled()
    await userEvent.click(toggle)

    await waitFor(() => expect(api.disableWebPush).toHaveBeenCalledWith(fakeSubscription.endpoint))
    expect(fakeSubscription.unsubscribe).toHaveBeenCalledOnce()
    await waitFor(() => expect(toggle).not.toBeChecked())
  })
})
