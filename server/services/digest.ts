import type { Course, NotificationJob, PriorityAssessment, Task, User } from '../domain/contracts.js'
import type { Repository } from '../repository.js'
import type { EmailSender } from './email.js'
import { assessPriority } from './priority.js'

type RankedDigestTask = {
  task: Task
  course: Course
  assessment: PriorityAssessment
}

export type DigestWorkerResult = {
  configured: boolean
  claimed: number
  sent: number
  skipped: number
  retried: number
  failed: number
}

export function nextDailyDigestRun(now = new Date()): string {
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

function formatDue(task: Task, user: User): string {
  if (!task.dueAt) return user.locale === 'vi' ? 'Chua co han nop' : 'No due date'
  return new Intl.DateTimeFormat(user.locale === 'vi' ? 'vi-VN' : 'en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(task.dueAt))
}

function digestEmail(input: {
  user: User
  ranked: RankedDigestTask[]
  appOrigin: string
  job: NotificationJob
}): Parameters<EmailSender['send']>[0] {
  const top = input.ranked[0]
  if (!top) throw new Error('DIGEST_REQUIRES_TASK')
  const isVietnamese = input.user.locale === 'vi'
  const subject = isVietnamese
    ? `Uu tien hom nay: ${top.task.title}`
    : `Today's priority: ${top.task.title}`
  const heading = isVietnamese ? `Chao ${input.user.name},` : `Hi ${input.user.name},`
  const intro = isVietnamese
    ? 'Day la ban tong hop tu cac task ban da xac nhan trong PrioriLearn.'
    : 'Here is your digest from the tasks you have confirmed in PrioriLearn.'
  const consequence = top.assessment.costOfDelay.message
  const textTasks = input.ranked.map(({ task, course, assessment }, index) => (
    `${index + 1}. ${task.title} (${course.name}) - ${assessment.score}/100 - ${formatDue(task, input.user)}`
  )).join('\n')
  const settingsNote = isVietnamese
    ? 'Ban co the tat email tong hop bat cu luc nao trong Settings > Data permissions.'
    : 'You can turn off digest emails at any time in Settings > Data permissions.'
  const safeAppOrigin = escapeHtml(input.appOrigin)
  const taskItems = input.ranked.map(({ task, course, assessment }) => (
    `<li><strong>${escapeHtml(task.title)}</strong> · ${escapeHtml(course.name)} · ${assessment.score}/100 · ${escapeHtml(formatDue(task, input.user))}</li>`
  )).join('')

  return {
    to: input.user.email,
    subject,
    text: `${heading}\n\n${intro}\n\n${textTasks}\n\n${consequence}\n\nOpen PrioriLearn: ${input.appOrigin}\n\n${settingsNote}`,
    html: `<p>${escapeHtml(heading)}</p><p>${escapeHtml(intro)}</p><ol>${taskItems}</ol><p><strong>${isVietnamese ? 'Chi phi tri hoan:' : 'Cost of delay:'}</strong> ${escapeHtml(consequence)}</p><p><a href="${safeAppOrigin}">${isVietnamese ? 'Mo PrioriLearn' : 'Open PrioriLearn'}</a></p><p>${escapeHtml(settingsNote)}</p>`,
    idempotencyKey: input.job.idempotencyKey,
  }
}

function latestDigestConsentGranted(
  consents: Awaited<ReturnType<Repository['listConsents']>>,
  userId: string,
): boolean {
  const latest = consents
    .filter((consent) => consent.userId === userId && consent.purpose === 'email_digest')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  return latest?.granted ?? false
}

export async function processNotificationJobs(input: {
  repository: Repository
  emailSender: EmailSender
  appOrigin: string
  batchSize?: number
  now?: Date
}): Promise<DigestWorkerResult> {
  const result: DigestWorkerResult = {
    configured: input.emailSender.configured,
    claimed: 0,
    sent: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  }
  if (!input.emailSender.configured) return result

  const now = input.now ?? new Date()
  const jobs = await input.repository.claimNotificationJobs(input.batchSize ?? 25, now)
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
      const digestEnabled = latestDigestConsentGranted(consents, user.id)
      if (!digestEnabled) {
        await input.repository.completeNotificationJob(job, {
          status: 'skipped',
          detail: 'Daily digest consent is not active.',
        }, now)
        result.skipped += 1
        continue
      }

      const nextRunAt = nextDailyDigestRun(now)
      if (!user.emailVerifiedAt) {
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
          return course ? { task, course, assessment: assessPriority(task, course) } : undefined
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

      await input.emailSender.send(digestEmail({
        user,
        ranked,
        appOrigin: input.appOrigin,
        job,
      }))
      await input.repository.completeNotificationJob(job, {
        status: 'completed',
        nextRunAt,
      }, now)
      result.sent += 1
    } catch (error) {
      const outcome = await input.repository.failNotificationJob(
        job,
        error instanceof Error ? error.message : 'Notification delivery failed.',
        now,
      )
      if (outcome === 'failed') {
        result.failed += 1
        await input.repository.scheduleDailyDigest(job.tenantId, job.userId, nextDailyDigestRun(now))
      } else {
        result.retried += 1
      }
    }
  }
  return result
}
