import type { Course, NotificationChannel, NotificationJob, PlanningPreferences, PriorityAssessment, Task, User } from '../domain/contracts.js'
import type { Repository } from '../repository.js'
import type { EmailSender } from './email.js'
import { assessPriority } from './priority.js'
import { localDateParts, localMinuteToUtc } from './scheduler.js'
import { DisabledWebPushSender, type WebPushPayload, type WebPushSender } from './web-push.js'

type RankedDigestTask = {
  task: Task
  course: Course
  assessment: PriorityAssessment
}

export type DigestWorkerResult = {
  configured: boolean
  emailConfigured: boolean
  webPushConfigured: boolean
  claimed: number
  sent: number
  deliveries: number
  expiredSubscriptions: number
  skipped: number
  retried: number
  failed: number
}

export function nextDailyDigestRun(now = new Date(), preferences?: PlanningPreferences): string {
  if (preferences) {
    const parts = localDateParts(now, preferences)
    const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    let next = localMinuteToUtc(localDate, 9 * 60, preferences)
    if (next <= now) {
      localDate.setUTCDate(localDate.getUTCDate() + 1)
      next = localMinuteToUtc(localDate, 9 * 60, preferences)
    }
    return next.toISOString()
  }
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    3,
    0,
    0,
    0,
  ))
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
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

function formatDue(task: Task, user: User, timezone?: string): string {
  if (!task.dueAt) return user.locale === 'vi' ? 'Chưa có hạn nộp' : 'No due date'
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone ?? 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat(user.locale === 'vi' ? 'vi-VN' : 'en-US', options).format(new Date(task.dueAt))
  } catch {
    return new Intl.DateTimeFormat(user.locale === 'vi' ? 'vi-VN' : 'en-US', { ...options, timeZone: 'UTC' }).format(new Date(task.dueAt))
  }
}

function digestEmail(input: {
  user: User
  ranked: RankedDigestTask[]
  appOrigin: string
  job: NotificationJob
  timezone?: string
}): Parameters<EmailSender['send']>[0] {
  const top = input.ranked[0]
  if (!top) throw new Error('DIGEST_REQUIRES_TASK')
  const isVietnamese = input.user.locale === 'vi'
  const subject = isVietnamese
    ? `Ưu tiên hôm nay: ${top.task.title}`
    : `Today's priority: ${top.task.title}`
  const heading = isVietnamese ? `Chào ${input.user.name},` : `Hi ${input.user.name},`
  const intro = isVietnamese
    ? 'Đây là bản tổng hợp từ các nhiệm vụ bạn đã xác nhận trong PrioriLearn.'
    : 'Here is your digest from the tasks you have confirmed in PrioriLearn.'
  const consequence = top.assessment.costOfDelay.message
  const textTasks = input.ranked.map(({ task, course, assessment }, index) => (
    `${index + 1}. ${task.title} (${course.name}) - ${assessment.score}/100 - ${formatDue(task, input.user, input.timezone)}`
  )).join('\n')
  const settingsNote = isVietnamese
    ? 'Bạn có thể tắt bản tổng hợp bất cứ lúc nào trong Cài đặt > Quyền dữ liệu.'
    : 'You can turn off digest emails at any time in Settings > Data permissions.'
  const safeAppOrigin = escapeHtml(input.appOrigin)
  const taskItems = input.ranked.map(({ task, course, assessment }) => (
    `<li><strong>${escapeHtml(task.title)}</strong> · ${escapeHtml(course.name)} · ${assessment.score}/100 · ${escapeHtml(formatDue(task, input.user, input.timezone))}</li>`
  )).join('')

  return {
    to: input.user.email,
    subject,
    text: `${heading}\n\n${intro}\n\n${textTasks}\n\n${consequence}\n\nOpen PrioriLearn: ${input.appOrigin}\n\n${settingsNote}`,
    html: `<p>${escapeHtml(heading)}</p><p>${escapeHtml(intro)}</p><ol>${taskItems}</ol><p><strong>${isVietnamese ? 'Chi phí trì hoãn:' : 'Cost of delay:'}</strong> ${escapeHtml(consequence)}</p><p><a href="${safeAppOrigin}">${isVietnamese ? 'Mở PrioriLearn' : 'Open PrioriLearn'}</a></p><p>${escapeHtml(settingsNote)}</p>`,
    idempotencyKey: input.job.idempotencyKey,
  }
}

function digestPush(input: {
  user: User
  ranked: RankedDigestTask[]
  appOrigin: string
  job: NotificationJob
  timezone?: string
}): WebPushPayload {
  const top = input.ranked[0]
  if (!top) throw new Error('DIGEST_REQUIRES_TASK')
  const isVietnamese = input.user.locale === 'vi'
  return {
    title: isVietnamese ? `Ưu tiên hôm nay: ${top.task.title}` : `Today's priority: ${top.task.title}`,
    body: `${top.course.name} · ${top.assessment.score}/100 · ${formatDue(top.task, input.user, input.timezone)}`,
    url: input.appOrigin,
    tag: `priori-digest-${input.job.digestDate.replaceAll('-', '')}`,
  }
}

