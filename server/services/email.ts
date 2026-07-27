import type { AppConfig } from '../config.js'
import type { AuthActionPurpose, User } from '../domain/contracts.js'

export type OutboundEmail = {
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
}

export interface EmailSender {
  readonly name: string
  readonly configured: boolean
  send(message: OutboundEmail): Promise<void>
}

export class DisabledEmailSender implements EmailSender {
  readonly name = 'disabled'
  readonly configured = false

  async send(): Promise<void> {
    throw new Error('EMAIL_DELIVERY_NOT_CONFIGURED')
  }
}

export class MemoryEmailSender implements EmailSender {
  readonly name = 'memory'
  readonly configured = true
  readonly messages: OutboundEmail[] = []

  async send(message: OutboundEmail): Promise<void> {
    this.messages.push(message)
  }
}

export class ResendEmailSender implements EmailSender {
  readonly name = 'resend'
  readonly configured = true

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: OutboundEmail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
    if (!response.ok) {
      throw new Error(`Email provider rejected the request with status ${response.status}.`)
    }
  }
}

export function createEmailSender(config: AppConfig): EmailSender {
  if (!config.resendApiKey && !config.emailFrom) return new DisabledEmailSender()
  if (!config.resendApiKey || !config.emailFrom) {
    throw new Error('RESEND_API_KEY and EMAIL_FROM must be set together.')
  }
  return new ResendEmailSender(config.resendApiKey, config.emailFrom)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function authActionUrl(appOrigin: string, purpose: AuthActionPurpose, token: string): string {
  const url = new URL('/', appOrigin)
  url.searchParams.set('authAction', purpose === 'email_verification' ? 'verify-email' : 'reset-password')
  url.searchParams.set('token', token)
  return url.toString()
}

export async function sendAuthActionEmail(input: {
  sender: EmailSender
  appOrigin: string
  user: User
  purpose: AuthActionPurpose
  token: string
  tokenHash: string
}): Promise<void> {
  const link = authActionUrl(input.appOrigin, input.purpose, input.token)
  const isVietnamese = input.user.locale === 'vi'
  const verification = input.purpose === 'email_verification'
  const subject = verification
    ? (isVietnamese ? 'Xac minh email PrioriLearn' : 'Verify your PrioriLearn email')
    : (isVietnamese ? 'Dat lai mat khau PrioriLearn' : 'Reset your PrioriLearn password')
  const instruction = verification
    ? (isVietnamese
      ? 'Mo lien ket ben duoi de xac minh dia chi email cua ban. Lien ket co hieu luc trong 24 gio.'
      : 'Open the link below to verify your email address. The link expires in 24 hours.')
    : (isVietnamese
      ? 'Mo lien ket ben duoi de dat mat khau moi. Lien ket co hieu luc trong 1 gio.'
      : 'Open the link below to choose a new password. The link expires in 1 hour.')
  const ignored = isVietnamese
    ? 'Neu ban khong yeu cau thao tac nay, hay bo qua email.'
    : 'If you did not request this action, you can ignore this email.'
  const safeName = escapeHtml(input.user.name)
  const safeLink = escapeHtml(link)

  await input.sender.send({
    to: input.user.email,
    subject,
    text: `Hi ${input.user.name},\n\n${instruction}\n\n${link}\n\n${ignored}`,
    html: `<p>Hi ${safeName},</p><p>${escapeHtml(instruction)}</p><p><a href="${safeLink}">${verification ? 'Verify email' : 'Reset password'}</a></p><p>${escapeHtml(ignored)}</p>`,
    idempotencyKey: `auth-${input.purpose}-${input.tokenHash}`,
  })
}
