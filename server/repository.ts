import { randomUUID } from 'node:crypto'
import type {
  AccountDeletionReceipt,
  AuthActionPurpose,
  AuthActionToken,
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
  PriorityAssessment,
  ReplanProposal,
  SourceDocument,
  StudyPlan,
  Task,
  Tenant,
  User,
} from './domain/contracts.js'
import { createSessionToken, hashPassword } from './lib/auth.js'

export type Awaitable<T> = T | Promise<T>

export type AuthSession = { user: User; tenant: Tenant }

export type CurrentPlan = {
  active: StudyPlan | null
  pending: StudyPlan | null
}

export type PlanProposalInput = {
  items: StudyPlan['items']
  rationale: string
  previousPlanId?: string
}

export type DocumentUploadResult = { document: SourceDocument; created: boolean }
export type DocumentImportResult = { document: SourceDocument; courses: Course[]; tasks: Task[] }
export type IcsImportResult = { draft: ImportDraft; tasks: Task[]; busyBlocks: AvailabilityBlock[] }
export type CursorPage<T> = { items: T[]; next?: { createdAt: string; id: string } }
export type DocumentPageInput = { limit: number; before?: { createdAt: string; id: string } }

export class RepositoryError extends Error {
  constructor(
    readonly code:
      | 'PLAN_NOT_FOUND'
      | 'PLAN_VERSION_CONFLICT'
      | 'PLAN_NOT_APPROVABLE'
      | 'DOCUMENT_NOT_FOUND'
      | 'EXTRACTION_NOT_READY'
      | 'IMPORT_NOT_FOUND'
      | 'IMPORT_NOT_READY'
      | 'LIFECYCLE_LEASE_CONFLICT'
      | 'NOTIFICATION_LEASE_CONFLICT'
      | 'EXTRACTION_LEASE_CONFLICT'
      | 'LEARNER_PROFILE_VERSION_CONFLICT',
    message: string,
  ) {
    super(message)
  }
}

export interface Repository {
  seedDemo(): Awaitable<void>
  createPersonalAccount(input: { email: string; password: string; name: string; locale: 'vi' | 'en'; googleSubject?: string }): Awaitable<User>
  findUserByEmail(email: string): Awaitable<User | undefined>
  findUserByGoogleSubject(googleSubject: string): Awaitable<User | undefined>
  getUser(tenantId: string, userId: string): Awaitable<User | undefined>
  linkGoogleSubject(tenantId: string, userId: string, googleSubject: string): Awaitable<User | undefined>
  markEmailVerified(tenantId: string, userId: string): Awaitable<User | undefined>
  createAuthActionToken(user: User, purpose: AuthActionPurpose, tokenHash: string, expiresAt: string): Awaitable<void>
  verifyEmailWithToken(tokenHash: string): Awaitable<User | undefined>
  resetPasswordWithToken(tokenHash: string, passwordHash: string): Awaitable<User | undefined>
  getTenant(tenantId: string): Awaitable<Tenant | undefined>
  getDemoUser(): Awaitable<User>
  createSession(user: User): Awaitable<string>
  resolveSession(token: string): Awaitable<AuthSession | undefined>
  revokeSession(token: string): Awaitable<boolean>
  createCourse(tenantId: string, input: Pick<Course, 'code' | 'name' | 'currentScore' | 'targetScore'> & { sourceDocumentId?: string }): Awaitable<Course>
  getCourse(tenantId: string, courseId: string): Awaitable<Course | undefined>
  listCourses(tenantId: string): Awaitable<Course[]>
  createTask(tenantId: string, input: Pick<Task, 'courseId' | 'title' | 'dueAt' | 'gradeWeight' | 'estimatedMinutes' | 'status' | 'sourceKind' | 'confidence' | 'evidence'> & { sourceDocumentId?: string; sourceImportDraftId?: string }): Awaitable<Task>
  getTask(tenantId: string, taskId: string): Awaitable<Task | undefined>
  listTasks(tenantId: string): Awaitable<Task[]>
  updateTask(tenantId: string, taskId: string, patch: Partial<Task>): Awaitable<Task | undefined>
  beginDocumentUpload(document: SourceDocument): Awaitable<DocumentUploadResult>
  saveDocument(document: SourceDocument): Awaitable<SourceDocument>
  getDocument(tenantId: string, documentId: string): Awaitable<SourceDocument | undefined>
  listDocuments(tenantId: string): Awaitable<SourceDocument[]>
  listDocumentsPage(tenantId: string, input: DocumentPageInput): Awaitable<CursorPage<SourceDocument>>
  listExpiredDocuments(now: Date): Awaitable<SourceDocument[]>
  deleteDocument(tenantId: string, documentId: string): Awaitable<SourceDocument | undefined>
  enqueueDocumentExtraction(tenantId: string, documentId: string): Awaitable<{ job: ExtractionJob; document: SourceDocument }>
  claimExtractionJobs(batchSize: number, now?: Date): Awaitable<ExtractionJob[]>
  completeExtractionJob(
    job: ExtractionJob,
    extraction: DocumentExtraction,
    provider: string,
    completedAt?: Date,
  ): Awaitable<SourceDocument>
  failExtractionJob(
    job: ExtractionJob,
    message: string,
    retryable: boolean,
    failedAt?: Date,
  ): Awaitable<'retrying' | 'failed'>
  confirmDocumentImport(tenantId: string, documentId: string, extraction: DocumentExtraction): Awaitable<DocumentImportResult>
  createAvailabilityBlock(tenantId: string, input: Pick<AvailabilityBlock, 'title' | 'startsAt' | 'endsAt' | 'sourceKind'> & { sourceImportDraftId?: string }): Awaitable<AvailabilityBlock>
  listAvailabilityBlocks(tenantId: string): Awaitable<AvailabilityBlock[]>
  saveAssessment(assessment: PriorityAssessment): Awaitable<PriorityAssessment>
  savePlan(plan: StudyPlan): Awaitable<StudyPlan>
  getPlan(tenantId: string, planId: string): Awaitable<StudyPlan | undefined>
  listPlans(tenantId: string): Awaitable<StudyPlan[]>
  nextPlanVersion(tenantId: string): Awaitable<number>
  getCurrentPlan(tenantId: string): Awaitable<CurrentPlan>
  createPlanProposal(tenantId: string, input: PlanProposalInput): Awaitable<StudyPlan>
  replacePlanProposal(tenantId: string, planId: string, expectedVersion: number, input: PlanProposalInput): Awaitable<StudyPlan>
  approvePlan(tenantId: string, planId: string, expectedVersion: number, approvalReceipt: string): Awaitable<StudyPlan>
  saveCheckIn(checkIn: CoachCheckIn): Awaitable<CoachCheckIn>
  saveReplanProposal(proposal: ReplanProposal): Awaitable<ReplanProposal>
  getReplanProposal(tenantId: string, proposalId: string): Awaitable<ReplanProposal | undefined>
  saveConsent(consent: ConsentAudit): Awaitable<ConsentAudit>
  listConsents(tenantId: string): Awaitable<ConsentAudit[]>
  getLearnerProfile(tenantId: string, userId: string): Awaitable<LearnerProfile | undefined>
  updateLearnerProfile(tenantId: string, userId: string, expectedVersion: number, signals: LearnerProfileSignal[]): Awaitable<LearnerProfile>
  saveImportDraft(draft: ImportDraft): Awaitable<ImportDraft>
  getImportDraft(tenantId: string, draftId: string): Awaitable<ImportDraft | undefined>
  confirmIcsImport(tenantId: string, draftId: string): Awaitable<IcsImportResult>
  scheduleDailyDigest(tenantId: string, userId: string, runAt: string): Awaitable<NotificationJob>
  cancelDailyDigestJobs(tenantId: string, userId: string): Awaitable<number>
  claimNotificationJobs(batchSize: number, now?: Date): Awaitable<NotificationJob[]>
  completeNotificationJob(
    job: NotificationJob,
    result: { status: 'completed' | 'skipped'; detail?: string; nextRunAt?: string },
    completedAt?: Date,
  ): Awaitable<void>
  failNotificationJob(job: NotificationJob, message: string, failedAt?: Date): Awaitable<'retrying' | 'failed'>
  claimLifecycleJobs(batchSize: number, now?: Date): Awaitable<LifecycleJob[]>
  completeLifecycleJob(job: LifecycleJob, completedAt?: Date): Awaitable<boolean>
  failLifecycleJob(job: LifecycleJob, message: string, failedAt?: Date): Awaitable<'retrying' | 'failed'>
  requestAccountDeletion(tenantId: string, userId: string): Awaitable<AccountDeletionReceipt>
  saveEvent(event: Omit<ProductEvent, 'id' | 'createdAt'>): Awaitable<ProductEvent>
  getMetrics(tenantId: string): Awaitable<Record<string, number>>
  deleteTenant(tenantId: string): Awaitable<void>
}

