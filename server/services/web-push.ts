import { lookup } from 'node:dns'
import { Agent } from 'node:https'
import { BlockList, type LookupFunction } from 'node:net'
import webPush from 'web-push'
import type { AppConfig } from '../config.js'
import { isValidWebPushEndpoint, type WebPushSubscription } from '../domain/contracts.js'

// Pin outbound push DNS to public addresses so a forged endpoint cannot reach private infrastructure.
const blockedAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['100::', 64],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv6')

const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { family: options.family, hints: options.hints, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0)
      return
    }
    const blocked = addresses.some(({ address, family }) => blockedAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4'))
    if (blocked || addresses.length === 0) {
      const denied = new Error('Web push endpoint resolved to a non-public address.') as NodeJS.ErrnoException
      denied.code = 'WEB_PUSH_PRIVATE_ENDPOINT'
      callback(denied, '', 0)
      return
    }
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}

const publicWebPushAgent = new Agent({ keepAlive: true, lookup: publicLookup })

export type WebPushPayload = {
  title: string
  body: string
  url: string
  tag: string
}

export interface WebPushSender {
  readonly name: string
  readonly configured: boolean
  readonly publicKey?: string
  send(subscription: WebPushSubscription, payload: WebPushPayload): Promise<'sent' | 'expired'>
}

export class DisabledWebPushSender implements WebPushSender {
  readonly name = 'disabled'
  readonly configured = false
  readonly publicKey = undefined

  async send(): Promise<'sent'> {
    throw new Error('Web push delivery is not configured.')
  }
}

export class VapidWebPushSender implements WebPushSender {
  readonly name = 'vapid'
  readonly configured = true
  readonly publicKey: string

  constructor(private readonly config: {
    publicKey: string
    privateKey: string
    subject: string
  }) {
    if (!/^(mailto:|https:\/\/)/.test(config.subject)) {
      throw new Error('WEB_PUSH_SUBJECT must be an https URL or mailto address.')
    }
    webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
    this.publicKey = config.publicKey
  }

  async send(subscription: WebPushSubscription, payload: WebPushPayload): Promise<'sent' | 'expired'> {
    if (!isValidWebPushEndpoint(subscription.endpoint)) {
      throw new Error('Web push endpoint must use a public HTTPS host.')
    }
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expiresAt ? Date.parse(subscription.expiresAt) : null,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, JSON.stringify(payload), {
        TTL: 60 * 60,
        timeout: 10_000,
        urgency: 'normal',
        topic: payload.tag.slice(0, 32),
        agent: publicWebPushAgent,
        vapidDetails: {
          subject: this.config.subject,
          publicKey: this.config.publicKey,
          privateKey: this.config.privateKey,
        },
      })
      return 'sent'
    } catch (error) {
      if (error instanceof webPush.WebPushError && [404, 410].includes(error.statusCode)) return 'expired'
      if (error instanceof webPush.WebPushError) {
        throw new Error(`Web push provider returned ${error.statusCode}.`)
      }
      throw error
    }
  }
}

export class MemoryWebPushSender implements WebPushSender {
  readonly name = 'memory'
  readonly configured = true
  readonly publicKey = 'memory-web-push-public-key'
  readonly messages: Array<{ subscription: WebPushSubscription; payload: WebPushPayload }> = []

  async send(subscription: WebPushSubscription, payload: WebPushPayload): Promise<'sent'> {
    this.messages.push({ subscription, payload })
    return 'sent'
  }
}

export function createWebPushSender(config: Pick<
  AppConfig,
  'webPushPublicKey' | 'webPushPrivateKey' | 'webPushSubject'
>): WebPushSender {
  if (!config.webPushPublicKey || !config.webPushPrivateKey || !config.webPushSubject) {
    return new DisabledWebPushSender()
  }
  return new VapidWebPushSender({
    publicKey: config.webPushPublicKey,
    privateKey: config.webPushPrivateKey,
    subject: config.webPushSubject,
  })
}
