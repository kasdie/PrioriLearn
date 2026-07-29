import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import type {
  AccountDeletionReceipt,
  AuthActionPurpose,
  AvailabilityBlock,
  CoachCheckIn,
  ConsentAudit,
  Course,
  DocumentExtraction,
  ExtractionJob,
  ImportDraft,
  LearnerProfile,
  LearnerProfileSignal,
  LifecycleJob,
  NotificationJob,
  PlanningPreferences,
  PriorityAssessment,
  ReplanProposal,
  SourceDocument,
  StudyPlan,
  Task,
  Tenant,
  User,
} from './domain/contracts.js'
import { createSessionToken, hashPassword } from './lib/auth.js'
import {
  RepositoryError,
  type AuthSession,
  type CursorPage,
  type DocumentPageInput,
  type CurrentPlan,
  type DocumentImportResult,
  type DocumentUploadResult,
  type IcsImportResult,
  type PlanProposalInput,
  type PlanningPreferencesInput,
  type Repository,
} from './repository.js'

type Row = Record<string, unknown>
type ProductEvent = {
  id: string
  tenantId: string
  userId: string
  name: string
  properties: Record<string, unknown>
  createdAt: string
}

const afterHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()
const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex')

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  throw new Error('Database returned an invalid timestamp.')
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

function rowTenant(row: Row): Tenant {
  return { id: String(row.id), kind: row.kind as Tenant['kind'], name: String(row.name), createdAt: iso(row.created_at) }
}

function rowUser(row: Row): User {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : undefined,
    googleSubject: row.google_subject ? String(row.google_subject) : undefined,
    passwordHash: String(row.password_hash),
    name: String(row.name),
    locale: row.locale as User['locale'],
    role: row.role as User['role'],
    createdAt: iso(row.created_at),
  }
}

function rowLearnerProfile(row: Row): LearnerProfile {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    approvedSignals: json<LearnerProfileSignal[]>(row.approved_signals, []),
    sourceEventCount: Number(row.source_event_count),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function rowPlanningPreferences(row: Row): PlanningPreferences {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    locale: row.locale as PlanningPreferences['locale'],
    coachMode: row.coach_mode as PlanningPreferences['coachMode'],
    dailyMinutes: Number(row.daily_minutes),
    timezone: String(row.timezone),
    utcOffsetMinutes: Number(row.utc_offset_minutes),
    windows: json<PlanningPreferences['windows']>(row.windows, []),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function rowCourse(row: Row): Course {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    code: String(row.code),
    name: String(row.name),
    currentScore: numberOrNull(row.current_score),
    targetScore: numberOrNull(row.target_score),
    sourceDocumentId: row.source_document_id ? String(row.source_document_id) : undefined,
    createdAt: iso(row.created_at),
  }
}

function rowTask(row: Row): Task {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    courseId: String(row.course_id),
    sourceDocumentId: row.source_document_id ? String(row.source_document_id) : undefined,
    sourceImportDraftId: row.source_import_draft_id ? String(row.source_import_draft_id) : undefined,
    title: String(row.title),
    dueAt: row.due_at ? iso(row.due_at) : null,
    gradeWeight: numberOrNull(row.grade_weight),
    estimatedMinutes: Number(row.estimated_minutes),
    status: row.status as Task['status'],
    sourceKind: row.source_kind as Task['sourceKind'],
    confidence: Number(row.confidence),
    evidence: json<string[]>(row.evidence, []),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function rowDocument(row: Row): SourceDocument {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storageKey: String(row.storage_key),
    status: row.status as SourceDocument['status'],
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    extraction: row.extraction ? json<DocumentExtraction>(row.extraction, { courses: [], tasks: [], warnings: [] }) : undefined,
    extractionProvider: row.extraction_provider ? String(row.extraction_provider) : undefined,
    expiresAt: iso(row.expires_at),
    rawDeletedAt: row.raw_deleted_at ? iso(row.raw_deleted_at) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at ? iso(row.updated_at) : iso(row.created_at),
  }
}

function rowAvailabilityBlock(row: Row): AvailabilityBlock {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    title: String(row.title),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    sourceKind: row.source_kind as AvailabilityBlock['sourceKind'],
    sourceImportDraftId: row.source_import_draft_id ? String(row.source_import_draft_id) : undefined,
    createdAt: iso(row.created_at),
  }
}

function rowLifecycleJob(row: Row): LifecycleJob {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    kind: row.kind as LifecycleJob['kind'],
    resourceId: String(row.resource_id),
    storageKey: row.storage_key ? String(row.storage_key) : undefined,
    receiptId: row.receipt_id ? String(row.receipt_id) : undefined,
    status: row.status as LifecycleJob['status'],
    attempts: Number(row.attempts),
    runAt: iso(row.run_at),
    leaseToken: row.lease_token ? String(row.lease_token) : undefined,
    leasedUntil: row.leased_until ? iso(row.leased_until) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function rowNotificationJob(row: Row): NotificationJob {
  const digestDate = dateOnly(row.digest_date)
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    kind: row.kind as NotificationJob['kind'],
    digestDate,
    status: row.status as NotificationJob['status'],
    attempts: Number(row.attempts),
    runAt: iso(row.run_at),
    leaseToken: row.lease_token ? String(row.lease_token) : undefined,
    leasedUntil: row.leased_until ? iso(row.leased_until) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : undefined,
  }
}

function rowExtractionJob(row: Row): ExtractionJob {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    documentId: String(row.document_id),
    status: row.status as ExtractionJob['status'],
    attempts: Number(row.attempts),
    runAt: iso(row.run_at),
    leaseToken: row.lease_token ? String(row.lease_token) : undefined,
    leasedUntil: row.leased_until ? iso(row.leased_until) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : undefined,
  }
}

function dailyDigestIdentity(userId: string, runAt: string): { runAt: string; digestDate: string; idempotencyKey: string } {
  const parsed = new Date(runAt)
  if (Number.isNaN(parsed.getTime())) throw new Error('INVALID_NOTIFICATION_RUN_AT')
  const normalized = parsed.toISOString()
  const digestDate = normalized.slice(0, 10)
  return {
    runAt: normalized,
    digestDate,
    idempotencyKey: `daily-digest:${userId}:${digestDate}`,
  }
}

function rowPlan(row: Row, items: StudyPlan['items']): StudyPlan {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    version: Number(row.version),
    status: row.status as StudyPlan['status'],
    previousPlanId: row.previous_plan_id ? String(row.previous_plan_id) : undefined,
    rationale: String(row.rationale),
    items,
    schedulingWarnings: json<StudyPlan['schedulingWarnings']>(row.scheduling_warnings, []),
    createdAt: iso(row.created_at),
    approvedAt: row.approved_at ? iso(row.approved_at) : undefined,
  }
}

