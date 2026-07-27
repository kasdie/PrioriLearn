import { describe, expect, it } from 'vitest'
import { InMemoryRepository } from '../repository.js'
import { DisabledEmailSender, MemoryEmailSender, type EmailSender } from './email.js'
import { nextDailyDigestRun, processNotificationJobs } from './digest.js'

async function readyDigestRepository() {
  const repository = new InMemoryRepository()
  await repository.seedDemo()
  const user = await repository.getDemoUser()
  await repository.saveConsent({
    id: 'digest-consent',
    tenantId: user.tenantId,
    userId: user.id,
    purpose: 'email_digest',
    granted: true,
    source: 'settings',
    createdAt: '2026-07-24T00:00:00.000Z',
  })
  return { repository, user }
}

describe('daily digest worker', () => {
  it('sends one ranked digest and schedules the next day atomically', async () => {
    const { repository, user } = await readyDigestRepository()
    const now = new Date('2026-07-24T03:05:00.000Z')
    await repository.scheduleDailyDigest(user.tenantId, user.id, '2026-07-24T03:00:00.000Z')
    const emailSender = new MemoryEmailSender()

    const result = await processNotificationJobs({
      repository,
      emailSender,
      appOrigin: 'https://app.example.test',
      now,
    })

    expect(result).toMatchObject({ configured: true, claimed: 1, sent: 1, skipped: 0 })
    expect(emailSender.messages).toHaveLength(1)
    expect(emailSender.messages[0]?.subject).toContain('Assignment 3: API design')
    expect(emailSender.messages[0]?.idempotencyKey).toBe(`daily-digest:${user.id}:2026-07-24`)
    expect(await repository.claimNotificationJobs(10, now)).toHaveLength(0)
    const tomorrow = new Date(nextDailyDigestRun(now))
    expect(await repository.claimNotificationJobs(10, tomorrow)).toHaveLength(1)
  })

  it('does not claim queued work while delivery is unconfigured', async () => {
    const { repository, user } = await readyDigestRepository()
    const now = new Date('2026-07-24T03:05:00.000Z')
    await repository.scheduleDailyDigest(user.tenantId, user.id, '2026-07-24T03:00:00.000Z')

    const disabled = await processNotificationJobs({
      repository,
      emailSender: new DisabledEmailSender(),
      appOrigin: 'https://app.example.test',
      now,
    })
    expect(disabled).toMatchObject({ configured: false, claimed: 0 })

    const enabled = await processNotificationJobs({
      repository,
      emailSender: new MemoryEmailSender(),
      appOrigin: 'https://app.example.test',
      now,
    })
    expect(enabled.sent).toBe(1)
  })

  it('retries transient provider failures without scheduling a duplicate day', async () => {
    const { repository, user } = await readyDigestRepository()
    const now = new Date('2026-07-24T03:05:00.000Z')
    await repository.scheduleDailyDigest(user.tenantId, user.id, '2026-07-24T03:00:00.000Z')
    const failingSender: EmailSender = {
      name: 'failing-test',
      configured: true,
      send: async () => {
        throw new Error('Temporary provider failure.')
      },
    }

    const result = await processNotificationJobs({
      repository,
      emailSender: failingSender,
      appOrigin: 'https://app.example.test',
      now,
    })

    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 1, failed: 0 })
    expect(await repository.claimNotificationJobs(10, now)).toHaveLength(0)
  })
})
