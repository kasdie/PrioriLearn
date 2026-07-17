import { createHash } from 'node:crypto'
import pg from 'pg'
import type {
  AvailabilityBlock,
  CoachCheckIn,
  ConsentAudit,
  Course,
  DocumentExtraction,
  ImportDraft,
  PriorityAssessment,
  ReplanProposal,
  SourceDocument,
  StudyPlan,
  Task,
  Tenant,
  User,
} from './domain/contracts.js'
import { createSessionToken, hashPassword } from './lib/auth.js'
import type { AuthSession, Repository } from './repository.js'

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
    passwordHash: String(row.password_hash),
    name: String(row.name),
    locale: row.locale as User['locale'],
    role: row.role as User['role'],
    createdAt: iso(row.created_at),
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
    extraction: row.extraction ? json<DocumentExtraction>(row.extraction, { courses: [], tasks: [], warnings: [] }) : undefined,
    extractionProvider: row.extraction_provider ? String(row.extraction_provider) : undefined,
    expiresAt: iso(row.expires_at),
    rawDeletedAt: row.raw_deleted_at ? iso(row.raw_deleted_at) : undefined,
    createdAt: iso(row.created_at),
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
    createdAt: iso(row.created_at),
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

  private async oneOrUndefined(query: string, values: unknown[] = []): Promise<Row | undefined> {
    const result = await this.pool.query<Row>(query, values)
    return result.rows[0]
  }

  private async listPlanItems(planId: string): Promise<StudyPlan['items']> {
    const result = await this.pool.query<Row>(
      'SELECT id, task_id, starts_at, ends_at, minutes, first_step, rationale FROM plan_items WHERE plan_id = $1 ORDER BY position',
      [planId],
    )
    return result.rows.map((row) => ({
      id: String(row.id), taskId: String(row.task_id), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
      minutes: Number(row.minutes), firstStep: String(row.first_step), rationale: String(row.rationale),
    }))
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

  async createPersonalAccount(input: { email: string; password: string; name: string; locale: 'vi' | 'en' }): Promise<User> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const tenant = await client.query<Row>('INSERT INTO tenants (kind, name) VALUES ($1, $2) RETURNING *', ['personal', input.name])
      const tenantId = String(tenant.rows[0]?.id)
      const user = await client.query<Row>(
        'INSERT INTO users (tenant_id, email, password_hash, name, locale, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [tenantId, input.email.trim().toLowerCase(), await hashPassword(input.password), input.name, input.locale, 'student'],
      )
      await client.query('COMMIT')
      const created = user.rows[0]
      if (!created) throw new Error('ACCOUNT_CREATION_FAILED')
      return rowUser(created)
    } catch (error) {
      await client.query('ROLLBACK')
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new Error('EMAIL_EXISTS')
      throw error
    } finally {
      client.release()
    }
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [email.trim()])
    return row ? rowUser(row) : undefined
  }

  async getUser(userId: string): Promise<User | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [userId])
    return row ? rowUser(row) : undefined
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL', [tenantId])
    return row ? rowTenant(row) : undefined
  }

  async getDemoUser(): Promise<User> {
    if (!this.demoUserId) await this.seedDemo()
    const user = this.demoUserId ? await this.getUser(this.demoUserId) : undefined
    if (!user) throw new Error('DEMO_NOT_SEEDED')
    return user
  }

  async createSession(user: User): Promise<string> {
    const token = createSessionToken()
    await this.pool.query(
      'INSERT INTO auth_sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [user.tenantId, user.id, hashSessionToken(token), new Date(Date.now() + 7 * 24 * 3_600_000).toISOString()],
    )
    return token
  }

  async resolveSession(token: string): Promise<AuthSession | undefined> {
    const row = await this.oneOrUndefined(
      `SELECT u.id AS user_id, u.tenant_id AS user_tenant_id, u.email, u.password_hash, u.name AS user_name, u.locale, u.role, u.created_at AS user_created_at,
        t.id AS tenant_id, t.kind, t.name AS tenant_name, t.created_at AS tenant_created_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL AND t.deleted_at IS NULL`,
      [hashSessionToken(token)],
    )
    if (!row) return undefined
    return {
      user: { id: String(row.user_id), tenantId: String(row.user_tenant_id), email: String(row.email), passwordHash: String(row.password_hash), name: String(row.user_name), locale: row.locale as User['locale'], role: row.role as User['role'], createdAt: iso(row.user_created_at) },
      tenant: { id: String(row.tenant_id), kind: row.kind as Tenant['kind'], name: String(row.tenant_name), createdAt: iso(row.tenant_created_at) },
    }
  }

  async createCourse(tenantId: string, input: Pick<Course, 'code' | 'name' | 'currentScore' | 'targetScore'> & { sourceDocumentId?: string }): Promise<Course> {
    const existing = await this.oneOrUndefined('SELECT * FROM courses WHERE tenant_id = $1 AND lower(code) = lower($2)', [tenantId, input.code])
    if (existing) return rowCourse(existing)
    const result = await this.pool.query<Row>(
      'INSERT INTO courses (tenant_id, code, name, current_score, target_score, source_document_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING *',
      [tenantId, input.code, input.name, input.currentScore, input.targetScore, input.sourceDocumentId ?? null],
    )
    const row = result.rows[0]
    if (!row) throw new Error('COURSE_CREATION_FAILED')
    return rowCourse(row)
  }

  async getCourse(tenantId: string, courseId: string): Promise<Course | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM courses WHERE id = $1 AND tenant_id = $2', [courseId, tenantId])
    return row ? rowCourse(row) : undefined
  }

  async listCourses(tenantId: string): Promise<Course[]> {
    const result = await this.pool.query<Row>('SELECT * FROM courses WHERE tenant_id = $1 ORDER BY created_at', [tenantId])
    return result.rows.map(rowCourse)
  }

  async createTask(tenantId: string, input: Pick<Task, 'courseId' | 'title' | 'dueAt' | 'gradeWeight' | 'estimatedMinutes' | 'status' | 'sourceKind' | 'confidence' | 'evidence'> & { sourceDocumentId?: string }): Promise<Task> {
    const result = await this.pool.query<Row>(
      `INSERT INTO tasks (tenant_id, course_id, source_document_id, title, due_at, grade_weight, estimated_minutes, status, source_kind, confidence, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [tenantId, input.courseId, input.sourceDocumentId ?? null, input.title, input.dueAt, input.gradeWeight, input.estimatedMinutes, input.status, input.sourceKind, input.confidence, JSON.stringify(input.evidence)],
    )
    const row = result.rows[0]
    if (!row) throw new Error('TASK_CREATION_FAILED')
    return rowTask(row)
  }

  async getTask(tenantId: string, taskId: string): Promise<Task | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM tasks WHERE id = $1 AND tenant_id = $2', [taskId, tenantId])
    return row ? rowTask(row) : undefined
  }

  async listTasks(tenantId: string): Promise<Task[]> {
    const result = await this.pool.query<Row>('SELECT * FROM tasks WHERE tenant_id = $1 ORDER BY due_at NULLS LAST, created_at', [tenantId])
    return result.rows.map(rowTask)
  }

  async updateTask(tenantId: string, taskId: string, patch: Partial<Task>): Promise<Task | undefined> {
    const has = (key: keyof Task) => Object.prototype.hasOwnProperty.call(patch, key)
    const result = await this.pool.query<Row>(
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
  }

  async saveDocument(document: SourceDocument): Promise<SourceDocument> {
    const result = await this.pool.query<Row>(
      `INSERT INTO source_documents (id, tenant_id, filename, mime_type, size_bytes, storage_key, status, extraction, extraction_provider, expires_at, raw_deleted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET filename = EXCLUDED.filename, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, storage_key = EXCLUDED.storage_key,
         status = EXCLUDED.status, extraction = EXCLUDED.extraction, extraction_provider = EXCLUDED.extraction_provider, expires_at = EXCLUDED.expires_at, raw_deleted_at = EXCLUDED.raw_deleted_at
       WHERE source_documents.tenant_id = EXCLUDED.tenant_id RETURNING *`,
      [document.id, document.tenantId, document.filename, document.mimeType, document.sizeBytes, document.storageKey, document.status, document.extraction ? JSON.stringify(document.extraction) : null, document.extractionProvider ?? null, document.expiresAt, document.rawDeletedAt ?? null, document.createdAt],
    )
    const row = result.rows[0]
    if (!row) throw new Error('DOCUMENT_SAVE_FAILED')
    return rowDocument(row)
  }

  async getDocument(tenantId: string, documentId: string): Promise<SourceDocument | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM source_documents WHERE id = $1 AND tenant_id = $2', [documentId, tenantId])
    return row ? rowDocument(row) : undefined
  }

  async listDocuments(tenantId: string): Promise<SourceDocument[]> {
    const result = await this.pool.query<Row>('SELECT * FROM source_documents WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId])
    return result.rows.map(rowDocument)
  }

  async listExpiredDocuments(now: Date): Promise<SourceDocument[]> {
    const result = await this.pool.query<Row>('SELECT * FROM source_documents WHERE raw_deleted_at IS NULL AND expires_at <= $1', [now.toISOString()])
    return result.rows.map(rowDocument)
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<SourceDocument | undefined> {
    const result = await this.pool.query<Row>('DELETE FROM source_documents WHERE id = $1 AND tenant_id = $2 RETURNING *', [documentId, tenantId])
    const row = result.rows[0]
    return row ? rowDocument(row) : undefined
  }

  async createAvailabilityBlock(tenantId: string, input: Pick<AvailabilityBlock, 'title' | 'startsAt' | 'endsAt' | 'sourceKind'>): Promise<AvailabilityBlock> {
    const result = await this.pool.query<Row>(
      'INSERT INTO availability_blocks (tenant_id, title, starts_at, ends_at, source_kind) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [tenantId, input.title, input.startsAt, input.endsAt, input.sourceKind],
    )
    const row = result.rows[0]
    if (!row) throw new Error('AVAILABILITY_BLOCK_CREATION_FAILED')
    return rowAvailabilityBlock(row)
  }

  async listAvailabilityBlocks(tenantId: string): Promise<AvailabilityBlock[]> {
    const result = await this.pool.query<Row>('SELECT * FROM availability_blocks WHERE tenant_id = $1 ORDER BY starts_at', [tenantId])
    return result.rows.map(rowAvailabilityBlock)
  }

  async saveAssessment(assessment: PriorityAssessment): Promise<PriorityAssessment> {
    await this.pool.query(
      `INSERT INTO priority_assessments (id, tenant_id, task_id, score, factors, weights, cost_of_delay, evidence, assumptions, uncertainty, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [assessment.id, assessment.tenantId, assessment.taskId, assessment.score, JSON.stringify(assessment.factors), JSON.stringify(assessment.weights), JSON.stringify(assessment.costOfDelay), JSON.stringify(assessment.evidence), JSON.stringify(assessment.assumptions), assessment.uncertainty, assessment.createdAt],
    )
    return assessment
  }

  async savePlan(plan: StudyPlan): Promise<StudyPlan> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO study_plans (id, tenant_id, version, status, previous_plan_id, rationale, approval_receipt_hash, created_at, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, rationale = EXCLUDED.rationale,
           approval_receipt_hash = COALESCE(EXCLUDED.approval_receipt_hash, study_plans.approval_receipt_hash),
           approved_at = COALESCE(EXCLUDED.approved_at, study_plans.approved_at)`,
        [plan.id, plan.tenantId, plan.version, plan.status, plan.previousPlanId ?? null, plan.rationale, plan.approvalReceipt ? hashSessionToken(plan.approvalReceipt) : null, plan.createdAt, plan.approvedAt ?? null],
      )
      await client.query('DELETE FROM plan_items WHERE plan_id = $1', [plan.id])
      for (const [position, item] of plan.items.entries()) {
        await client.query(
          'INSERT INTO plan_items (id, tenant_id, plan_id, task_id, starts_at, ends_at, minutes, first_step, rationale, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [item.id, plan.tenantId, plan.id, item.taskId, item.startsAt, item.endsAt, item.minutes, item.firstStep, item.rationale, position],
        )
      }
      await client.query('COMMIT')
      return plan
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getPlan(tenantId: string, planId: string): Promise<StudyPlan | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM study_plans WHERE id = $1 AND tenant_id = $2', [planId, tenantId])
    return row ? rowPlan(row, await this.listPlanItems(planId)) : undefined
  }

  async listPlans(tenantId: string): Promise<StudyPlan[]> {
    const result = await this.pool.query<Row>('SELECT * FROM study_plans WHERE tenant_id = $1 ORDER BY version DESC', [tenantId])
    return Promise.all(result.rows.map(async (row) => rowPlan(row, await this.listPlanItems(String(row.id)))))
  }

  async nextPlanVersion(tenantId: string): Promise<number> {
    const row = await this.oneOrUndefined('SELECT COALESCE(MAX(version), 0) AS version FROM study_plans WHERE tenant_id = $1', [tenantId])
    return Number(row?.version ?? 0) + 1
  }

  async saveCheckIn(checkIn: CoachCheckIn): Promise<CoachCheckIn> {
    await this.pool.query('INSERT INTO coach_check_ins (id, tenant_id, plan_id, friction, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [checkIn.id, checkIn.tenantId, checkIn.planId, checkIn.friction, checkIn.note ?? null, checkIn.createdAt])
    return checkIn
  }

  async saveReplanProposal(proposal: ReplanProposal): Promise<ReplanProposal> {
    await this.pool.query(
      `INSERT INTO replan_proposals (id, tenant_id, check_in_id, base_plan_id, base_plan_version, status, title, rationale, changes, proposed_items, approved_plan_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, approved_plan_id = EXCLUDED.approved_plan_id`,
      [proposal.id, proposal.tenantId, proposal.checkInId, proposal.basePlanId, proposal.basePlanVersion, proposal.status, proposal.title, proposal.rationale, JSON.stringify(proposal.changes), JSON.stringify(proposal.proposedItems), proposal.approvedPlanId ?? null, proposal.createdAt],
    )
    return proposal
  }

  async getReplanProposal(tenantId: string, proposalId: string): Promise<ReplanProposal | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM replan_proposals WHERE id = $1 AND tenant_id = $2', [proposalId, tenantId])
    if (!row) return undefined
    return {
      id: String(row.id), tenantId: String(row.tenant_id), checkInId: String(row.check_in_id), basePlanId: String(row.base_plan_id), basePlanVersion: Number(row.base_plan_version),
      status: row.status as ReplanProposal['status'], title: String(row.title), rationale: String(row.rationale), changes: json<string[]>(row.changes, []),
      proposedItems: json<ReplanProposal['proposedItems']>(row.proposed_items, []), createdAt: iso(row.created_at), approvedPlanId: row.approved_plan_id ? String(row.approved_plan_id) : undefined,
    }
  }

  async saveConsent(consent: ConsentAudit): Promise<ConsentAudit> {
    await this.pool.query('INSERT INTO consent_audits (id, tenant_id, user_id, purpose, granted, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [consent.id, consent.tenantId, consent.userId, consent.purpose, consent.granted, consent.source, consent.createdAt])
    return consent
  }

  async listConsents(tenantId: string): Promise<ConsentAudit[]> {
    const result = await this.pool.query<Row>('SELECT * FROM consent_audits WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId])
    return result.rows.map((row) => ({ id: String(row.id), tenantId: String(row.tenant_id), userId: String(row.user_id), purpose: row.purpose as ConsentAudit['purpose'], granted: Boolean(row.granted), source: row.source as ConsentAudit['source'], createdAt: iso(row.created_at) }))
  }

  async saveImportDraft(draft: ImportDraft): Promise<ImportDraft> {
    await this.pool.query('INSERT INTO import_drafts (id, tenant_id, kind, status, tasks, busy_blocks, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status', [draft.id, draft.tenantId, draft.kind, draft.status, JSON.stringify(draft.tasks), JSON.stringify(draft.busyBlocks), draft.createdAt])
    return draft
  }

  async getImportDraft(tenantId: string, draftId: string): Promise<ImportDraft | undefined> {
    const row = await this.oneOrUndefined('SELECT * FROM import_drafts WHERE id = $1 AND tenant_id = $2', [draftId, tenantId])
    return row ? { id: String(row.id), tenantId: String(row.tenant_id), kind: row.kind as ImportDraft['kind'], status: row.status as ImportDraft['status'], tasks: json<ImportDraft['tasks']>(row.tasks, []), busyBlocks: json<ImportDraft['busyBlocks']>(row.busy_blocks, []), createdAt: iso(row.created_at) } : undefined
  }

  async saveEvent(event: Omit<ProductEvent, 'id' | 'createdAt'>): Promise<ProductEvent> {
    const result = await this.pool.query<Row>('INSERT INTO product_events (tenant_id, user_id, name, properties) VALUES ($1, $2, $3, $4) RETURNING *', [event.tenantId, event.userId, event.name, JSON.stringify(event.properties)])
    const row = result.rows[0]
    if (!row) throw new Error('EVENT_SAVE_FAILED')
    return { id: String(row.id), tenantId: String(row.tenant_id), userId: String(row.user_id), name: String(row.name), properties: json<Record<string, unknown>>(row.properties, {}), createdAt: iso(row.created_at) }
  }

  async getMetrics(tenantId: string): Promise<Record<string, number>> {
    const result = await this.pool.query<Row>('SELECT name, COUNT(*)::int AS count FROM product_events WHERE tenant_id = $1 GROUP BY name', [tenantId])
    return Object.fromEntries(result.rows.map((row) => [String(row.name), Number(row.count)]))
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    if (this.demoUserId) {
      const demo = await this.getUser(this.demoUserId)
      if (!demo) this.demoUserId = undefined
    }
  }
}