type Session = {
  token: string
  userId: string
  tenantId: string
  createdAt: string
  expiresAt: string
}

type ProductEvent = {
  id: string
  tenantId: string
  userId: string
  name: string
  properties: Record<string, unknown>
  createdAt: string
}

const nowIso = () => new Date().toISOString()
const afterHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()

export class InMemoryRepository implements Repository {
  private tenants = new Map<string, Tenant>()
  private users = new Map<string, User>()
  private sessions = new Map<string, Session>()
  private authActionTokens = new Map<string, AuthActionToken>()
  private courses = new Map<string, Course>()
  private tasks = new Map<string, Task>()
  private documents = new Map<string, SourceDocument>()
  private extractionJobs = new Map<string, ExtractionJob>()
  private availabilityBlocks = new Map<string, AvailabilityBlock>()
  private assessments = new Map<string, PriorityAssessment>()
  private plans = new Map<string, StudyPlan>()
  private checkIns = new Map<string, CoachCheckIn>()
  private replanProposals = new Map<string, ReplanProposal>()
  private consents = new Map<string, ConsentAudit>()
  private learnerProfiles = new Map<string, LearnerProfile>()
  private importDrafts = new Map<string, ImportDraft>()
  private notificationJobs = new Map<string, NotificationJob>()
  private lifecycleJobs = new Map<string, LifecycleJob>()
  private deletionReceipts = new Map<string, AccountDeletionReceipt>()
  private events = new Map<string, ProductEvent>()
  private deletingTenants = new Set<string>()
  private demoUserId?: string

  async seedDemo(): Promise<void> {
    if (this.demoUserId) return

    const tenantId = randomUUID()
    const userId = randomUUID()
    const createdAt = nowIso()
    this.tenants.set(tenantId, { id: tenantId, kind: 'personal', name: 'Mai Nguyen', createdAt })
    this.users.set(userId, {
      id: userId,
      tenantId,
      email: 'mai@demo.priorilearn.app',
      emailVerifiedAt: createdAt,
      name: 'Mai Nguyen',
      locale: 'vi',
      role: 'student',
      passwordHash: await hashPassword('demo-priorilearn'),
      createdAt,
    })
    this.demoUserId = userId

    const programming = this.createCourse(tenantId, {
      code: 'CS304',
      name: 'Programming',
      currentScore: 54,
      targetScore: 78,
    })
    const marketing = this.createCourse(tenantId, {
      code: 'MKT201',
      name: 'Marketing',
      currentScore: 62,
      targetScore: 75,
    })
    const statistics = this.createCourse(tenantId, {
      code: 'STA210',
      name: 'Statistics',
      currentScore: 71,
      targetScore: 78,
    })

    this.createTask(tenantId, {
      courseId: programming.id,
      title: 'Assignment 3: API design',
      dueAt: afterHours(47),
      gradeWeight: 30,
      estimatedMinutes: 45,
      sourceKind: 'demo',
      status: 'confirmed',
      confidence: 0.98,
      evidence: ['Assignment brief: 30% of course grade'],
    })
    this.createTask(tenantId, {
      courseId: marketing.id,
      title: 'Research quiz 04',
      dueAt: afterHours(25),
      gradeWeight: 5,
      estimatedMinutes: 25,
      sourceKind: 'demo',
      status: 'confirmed',
      confidence: 0.94,
      evidence: ['Syllabus week 6 assessment table'],
    })
    this.createTask(tenantId, {
      courseId: statistics.id,
      title: 'Week 6 problem set',
      dueAt: afterHours(76),
      gradeWeight: 10,
      estimatedMinutes: 60,
      sourceKind: 'demo',
      status: 'confirmed',
      confidence: 0.91,
      evidence: ['Course calendar week 6'],
    })
  }

  async createPersonalAccount(input: { email: string; password: string; name: string; locale: 'vi' | 'en'; googleSubject?: string }): Promise<User> {
    const normalizedEmail = input.email.trim().toLowerCase()
    if (this.findUserByEmail(normalizedEmail)) throw new Error('EMAIL_EXISTS')

    const tenantId = randomUUID()
    const createdAt = nowIso()
    const tenant: Tenant = { id: tenantId, kind: 'personal', name: input.name, createdAt }
    const user: User = {
      id: randomUUID(),
      tenantId,
      email: normalizedEmail,
      name: input.name,
      locale: input.locale,
      role: 'student',
      passwordHash: await hashPassword(input.password),
      googleSubject: input.googleSubject,
      emailVerifiedAt: input.googleSubject ? createdAt : undefined,
      createdAt,
    }
    this.tenants.set(tenant.id, tenant)
    this.users.set(user.id, user)
    return user
  }

