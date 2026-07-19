import { randomUUID } from 'node:crypto'
import type {
  AvailabilityBlock,
  CoachCheckIn,
  ConsentAudit,
  Course,
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

export type Awaitable<T> = T | Promise<T>

export type AuthSession = { user: User; tenant: Tenant }

export interface Repository {
  seedDemo(): Awaitable<void>
  createPersonalAccount(input: { email: string; password: string; name: string; locale: 'vi' | 'en' }): Awaitable<User>
  findUserByEmail(email: string): Awaitable<User | undefined>
  getUser(userId: string): Awaitable<User | undefined>
  getTenant(tenantId: string): Awaitable<Tenant | undefined>
  getDemoUser(): Awaitable<User>
  createSession(user: User): Awaitable<string>
  resolveSession(token: string): Awaitable<AuthSession | undefined>
  revokeSession(token: string): Awaitable<boolean>
  createCourse(tenantId: string, input: Pick<Course, 'code' | 'name' | 'currentScore' | 'targetScore'> & { sourceDocumentId?: string }): Awaitable<Course>
  getCourse(tenantId: string, courseId: string): Awaitable<Course | undefined>
  listCourses(tenantId: string): Awaitable<Course[]>
  createTask(tenantId: string, input: Pick<Task, 'courseId' | 'title' | 'dueAt' | 'gradeWeight' | 'estimatedMinutes' | 'status' | 'sourceKind' | 'confidence' | 'evidence'> & { sourceDocumentId?: string }): Awaitable<Task>
  getTask(tenantId: string, taskId: string): Awaitable<Task | undefined>
  listTasks(tenantId: string): Awaitable<Task[]>
  updateTask(tenantId: string, taskId: string, patch: Partial<Task>): Awaitable<Task | undefined>
  saveDocument(document: SourceDocument): Awaitable<SourceDocument>
  getDocument(tenantId: string, documentId: string): Awaitable<SourceDocument | undefined>
  listDocuments(tenantId: string): Awaitable<SourceDocument[]>
  listExpiredDocuments(now: Date): Awaitable<SourceDocument[]>
  deleteDocument(tenantId: string, documentId: string): Awaitable<SourceDocument | undefined>
  createAvailabilityBlock(tenantId: string, input: Pick<AvailabilityBlock, 'title' | 'startsAt' | 'endsAt' | 'sourceKind'>): Awaitable<AvailabilityBlock>
  listAvailabilityBlocks(tenantId: string): Awaitable<AvailabilityBlock[]>
  saveAssessment(assessment: PriorityAssessment): Awaitable<PriorityAssessment>
  savePlan(plan: StudyPlan): Awaitable<StudyPlan>
  getPlan(tenantId: string, planId: string): Awaitable<StudyPlan | undefined>
  listPlans(tenantId: string): Awaitable<StudyPlan[]>
  nextPlanVersion(tenantId: string): Awaitable<number>
  saveCheckIn(checkIn: CoachCheckIn): Awaitable<CoachCheckIn>
  saveReplanProposal(proposal: ReplanProposal): Awaitable<ReplanProposal>
  getReplanProposal(tenantId: string, proposalId: string): Awaitable<ReplanProposal | undefined>
  saveConsent(consent: ConsentAudit): Awaitable<ConsentAudit>
  listConsents(tenantId: string): Awaitable<ConsentAudit[]>
  saveImportDraft(draft: ImportDraft): Awaitable<ImportDraft>
  getImportDraft(tenantId: string, draftId: string): Awaitable<ImportDraft | undefined>
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
  private courses = new Map<string, Course>()
  private tasks = new Map<string, Task>()
  private documents = new Map<string, SourceDocument>()
  private availabilityBlocks = new Map<string, AvailabilityBlock>()
  private assessments = new Map<string, PriorityAssessment>()
  private plans = new Map<string, StudyPlan>()
  private checkIns = new Map<string, CoachCheckIn>()
  private replanProposals = new Map<string, ReplanProposal>()
  private consents = new Map<string, ConsentAudit>()
  private importDrafts = new Map<string, ImportDraft>()
  private events = new Map<string, ProductEvent>()
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

  async createPersonalAccount(input: { email: string; password: string; name: string; locale: 'vi' | 'en' }): Promise<User> {
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
      createdAt,
    }
    this.tenants.set(tenant.id, tenant)
    this.users.set(user.id, user)
    return user
  }

  findUserByEmail(email: string): User | undefined {
    const normalizedEmail = email.trim().toLowerCase()
    return [...this.users.values()].find((user) => user.email === normalizedEmail)
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId)
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
    return user && tenant ? { user, tenant } : undefined
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
      & { sourceDocumentId?: string },
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

  saveDocument(document: SourceDocument): SourceDocument {
    this.documents.set(document.id, document)
    return document
  }

  getDocument(tenantId: string, documentId: string): SourceDocument | undefined {
    const document = this.documents.get(documentId)
    return document?.tenantId === tenantId ? document : undefined
  }

  listDocuments(tenantId: string): SourceDocument[] {
    return [...this.documents.values()].filter((document) => document.tenantId === tenantId)
  }

  listExpiredDocuments(now: Date): SourceDocument[] {
    return [...this.documents.values()].filter((document) => !document.rawDeletedAt && new Date(document.expiresAt) <= now)
  }

  deleteDocument(tenantId: string, documentId: string): SourceDocument | undefined {
    const document = this.getDocument(tenantId, documentId)
    if (!document) return undefined
    this.documents.delete(document.id)
    return document
  }

  createAvailabilityBlock(
    tenantId: string,
    input: Pick<AvailabilityBlock, 'title' | 'startsAt' | 'endsAt' | 'sourceKind'>,
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

  saveImportDraft(draft: ImportDraft): ImportDraft {
    this.importDrafts.set(draft.id, draft)
    return draft
  }

  getImportDraft(tenantId: string, draftId: string): ImportDraft | undefined {
    const draft = this.importDrafts.get(draftId)
    return draft?.tenantId === tenantId ? draft : undefined
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
    deleteOwned(this.courses)
    deleteOwned(this.tasks)
    deleteOwned(this.documents)
    deleteOwned(this.availabilityBlocks)
    deleteOwned(this.assessments)
    deleteOwned(this.plans)
    deleteOwned(this.checkIns)
    deleteOwned(this.replanProposals)
    deleteOwned(this.consents)
    deleteOwned(this.importDrafts)
    deleteOwned(this.events)
    for (const [token, session] of this.sessions) if (session.tenantId === tenantId) this.sessions.delete(token)
    this.tenants.delete(tenantId)
    if (this.demoUserId && !this.users.has(this.demoUserId)) this.demoUserId = undefined
  }
}