function latestDigestConsentGranted(
  consents: Awaited<ReturnType<Repository['listConsents']>>,
  userId: string,
  purpose: 'email_digest' | 'web_push',
): boolean {
  const latest = consents
    .filter((consent) => consent.userId === userId && consent.purpose === purpose)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  return latest?.granted ?? false
}

export async function processNotificationJobs(input: {
  repository: Repository
  emailSender: EmailSender
  webPushSender?: WebPushSender
  appOrigin: string
  batchSize?: number
  now?: Date
}): Promise<DigestWorkerResult> {
  const webPushSender = input.webPushSender ?? new DisabledWebPushSender()
  const configuredChannels: NotificationChannel[] = []
  if (input.emailSender.configured) configuredChannels.push('email')
  if (webPushSender.configured) configuredChannels.push('web_push')
  const result: DigestWorkerResult = {
    configured: configuredChannels.length > 0,
    emailConfigured: input.emailSender.configured,
    webPushConfigured: webPushSender.configured,
    claimed: 0,
    sent: 0,
    deliveries: 0,
    expiredSubscriptions: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  }
  if (configuredChannels.length === 0) return result

  const now = input.now ?? new Date()
  const jobs = await input.repository.claimNotificationJobs(input.batchSize ?? 25, now, configuredChannels)
  result.claimed = jobs.length

  for (const job of jobs) {
    try {
      const user = await input.repository.getUser(job.tenantId, job.userId)
      if (!user) {
        await input.repository.completeNotificationJob(job, {
          status: 'skipped',
          detail: 'User no longer exists.',
        }, now)
        result.skipped += 1
        continue
      }

      const consents = await input.repository.listConsents(job.tenantId)
      const planningPreferences = await input.repository.getPlanningPreferences(job.tenantId, user.id)
      const purpose = job.channel === 'email' ? 'email_digest' : 'web_push'
      const digestEnabled = latestDigestConsentGranted(consents, user.id, purpose)
      if (!digestEnabled) {
        await input.repository.completeNotificationJob(job, {
          status: 'skipped',
          detail: `${job.channel} digest consent is not active.`,
        }, now)
        result.skipped += 1
        continue
      }

      const nextRunAt = nextDailyDigestRun(now, planningPreferences)
      if (job.channel === 'email' && !user.emailVerifiedAt) {
        await input.repository.completeNotificationJob(job, {
          status: 'skipped',
          detail: 'Email is not verified.',
          nextRunAt,
        }, now)
        result.skipped += 1
        continue
      }

      const [tasks, courses] = await Promise.all([
        input.repository.listTasks(job.tenantId),
        input.repository.listCourses(job.tenantId),
      ])
      const courseById = new Map(courses.map((course) => [course.id, course]))
      const ranked = tasks
        .filter((task) => task.status === 'confirmed')
        .map((task): RankedDigestTask | undefined => {
          const course = courseById.get(task.courseId)
          return course ? { task, course, assessment: assessPriority(task, course, now, user.locale) } : undefined
        })
        .filter((item): item is RankedDigestTask => Boolean(item))
        .sort((left, right) => right.assessment.score - left.assessment.score)
        .slice(0, 3)

      if (ranked.length === 0) {
        await input.repository.completeNotificationJob(job, {
          status: 'skipped',
          detail: 'No confirmed tasks are available.',
          nextRunAt,
        }, now)
        result.skipped += 1
        continue
      }

      let deliveries = 0
      if (job.channel === 'email') {
        await input.emailSender.send(digestEmail({
          user,
          ranked,
          appOrigin: input.appOrigin,
          job,
          timezone: planningPreferences?.timezone,
        }))
        deliveries = 1
      } else {
        const subscriptions = await input.repository.listPushSubscriptions(job.tenantId, job.userId)
        for (const subscription of subscriptions) {
          const outcome = await webPushSender.send(subscription, digestPush({
            user,
            ranked,
            appOrigin: input.appOrigin,
            job,
            timezone: planningPreferences?.timezone,
          }))
          if (outcome === 'expired') {
            await input.repository.deletePushSubscription(job.tenantId, job.userId, subscription.endpoint)
            result.expiredSubscriptions += 1
          } else {
            deliveries += 1
          }
        }
        if (deliveries === 0) {
          await input.repository.completeNotificationJob(job, {
            status: 'skipped',
            detail: 'No active browser subscriptions are available.',
          }, now)
          result.skipped += 1
          continue
        }
      }
      await input.repository.completeNotificationJob(job, {
        status: 'completed',
        nextRunAt,
      }, now)
      result.sent += 1
      result.deliveries += deliveries
    } catch (error) {
      const outcome = await input.repository.failNotificationJob(
        job,
        error instanceof Error ? error.message : 'Notification delivery failed.',
        now,
      )
      if (outcome === 'failed') {
        result.failed += 1
        await input.repository.scheduleDailyDigest(job.tenantId, job.userId, nextDailyDigestRun(now), job.channel)
      } else {
        result.retried += 1
      }
    }
  }
  return result
}
