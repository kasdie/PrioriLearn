import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { PostgresRepository } from './postgres-repository.js'
import { provisionRuntimeRole } from './db/runtime-role.js'
import { runMigrations } from './db/migrations-runner.js'
import { hashPassword, verifyPassword } from './lib/auth.js'
import { assertSafeTestDatabaseUrl, resetTestSchema, runtimeDatabaseUrl } from './test/postgres.js'

const postgresTestsEnabled = process.env.PRIORILEARN_POSTGRES_TESTS === 'true'
const runtimePassword = 'priorilearn-runtime-test-password'

describe.skipIf(!postgresTestsEnabled)('PostgresRepository tenant boundary', () => {
  let migratorUrl: URL
  let runtimeUrl: string
  let repository: PostgresRepository

  beforeAll(async () => {
    const configuredUrl = process.env.DATABASE_URL_TEST
    if (!configuredUrl) throw new Error('DATABASE_URL_TEST is required for PostgreSQL integration tests.')
    migratorUrl = assertSafeTestDatabaseUrl(configuredUrl)
    await resetTestSchema(migratorUrl.toString())
    await runMigrations({ connectionString: migratorUrl.toString() })
    await provisionRuntimeRole(migratorUrl.toString(), runtimePassword)
    runtimeUrl = runtimeDatabaseUrl(migratorUrl, runtimePassword)
    repository = new PostgresRepository(runtimeUrl)
  }, 30_000)

  afterAll(async () => {
    await repository?.close()
  })

  test('runtime role is least privilege and every tenant table is forced through RLS', async () => {
    const admin = new pg.Client({ connectionString: migratorUrl.toString() })
    await admin.connect()
    try {
      const role = await admin.query<{ rolinherit: boolean; rolbypassrls: boolean }>(
        'SELECT rolinherit, rolbypassrls FROM pg_roles WHERE rolname = $1',
        ['priorilearn_api'],
      )
      expect(role.rows[0]).toEqual({ rolinherit: false, rolbypassrls: false })

      const tables = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
        `SELECT relname, relforcerowsecurity
         FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations'`,
      )
      expect(tables.rows.length).toBeGreaterThan(10)
      expect(tables.rows.every((table) => table.relforcerowsecurity)).toBe(true)
    } finally {
      await admin.end()
    }
  })

  test('bounded auth bootstrap restores only the supplied email or session hash', async () => {
    const alice = await repository.createPersonalAccount({
      email: 'alice@example.test',
      password: 'alice-password',
      name: 'Alice',
      locale: 'en',
    })
    await repository.createPersonalAccount({
      email: 'bob@example.test',
      password: 'bob-password',
      name: 'Bob',
      locale: 'en',
    })

    expect((await repository.findUserByEmail('alice@example.test'))?.id).toBe(alice.id)
    expect(await repository.findUserByEmail('unknown@example.test')).toBeUndefined()

    const token = await repository.createSession(alice)
    const restored = await repository.resolveSession(token)
    expect(restored?.user.id).toBe(alice.id)
    expect(restored?.tenant.id).toBe(alice.tenantId)
    expect(await repository.resolveSession('not-a-real-session')).toBeUndefined()
  })

  test('missing and wrong tenant context cannot read or create tenant data', async () => {
    const alice = await repository.findUserByEmail('alice@example.test')
    const bob = await repository.findUserByEmail('bob@example.test')
    if (!alice || !bob) throw new Error('Test users were not created.')

    const course = await repository.createCourse(alice.tenantId, {
      code: 'RLS101',
      name: 'Tenant isolation',
      currentScore: null,
      targetScore: null,
    })
    expect(await repository.getCourse(bob.tenantId, course.id)).toBeUndefined()

    const runtime = new pg.Client({ connectionString: runtimeUrl })
    await runtime.connect()
    try {
      const withoutTenant = await runtime.query<{ count: string }>('SELECT count(*) FROM courses')
      expect(withoutTenant.rows[0]?.count).toBe('0')

      await expect(runtime.query("INSERT INTO tenants (kind, name) VALUES ('personal', 'No context')"))
        .rejects.toMatchObject({ code: '42501' })

      await runtime.query('BEGIN')
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [bob.tenantId])
      const wrongTenant = await runtime.query<{ count: string }>('SELECT count(*) FROM courses WHERE id = $1', [course.id])
      expect(wrongTenant.rows[0]?.count).toBe('0')
      await runtime.query('ROLLBACK')
    } finally {
      await runtime.end()
    }
  })

  test('logout revokes the persisted session', async () => {
    const alice = await repository.findUserByEmail('alice@example.test')
    if (!alice) throw new Error('Test user was not created.')
    const token = await repository.createSession(alice)

    expect(await repository.resolveSession(token)).toBeDefined()
    expect(await repository.revokeSession(token)).toBe(true)
    expect(await repository.resolveSession(token)).toBeUndefined()
  })

  test('email action tokens are tenant-scoped, one-time, and revoke sessions after reset', async () => {
    const user = await repository.createPersonalAccount({
      email: 'email-actions@example.test',
      password: 'old-password',
      name: 'Email Actions',
      locale: 'en',
    })
    const verificationHash = `verify-${randomUUID()}`
    await repository.createAuthActionToken(
      user,
      'email_verification',
      verificationHash,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const verified = await repository.verifyEmailWithToken(verificationHash)
    expect(verified?.emailVerifiedAt).toBeDefined()
    expect(await repository.verifyEmailWithToken(verificationHash)).toBeUndefined()

    const oldSession = await repository.createSession(verified ?? user)
    const resetHash = `reset-${randomUUID()}`
    await repository.createAuthActionToken(
      verified ?? user,
      'password_reset',
      resetHash,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const newPasswordHash = await hashPassword('new-password')
    const reset = await repository.resetPasswordWithToken(resetHash, newPasswordHash)
    expect(reset && await verifyPassword('new-password', reset.passwordHash)).toBe(true)
    expect(await repository.resolveSession(oldSession)).toBeUndefined()
    expect(await repository.resetPasswordWithToken(resetHash, newPasswordHash)).toBeUndefined()
  })

  test('notification jobs claim once and atomically schedule the next digest', async () => {
    const user = await repository.createPersonalAccount({
      email: 'digest-queue@example.test',
      password: 'digest-password',
      name: 'Digest Queue',
      locale: 'en',
    })
    const scheduled = await repository.scheduleDailyDigest(
      user.tenantId,
      user.id,
      '2020-01-01T03:00:00.000Z',
    )
    const duplicate = await repository.scheduleDailyDigest(
      user.tenantId,
      user.id,
      '2020-01-01T03:00:00.000Z',
    )
    expect(duplicate.id).toBe(scheduled.id)

    const claims = await Promise.all([
      repository.claimNotificationJobs(10),
      repository.claimNotificationJobs(10),
    ])
    const claimed = claims.flat().filter((job) => job.id === scheduled.id)
    expect(claimed).toHaveLength(1)
    const job = claimed[0]
    if (!job) throw new Error('Expected the digest job to be claimed.')
    await repository.completeNotificationJob(job, {
      status: 'completed',
      nextRunAt: '2020-01-02T03:00:00.000Z',
    })

    const next = (await repository.claimNotificationJobs(10))
      .find((candidate) => candidate.userId === user.id && candidate.digestDate === '2020-01-02')
    expect(next).toBeDefined()
  })

  test('concurrent plan transitions preserve one pending and one active version', async () => {
    const alice = await repository.findUserByEmail('alice@example.test')
    const bob = await repository.findUserByEmail('bob@example.test')
    if (!alice || !bob) throw new Error('Test users were not created.')
    const course = await repository.createCourse(alice.tenantId, {
      code: 'PLAN101', name: 'Plan transactions', currentScore: 60, targetScore: 80,
    })
    const task = await repository.createTask(alice.tenantId, {
      courseId: course.id,
      title: 'Review transaction locks',
      dueAt: '2026-07-25T10:00:00.000Z',
      gradeWeight: 20,
      estimatedMinutes: 45,
      status: 'confirmed',
      sourceKind: 'manual',
      confidence: 1,
      evidence: [],
    })
    const input = {
      rationale: 'Concurrent proposal test.',
      items: [{
        id: randomUUID(),
        taskId: task.id,
        startsAt: '2026-07-21T09:00:00.000Z',
        endsAt: '2026-07-21T09:45:00.000Z',
        minutes: 45,
        firstStep: 'Open the repository.',
        rationale: 'Highest impact confirmed task.',
      }],
    }

    const bobCourse = await repository.createCourse(bob.tenantId, {
      code: 'FOREIGN101', name: 'Foreign tenant task', currentScore: null, targetScore: null,
    })
    const bobTask = await repository.createTask(bob.tenantId, {
      courseId: bobCourse.id,
      title: 'Must not cross tenant boundary',
      dueAt: null,
      gradeWeight: null,
      estimatedMinutes: 30,
      status: 'confirmed',
      sourceKind: 'manual',
      confidence: 1,
      evidence: [],
    })
    await expect(repository.createPlanProposal(alice.tenantId, {
      ...input,
      items: input.items.map((item) => ({ ...item, taskId: bobTask.id })),
    })).rejects.toMatchObject({ code: '23503' })

    const proposals = await Promise.all([
      repository.createPlanProposal(alice.tenantId, input),
      repository.createPlanProposal(alice.tenantId, input),
    ])
    expect(new Set(proposals.map((plan) => plan.id)).size).toBe(1)

    const proposal = proposals[0]
    if (!proposal) throw new Error('Proposal was not created.')
    await Promise.all([
      repository.approvePlan(alice.tenantId, proposal.id, proposal.version, 'approval-receipt-one'),
      repository.approvePlan(alice.tenantId, proposal.id, proposal.version, 'approval-receipt-two'),
    ])

    const pending = await repository.createPlanProposal(alice.tenantId, {
      ...input,
      items: proposal.items,
    })
    const replacement = await repository.replacePlanProposal(alice.tenantId, pending.id, pending.version, {
      ...input,
      items: pending.items,
    })
    expect(replacement.items.map((item) => item.id)).not.toEqual(pending.items.map((item) => item.id))
    const current = await repository.getCurrentPlan(alice.tenantId)
    expect(current.active?.id).toBe(proposal.id)
    expect(current.pending?.id).toBe(replacement.id)
    expect(current.pending?.version).toBeGreaterThan(current.active?.version ?? 0)
  })

  test('document uploads and confirmations are idempotent under real transaction locks', async () => {
    const alice = await repository.findUserByEmail('alice@example.test')
    if (!alice) throw new Error('Test user was not created.')
    const id = randomUUID()
    const document = {
      id,
      tenantId: alice.tenantId,
      filename: 'syllabus.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      storageKey: `${alice.tenantId}/${id}`,
      status: 'uploading' as const,
      idempotencyKey: 'postgres-document-idempotency',
      createdAt: '2026-07-20T09:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
    const started = await repository.beginDocumentUpload(document)
    const retried = await repository.beginDocumentUpload({ ...document, id: randomUUID(), storageKey: `${alice.tenantId}/different-key` })
    expect(started.created).toBe(true)
    expect(retried).toMatchObject({ created: false, document: { id } })

    const extraction = {
      courses: [{ code: 'TXN101', name: 'Import transactions', currentScore: null, targetScore: 85, confidence: .9, evidence: ['Line 1'] }],
      tasks: [{ courseCode: 'TXN101', title: 'Confirm once', dueAt: null, gradeWeight: 20, estimatedMinutes: 30, confidence: .9, evidence: ['Line 2'] }],
      warnings: [],
    }
    await repository.saveDocument({ ...started.document, status: 'review', extraction })
    const [first, second] = await Promise.all([
      repository.confirmDocumentImport(alice.tenantId, id, extraction),
      repository.confirmDocumentImport(alice.tenantId, id, extraction),
    ])
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))
    expect((await repository.listTasks(alice.tenantId)).filter((task) => task.sourceDocumentId === id)).toHaveLength(1)

    const page = await repository.listDocumentsPage(alice.tenantId, { limit: 1 })
    expect(page.items).toHaveLength(1)
  })

  test('extraction jobs claim once and commit the review draft with the lease', async () => {
    const user = await repository.createPersonalAccount({
      email: 'extraction-queue@example.test',
      password: 'extraction-password',
      name: 'Extraction Queue',
      locale: 'en',
    })
    const id = randomUUID()
    const upload = await repository.beginDocumentUpload({
      id,
      tenantId: user.tenantId,
      filename: 'queued.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `${user.tenantId}/${id}`,
      status: 'uploading',
      idempotencyKey: `extraction-${id}`,
      createdAt: '2026-07-24T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    await repository.saveDocument({ ...upload.document, status: 'uploaded' })
    const queued = await repository.enqueueDocumentExtraction(user.tenantId, id)
    const duplicate = await repository.enqueueDocumentExtraction(user.tenantId, id)
    expect(duplicate.job.id).toBe(queued.job.id)
    expect(duplicate.document.status).toBe('extracting')

    const claims = await Promise.all([
      repository.claimExtractionJobs(10),
      repository.claimExtractionJobs(10),
    ])
    const claimed = claims.flat().filter((job) => job.id === queued.job.id)
    expect(claimed).toHaveLength(1)
    const job = claimed[0]
    if (!job) throw new Error('Expected the extraction job to be claimed.')
    const extraction = {
      courses: [{ code: 'QUEUE101', name: 'Queue safety', currentScore: null, targetScore: 80, confidence: .9, evidence: ['Course row'] }],
      tasks: [{ courseCode: 'QUEUE101', title: 'Commit once', dueAt: null, gradeWeight: 20, estimatedMinutes: 30, confidence: .9, evidence: ['Task row'] }],
      warnings: [],
    }
    const reviewed = await repository.completeExtractionJob(job, extraction, 'integration-test')
    expect(reviewed).toMatchObject({ status: 'review', extractionProvider: 'integration-test' })
    await expect(repository.completeExtractionJob(job, extraction, 'integration-test'))
      .rejects.toMatchObject({ code: 'EXTRACTION_LEASE_CONFLICT' })
  })

  test('planning preferences are versioned and isolated by tenant RLS', async () => {
    const owner = await repository.createPersonalAccount({
      email: 'planning-owner@example.test',
      password: 'planning-password',
      name: 'Planning Owner',
      locale: 'vi',
    })
    const other = await repository.createPersonalAccount({
      email: 'planning-other@example.test',
      password: 'planning-password',
      name: 'Planning Other',
      locale: 'en',
    })
    const saved = await repository.updatePlanningPreferences(owner.tenantId, owner.id, 0, {
      locale: 'vi',
      coachMode: 'focus',
      dailyMinutes: 90,
      timezone: 'Asia/Ho_Chi_Minh',
      utcOffsetMinutes: 420,
      windows: [{ dayOfWeek: 1, startMinute: 1140, endMinute: 1260 }],
    })
    expect(saved.version).toBe(1)
    expect(await repository.getPlanningPreferences(other.tenantId, owner.id)).toBeUndefined()
    await expect(repository.updatePlanningPreferences(owner.tenantId, owner.id, 0, {
      locale: 'vi',
      coachMode: 'gentle',
      dailyMinutes: 60,
      timezone: 'Asia/Ho_Chi_Minh',
      utcOffsetMinutes: 420,
      windows: [{ dayOfWeek: 2, startMinute: 1140, endMinute: 1200 }],
    })).rejects.toMatchObject({ code: 'PLANNING_PREFERENCES_VERSION_CONFLICT' })
  })

  test('the lifecycle claim capability leases a tenant job and schedules a retry', async () => {
    const alice = await repository.findUserByEmail('alice@example.test')
    if (!alice) throw new Error('Test user was not created.')
    const id = randomUUID()
    await repository.beginDocumentUpload({
      id,
      tenantId: alice.tenantId,
      filename: 'expired.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      storageKey: `${alice.tenantId}/${id}`,
      status: 'uploading',
      idempotencyKey: 'postgres-lifecycle-idempotency',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-02T00:00:00.000Z',
    })
    const claimed = await repository.claimLifecycleJobs(25)
    const job = claimed.find((candidate) => candidate.resourceId === id)
    if (!job) throw new Error('Expected the document lifecycle job to be claimed.')
    expect(job).toMatchObject({ kind: 'document_raw_delete', status: 'leased', tenantId: alice.tenantId })
    await expect(repository.failLifecycleJob(job, 'Object store unavailable.')).resolves.toBe('retrying')
    expect((await repository.claimLifecycleJobs(25)).some((candidate) => candidate.id === job.id)).toBe(false)
  })
})
