import { describe, expect, it } from 'vitest'
import webPush from 'web-push'
import { DisabledWebPushSender, VapidWebPushSender, createWebPushSender } from './web-push.js'

describe('web push sender configuration', () => {
  it('stays disabled when the VAPID configuration is absent', () => {
    expect(createWebPushSender({})).toBeInstanceOf(DisabledWebPushSender)
  })

  it('validates and enables a complete VAPID configuration at startup', () => {
    const keys = webPush.generateVAPIDKeys()
    const sender = createWebPushSender({
      webPushPublicKey: keys.publicKey,
      webPushPrivateKey: keys.privateKey,
      webPushSubject: 'https://priori-learn-kasdies-projects.vercel.app',
    })

    expect(sender).toBeInstanceOf(VapidWebPushSender)
    expect(sender.configured).toBe(true)
    expect(sender.publicKey).toBe(keys.publicKey)
  })

  it('rejects an invalid VAPID subject before the server starts', () => {
    const keys = webPush.generateVAPIDKeys()
    expect(() => new VapidWebPushSender({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'priorilearn',
    })).toThrow('WEB_PUSH_SUBJECT must be an https URL or mailto address.')
  })

  it('rejects a forged private endpoint before opening a network connection', async () => {
    const keys = webPush.generateVAPIDKeys()
    const sender = new VapidWebPushSender({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'https://priori-learn-kasdies-projects.vercel.app',
    })

    await expect(sender.send({
      id: 'subscription-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      endpoint: 'https://127.0.0.1/private-target',
      p256dh: 'not-used-for-a-rejected-endpoint',
      auth: 'not-used',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    }, {
      title: 'Priority',
      body: 'Study now',
      url: 'https://priori-learn-kasdies-projects.vercel.app',
      tag: 'daily-priority',
    })).rejects.toThrow('Web push endpoint must use a public HTTPS host.')
  })
})