  findUserByEmail(email: string): User | undefined {
    const normalizedEmail = email.trim().toLowerCase()
    return [...this.users.values()].find((user) => user.email === normalizedEmail && !this.deletingTenants.has(user.tenantId))
  }

  findUserByGoogleSubject(googleSubject: string): User | undefined {
    return [...this.users.values()].find((user) => user.googleSubject === googleSubject && !this.deletingTenants.has(user.tenantId))
  }

  linkGoogleSubject(tenantId: string, userId: string, googleSubject: string): User | undefined {
    const user = this.users.get(userId)
    if (!user || user.tenantId !== tenantId || this.deletingTenants.has(tenantId)) return undefined
    const linked = this.findUserByGoogleSubject(googleSubject)
    if (linked && linked.id !== user.id) throw new Error('GOOGLE_SUBJECT_EXISTS')
    if (user.googleSubject && user.googleSubject !== googleSubject) throw new Error('GOOGLE_SUBJECT_EXISTS')
    const updated = { ...user, googleSubject, emailVerifiedAt: user.emailVerifiedAt ?? nowIso() }
    this.users.set(updated.id, updated)
    return updated
  }

  markEmailVerified(tenantId: string, userId: string): User | undefined {
    const user = this.users.get(userId)
    if (!user || user.tenantId !== tenantId || this.deletingTenants.has(tenantId)) return undefined
    const updated = { ...user, emailVerifiedAt: user.emailVerifiedAt ?? nowIso() }
    this.users.set(updated.id, updated)
    return updated
  }

  createAuthActionToken(user: User, purpose: AuthActionPurpose, tokenHash: string, expiresAt: string): void {
    const createdAt = nowIso()
    for (const [id, token] of this.authActionTokens) {
      if (token.userId === user.id && token.tenantId === user.tenantId && token.purpose === purpose && !token.consumedAt) {
        this.authActionTokens.set(id, { ...token, consumedAt: createdAt })
      }
    }
    const token: AuthActionToken = {
      id: randomUUID(),
      tenantId: user.tenantId,
      userId: user.id,
      purpose,
      tokenHash,
      expiresAt,
      createdAt,
    }
    this.authActionTokens.set(token.id, token)
  }

  verifyEmailWithToken(tokenHash: string): User | undefined {
    const token = [...this.authActionTokens.values()].find((candidate) => (
      candidate.tokenHash === tokenHash
      && candidate.purpose === 'email_verification'
      && !candidate.consumedAt
      && new Date(candidate.expiresAt) > new Date()
    ))
    if (!token) return undefined
    const user = this.users.get(token.userId)
    if (!user || user.tenantId !== token.tenantId || this.deletingTenants.has(token.tenantId)) return undefined
    const consumedAt = nowIso()
    this.authActionTokens.set(token.id, { ...token, consumedAt })
    const verified = { ...user, emailVerifiedAt: user.emailVerifiedAt ?? consumedAt }
    this.users.set(user.id, verified)
    return verified
  }

  resetPasswordWithToken(tokenHash: string, passwordHash: string): User | undefined {
    const token = [...this.authActionTokens.values()].find((candidate) => (
      candidate.tokenHash === tokenHash
      && candidate.purpose === 'password_reset'
      && !candidate.consumedAt
      && new Date(candidate.expiresAt) > new Date()
    ))
    if (!token) return undefined
    const user = this.users.get(token.userId)
    if (!user || user.tenantId !== token.tenantId || this.deletingTenants.has(token.tenantId)) return undefined
    const consumedAt = nowIso()
    this.authActionTokens.set(token.id, { ...token, consumedAt })
    const updated = {
      ...user,
      passwordHash,
      emailVerifiedAt: user.emailVerifiedAt ?? consumedAt,
    }
    this.users.set(user.id, updated)
    for (const [sessionToken, session] of this.sessions) {
      if (session.userId === user.id && session.tenantId === user.tenantId) this.sessions.delete(sessionToken)
    }
    return updated
  }