export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool
  private demoUserId?: string

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  private async oneOrUndefined(client: pg.PoolClient, query: string, values: unknown[] = []): Promise<Row | undefined> {
    const result = await client.query<Row>(query, values)
    return result.rows[0]
  }

  private async withSettings<T>(settings: Record<string, string>, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const [name, value] of Object.entries(settings)) {
        await client.query('SELECT set_config($1, $2, true)', [name, value])
      }
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private withTenant<T>(tenantId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    return this.withSettings({ 'app.tenant_id': tenantId }, work)
  }

  private async listPlanItems(client: pg.PoolClient, tenantId: string, planIds: string[]): Promise<Map<string, StudyPlan['items']>> {
    if (planIds.length === 0) return new Map()
    const result = await client.query<Row>(
      `SELECT id, plan_id, task_id, starts_at, ends_at, minutes, first_step, rationale
       FROM plan_items
       WHERE tenant_id = $1 AND plan_id = ANY($2::uuid[])
       ORDER BY plan_id, position`,
      [tenantId, planIds],
    )
    const items = new Map<string, StudyPlan['items']>()
    for (const row of result.rows) {
      const planId = String(row.plan_id)
      const planItems = items.get(planId) ?? []
      planItems.push({
        id: String(row.id), taskId: String(row.task_id), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
        minutes: Number(row.minutes), firstStep: String(row.first_step), rationale: String(row.rationale),
      })
      items.set(planId, planItems)
    }
    return items
  }

  private async insertPlan(client: pg.PoolClient, plan: StudyPlan): Promise<void> {
    await client.query(
      `INSERT INTO study_plans (id, tenant_id, version, status, previous_plan_id, rationale, scheduling_warnings, approval_receipt_hash, created_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [plan.id, plan.tenantId, plan.version, plan.status, plan.previousPlanId ?? null, plan.rationale, JSON.stringify(plan.schedulingWarnings), plan.approvalReceipt ? hashSessionToken(plan.approvalReceipt) : null, plan.createdAt, plan.approvedAt ?? null],
    )
    for (const [position, item] of plan.items.entries()) {
      await client.query(
        'INSERT INTO plan_items (id, tenant_id, plan_id, task_id, starts_at, ends_at, minutes, first_step, rationale, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [item.id, plan.tenantId, plan.id, item.taskId, item.startsAt, item.endsAt, item.minutes, item.firstStep, item.rationale, position],
      )
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async seedDemo(): Promise<void> {
    const existing = await this.findUserByEmail('mai@demo.priorilearn.app')
    if (existing) {
      this.demoUserId = existing.id
      return
    }

    const user = await this.createPersonalAccount({
      email: 'mai@demo.priorilearn.app', password: 'demo-priorilearn', name: 'Mai Nguyen', locale: 'vi',
    })
    await this.markEmailVerified(user.tenantId, user.id)
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date().toISOString()
    this.demoUserId = user.id
    const programming = await this.createCourse(user.tenantId, { code: 'CS304', name: 'Programming', currentScore: 54, targetScore: 78 })
    const marketing = await this.createCourse(user.tenantId, { code: 'MKT201', name: 'Marketing', currentScore: 62, targetScore: 75 })
    const statistics = await this.createCourse(user.tenantId, { code: 'STA210', name: 'Statistics', currentScore: 71, targetScore: 78 })
    await Promise.all([
      this.createTask(user.tenantId, { courseId: programming.id, title: 'Assignment 3: API design', dueAt: afterHours(47), gradeWeight: 30, estimatedMinutes: 45, sourceKind: 'demo', status: 'confirmed', confidence: 0.98, evidence: ['Assignment brief: 30% of course grade'] }),
      this.createTask(user.tenantId, { courseId: marketing.id, title: 'Research quiz 04', dueAt: afterHours(25), gradeWeight: 5, estimatedMinutes: 25, sourceKind: 'demo', status: 'confirmed', confidence: 0.94, evidence: ['Syllabus week 6 assessment table'] }),
      this.createTask(user.tenantId, { courseId: statistics.id, title: 'Week 6 problem set', dueAt: afterHours(76), gradeWeight: 10, estimatedMinutes: 60, sourceKind: 'demo', status: 'confirmed', confidence: 0.91, evidence: ['Course calendar week 6'] }),
    ])
  }

  async createPersonalAccount(input: { email: string; password: string; name: string; locale: 'vi' | 'en'; googleSubject?: string }): Promise<User> {
    const tenantId = randomUUID()
    try {
      const passwordHash = await hashPassword(input.password)
      return await this.withTenant(tenantId, async (client) => {
        await client.query('INSERT INTO tenants (id, kind, name) VALUES ($1, $2, $3)', [tenantId, 'personal', input.name])
        const user = await client.query<Row>(
          'INSERT INTO users (tenant_id, email, password_hash, name, locale, role, google_subject, email_verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
          [tenantId, input.email.trim().toLowerCase(), passwordHash, input.name, input.locale, 'student', input.googleSubject ?? null, input.googleSubject ? new Date().toISOString() : null],
        )
        const created = user.rows[0]
        if (!created) throw new Error('ACCOUNT_CREATION_FAILED')
        return rowUser(created)
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new Error('EMAIL_EXISTS')
      throw error
    }
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const normalizedEmail = email.trim().toLowerCase()
    return this.withSettings({ 'app.auth_email': normalizedEmail }, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [normalizedEmail])
      return row ? rowUser(row) : undefined
    })
  }

  async findUserByGoogleSubject(googleSubject: string): Promise<User | undefined> {
    return this.withSettings({ 'app.auth_google_subject': googleSubject }, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM users WHERE google_subject = $1 AND deleted_at IS NULL', [googleSubject])
      return row ? rowUser(row) : undefined
    })
  }

  async getUser(tenantId: string, userId: string): Promise<User | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(
        client,
        'SELECT * FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [userId, tenantId],
      )
      return row ? rowUser(row) : undefined
    })
  }

  async updateUserLocale(tenantId: string, userId: string, locale: User['locale']): Promise<User | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(
        client,
        `UPDATE users SET locale = $3
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [userId, tenantId, locale],
      )
      return row ? rowUser(row) : undefined
    })
  }

  async linkGoogleSubject(tenantId: string, userId: string, googleSubject: string): Promise<User | undefined> {
    try {
      return await this.withTenant(tenantId, async (client) => {
        const row = await this.oneOrUndefined(
          client,
          `UPDATE users
           SET google_subject = $3,
               email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
             AND (google_subject IS NULL OR google_subject = $3)
           RETURNING *`,
          [userId, tenantId, googleSubject],
        )
        return row ? rowUser(row) : undefined
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new Error('GOOGLE_SUBJECT_EXISTS')
      throw error
    }
  }

  async markEmailVerified(tenantId: string, userId: string): Promise<User | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(
        client,
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, now())
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [userId, tenantId],
      )
      return row ? rowUser(row) : undefined
    })
  }

  async createAuthActionToken(
    user: User,
    purpose: AuthActionPurpose,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    await this.withTenant(user.tenantId, async (client) => {
      await client.query(
        `UPDATE auth_action_tokens
         SET consumed_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND purpose = $3 AND consumed_at IS NULL`,
        [user.tenantId, user.id, purpose],
      )
      await client.query(
        `INSERT INTO auth_action_tokens (tenant_id, user_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.tenantId, user.id, purpose, tokenHash, expiresAt],
      )
    })
  }

  async verifyEmailWithToken(tokenHash: string): Promise<User | undefined> {
    return this.withSettings({ 'app.auth_action_hash': tokenHash }, async (client) => {
      const token = await this.oneOrUndefined(
        client,
        `SELECT tenant_id, user_id
         FROM auth_action_tokens
         WHERE token_hash = $1 AND purpose = 'email_verification'
           AND consumed_at IS NULL AND expires_at > now()`,
        [tokenHash],
      )
      if (!token) return undefined
      const tenantId = String(token.tenant_id)
      const userId = String(token.user_id)
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
      const consumed = await client.query(
        `UPDATE auth_action_tokens
         SET consumed_at = now()
         WHERE token_hash = $1 AND tenant_id = $2 AND user_id = $3
           AND consumed_at IS NULL AND expires_at > now()`,
        [tokenHash, tenantId, userId],
      )
      if ((consumed.rowCount ?? 0) === 0) return undefined
      const row = await this.oneOrUndefined(
        client,
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, now())
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [userId, tenantId],
      )
      return row ? rowUser(row) : undefined
    })
  }

  async resetPasswordWithToken(tokenHash: string, passwordHash: string): Promise<User | undefined> {
    return this.withSettings({ 'app.auth_action_hash': tokenHash }, async (client) => {
      const token = await this.oneOrUndefined(
        client,
        `SELECT tenant_id, user_id
         FROM auth_action_tokens
         WHERE token_hash = $1 AND purpose = 'password_reset'
           AND consumed_at IS NULL AND expires_at > now()`,
        [tokenHash],
      )
      if (!token) return undefined
      const tenantId = String(token.tenant_id)
      const userId = String(token.user_id)
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
      const consumed = await client.query(
        `UPDATE auth_action_tokens
         SET consumed_at = now()
         WHERE token_hash = $1 AND tenant_id = $2 AND user_id = $3
           AND consumed_at IS NULL AND expires_at > now()`,
        [tokenHash, tenantId, userId],
      )
      if ((consumed.rowCount ?? 0) === 0) return undefined
      const row = await this.oneOrUndefined(
        client,
        `UPDATE users
         SET password_hash = $3,
             email_verified_at = COALESCE(email_verified_at, now())
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [userId, tenantId, passwordHash],
      )
      if (!row) return undefined
      await client.query(
        `UPDATE auth_sessions
         SET revoked_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [tenantId, userId],
      )
      return rowUser(row)
    })
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL', [tenantId])
      return row ? rowTenant(row) : undefined
    })
  }

  async getDemoUser(): Promise<User> {
    if (!this.demoUserId) await this.seedDemo()
    const user = await this.findUserByEmail('mai@demo.priorilearn.app')
    if (!user) throw new Error('DEMO_NOT_SEEDED')
    this.demoUserId = user.id
    return user
  }

  async createSession(user: User): Promise<string> {
    const token = createSessionToken()
    await this.withTenant(user.tenantId, async (client) => {
      await client.query(
        'INSERT INTO auth_sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
        [user.tenantId, user.id, hashSessionToken(token), new Date(Date.now() + 7 * 24 * 3_600_000).toISOString()],
      )
    })
    return token
  }

  async resolveSession(token: string): Promise<AuthSession | undefined> {
    const tokenHash = hashSessionToken(token)
    return this.withSettings({ 'app.session_hash': tokenHash }, async (client) => {
      const session = await this.oneOrUndefined(
        client,
        'SELECT tenant_id, user_id FROM auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()',
        [tokenHash],
      )
      if (!session) return undefined

      const tenantId = String(session.tenant_id)
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
      const row = await this.oneOrUndefined(
        client,
        `SELECT u.id AS user_id, u.tenant_id AS user_tenant_id, u.email, u.email_verified_at, u.google_subject,
          u.password_hash, u.name AS user_name, u.locale, u.role, u.created_at AS user_created_at,
          t.id AS tenant_id, t.kind, t.name AS tenant_name, t.created_at AS tenant_created_at
         FROM auth_sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = s.tenant_id
         WHERE s.token_hash = $1 AND s.user_id = $2 AND s.tenant_id = $3
           AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL AND t.deleted_at IS NULL`,
        [tokenHash, String(session.user_id), tenantId],
      )
      if (!row) return undefined
      return {
        user: {
          id: String(row.user_id),
          tenantId: String(row.user_tenant_id),
          email: String(row.email),
          emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : undefined,
          googleSubject: row.google_subject ? String(row.google_subject) : undefined,
          passwordHash: String(row.password_hash),
          name: String(row.user_name),
          locale: row.locale as User['locale'],
          role: row.role as User['role'],
          createdAt: iso(row.user_created_at),
        },
        tenant: { id: String(row.tenant_id), kind: row.kind as Tenant['kind'], name: String(row.tenant_name), createdAt: iso(row.tenant_created_at) },
      }
    })
  }

  async revokeSession(token: string): Promise<boolean> {
    const tokenHash = hashSessionToken(token)
    return this.withSettings({ 'app.session_hash': tokenHash }, async (client) => {
      const session = await this.oneOrUndefined(client, 'SELECT tenant_id FROM auth_sessions WHERE token_hash = $1', [tokenHash])
      if (!session) return false
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(session.tenant_id)])
      const result = await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash])
      return (result.rowCount ?? 0) > 0
    })
  }

  async createCourse(tenantId: string, input: Pick<Course, 'code' | 'name' | 'currentScore' | 'targetScore'> & { sourceDocumentId?: string }): Promise<Course> {
    return this.withTenant(tenantId, async (client) => {
      const existing = await this.oneOrUndefined(client, 'SELECT * FROM courses WHERE tenant_id = $1 AND lower(code) = lower($2)', [tenantId, input.code])
      if (existing) return rowCourse(existing)
      const result = await client.query<Row>(
        'INSERT INTO courses (tenant_id, code, name, current_score, target_score, source_document_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING *',
        [tenantId, input.code, input.name, input.currentScore, input.targetScore, input.sourceDocumentId ?? null],
      )
      const row = result.rows[0]
      if (!row) throw new Error('COURSE_CREATION_FAILED')
      return rowCourse(row)
    })
  }

  async getCourse(tenantId: string, courseId: string): Promise<Course | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM courses WHERE id = $1 AND tenant_id = $2', [courseId, tenantId])
      return row ? rowCourse(row) : undefined
    })
  }

  async listCourses(tenantId: string): Promise<Course[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT * FROM courses WHERE tenant_id = $1 ORDER BY created_at', [tenantId])
      return result.rows.map(rowCourse)
    })
  }

  async createTask(tenantId: string, input: Pick<Task, 'courseId' | 'title' | 'dueAt' | 'gradeWeight' | 'estimatedMinutes' | 'status' | 'sourceKind' | 'confidence' | 'evidence'> & { sourceDocumentId?: string; sourceImportDraftId?: string }): Promise<Task> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `INSERT INTO tasks (tenant_id, course_id, source_document_id, source_import_draft_id, title, due_at, grade_weight, estimated_minutes, status, source_kind, confidence, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [tenantId, input.courseId, input.sourceDocumentId ?? null, input.sourceImportDraftId ?? null, input.title, input.dueAt, input.gradeWeight, input.estimatedMinutes, input.status, input.sourceKind, input.confidence, JSON.stringify(input.evidence)],
      )
      const row = result.rows[0]
      if (!row) throw new Error('TASK_CREATION_FAILED')
      return rowTask(row)
    })
  }

  async getTask(tenantId: string, taskId: string): Promise<Task | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM tasks WHERE id = $1 AND tenant_id = $2', [taskId, tenantId])
      return row ? rowTask(row) : undefined
    })
  }

  async listTasks(tenantId: string): Promise<Task[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT * FROM tasks WHERE tenant_id = $1 ORDER BY due_at NULLS LAST, created_at', [tenantId])
      return result.rows.map(rowTask)
    })
  }

  async listTasksPage(tenantId: string, input: DocumentPageInput): Promise<CursorPage<Task>> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT * FROM tasks
         WHERE tenant_id = $1
           AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz
             OR (created_at = $2::timestamptz AND id < $3::uuid))
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [tenantId, input.before?.createdAt ?? null, input.before?.id ?? null, input.limit + 1],
      )
      const rows = result.rows.map(rowTask)
      const items = rows.slice(0, input.limit)
      const last = items.at(-1)
      return { items, next: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : undefined }
    })
  }

  async updateTask(tenantId: string, taskId: string, patch: Partial<Task>): Promise<Task | undefined> {
    const has = (key: keyof Task) => Object.prototype.hasOwnProperty.call(patch, key)
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `UPDATE tasks SET
          course_id = CASE WHEN $3 THEN $4 ELSE course_id END,
          title = CASE WHEN $5 THEN $6 ELSE title END,
          due_at = CASE WHEN $7 THEN $8 ELSE due_at END,
          grade_weight = CASE WHEN $9 THEN $10 ELSE grade_weight END,
          estimated_minutes = CASE WHEN $11 THEN $12 ELSE estimated_minutes END,
          status = CASE WHEN $13 THEN $14 ELSE status END,
          updated_at = now()
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [taskId, tenantId, has('courseId'), patch.courseId ?? null, has('title'), patch.title ?? null, has('dueAt'), patch.dueAt ?? null, has('gradeWeight'), patch.gradeWeight ?? null, has('estimatedMinutes'), patch.estimatedMinutes ?? null, has('status'), patch.status ?? null],
      )
      const row = result.rows[0]
      return row ? rowTask(row) : undefined
    })
  }

  async beginDocumentUpload(document: SourceDocument): Promise<DocumentUploadResult> {
    if (!document.idempotencyKey) throw new Error('DOCUMENT_IDEMPOTENCY_KEY_REQUIRED')
    return this.withTenant(document.tenantId, async (client) => {
      const inserted = await client.query<Row>(
        `INSERT INTO source_documents (
           id, tenant_id, filename, mime_type, size_bytes, storage_key, status, idempotency_key,
           extraction, extraction_provider, expires_at, raw_deleted_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          document.id, document.tenantId, document.filename, document.mimeType, document.sizeBytes,
          document.storageKey, document.status, document.idempotencyKey,
          document.extraction ? JSON.stringify(document.extraction) : null, document.extractionProvider ?? null,
          document.expiresAt, document.rawDeletedAt ?? null, document.createdAt,
        ],
      )
      const createdRow = inserted.rows[0]
      if (createdRow) {
        await client.query(
          `INSERT INTO lifecycle_jobs (
             tenant_id, kind, resource_id, storage_key, status, run_at, idempotency_key
           ) VALUES ($1, 'document_raw_delete', $2, $3, 'pending', $4, $5)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [document.tenantId, document.id, document.storageKey, document.expiresAt, `document:${document.id}:raw-delete`],
        )
        return { document: rowDocument(createdRow), created: true }
      }

      const existing = await this.oneOrUndefined(
        client,
        'SELECT * FROM source_documents WHERE tenant_id = $1 AND idempotency_key = $2',
        [document.tenantId, document.idempotencyKey],
      )
      if (!existing) throw new Error('DOCUMENT_UPLOAD_RESUME_FAILED')
      return { document: rowDocument(existing), created: false }
    })
  }

  async saveDocument(document: SourceDocument): Promise<SourceDocument> {
    return this.withTenant(document.tenantId, async (client) => {
      const result = await client.query<Row>(
        `INSERT INTO source_documents (id, tenant_id, filename, mime_type, size_bytes, storage_key, status, idempotency_key, extraction, extraction_provider, expires_at, raw_deleted_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (id) DO UPDATE SET filename = EXCLUDED.filename, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, storage_key = EXCLUDED.storage_key,
           status = EXCLUDED.status, idempotency_key = COALESCE(EXCLUDED.idempotency_key, source_documents.idempotency_key), extraction = EXCLUDED.extraction,
           extraction_provider = EXCLUDED.extraction_provider, expires_at = EXCLUDED.expires_at, raw_deleted_at = EXCLUDED.raw_deleted_at, updated_at = now()
         WHERE source_documents.tenant_id = EXCLUDED.tenant_id RETURNING *`,
        [document.id, document.tenantId, document.filename, document.mimeType, document.sizeBytes, document.storageKey, document.status, document.idempotencyKey ?? null, document.extraction ? JSON.stringify(document.extraction) : null, document.extractionProvider ?? null, document.expiresAt, document.rawDeletedAt ?? null, document.createdAt],
      )
      const row = result.rows[0]
      if (!row) throw new Error('DOCUMENT_SAVE_FAILED')
      return rowDocument(row)
    })
  }

  async getDocument(tenantId: string, documentId: string): Promise<SourceDocument | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM source_documents WHERE id = $1 AND tenant_id = $2', [documentId, tenantId])
      return row ? rowDocument(row) : undefined
    })
  }

  async listDocuments(tenantId: string): Promise<SourceDocument[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT * FROM source_documents WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId])
      return result.rows.map(rowDocument)
    })
  }

  async listDocumentsPage(tenantId: string, input: DocumentPageInput): Promise<CursorPage<SourceDocument>> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT * FROM source_documents
         WHERE tenant_id = $1
           AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz
             OR (created_at = $2::timestamptz AND id < $3::uuid))
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [tenantId, input.before?.createdAt ?? null, input.before?.id ?? null, input.limit + 1],
      )
      const rows = result.rows.map(rowDocument)
      const items = rows.slice(0, input.limit)
      const last = items.at(-1)
      return { items, next: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : undefined }
    })
  }

  async listExpiredDocuments(_now: Date): Promise<SourceDocument[]> {
    throw new Error('Cross-tenant document scans require the lifecycle queue claim function.')
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<SourceDocument | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('DELETE FROM source_documents WHERE id = $1 AND tenant_id = $2 RETURNING *', [documentId, tenantId])
      const row = result.rows[0]
      return row ? rowDocument(row) : undefined
    })
  }

  async enqueueDocumentExtraction(
    tenantId: string,
    documentId: string,
  ): Promise<{ job: ExtractionJob; document: SourceDocument }> {
    return this.withTenant(tenantId, async (client) => {
      const documentRow = await this.oneOrUndefined(
        client,
        'SELECT * FROM source_documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [documentId, tenantId],
      )
      if (!documentRow) throw new RepositoryError('DOCUMENT_NOT_FOUND', 'Document was not found.')

      let jobRow = await this.oneOrUndefined(
        client,
        'SELECT * FROM extraction_jobs WHERE tenant_id = $1 AND document_id = $2 FOR UPDATE',
        [tenantId, documentId],
      )
      if (!jobRow) {
        const inserted = await client.query<Row>(
          `INSERT INTO extraction_jobs (
             tenant_id, document_id, status, attempts, run_at, idempotency_key
           ) VALUES ($1, $2, 'pending', 0, now(), $3)
           RETURNING *`,
          [tenantId, documentId, `document-extraction:${documentId}`],
        )
        jobRow = inserted.rows[0]
      } else if (jobRow.status === 'failed') {
        jobRow = await this.oneOrUndefined(
          client,
          `UPDATE extraction_jobs
           SET status = 'pending', attempts = 0, run_at = now(), lease_token = NULL,
               leased_until = NULL, last_error = NULL, completed_at = NULL, updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING *`,
          [jobRow.id, tenantId],
        )
      }
      if (!jobRow) throw new Error('EXTRACTION_JOB_CREATION_FAILED')

      let queuedDocumentRow = documentRow
      if (documentRow.status !== 'review' && documentRow.status !== 'confirmed') {
        queuedDocumentRow = await this.oneOrUndefined(
          client,
          `UPDATE source_documents
           SET status = 'extracting', updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING *`,
          [documentId, tenantId],
        ) ?? documentRow
      }
      return { job: rowExtractionJob(jobRow), document: rowDocument(queuedDocumentRow) }
    })
  }

  async claimExtractionJobs(batchSize: number): Promise<ExtractionJob[]> {
    const result = await this.pool.query<Row>(
      'SELECT * FROM private.claim_due_extraction_jobs($1)',
      [batchSize],
    )
    return result.rows.map(rowExtractionJob)
  }

  async completeExtractionJob(
    job: ExtractionJob,
    extraction: DocumentExtraction,
    provider: string,
    completedAt = new Date(),
  ): Promise<SourceDocument> {
    return this.withTenant(job.tenantId, async (client) => {
      const current = await this.oneOrUndefined(
        client,
        `SELECT id FROM extraction_jobs
         WHERE id = $1 AND tenant_id = $2 AND status = 'leased' AND lease_token = $3
         FOR UPDATE`,
        [job.id, job.tenantId, job.leaseToken ?? null],
      )
      if (!current) throw new RepositoryError('EXTRACTION_LEASE_CONFLICT', 'The extraction job lease is no longer current.')
      const document = await this.oneOrUndefined(
        client,
        `UPDATE source_documents
         SET status = 'review', extraction = $3, extraction_provider = $4, updated_at = $5
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [job.documentId, job.tenantId, JSON.stringify(extraction), provider, completedAt.toISOString()],
      )
      if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 'Document was not found.')
      await client.query(
        `UPDATE extraction_jobs
         SET status = 'completed', lease_token = NULL, leased_until = NULL,
             last_error = NULL, updated_at = $4, completed_at = $4
         WHERE id = $1 AND tenant_id = $2 AND lease_token = $3`,
        [job.id, job.tenantId, job.leaseToken ?? null, completedAt.toISOString()],
      )
      return rowDocument(document)
    })
  }

  async failExtractionJob(
    job: ExtractionJob,
    message: string,
    retryable: boolean,
    failedAt = new Date(),
  ): Promise<'retrying' | 'failed'> {
    return this.withTenant(job.tenantId, async (client) => {
      const result = await client.query<Row>(
        `UPDATE extraction_jobs
         SET status = CASE WHEN NOT $4 OR attempts >= 5 THEN 'failed' ELSE 'pending' END,
             run_at = CASE WHEN NOT $4 OR attempts >= 5
               THEN run_at
               ELSE $5::timestamptz + make_interval(mins => LEAST(30, power(2, LEAST(attempts, 5))::int))
             END,
             lease_token = NULL, leased_until = NULL, last_error = $6, updated_at = $5,
             completed_at = CASE WHEN NOT $4 OR attempts >= 5 THEN $5 ELSE NULL END
         WHERE id = $1 AND tenant_id = $2 AND status = 'leased' AND lease_token = $3
         RETURNING status`,
        [job.id, job.tenantId, job.leaseToken ?? null, retryable, failedAt.toISOString(), message.slice(0, 1_000)],
      )
      if ((result.rowCount ?? 0) !== 1) {
        throw new RepositoryError('EXTRACTION_LEASE_CONFLICT', 'The extraction job lease is no longer current.')
      }
      const failed = result.rows[0]?.status === 'failed'
      if (failed) {
        await client.query(
          `UPDATE source_documents
           SET status = 'extraction_failed', updated_at = $3
           WHERE id = $1 AND tenant_id = $2`,
          [job.documentId, job.tenantId, failedAt.toISOString()],
        )
      }
      return failed ? 'failed' : 'retrying'
    })
  }

  async confirmDocumentImport(tenantId: string, documentId: string, extraction: DocumentExtraction): Promise<DocumentImportResult> {
    return this.withTenant(tenantId, async (client) => {
      const documentRow = await this.oneOrUndefined(
        client,
        'SELECT * FROM source_documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [documentId, tenantId],
      )
      if (!documentRow) throw new RepositoryError('DOCUMENT_NOT_FOUND', 'Document was not found.')
      const document = rowDocument(documentRow)

      if (document.status === 'confirmed') {
        const taskRows = await client.query<Row>(
          'SELECT * FROM tasks WHERE tenant_id = $1 AND source_document_id = $2 ORDER BY created_at',
          [tenantId, documentId],
        )
        const tasks = taskRows.rows.map(rowTask)
        const courseIds = [...new Set(tasks.map((task) => task.courseId))]
        const courseRows = await client.query<Row>(
          `SELECT * FROM courses
           WHERE tenant_id = $1 AND (source_document_id = $2 OR id = ANY($3::uuid[]))
           ORDER BY created_at`,
          [tenantId, documentId, courseIds],
        )
        return { document, courses: courseRows.rows.map(rowCourse), tasks }
      }
      if (document.status !== 'review') {
        throw new RepositoryError('EXTRACTION_NOT_READY', 'Extract and review this document before confirming it.')
      }

      const courses: Course[] = []
      const courseByCode = new Map<string, Course>()
      for (const extracted of extraction.courses) {
        const normalizedCode = extracted.code.toLowerCase()
        if (courseByCode.has(normalizedCode)) continue
        const existing = await this.oneOrUndefined(
          client,
          'SELECT * FROM courses WHERE tenant_id = $1 AND lower(code) = lower($2)',
          [tenantId, extracted.code],
        )
        let course = existing ? rowCourse(existing) : undefined
        if (!course) {
          const inserted = await client.query<Row>(
            `INSERT INTO courses (tenant_id, code, name, current_score, target_score, source_document_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code
             RETURNING *`,
            [tenantId, extracted.code, extracted.name, extracted.currentScore, extracted.targetScore, documentId],
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('COURSE_CREATION_FAILED')
          course = rowCourse(row)
        }
        courses.push(course)
        courseByCode.set(normalizedCode, course)
      }

      let fallbackCourse = courses[0]
      if (!fallbackCourse) {
        const inserted = await client.query<Row>(
          `INSERT INTO courses (tenant_id, code, name, current_score, target_score, source_document_id)
           VALUES ($1, $2, 'Imported course', NULL, NULL, $3)
           ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code
           RETURNING *`,
          [tenantId, `DOC-${documentId.slice(0, 6)}`, documentId],
        )
        const row = inserted.rows[0]
        if (!row) throw new Error('COURSE_CREATION_FAILED')
        fallbackCourse = rowCourse(row)
        courses.push(fallbackCourse)
      }

      const tasks: Task[] = []
      for (const task of extraction.tasks) {
        const result = await client.query<Row>(
          `INSERT INTO tasks (
             tenant_id, course_id, source_document_id, title, due_at, grade_weight,
             estimated_minutes, status, source_kind, confidence, evidence
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'document', $8, $9)
           RETURNING *`,
          [
            tenantId, courseByCode.get(task.courseCode.toLowerCase())?.id ?? fallbackCourse.id,
            documentId, task.title, task.dueAt, task.gradeWeight, task.estimatedMinutes,
            task.confidence, JSON.stringify(task.evidence),
          ],
        )
        const row = result.rows[0]
        if (!row) throw new Error('TASK_CREATION_FAILED')
        tasks.push(rowTask(row))
      }

      const confirmed = await client.query<Row>(
        `UPDATE source_documents
         SET extraction = $3, status = 'confirmed', updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [documentId, tenantId, JSON.stringify(extraction)],
      )
      const confirmedRow = confirmed.rows[0]
      if (!confirmedRow) throw new Error('DOCUMENT_CONFIRMATION_FAILED')
      return { document: rowDocument(confirmedRow), courses, tasks }
    })
  }

  async createAvailabilityBlock(tenantId: string, input: Pick<AvailabilityBlock, 'title' | 'startsAt' | 'endsAt' | 'sourceKind'> & { sourceImportDraftId?: string }): Promise<AvailabilityBlock> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        'INSERT INTO availability_blocks (tenant_id, title, starts_at, ends_at, source_kind, source_import_draft_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [tenantId, input.title, input.startsAt, input.endsAt, input.sourceKind, input.sourceImportDraftId ?? null],
      )
      const row = result.rows[0]
      if (!row) throw new Error('AVAILABILITY_BLOCK_CREATION_FAILED')
      return rowAvailabilityBlock(row)
    })
  }

  async listAvailabilityBlocks(tenantId: string): Promise<AvailabilityBlock[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT * FROM availability_blocks WHERE tenant_id = $1 ORDER BY starts_at', [tenantId])
      return result.rows.map(rowAvailabilityBlock)
    })
  }

  async saveAssessment(assessment: PriorityAssessment): Promise<PriorityAssessment> {
    await this.withTenant(assessment.tenantId, async (client) => {
      await client.query(
        `INSERT INTO priority_assessments (id, tenant_id, task_id, score, factors, weights, cost_of_delay, evidence, assumptions, uncertainty, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [assessment.id, assessment.tenantId, assessment.taskId, assessment.score, JSON.stringify(assessment.factors), JSON.stringify(assessment.weights), JSON.stringify(assessment.costOfDelay), JSON.stringify(assessment.evidence), JSON.stringify(assessment.assumptions), assessment.uncertainty, assessment.createdAt],
      )
    })
    return assessment
  }

  async savePlan(plan: StudyPlan): Promise<StudyPlan> {
    return this.withTenant(plan.tenantId, async (client) => {
      await client.query(
        `INSERT INTO study_plans (id, tenant_id, version, status, previous_plan_id, rationale, scheduling_warnings, approval_receipt_hash, created_at, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, rationale = EXCLUDED.rationale,
           scheduling_warnings = EXCLUDED.scheduling_warnings,
           approval_receipt_hash = COALESCE(EXCLUDED.approval_receipt_hash, study_plans.approval_receipt_hash),
           approved_at = COALESCE(EXCLUDED.approved_at, study_plans.approved_at)`,
        [plan.id, plan.tenantId, plan.version, plan.status, plan.previousPlanId ?? null, plan.rationale, JSON.stringify(plan.schedulingWarnings), plan.approvalReceipt ? hashSessionToken(plan.approvalReceipt) : null, plan.createdAt, plan.approvedAt ?? null],
      )
      await client.query('DELETE FROM plan_items WHERE plan_id = $1', [plan.id])
      for (const [position, item] of plan.items.entries()) {
        await client.query(
          'INSERT INTO plan_items (id, tenant_id, plan_id, task_id, starts_at, ends_at, minutes, first_step, rationale, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [item.id, plan.tenantId, plan.id, item.taskId, item.startsAt, item.endsAt, item.minutes, item.firstStep, item.rationale, position],
        )
      }
      return plan
    })
  }

  async getPlan(tenantId: string, planId: string): Promise<StudyPlan | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM study_plans WHERE id = $1 AND tenant_id = $2', [planId, tenantId])
      if (!row) return undefined
      const items = await this.listPlanItems(client, tenantId, [planId])
      return rowPlan(row, items.get(planId) ?? [])
    })
  }

  async listPlans(tenantId: string): Promise<StudyPlan[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT * FROM study_plans WHERE tenant_id = $1 ORDER BY version DESC', [tenantId])
      const planIds = result.rows.map((row) => String(row.id))
      const items = await this.listPlanItems(client, tenantId, planIds)
      return result.rows.map((row) => rowPlan(row, items.get(String(row.id)) ?? []))
    })
  }

  async nextPlanVersion(tenantId: string): Promise<number> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT COALESCE(MAX(version), 0) AS version FROM study_plans WHERE tenant_id = $1', [tenantId])
      return Number(row?.version ?? 0) + 1
    })
  }

  async getCurrentPlan(tenantId: string): Promise<CurrentPlan> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT * FROM study_plans
         WHERE tenant_id = $1 AND status IN ('approved', 'proposed')
         ORDER BY version DESC
         LIMIT 2`,
        [tenantId],
      )
      const planIds = result.rows.map((row) => String(row.id))
      const items = await this.listPlanItems(client, tenantId, planIds)
      const plans = result.rows.map((row) => rowPlan(row, items.get(String(row.id)) ?? []))
      return {
        active: plans.find((plan) => plan.status === 'approved') ?? null,
        pending: plans.find((plan) => plan.status === 'proposed') ?? null,
      }
    })
  }

  async createPlanProposal(tenantId: string, input: PlanProposalInput): Promise<StudyPlan> {
    return this.withTenant(tenantId, async (client) => {
      await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId])
      const existing = await this.oneOrUndefined(
        client,
        "SELECT * FROM study_plans WHERE tenant_id = $1 AND status = 'proposed' ORDER BY version DESC LIMIT 1",
        [tenantId],
      )
      if (existing) {
        const id = String(existing.id)
        const items = await this.listPlanItems(client, tenantId, [id])
        return rowPlan(existing, items.get(id) ?? [])
      }

      const active = await this.oneOrUndefined(
        client,
        "SELECT id FROM study_plans WHERE tenant_id = $1 AND status = 'approved' ORDER BY version DESC LIMIT 1",
        [tenantId],
      )
      const versionRow = await this.oneOrUndefined(client, 'SELECT COALESCE(MAX(version), 0) AS version FROM study_plans WHERE tenant_id = $1', [tenantId])
      const plan: StudyPlan = {
        id: randomUUID(),
        tenantId,
        version: Number(versionRow?.version ?? 0) + 1,
        status: 'proposed',
        previousPlanId: input.previousPlanId ?? (active ? String(active.id) : undefined),
        items: input.items.map((item) => ({ ...item, id: randomUUID() })),
        schedulingWarnings: input.schedulingWarnings ?? [],
        rationale: input.rationale,
        createdAt: new Date().toISOString(),
      }
      await this.insertPlan(client, plan)
      return plan
    })
  }

  async replacePlanProposal(tenantId: string, planId: string, expectedVersion: number, input: PlanProposalInput): Promise<StudyPlan> {
    return this.withTenant(tenantId, async (client) => {
      await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId])
      const current = await this.oneOrUndefined(
        client,
        'SELECT * FROM study_plans WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [planId, tenantId],
      )
      if (!current) throw new RepositoryError('PLAN_NOT_FOUND', 'Plan was not found.')
      if (Number(current.version) !== expectedVersion) throw new RepositoryError('PLAN_VERSION_CONFLICT', 'The plan changed. Review the latest version.')
      if (current.status !== 'proposed') throw new RepositoryError('PLAN_NOT_APPROVABLE', 'Only a proposed plan can be edited.')

      await client.query("UPDATE study_plans SET status = 'superseded' WHERE id = $1 AND tenant_id = $2", [planId, tenantId])
      const versionRow = await this.oneOrUndefined(client, 'SELECT COALESCE(MAX(version), 0) AS version FROM study_plans WHERE tenant_id = $1', [tenantId])
      const replacement: StudyPlan = {
        id: randomUUID(),
        tenantId,
        version: Number(versionRow?.version ?? 0) + 1,
        status: 'proposed',
        previousPlanId: planId,
        items: input.items.map((item) => ({ ...item, id: randomUUID() })),
        schedulingWarnings: input.schedulingWarnings ?? [],
        rationale: input.rationale,
        createdAt: new Date().toISOString(),
      }
      await this.insertPlan(client, replacement)
      return replacement
    })
  }

  async approvePlan(tenantId: string, planId: string, expectedVersion: number, approvalReceipt: string): Promise<StudyPlan> {
    return this.withTenant(tenantId, async (client) => {
      await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId])
      const row = await this.oneOrUndefined(
        client,
        'SELECT * FROM study_plans WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [planId, tenantId],
      )
      if (!row) throw new RepositoryError('PLAN_NOT_FOUND', 'Plan was not found.')
      if (Number(row.version) !== expectedVersion) throw new RepositoryError('PLAN_VERSION_CONFLICT', 'The plan changed. Review the latest version.')
      if (row.status === 'approved') {
        const items = await this.listPlanItems(client, tenantId, [planId])
        return rowPlan(row, items.get(planId) ?? [])
      }
      if (row.status !== 'proposed') throw new RepositoryError('PLAN_NOT_APPROVABLE', 'Only a proposed plan can be approved.')

      await client.query(
        "UPDATE study_plans SET status = 'superseded' WHERE tenant_id = $1 AND status = 'approved' AND id <> $2",
        [tenantId, planId],
      )
      const approvedAt = new Date().toISOString()
      await client.query(
        "UPDATE study_plans SET status = 'approved', approval_receipt_hash = $3, approved_at = $4 WHERE id = $1 AND tenant_id = $2",
        [planId, tenantId, hashSessionToken(approvalReceipt), approvedAt],
      )
      const items = await this.listPlanItems(client, tenantId, [planId])
      return {
        ...rowPlan({ ...row, status: 'approved', approved_at: approvedAt }, items.get(planId) ?? []),
        approvalReceipt,
      }
    })
  }

  async saveCheckIn(checkIn: CoachCheckIn): Promise<CoachCheckIn> {
    await this.withTenant(checkIn.tenantId, async (client) => {
      await client.query('INSERT INTO coach_check_ins (id, tenant_id, plan_id, friction, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [checkIn.id, checkIn.tenantId, checkIn.planId, checkIn.friction, checkIn.note ?? null, checkIn.createdAt])
    })
    return checkIn
  }

  async saveReplanProposal(proposal: ReplanProposal): Promise<ReplanProposal> {
    await this.withTenant(proposal.tenantId, async (client) => {
      await client.query(
        `INSERT INTO replan_proposals (id, tenant_id, check_in_id, base_plan_id, base_plan_version, status, title, rationale, changes, proposed_items, approved_plan_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, approved_plan_id = EXCLUDED.approved_plan_id`,
        [proposal.id, proposal.tenantId, proposal.checkInId, proposal.basePlanId, proposal.basePlanVersion, proposal.status, proposal.title, proposal.rationale, JSON.stringify(proposal.changes), JSON.stringify(proposal.proposedItems), proposal.approvedPlanId ?? null, proposal.createdAt],
      )
    })
    return proposal
  }

  async getReplanProposal(tenantId: string, proposalId: string): Promise<ReplanProposal | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM replan_proposals WHERE id = $1 AND tenant_id = $2', [proposalId, tenantId])
      if (!row) return undefined
      return {
        id: String(row.id), tenantId: String(row.tenant_id), checkInId: String(row.check_in_id), basePlanId: String(row.base_plan_id), basePlanVersion: Number(row.base_plan_version),
        status: row.status as ReplanProposal['status'], title: String(row.title), rationale: String(row.rationale), changes: json<string[]>(row.changes, []),
        proposedItems: json<ReplanProposal['proposedItems']>(row.proposed_items, []), createdAt: iso(row.created_at), approvedPlanId: row.approved_plan_id ? String(row.approved_plan_id) : undefined,
      }
    })
  }

  async saveConsent(consent: ConsentAudit): Promise<ConsentAudit> {
    await this.withTenant(consent.tenantId, async (client) => {
      await client.query('INSERT INTO consent_audits (id, tenant_id, user_id, purpose, granted, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [consent.id, consent.tenantId, consent.userId, consent.purpose, consent.granted, consent.source, consent.createdAt])
    })
    return consent
  }

  async listConsents(tenantId: string): Promise<ConsentAudit[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT * FROM consent_audits WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId])
      return result.rows.map((row) => ({ id: String(row.id), tenantId: String(row.tenant_id), userId: String(row.user_id), purpose: row.purpose as ConsentAudit['purpose'], granted: Boolean(row.granted), source: row.source as ConsentAudit['source'], createdAt: iso(row.created_at) }))
    })
  }

  async getLearnerProfile(tenantId: string, userId: string): Promise<LearnerProfile | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(
        client,
        'SELECT * FROM learner_profiles WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, userId],
      )
      return row ? rowLearnerProfile(row) : undefined
    })
  }

  async updateLearnerProfile(
    tenantId: string,
    userId: string,
    expectedVersion: number,
    signals: LearnerProfileSignal[],
  ): Promise<LearnerProfile> {
    return this.withTenant(tenantId, async (client) => {
      if (expectedVersion === 0) {
        const inserted = await client.query<Row>(
          `INSERT INTO learner_profiles (tenant_id, user_id, approved_signals, source_event_count, version)
           VALUES ($1, $2, $3, 0, 1)
           ON CONFLICT (user_id) DO NOTHING
           RETURNING *`,
          [tenantId, userId, JSON.stringify(signals)],
        )
        const row = inserted.rows[0]
        if (row) return rowLearnerProfile(row)
      }

      const updated = await client.query<Row>(
        `UPDATE learner_profiles
         SET approved_signals = $4, version = version + 1, updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND version = $3
         RETURNING *`,
        [tenantId, userId, expectedVersion, JSON.stringify(signals)],
      )
      const row = updated.rows[0]
      if (!row) {
        throw new RepositoryError('LEARNER_PROFILE_VERSION_CONFLICT', 'The learner profile changed. Reload it before saving again.')
      }
      return rowLearnerProfile(row)
    })
  }

  async getPlanningPreferences(tenantId: string, userId: string): Promise<PlanningPreferences | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(
        client,
        'SELECT * FROM planning_preferences WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, userId],
      )
      return row ? rowPlanningPreferences(row) : undefined
    })
  }

  async updatePlanningPreferences(
    tenantId: string,
    userId: string,
    expectedVersion: number,
    input: PlanningPreferencesInput,
  ): Promise<PlanningPreferences> {
    return this.withTenant(tenantId, async (client) => {
      if (expectedVersion === 0) {
        const inserted = await client.query<Row>(
          `INSERT INTO planning_preferences (
             tenant_id, user_id, locale, coach_mode, daily_minutes, timezone, utc_offset_minutes, windows, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
           ON CONFLICT (user_id) DO NOTHING
           RETURNING *`,
          [
            tenantId,
            userId,
            input.locale,
            input.coachMode,
            input.dailyMinutes,
            input.timezone,
            input.utcOffsetMinutes,
            JSON.stringify(input.windows),
          ],
        )
        const row = inserted.rows[0]
        if (row) return rowPlanningPreferences(row)
      }

      const updated = await client.query<Row>(
        `UPDATE planning_preferences
         SET locale = $4, coach_mode = $5, daily_minutes = $6, timezone = $7,
             utc_offset_minutes = $8, windows = $9, version = version + 1, updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND version = $3
         RETURNING *`,
        [
          tenantId,
          userId,
          expectedVersion,
          input.locale,
          input.coachMode,
          input.dailyMinutes,
          input.timezone,
          input.utcOffsetMinutes,
          JSON.stringify(input.windows),
        ],
      )
      const row = updated.rows[0]
      if (!row) {
        throw new RepositoryError('PLANNING_PREFERENCES_VERSION_CONFLICT', 'Planning preferences changed. Reload them before saving again.')
      }
      return rowPlanningPreferences(row)
    })
  }

  async saveImportDraft(draft: ImportDraft): Promise<ImportDraft> {
    await this.withTenant(draft.tenantId, async (client) => {
      await client.query('INSERT INTO import_drafts (id, tenant_id, kind, status, tasks, busy_blocks, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status', [draft.id, draft.tenantId, draft.kind, draft.status, JSON.stringify(draft.tasks), JSON.stringify(draft.busyBlocks), draft.createdAt])
    })
    return draft
  }

  async getImportDraft(tenantId: string, draftId: string): Promise<ImportDraft | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(client, 'SELECT * FROM import_drafts WHERE id = $1 AND tenant_id = $2', [draftId, tenantId])
      return row ? { id: String(row.id), tenantId: String(row.tenant_id), kind: row.kind as ImportDraft['kind'], status: row.status as ImportDraft['status'], tasks: json<ImportDraft['tasks']>(row.tasks, []), busyBlocks: json<ImportDraft['busyBlocks']>(row.busy_blocks, []), createdAt: iso(row.created_at) } : undefined
    })
  }

  async confirmIcsImport(tenantId: string, draftId: string): Promise<IcsImportResult> {
    return this.withTenant(tenantId, async (client) => {
      const row = await this.oneOrUndefined(
        client,
        'SELECT * FROM import_drafts WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [draftId, tenantId],
      )
      if (!row) throw new RepositoryError('IMPORT_NOT_FOUND', 'Import draft was not found.')
      const draft: ImportDraft = {
        id: String(row.id), tenantId: String(row.tenant_id), kind: row.kind as ImportDraft['kind'],
        status: row.status as ImportDraft['status'], tasks: json<ImportDraft['tasks']>(row.tasks, []),
        busyBlocks: json<ImportDraft['busyBlocks']>(row.busy_blocks, []), createdAt: iso(row.created_at),
      }
      if (draft.status === 'confirmed') {
        const taskRows = await client.query<Row>(
          'SELECT * FROM tasks WHERE tenant_id = $1 AND source_import_draft_id = $2 ORDER BY created_at',
          [tenantId, draftId],
        )
        const blockRows = await client.query<Row>(
          'SELECT * FROM availability_blocks WHERE tenant_id = $1 AND source_import_draft_id = $2 ORDER BY starts_at',
          [tenantId, draftId],
        )
        return { draft, tasks: taskRows.rows.map(rowTask), busyBlocks: blockRows.rows.map(rowAvailabilityBlock) }
      }
      if (draft.status !== 'review') throw new RepositoryError('IMPORT_NOT_READY', 'Review this import before confirming it.')

      let courseRow = await this.oneOrUndefined(
        client,
        "SELECT * FROM courses WHERE tenant_id = $1 AND lower(code) = 'calendar'",
        [tenantId],
      )
      if (!courseRow) {
        const inserted = await client.query<Row>(
          `INSERT INTO courses (tenant_id, code, name, current_score, target_score)
           VALUES ($1, 'CALENDAR', 'Calendar imports', NULL, NULL)
           ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code
           RETURNING *`,
          [tenantId],
        )
        courseRow = inserted.rows[0]
      }
      if (!courseRow) throw new Error('COURSE_CREATION_FAILED')
      const course = rowCourse(courseRow)

      const tasks: Task[] = []
      for (const task of draft.tasks) {
        const inserted = await client.query<Row>(
          `INSERT INTO tasks (
             tenant_id, course_id, source_import_draft_id, title, due_at, grade_weight,
             estimated_minutes, status, source_kind, confidence, evidence
           ) VALUES ($1, $2, $3, $4, $5, NULL, $6, 'confirmed', 'ics', $7, $8)
           RETURNING *`,
          [tenantId, course.id, draftId, task.title, task.dueAt, task.estimatedMinutes, task.confidence, JSON.stringify(task.evidence)],
        )
        const insertedRow = inserted.rows[0]
        if (!insertedRow) throw new Error('TASK_CREATION_FAILED')
        tasks.push(rowTask(insertedRow))
      }

      const busyBlocks: AvailabilityBlock[] = []
      for (const block of draft.busyBlocks) {
        const inserted = await client.query<Row>(
          `INSERT INTO availability_blocks (
             tenant_id, title, starts_at, ends_at, source_kind, source_import_draft_id
           ) VALUES ($1, $2, $3, $4, 'ics', $5)
           RETURNING *`,
          [tenantId, block.title, block.startsAt, block.endsAt, draftId],
        )
        const insertedRow = inserted.rows[0]
        if (!insertedRow) throw new Error('AVAILABILITY_BLOCK_CREATION_FAILED')
        busyBlocks.push(rowAvailabilityBlock(insertedRow))
      }

      await client.query(
        "UPDATE import_drafts SET status = 'confirmed' WHERE id = $1 AND tenant_id = $2",
        [draftId, tenantId],
      )
      return { draft: { ...draft, status: 'confirmed' }, tasks, busyBlocks }
    })
  }

  async scheduleDailyDigest(tenantId: string, userId: string, runAt: string): Promise<NotificationJob> {
    const identity = dailyDigestIdentity(userId, runAt)
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `INSERT INTO notification_jobs (
           tenant_id, user_id, kind, digest_date, status, attempts, run_at, idempotency_key
         ) VALUES ($1, $2, 'daily_digest', $3, 'pending', 0, $4, $5)
         ON CONFLICT (idempotency_key) DO UPDATE
           SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING *`,
        [tenantId, userId, identity.digestDate, identity.runAt, identity.idempotencyKey],
      )
      const row = result.rows[0]
      if (!row) throw new Error('NOTIFICATION_JOB_CREATION_FAILED')
      return rowNotificationJob(row)
    })
  }

  async cancelDailyDigestJobs(tenantId: string, userId: string): Promise<number> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE notification_jobs
         SET status = 'cancelled', completed_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND kind = 'daily_digest' AND status = 'pending'`,
        [tenantId, userId],
      )
      return result.rowCount ?? 0
    })
  }

  async claimNotificationJobs(batchSize: number): Promise<NotificationJob[]> {
    const result = await this.pool.query<Row>(
      'SELECT * FROM private.claim_due_notification_jobs($1)',
      [batchSize],
    )
    return result.rows.map(rowNotificationJob)
  }

  async completeNotificationJob(
    job: NotificationJob,
    result: { status: 'completed' | 'skipped'; detail?: string; nextRunAt?: string },
    completedAt = new Date(),
  ): Promise<void> {
    await this.withTenant(job.tenantId, async (client) => {
      const current = await this.oneOrUndefined(
        client,
        `SELECT id FROM notification_jobs
         WHERE id = $1 AND tenant_id = $2 AND status = 'leased' AND lease_token = $3
         FOR UPDATE`,
        [job.id, job.tenantId, job.leaseToken ?? null],
      )
      if (!current) throw new RepositoryError('NOTIFICATION_LEASE_CONFLICT', 'The notification job lease is no longer current.')
      await client.query(
        `UPDATE notification_jobs
         SET status = $4, lease_token = NULL, leased_until = NULL, last_error = $5,
             updated_at = $6, completed_at = $6
         WHERE id = $1 AND tenant_id = $2 AND lease_token = $3`,
        [job.id, job.tenantId, job.leaseToken ?? null, result.status, result.detail ?? null, completedAt.toISOString()],
      )
      if (result.nextRunAt) {
        const identity = dailyDigestIdentity(job.userId, result.nextRunAt)
        await client.query(
          `INSERT INTO notification_jobs (
             tenant_id, user_id, kind, digest_date, status, attempts, run_at, idempotency_key
           ) VALUES ($1, $2, 'daily_digest', $3, 'pending', 0, $4, $5)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [job.tenantId, job.userId, identity.digestDate, identity.runAt, identity.idempotencyKey],
        )
      }
    })
  }

  async failNotificationJob(
    job: NotificationJob,
    message: string,
    failedAt = new Date(),
  ): Promise<'retrying' | 'failed'> {
    return this.withTenant(job.tenantId, async (client) => {
      const result = await client.query<Row>(
        `UPDATE notification_jobs
         SET status = CASE WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
             run_at = $4::timestamptz + make_interval(mins => LEAST(720, power(2, LEAST(attempts, 9))::int)),
             lease_token = NULL, leased_until = NULL, last_error = $5, updated_at = $4,
             completed_at = CASE WHEN attempts >= 8 THEN $4 ELSE NULL END
         WHERE id = $1 AND tenant_id = $2 AND status = 'leased' AND lease_token = $3
         RETURNING status`,
        [job.id, job.tenantId, job.leaseToken ?? null, failedAt.toISOString(), message.slice(0, 1_000)],
      )
      if ((result.rowCount ?? 0) !== 1) {
        throw new RepositoryError('NOTIFICATION_LEASE_CONFLICT', 'The notification job lease is no longer current.')
      }
      return result.rows[0]?.status === 'failed' ? 'failed' : 'retrying'
    })
  }

  async claimLifecycleJobs(batchSize: number): Promise<LifecycleJob[]> {
    const result = await this.pool.query<Row>(
      'SELECT * FROM private.claim_due_lifecycle_jobs($1)',
      [batchSize],
    )
    return result.rows.map(rowLifecycleJob)
  }

  async completeLifecycleJob(job: LifecycleJob, completedAt = new Date()): Promise<boolean> {
    return this.withTenant(job.tenantId, async (client) => {
      const current = await this.oneOrUndefined(
        client,
        `SELECT * FROM lifecycle_jobs
         WHERE id = $1 AND tenant_id = $2 AND status = 'leased' AND lease_token = $3
         FOR UPDATE`,
        [job.id, job.tenantId, job.leaseToken ?? null],
      )
      if (!current) throw new RepositoryError('LIFECYCLE_LEASE_CONFLICT', 'The lifecycle job lease is no longer current.')

      if (current.kind === 'document_raw_delete') {
        await client.query(
          'UPDATE source_documents SET raw_deleted_at = $3, updated_at = $3 WHERE id = $1 AND tenant_id = $2',
          [current.resource_id, job.tenantId, completedAt.toISOString()],
        )
      } else {
        const dependencies = await this.oneOrUndefined(
          client,
          `SELECT count(*) FILTER (WHERE status <> 'completed')::int AS pending_count,
             count(*) FILTER (WHERE status = 'failed')::int AS failed_count
           FROM lifecycle_jobs WHERE receipt_id = $1 AND kind = 'document_raw_delete'`,
          [current.receipt_id],
        )
        if (Number(dependencies?.failed_count ?? 0) > 0) {
          await client.query("UPDATE deletion_receipts SET status = 'failed' WHERE id = $1", [current.receipt_id])
          await client.query(
            `UPDATE lifecycle_jobs SET status = 'failed', lease_token = NULL, leased_until = NULL,
               last_error = 'A dependent object cleanup job failed permanently.', updated_at = $2 WHERE id = $1`,
            [job.id, completedAt.toISOString()],
          )
          return true
        }
        if (Number(dependencies?.pending_count ?? 0) > 0) {
          await client.query(
            `UPDATE lifecycle_jobs SET status = 'pending', run_at = $2::timestamptz + interval '15 minutes',
               lease_token = NULL, leased_until = NULL, updated_at = $2
             WHERE id = $1`,
            [job.id, completedAt.toISOString()],
          )
          return false
        }
        await client.query(
          "UPDATE deletion_receipts SET status = 'completed', completed_at = $2 WHERE id = $1",
          [current.receipt_id, completedAt.toISOString()],
        )
        await client.query('DELETE FROM tenants WHERE id = $1', [job.tenantId])
        this.demoUserId = undefined
      }

      await client.query(
        `UPDATE lifecycle_jobs SET status = 'completed', lease_token = NULL, leased_until = NULL,
           last_error = NULL, updated_at = $2 WHERE id = $1`,
        [job.id, completedAt.toISOString()],
      )
      return true
    })
  }

  async failLifecycleJob(job: LifecycleJob, message: string, failedAt = new Date()): Promise<'retrying' | 'failed'> {
    return this.withTenant(job.tenantId, async (client) => {
      const result = await client.query<Row>(
        `UPDATE lifecycle_jobs
         SET status = CASE WHEN attempts >= 12 THEN 'failed' ELSE 'pending' END,
             run_at = $4::timestamptz + make_interval(mins => LEAST(1440, power(2, LEAST(attempts, 10))::int)),
             lease_token = NULL, leased_until = NULL, last_error = $5, updated_at = $4
         WHERE id = $1 AND tenant_id = $2 AND status = 'leased' AND lease_token = $3
         RETURNING receipt_id, status`,
        [job.id, job.tenantId, job.leaseToken ?? null, failedAt.toISOString(), message.slice(0, 1_000)],
      )
      if ((result.rowCount ?? 0) !== 1) {
        throw new RepositoryError('LIFECYCLE_LEASE_CONFLICT', 'The lifecycle job lease is no longer current.')
      }
      const row = result.rows[0]
      if (row?.status === 'failed' && row.receipt_id) {
        await client.query("UPDATE deletion_receipts SET status = 'failed' WHERE id = $1", [row.receipt_id])
      }
      return row?.status === 'failed' ? 'failed' : 'retrying'
    })
  }

  async requestAccountDeletion(tenantId: string, userId: string): Promise<AccountDeletionReceipt> {
    return this.withTenant(tenantId, async (client) => {
      await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId])
      const existing = await this.oneOrUndefined(
        client,
        "SELECT * FROM deletion_receipts WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [tenantId],
      )
      if (existing) {
        return { id: String(existing.id), tenantId, status: 'pending', createdAt: iso(existing.created_at) }
      }

      const receiptResult = await client.query<Row>(
        "INSERT INTO deletion_receipts (tenant_id, status) VALUES ($1, 'pending') RETURNING *",
        [tenantId],
      )
      const receiptRow = receiptResult.rows[0]
      if (!receiptRow) throw new Error('DELETION_RECEIPT_CREATION_FAILED')
      const receipt: AccountDeletionReceipt = {
        id: String(receiptRow.id), tenantId, status: 'pending', createdAt: iso(receiptRow.created_at),
      }

      const user = await this.oneOrUndefined(client, 'SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId])
      if (!user) throw new Error('ACCOUNT_USER_NOT_FOUND')
      await client.query('UPDATE users SET deleted_at = now() WHERE tenant_id = $1', [tenantId])
      await client.query('UPDATE tenants SET deleted_at = now() WHERE id = $1', [tenantId])
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL', [tenantId])

      await client.query(
        `INSERT INTO lifecycle_jobs (
           tenant_id, kind, resource_id, storage_key, receipt_id, status, run_at, idempotency_key
         )
         SELECT tenant_id, 'document_raw_delete', id, storage_key, $2, 'pending', now(),
           'document:' || id::text || ':raw-delete'
         FROM source_documents
         WHERE tenant_id = $1 AND raw_deleted_at IS NULL
         ON CONFLICT (idempotency_key) DO UPDATE
         SET receipt_id = EXCLUDED.receipt_id, run_at = now(),
             status = CASE WHEN lifecycle_jobs.status = 'completed' THEN 'completed' ELSE 'pending' END,
             lease_token = NULL, leased_until = NULL, updated_at = now()`,
        [tenantId, receipt.id],
      )
      await client.query(
        `INSERT INTO lifecycle_jobs (
           tenant_id, kind, resource_id, receipt_id, status, run_at, idempotency_key
         ) VALUES ($1, 'account_finalize', $1, $2, 'pending', now(), $3)
         ON CONFLICT (idempotency_key) DO UPDATE SET receipt_id = EXCLUDED.receipt_id,
           status = CASE WHEN lifecycle_jobs.status = 'completed' THEN 'completed' ELSE 'pending' END,
           run_at = now(), lease_token = NULL, leased_until = NULL, updated_at = now()`,
        [tenantId, receipt.id, `account:${tenantId}:finalize`],
      )
      return receipt
    })
  }

  async saveEvent(event: Omit<ProductEvent, 'id' | 'createdAt'>): Promise<ProductEvent> {
    return this.withTenant(event.tenantId, async (client) => {
      const result = await client.query<Row>('INSERT INTO product_events (tenant_id, user_id, name, properties) VALUES ($1, $2, $3, $4) RETURNING *', [event.tenantId, event.userId, event.name, JSON.stringify(event.properties)])
      const row = result.rows[0]
      if (!row) throw new Error('EVENT_SAVE_FAILED')
      return { id: String(row.id), tenantId: String(row.tenant_id), userId: String(row.user_id), name: String(row.name), properties: json<Record<string, unknown>>(row.properties, {}), createdAt: iso(row.created_at) }
    })
  }

  async getMetrics(tenantId: string): Promise<Record<string, number>> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>('SELECT name, COUNT(*)::int AS count FROM product_events WHERE tenant_id = $1 GROUP BY name', [tenantId])
      return Object.fromEntries(result.rows.map((row) => [String(row.name), Number(row.count)]))
    })
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    })
    this.demoUserId = undefined
  }
}