  getUser(tenantId: string, userId: string): User | undefined {
    const user = this.users.get(userId)
    return user?.tenantId === tenantId && !this.deletingTenants.has(tenantId) ? user : undefined
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId)
  }

  getDemoUser(): User {
    const user = this.demoUserId ? this.users.get(this.demoUserId) : undefined
    if (!user) throw new Error('DEMO_NOT_SEEDED')
    return user
  }

  createSession(user: User): string {
    const token = createSessionToken()
    this.sessions.set(token, {
      token,
      userId: user.id,
      tenantId: user.tenantId,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    })
    return token
  }

  resolveSession(token: string): { user: User; tenant: Tenant } | undefined {
    const session = this.sessions.get(token)
    if (!session) return undefined
    if (new Date(session.expiresAt) <= new Date()) {
      this.sessions.delete(token)
      return undefined
    }
    const user = this.users.get(session.userId)
    const tenant = this.tenants.get(session.tenantId)
    return user && tenant && !this.deletingTenants.has(tenant.id) ? { user, tenant } : undefined
  }

  revokeSession(token: string): boolean {
    return this.sessions.delete(token)
  }

  createCourse(
    tenantId: string,
    input: Pick<Course, 'code' | 'name' | 'currentScore' | 'targetScore'> & { sourceDocumentId?: string },
  ): Course {
    const existing = this.listCourses(tenantId).find((course) => course.code.toLowerCase() === input.code.toLowerCase())
    if (existing) return existing
    const course: Course = { id: randomUUID(), tenantId, createdAt: nowIso(), ...input }
    this.courses.set(course.id, course)
    return course
  }

  getCourse(tenantId: string, courseId: string): Course | undefined {
    const course = this.courses.get(courseId)
    return course?.tenantId === tenantId ? course : undefined
  }

  listCourses(tenantId: string): Course[] {
    return [...this.courses.values()].filter((course) => course.tenantId === tenantId)
  }

  createTask(
    tenantId: string,
    input: Pick<Task, 'courseId' | 'title' | 'dueAt' | 'gradeWeight' | 'estimatedMinutes' | 'status' | 'sourceKind' | 'confidence' | 'evidence'>
      & { sourceDocumentId?: string; sourceImportDraftId?: string },
  ): Task {
    const timestamp = nowIso()
    const task: Task = { id: randomUUID(), tenantId, createdAt: timestamp, updatedAt: timestamp, ...input }
    this.tasks.set(task.id, task)
    return task
  }

  getTask(tenantId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId)
    return task?.tenantId === tenantId ? task : undefined
  }

  listTasks(tenantId: string): Task[] {
    return [...this.tasks.values()].filter((task) => task.tenantId === tenantId)
  }

  updateTask(tenantId: string, taskId: string, patch: Partial<Task>): Task | undefined {
    const task = this.getTask(tenantId, taskId)
    if (!task) return undefined
    const updated: Task = { ...task, ...patch, id: task.id, tenantId, updatedAt: nowIso() }
    this.tasks.set(task.id, updated)
    return updated
  }

  beginDocumentUpload(document: SourceDocument): DocumentUploadResult {
    if (!document.idempotencyKey) throw new Error('DOCUMENT_IDEMPOTENCY_KEY_REQUIRED')
    const existing = [...this.documents.values()].find((candidate) => (
      candidate.tenantId === document.tenantId && candidate.idempotencyKey === document.idempotencyKey
    ))
    if (existing) return { document: existing, created: false }

    const saved = this.saveDocument(document)
    const timestamp = nowIso()
    const job: LifecycleJob = {
      id: randomUUID(),
      tenantId: document.tenantId,
      kind: 'document_raw_delete',
      resourceId: document.id,
      storageKey: document.storageKey,
      status: 'pending',
      attempts: 0,
      runAt: document.expiresAt,
      idempotencyKey: `document:${document.id}:raw-delete`,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.lifecycleJobs.set(job.id, job)
    return { document: saved, created: true }
  }

  saveDocument(document: SourceDocument): SourceDocument {
    const saved = { ...document, updatedAt: nowIso() }
    this.documents.set(document.id, saved)
    return saved
  }

  getDocument(tenantId: string, documentId: string): SourceDocument | undefined {
    const document = this.documents.get(documentId)
    return document?.tenantId === tenantId ? document : undefined
  }

  listDocuments(tenantId: string): SourceDocument[] {
    return [...this.documents.values()].filter((document) => document.tenantId === tenantId)
  }

  listDocumentsPage(tenantId: string, input: DocumentPageInput): CursorPage<SourceDocument> {
    const ordered = this.listDocuments(tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter((document) => !input.before
        || document.createdAt < input.before.createdAt
        || (document.createdAt === input.before.createdAt && document.id < input.before.id))
    const results = ordered.slice(0, input.limit + 1)
    const items = results.slice(0, input.limit)
    const last = items.at(-1)
    return { items, next: results.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : undefined }
  }

  listExpiredDocuments(now: Date): SourceDocument[] {
    return [...this.documents.values()].filter((document) => !document.rawDeletedAt && new Date(document.expiresAt) <= now)
  }

  deleteDocument(tenantId: string, documentId: string): SourceDocument | undefined {
    const document = this.getDocument(tenantId, documentId)
    if (!document) return undefined
    this.documents.delete(document.id)
    for (const [id, job] of this.extractionJobs) {
      if (job.tenantId === tenantId && job.documentId === documentId) this.extractionJobs.delete(id)
    }
    return document
  }

  enqueueDocumentExtraction(tenantId: string, documentId: string): { job: ExtractionJob; document: SourceDocument } {
    const document = this.getDocument(tenantId, documentId)
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 'Document was not found.')
    const existing = [...this.extractionJobs.values()].find((job) => (
      job.tenantId === tenantId && job.documentId === documentId
    ))
    const timestamp = nowIso()
    let job: ExtractionJob
    if (existing) {
      job = existing.status === 'failed'
        ? {
          ...existing,
          status: 'pending',
          attempts: 0,
          runAt: timestamp,
          leaseToken: undefined,
          leasedUntil: undefined,
          lastError: undefined,
          updatedAt: timestamp,
          completedAt: undefined,
        }
        : existing
      this.extractionJobs.set(job.id, job)
    } else {
      job = {
        id: randomUUID(),
        tenantId,
        documentId,
        status: 'pending',
        attempts: 0,
        runAt: timestamp,
        idempotencyKey: `document-extraction:${documentId}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.extractionJobs.set(job.id, job)
    }
    const queuedDocument = document.status === 'review' || document.status === 'confirmed'
      ? document
      : this.saveDocument({ ...document, status: 'extracting' })
    return { job, document: queuedDocument }
  }

  claimExtractionJobs(batchSize: number, now = new Date()): ExtractionJob[] {
    const boundedBatch = Math.min(10, Math.max(1, batchSize))
    const due = [...this.extractionJobs.values()]
      .filter((job) => job.status === 'pending'
        ? new Date(job.runAt) <= now
        : job.status === 'leased' && job.leasedUntil !== undefined && new Date(job.leasedUntil) <= now)
      .sort((left, right) => left.runAt.localeCompare(right.runAt) || left.createdAt.localeCompare(right.createdAt))
      .slice(0, boundedBatch)
    return due.map((job) => {
      const leased: ExtractionJob = {
        ...job,
        status: 'leased',
        attempts: job.attempts + 1,
        leaseToken: randomUUID(),
        leasedUntil: new Date(now.getTime() + 15 * 60_000).toISOString(),
        updatedAt: now.toISOString(),
      }
      this.extractionJobs.set(leased.id, leased)
      return leased
    })
  }

  completeExtractionJob(
    job: ExtractionJob,
    extraction: DocumentExtraction,
    provider: string,
    completedAt = new Date(),
  ): SourceDocument {
    const current = this.extractionJobs.get(job.id)
    if (!current || current.tenantId !== job.tenantId || current.status !== 'leased' || current.leaseToken !== job.leaseToken) {
      throw new RepositoryError('EXTRACTION_LEASE_CONFLICT', 'The extraction job lease is no longer current.')
    }
    const document = this.getDocument(job.tenantId, job.documentId)
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 'Document was not found.')
    const timestamp = completedAt.toISOString()
    const updated = this.saveDocument({
      ...document,
      status: 'review',
      extraction,
      extractionProvider: provider,
    })
    this.extractionJobs.set(current.id, {
      ...current,
      status: 'completed',
      leaseToken: undefined,
      leasedUntil: undefined,
      lastError: undefined,
      updatedAt: timestamp,
      completedAt: timestamp,
    })
    return updated
  }

  failExtractionJob(
    job: ExtractionJob,
    message: string,
    retryable: boolean,
    failedAt = new Date(),
  ): 'retrying' | 'failed' {
    const current = this.extractionJobs.get(job.id)
    if (!current || current.tenantId !== job.tenantId || current.status !== 'leased' || current.leaseToken !== job.leaseToken) {
      throw new RepositoryError('EXTRACTION_LEASE_CONFLICT', 'The extraction job lease is no longer current.')
    }
    const permanentlyFailed = !retryable || current.attempts >= 5
    const retryDelayMinutes = Math.min(30, 2 ** Math.min(current.attempts, 5))
    this.extractionJobs.set(current.id, {
      ...current,
      status: permanentlyFailed ? 'failed' : 'pending',
      runAt: permanentlyFailed ? current.runAt : new Date(failedAt.getTime() + retryDelayMinutes * 60_000).toISOString(),
      leaseToken: undefined,
      leasedUntil: undefined,
      lastError: message.slice(0, 1_000),
      updatedAt: failedAt.toISOString(),
      completedAt: permanentlyFailed ? failedAt.toISOString() : undefined,
    })
    if (permanentlyFailed) {
      const document = this.getDocument(job.tenantId, job.documentId)
      if (document) this.saveDocument({ ...document, status: 'extraction_failed' })
    }
    return permanentlyFailed ? 'failed' : 'retrying'
  }

  confirmDocumentImport(tenantId: string, documentId: string, extraction: DocumentExtraction): DocumentImportResult {
    const document = this.getDocument(tenantId, documentId)
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 'Document was not found.')
    if (document.status === 'confirmed') {
      const tasks = this.listTasks(tenantId).filter((task) => task.sourceDocumentId === document.id)
      const courseIds = new Set(tasks.map((task) => task.courseId))
      const courses = this.listCourses(tenantId).filter((course) => course.sourceDocumentId === document.id || courseIds.has(course.id))
      return { document, courses, tasks }
    }
    if (document.status !== 'review') {
      throw new RepositoryError('EXTRACTION_NOT_READY', 'Extract and review this document before confirming it.')
    }

    const stagedCourses: Course[] = []
    const courseByCode = new Map<string, Course>()
    for (const extracted of extraction.courses) {
      const existing = this.listCourses(tenantId).find((course) => course.code.toLowerCase() === extracted.code.toLowerCase())
      const course = existing ?? {
        id: randomUUID(),
        tenantId,
        code: extracted.code,
        name: extracted.name,
        currentScore: extracted.currentScore,
        targetScore: extracted.targetScore,
        sourceDocumentId: document.id,
        createdAt: nowIso(),
      }
      if (!existing) stagedCourses.push(course)
      courseByCode.set(course.code.toLowerCase(), course)
    }
    let fallbackCourse = stagedCourses[0] ?? [...courseByCode.values()][0]
    if (!fallbackCourse) {
      fallbackCourse = {
        id: randomUUID(), tenantId, code: `DOC-${document.id.slice(0, 6)}`, name: 'Imported course',
        currentScore: null, targetScore: null, sourceDocumentId: document.id, createdAt: nowIso(),
      }
      stagedCourses.push(fallbackCourse)
    }
    const timestamp = nowIso()
    const stagedTasks = extraction.tasks.map<Task>((task) => ({
      id: randomUUID(),
      tenantId,
      courseId: courseByCode.get(task.courseCode.toLowerCase())?.id ?? fallbackCourse.id,
      sourceDocumentId: document.id,
      title: task.title,
      dueAt: task.dueAt,
      gradeWeight: task.gradeWeight,
      estimatedMinutes: task.estimatedMinutes,
      status: 'confirmed',
      sourceKind: 'document',
      confidence: task.confidence,
      evidence: task.evidence,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))

    for (const course of stagedCourses) this.courses.set(course.id, course)
    for (const task of stagedTasks) this.tasks.set(task.id, task)
    const confirmed = this.saveDocument({ ...document, extraction, status: 'confirmed' })
    const returnedCourses = [...new Map([...courseByCode.values(), ...stagedCourses].map((course) => [course.id, course])).values()]
    return { document: confirmed, courses: returnedCourses, tasks: stagedTasks }
  }

  createAvailabilityBlock(
    tenantId: string,
    input: Pick<AvailabilityBlock, 'title' | 'startsAt' | 'endsAt' | 'sourceKind'> & { sourceImportDraftId?: string },
  ): AvailabilityBlock {
    const block: AvailabilityBlock = { id: randomUUID(), tenantId, createdAt: nowIso(), ...input }
    this.availabilityBlocks.set(block.id, block)
    return block
  }

  listAvailabilityBlocks(tenantId: string): AvailabilityBlock[] {
    return [...this.availabilityBlocks.values()].filter((block) => block.tenantId === tenantId)
  }

  saveAssessment(assessment: PriorityAssessment): PriorityAssessment {
    this.assessments.set(assessment.id, assessment)
    return assessment
  }

  savePlan(plan: StudyPlan): StudyPlan {
    this.plans.set(plan.id, plan)
    return plan
  }

  getPlan(tenantId: string, planId: string): StudyPlan | undefined {
    const plan = this.plans.get(planId)
    return plan?.tenantId === tenantId ? plan : undefined
  }

  listPlans(tenantId: string): StudyPlan[] {
    return [...this.plans.values()].filter((plan) => plan.tenantId === tenantId)
  }

  nextPlanVersion(tenantId: string): number {
    return Math.max(0, ...this.listPlans(tenantId).map((plan) => plan.version)) + 1
  }

  getCurrentPlan(tenantId: string): CurrentPlan {
    const plans = this.listPlans(tenantId).sort((left, right) => right.version - left.version)
    return {
      active: plans.find((plan) => plan.status === 'approved') ?? null,
      pending: plans.find((plan) => plan.status === 'proposed') ?? null,
    }
  }

  createPlanProposal(tenantId: string, input: PlanProposalInput): StudyPlan {
    const current = this.getCurrentPlan(tenantId)
    if (current.pending) return current.pending
    const plan: StudyPlan = {
      id: randomUUID(),
      tenantId,
      version: this.nextPlanVersion(tenantId),
      status: 'proposed',
      previousPlanId: input.previousPlanId ?? current.active?.id,
      items: input.items,
      rationale: input.rationale,
      createdAt: nowIso(),
    }
    this.plans.set(plan.id, plan)
    return plan
  }

  replacePlanProposal(tenantId: string, planId: string, expectedVersion: number, input: PlanProposalInput): StudyPlan {
    const current = this.getPlan(tenantId, planId)
    if (!current) throw new RepositoryError('PLAN_NOT_FOUND', 'Plan was not found.')
    if (current.version !== expectedVersion) throw new RepositoryError('PLAN_VERSION_CONFLICT', 'The plan changed. Review the latest version.')
    if (current.status !== 'proposed') throw new RepositoryError('PLAN_NOT_APPROVABLE', 'Only a proposed plan can be edited.')

    this.plans.set(current.id, { ...current, status: 'superseded' })
    const replacement: StudyPlan = {
      id: randomUUID(),
      tenantId,
      version: this.nextPlanVersion(tenantId),
      status: 'proposed',
      previousPlanId: current.id,
      items: input.items,
      rationale: input.rationale,
      createdAt: nowIso(),
    }
    this.plans.set(replacement.id, replacement)
    return replacement
  }

  approvePlan(tenantId: string, planId: string, expectedVersion: number, approvalReceipt: string): StudyPlan {
    const plan = this.getPlan(tenantId, planId)
    if (!plan) throw new RepositoryError('PLAN_NOT_FOUND', 'Plan was not found.')
    if (plan.version !== expectedVersion) throw new RepositoryError('PLAN_VERSION_CONFLICT', 'The plan changed. Review the latest version.')
    if (plan.status === 'approved') return plan
    if (plan.status !== 'proposed') throw new RepositoryError('PLAN_NOT_APPROVABLE', 'Only a proposed plan can be approved.')

    for (const candidate of this.listPlans(tenantId)) {
      if (candidate.status === 'approved') this.plans.set(candidate.id, { ...candidate, status: 'superseded' })
    }
    const approved: StudyPlan = {
      ...plan,
      status: 'approved',
      approvedAt: nowIso(),
      approvalReceipt,
    }
    this.plans.set(approved.id, approved)
    return approved
  }

  saveCheckIn(checkIn: CoachCheckIn): CoachCheckIn {
    this.checkIns.set(checkIn.id, checkIn)
    return checkIn
  }

  saveReplanProposal(proposal: ReplanProposal): ReplanProposal {
    this.replanProposals.set(proposal.id, proposal)
    return proposal
  }

  getReplanProposal(tenantId: string, proposalId: string): ReplanProposal | undefined {
    const proposal = this.replanProposals.get(proposalId)
    return proposal?.tenantId === tenantId ? proposal : undefined
  }

  saveConsent(consent: ConsentAudit): ConsentAudit {
    this.consents.set(consent.id, consent)
    return consent
  }

  listConsents(tenantId: string): ConsentAudit[] {
    return [...this.consents.values()].filter((consent) => consent.tenantId === tenantId)
  }

  getLearnerProfile(tenantId: string, userId: string): LearnerProfile | undefined {
    const profile = this.learnerProfiles.get(userId)
    if (!profile || profile.tenantId !== tenantId) return undefined
    return { ...profile, approvedSignals: profile.approvedSignals.map((signal) => ({ ...signal })) }
  }

  updateLearnerProfile(tenantId: string, userId: string, expectedVersion: number, signals: LearnerProfileSignal[]): LearnerProfile {
    const existing = this.learnerProfiles.get(userId)
    const timestamp = nowIso()
    if (!existing) {
      if (expectedVersion !== 0) {
        throw new RepositoryError('LEARNER_PROFILE_VERSION_CONFLICT', 'The learner profile changed. Reload it before saving again.')
      }
      const profile: LearnerProfile = {
        id: randomUUID(),
        tenantId,
        userId,
        approvedSignals: signals.map((signal) => ({ ...signal })),
        sourceEventCount: 0,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.learnerProfiles.set(userId, profile)
      return { ...profile, approvedSignals: profile.approvedSignals.map((signal) => ({ ...signal })) }
    }
    if (existing.tenantId !== tenantId || existing.version !== expectedVersion) {
      throw new RepositoryError('LEARNER_PROFILE_VERSION_CONFLICT', 'The learner profile changed. Reload it before saving again.')
    }
    const updated: LearnerProfile = {
      ...existing,
      approvedSignals: signals.map((signal) => ({ ...signal })),
      version: existing.version + 1,
      updatedAt: timestamp,
    }
    this.learnerProfiles.set(userId, updated)
    return { ...updated, approvedSignals: updated.approvedSignals.map((signal) => ({ ...signal })) }
  }

  saveImportDraft(draft: ImportDraft): ImportDraft {
    this.importDrafts.set(draft.id, draft)
    return draft
  }

  getImportDraft(tenantId: string, draftId: string): ImportDraft | undefined {
    const draft = this.importDrafts.get(draftId)
    return draft?.tenantId === tenantId ? draft : undefined
  }

  confirmIcsImport(tenantId: string, draftId: string): IcsImportResult {
    const draft = this.getImportDraft(tenantId, draftId)
    if (!draft) throw new RepositoryError('IMPORT_NOT_FOUND', 'Import draft was not found.')
    if (draft.status === 'confirmed') {
      return {
        draft,
        tasks: this.listTasks(tenantId).filter((task) => task.sourceImportDraftId === draft.id),
        busyBlocks: this.listAvailabilityBlocks(tenantId).filter((block) => block.sourceImportDraftId === draft.id),
      }
    }
    if (draft.status !== 'review') throw new RepositoryError('IMPORT_NOT_READY', 'Review this import before confirming it.')

    const existingCourse = this.listCourses(tenantId).find((course) => course.code.toLowerCase() === 'calendar')
    const course: Course = existingCourse ?? {
      id: randomUUID(), tenantId, code: 'CALENDAR', name: 'Calendar imports',
      currentScore: null, targetScore: null, createdAt: nowIso(),
    }
    const timestamp = nowIso()
    const tasks = draft.tasks.map<Task>((task) => ({
      id: randomUUID(), tenantId, courseId: course.id, sourceImportDraftId: draft.id,
      title: task.title, dueAt: task.dueAt, gradeWeight: null, estimatedMinutes: task.estimatedMinutes,
      status: 'confirmed', sourceKind: 'ics', confidence: task.confidence, evidence: task.evidence,
      createdAt: timestamp, updatedAt: timestamp,
    }))
    const busyBlocks = draft.busyBlocks.map<AvailabilityBlock>((block) => ({
      id: randomUUID(), tenantId, sourceImportDraftId: draft.id, sourceKind: 'ics',
      title: block.title, startsAt: block.startsAt, endsAt: block.endsAt, createdAt: timestamp,
    }))

    if (!existingCourse) this.courses.set(course.id, course)
    for (const task of tasks) this.tasks.set(task.id, task)
    for (const block of busyBlocks) this.availabilityBlocks.set(block.id, block)
    const confirmed = { ...draft, status: 'confirmed' as const }
    this.importDrafts.set(draft.id, confirmed)
    return { draft: confirmed, tasks, busyBlocks }
  }

  scheduleDailyDigest(tenantId: string, userId: string, runAt: string): NotificationJob {
    if (!this.getUser(tenantId, userId)) throw new Error('USER_NOT_FOUND')
    const parsedRunAt = new Date(runAt)
    if (Number.isNaN(parsedRunAt.getTime())) throw new Error('INVALID_NOTIFICATION_RUN_AT')
    const normalizedRunAt = parsedRunAt.toISOString()
    const digestDate = normalizedRunAt.slice(0, 10)
    const idempotencyKey = `daily-digest:${userId}:${digestDate}`
    const existing = [...this.notificationJobs.values()].find((job) => job.idempotencyKey === idempotencyKey)
    if (existing) return existing
    const timestamp = nowIso()
    const job: NotificationJob = {
      id: randomUUID(),
      tenantId,
      userId,
      kind: 'daily_digest',
      digestDate,
      status: 'pending',
      attempts: 0,
      runAt: normalizedRunAt,
      idempotencyKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.notificationJobs.set(job.id, job)
    return job
  }

  cancelDailyDigestJobs(tenantId: string, userId: string): number {
    let cancelled = 0
    const timestamp = nowIso()
    for (const [id, job] of this.notificationJobs) {
      if (job.tenantId === tenantId && job.userId === userId && job.kind === 'daily_digest' && job.status === 'pending') {
        this.notificationJobs.set(id, { ...job, status: 'cancelled', updatedAt: timestamp, completedAt: timestamp })
        cancelled += 1
      }
    }
    return cancelled
  }

  claimNotificationJobs(batchSize: number, now = new Date()): NotificationJob[] {
    const boundedBatch = Math.min(100, Math.max(1, batchSize))
    const due = [...this.notificationJobs.values()]
      .filter((job) => job.status === 'pending'
        ? new Date(job.runAt) <= now
        : job.status === 'leased' && job.leasedUntil !== undefined && new Date(job.leasedUntil) <= now)
      .sort((left, right) => left.runAt.localeCompare(right.runAt) || left.createdAt.localeCompare(right.createdAt))
      .slice(0, boundedBatch)

    return due.map((job) => {
      const leased: NotificationJob = {
        ...job,
        status: 'leased',
        attempts: job.attempts + 1,
        leaseToken: randomUUID(),
        leasedUntil: new Date(now.getTime() + 15 * 60_000).toISOString(),
        updatedAt: now.toISOString(),
      }
      this.notificationJobs.set(leased.id, leased)
      return leased
    })
  }

  completeNotificationJob(
    job: NotificationJob,
    result: { status: 'completed' | 'skipped'; detail?: string; nextRunAt?: string },
    completedAt = new Date(),
  ): void {
    const current = this.notificationJobs.get(job.id)
    if (!current || current.tenantId !== job.tenantId || current.status !== 'leased' || current.leaseToken !== job.leaseToken) {
      throw new RepositoryError('NOTIFICATION_LEASE_CONFLICT', 'The notification job lease is no longer current.')
    }
    const timestamp = completedAt.toISOString()
    this.notificationJobs.set(current.id, {
      ...current,
      status: result.status,
      leaseToken: undefined,
      leasedUntil: undefined,
      lastError: result.detail,
      updatedAt: timestamp,
      completedAt: timestamp,
    })
    if (result.nextRunAt && this.getUser(job.tenantId, job.userId)) {
      this.scheduleDailyDigest(job.tenantId, job.userId, result.nextRunAt)
    }
  }

  failNotificationJob(job: NotificationJob, message: string, failedAt = new Date()): 'retrying' | 'failed' {
    const current = this.notificationJobs.get(job.id)
    if (!current || current.tenantId !== job.tenantId || current.status !== 'leased' || current.leaseToken !== job.leaseToken) {
      throw new RepositoryError('NOTIFICATION_LEASE_CONFLICT', 'The notification job lease is no longer current.')
    }
    const permanentlyFailed = current.attempts >= 8
    const retryDelayMinutes = Math.min(12 * 60, 2 ** Math.min(current.attempts, 9))
    this.notificationJobs.set(current.id, {
      ...current,
      status: permanentlyFailed ? 'failed' : 'pending',
      runAt: new Date(failedAt.getTime() + retryDelayMinutes * 60_000).toISOString(),
      leaseToken: undefined,
      leasedUntil: undefined,
      lastError: message.slice(0, 1_000),
      updatedAt: failedAt.toISOString(),
      completedAt: permanentlyFailed ? failedAt.toISOString() : undefined,
    })
    return permanentlyFailed ? 'failed' : 'retrying'
  }

  claimLifecycleJobs(batchSize: number, now = new Date()): LifecycleJob[] {
    const boundedBatch = Math.min(100, Math.max(1, batchSize))
    const due = [...this.lifecycleJobs.values()]
      .filter((job) => job.status === 'pending'
        ? new Date(job.runAt) <= now
        : job.status === 'leased' && job.leasedUntil !== undefined && new Date(job.leasedUntil) <= now)
      .sort((left, right) => left.runAt.localeCompare(right.runAt) || left.createdAt.localeCompare(right.createdAt))
      .slice(0, boundedBatch)

    return due.map((job) => {
      const leased: LifecycleJob = {
        ...job,
        status: 'leased',
        attempts: job.attempts + 1,
        leaseToken: randomUUID(),
        leasedUntil: new Date(now.getTime() + 15 * 60_000).toISOString(),
        updatedAt: now.toISOString(),
      }
      this.lifecycleJobs.set(leased.id, leased)
      return leased
    })
  }

  completeLifecycleJob(job: LifecycleJob, completedAt = new Date()): boolean {
    const current = this.lifecycleJobs.get(job.id)
    if (!current || current.tenantId !== job.tenantId || current.status !== 'leased' || current.leaseToken !== job.leaseToken) {
      throw new RepositoryError('LIFECYCLE_LEASE_CONFLICT', 'The lifecycle job lease is no longer current.')
    }
    if (current.kind === 'document_raw_delete') {
      const document = this.getDocument(current.tenantId, current.resourceId)
      if (document) this.saveDocument({ ...document, rawDeletedAt: completedAt.toISOString() })
    } else {
      const relatedObjects = [...this.lifecycleJobs.values()].filter((candidate) => (
        candidate.receiptId === current.receiptId
        && candidate.kind === 'document_raw_delete'
      ))
      const hasFailedObjects = relatedObjects.some((candidate) => candidate.status === 'failed')
      if (hasFailedObjects) {
        if (current.receiptId) {
          const receipt = this.deletionReceipts.get(current.receiptId)
          if (receipt) this.deletionReceipts.set(receipt.id, { ...receipt, status: 'failed' })
        }
        this.lifecycleJobs.set(current.id, {
          ...current,
          status: 'failed',
          leaseToken: undefined,
          leasedUntil: undefined,
          lastError: 'A dependent object cleanup job failed permanently.',
          updatedAt: completedAt.toISOString(),
        })
        return true
      }
      const hasPendingObjects = relatedObjects.some((candidate) => candidate.status !== 'completed')
      if (hasPendingObjects) {
        this.lifecycleJobs.set(current.id, {
          ...current,
          status: 'pending',
          runAt: new Date(completedAt.getTime() + 15 * 60_000).toISOString(),
          leaseToken: undefined,
          leasedUntil: undefined,
          updatedAt: completedAt.toISOString(),
        })
        return false
      }
      this.deleteTenant(current.tenantId)
      if (current.receiptId) {
        const receipt = this.deletionReceipts.get(current.receiptId)
        if (receipt) this.deletionReceipts.set(receipt.id, { ...receipt, status: 'completed', completedAt: completedAt.toISOString() })
      }
    }
    this.lifecycleJobs.set(current.id, {
      ...current,
      status: 'completed',
      leaseToken: undefined,
      leasedUntil: undefined,
      lastError: undefined,
      updatedAt: completedAt.toISOString(),
    })
    return true
  }

  failLifecycleJob(job: LifecycleJob, message: string, failedAt = new Date()): 'retrying' | 'failed' {
    const current = this.lifecycleJobs.get(job.id)
    if (!current || current.tenantId !== job.tenantId || current.status !== 'leased' || current.leaseToken !== job.leaseToken) {
      throw new RepositoryError('LIFECYCLE_LEASE_CONFLICT', 'The lifecycle job lease is no longer current.')
    }
    const permanentlyFailed = current.attempts >= 12
    const retryDelayMinutes = Math.min(24 * 60, 2 ** Math.min(current.attempts, 10))
    this.lifecycleJobs.set(current.id, {
      ...current,
      status: permanentlyFailed ? 'failed' : 'pending',
      runAt: new Date(failedAt.getTime() + retryDelayMinutes * 60_000).toISOString(),
      leaseToken: undefined,
      leasedUntil: undefined,
      lastError: message.slice(0, 1_000),
      updatedAt: failedAt.toISOString(),
    })
    if (permanentlyFailed && current.receiptId) {
      const receipt = this.deletionReceipts.get(current.receiptId)
      if (receipt) this.deletionReceipts.set(receipt.id, { ...receipt, status: 'failed' })
    }
    return permanentlyFailed ? 'failed' : 'retrying'
  }

  requestAccountDeletion(tenantId: string, _userId: string): AccountDeletionReceipt {
    const existing = [...this.deletionReceipts.values()].find((receipt) => receipt.tenantId === tenantId && receipt.status === 'pending')
    if (existing) return existing

    const timestamp = nowIso()
    const receipt: AccountDeletionReceipt = { id: randomUUID(), tenantId, status: 'pending', createdAt: timestamp }
    this.deletionReceipts.set(receipt.id, receipt)
    this.deletingTenants.add(tenantId)
    for (const [token, session] of this.sessions) if (session.tenantId === tenantId) this.sessions.delete(token)

    for (const document of this.listDocuments(tenantId).filter((candidate) => !candidate.rawDeletedAt)) {
      const key = `document:${document.id}:raw-delete`
      const existingJob = [...this.lifecycleJobs.values()].find((job) => job.idempotencyKey === key)
      if (existingJob) {
        this.lifecycleJobs.set(existingJob.id, {
          ...existingJob,
          receiptId: receipt.id,
          runAt: timestamp,
          status: existingJob.status === 'completed' ? 'completed' : 'pending',
          leaseToken: undefined,
          leasedUntil: undefined,
          updatedAt: timestamp,
        })
      } else {
        const job: LifecycleJob = {
          id: randomUUID(), tenantId, kind: 'document_raw_delete', resourceId: document.id,
          storageKey: document.storageKey, receiptId: receipt.id, status: 'pending', attempts: 0,
          runAt: timestamp, idempotencyKey: key, createdAt: timestamp, updatedAt: timestamp,
        }
        this.lifecycleJobs.set(job.id, job)
      }
    }
    const finalize: LifecycleJob = {
      id: randomUUID(), tenantId, kind: 'account_finalize', resourceId: tenantId,
      receiptId: receipt.id, status: 'pending', attempts: 0, runAt: timestamp,
      idempotencyKey: `account:${tenantId}:finalize`, createdAt: timestamp, updatedAt: timestamp,
    }
    this.lifecycleJobs.set(finalize.id, finalize)
    return receipt
  }

  saveEvent(event: Omit<ProductEvent, 'id' | 'createdAt'>): ProductEvent {
    const saved = { ...event, id: randomUUID(), createdAt: nowIso() }
    this.events.set(saved.id, saved)
    return saved
  }

  getMetrics(tenantId: string): Record<string, number> {
    const tenantEvents = [...this.events.values()].filter((event) => event.tenantId === tenantId)
    return tenantEvents.reduce<Record<string, number>>((totals, event) => {
      totals[event.name] = (totals[event.name] ?? 0) + 1
      return totals
    }, {})
  }

  deleteTenant(tenantId: string): void {
    const deleteOwned = <T extends { tenantId: string }>(items: Map<string, T>) => {
      for (const [id, item] of items) if (item.tenantId === tenantId) items.delete(id)
    }
    deleteOwned(this.users)
    deleteOwned(this.authActionTokens)
    deleteOwned(this.courses)
    deleteOwned(this.tasks)
    deleteOwned(this.documents)
    deleteOwned(this.extractionJobs)
    deleteOwned(this.availabilityBlocks)
    deleteOwned(this.assessments)
    deleteOwned(this.plans)
    deleteOwned(this.checkIns)
    deleteOwned(this.replanProposals)
    deleteOwned(this.consents)
    deleteOwned(this.learnerProfiles)
    deleteOwned(this.importDrafts)
    deleteOwned(this.notificationJobs)
    deleteOwned(this.events)
    for (const [token, session] of this.sessions) if (session.tenantId === tenantId) this.sessions.delete(token)
    this.tenants.delete(tenantId)
    this.deletingTenants.delete(tenantId)
    if (this.demoUserId && !this.users.has(this.demoUserId)) this.demoUserId = undefined
  }
}
