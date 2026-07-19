import { randomBytes, randomUUID } from 'node:crypto'
import cors from 'cors'
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import multer from 'multer'
import { z, type ZodType } from 'zod'
import { loadConfig, type AppConfig } from './config.js'
import {
  CheckInInputSchema,
  ConsentInputSchema,
  DocumentExtractionSchema,
  LoginInputSchema,
  PlanApprovalInputSchema,
  PlanGenerateInputSchema,
  RegisterInputSchema,
  ReplanApprovalInputSchema,
  TaskCreateInputSchema,
  TaskPatchInputSchema,
  type ConsentAudit,
  type ImportDraft,
  type ReplanProposal,
  type SourceDocument,
  type StudyPlan,
} from './domain/contracts.js'
import { verifyPassword } from './lib/auth.js'
import { PostgresRepository } from './postgres-repository.js'
import { InMemoryRepository, type AuthSession, type Repository } from './repository.js'
import { createAiProvider, type AiProvider } from './services/ai-provider.js'
import { parseIcsPreview } from './services/ics.js'
import { assessPriority } from './services/priority.js'
import { purgeExpiredDocuments } from './services/purge.js'
import { schedulePlan } from './services/scheduler.js'
import { LocalObjectStore, SupabaseObjectStore, type ObjectStore } from './storage.js'

type AuthContext = AuthSession

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type ApplicationContext = {
  app: express.Express
  config: AppConfig
  repository: Repository
  objectStore: ObjectStore
  aiProvider: AiProvider
}

type ApplicationOptions = {
  config?: Partial<AppConfig>
  repository?: Repository
  objectStore?: ObjectStore
  aiProvider?: AiProvider
}

const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (request, response, next) => void handler(request, response, next).catch(next)

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request did not match the expected contract.', result.error.flatten())
  }
  return result.data
}

function getAuth(response: Response): AuthContext {
  return response.locals.auth as AuthContext
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function publicUser(user: AuthContext['user']) {
  const { passwordHash: _passwordHash, ...safeUser } = user
  return safeUser
}

function createAuthRateLimit(options: { maxAttempts: number; windowMs: number }): RequestHandler {
  const buckets = new Map<string, { attempts: number; resetsAt: number }>()
  const maxBuckets = 5_000

  return (request, response, next) => {
    const now = Date.now()
    const key = `${request.path}:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`
    let bucket = buckets.get(key)

    if (!bucket || bucket.resetsAt <= now) {
      if (!bucket && buckets.size >= maxBuckets) {
        for (const [existingKey, existingBucket] of buckets) {
          if (existingBucket.resetsAt <= now) buckets.delete(existingKey)
        }
        if (buckets.size >= maxBuckets) {
          const oldestKey = buckets.keys().next().value as string | undefined
          if (oldestKey) buckets.delete(oldestKey)
        }
      }
      bucket = { attempts: 0, resetsAt: now + options.windowMs }
      buckets.set(key, bucket)
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetsAt - now) / 1_000))
    response.setHeader('RateLimit-Limit', String(options.maxAttempts))
    response.setHeader('RateLimit-Remaining', String(Math.max(0, options.maxAttempts - bucket.attempts - 1)))
    response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetsAt / 1_000)))

    if (bucket.attempts >= options.maxAttempts) {
      response.setHeader('Retry-After', String(retryAfterSeconds))
      response.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many authentication attempts. Wait before trying again.',
        },
      })
      return
    }

    bucket.attempts += 1
    next()
  }
}

function validateExtractionDates(extraction: z.infer<typeof DocumentExtractionSchema>) {
  const warnings = [...extraction.warnings]
  const tasks = extraction.tasks.map((task) => {
    if (task.dueAt && Number.isNaN(Date.parse(task.dueAt))) {
      warnings.push(`Deadline for "${task.title}" was not a valid timestamp and must be reviewed.`)
      return { ...task, dueAt: null }
    }
    return task
  })
  return { ...extraction, tasks, warnings }
}

export async function createApplication(options: ApplicationOptions = {}): Promise<ApplicationContext> {
  const config = loadConfig(options.config)
  if (config.persistenceDriver === 'postgres' && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required when PERSISTENCE_DRIVER=postgres.')
  }
  const repository = options.repository
    ?? (config.persistenceDriver === 'postgres' ? new PostgresRepository(config.databaseUrl as string) : new InMemoryRepository())
  if (config.persistenceDriver === 'memory' || options.repository instanceof InMemoryRepository) await repository.seedDemo()
  const supabaseStorageValues = [config.supabaseUrl, config.supabaseServiceRoleKey, config.supabaseStorageBucket]
  const supabaseStorageConfigured = supabaseStorageValues.every(Boolean)
  if (supabaseStorageValues.some(Boolean) && !supabaseStorageConfigured) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET must be set together.')
  }
  const objectStore = options.objectStore ?? (supabaseStorageConfigured
    ? new SupabaseObjectStore({
      url: config.supabaseUrl as string,
      serviceRoleKey: config.supabaseServiceRoleKey as string,
      bucket: config.supabaseStorageBucket as string,
    })
    : new LocalObjectStore(config.storageDirectory))
  const aiProvider = options.aiProvider ?? createAiProvider(config)
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(cors({ origin: config.appOrigin, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  const authRateLimit = createAuthRateLimit({
    maxAttempts: config.authRateLimitMax,
    windowMs: config.authRateLimitWindowMs,
  })

  const uploadDocument = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const allowed = ['application/pdf', 'text/plain', 'text/calendar', 'application/octet-stream']
      if (allowed.includes(file.mimetype)) callback(null, true)
      else callback(new ApiError(415, 'UNSUPPORTED_FILE', 'Upload a PDF, text, or ICS file.'))
    },
  })

  const requireAuth: RequestHandler = (request, response, next) => {
    void (async () => {
      const authorization = request.header('authorization')
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
      const auth = token ? await repository.resolveSession(token) : undefined
      if (!auth) {
        response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A valid bearer token is required.' } })
        return
      }
      response.locals.auth = auth
      response.locals.sessionToken = token
      next()
    })().catch(next)
  }

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'priorilearn-api',
      persistence: config.persistenceDriver,
      storage: supabaseStorageConfigured ? 'supabase' : 'local',
      aiProvider: aiProvider.name,
      timestamp: new Date().toISOString(),
    })
  })

  app.post('/api/auth/register', authRateLimit, asyncRoute(async (request, response) => {
    const input = parseBody(RegisterInputSchema, request.body)
    try {
      const user = await repository.createPersonalAccount(input)
      const token = await repository.createSession(user)
      response.status(201).json({ token, user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
    } catch (error) {
      if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
        throw new ApiError(409, 'EMAIL_EXISTS', 'An account already exists for this email.')
      }
      throw error
    }
  }))

  app.post('/api/auth/login', authRateLimit, asyncRoute(async (request, response) => {
    const input = parseBody(LoginInputSchema, request.body)
    const user = await repository.findUserByEmail(input.email)
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    const token = await repository.createSession(user)
    response.json({ token, user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.post('/api/auth/demo', authRateLimit, asyncRoute(async (_request, response) => {
    const user = await repository.getDemoUser()
    const token = await repository.createSession(user)
    response.json({ token, user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.get('/api/me', requireAuth, (_request, response) => {
    const { user, tenant } = getAuth(response)
    response.json({ user: publicUser(user), tenant })
  })

  app.post('/api/auth/logout', requireAuth, asyncRoute(async (_request, response) => {
    await repository.revokeSession(response.locals.sessionToken as string)
    response.status(204).end()
  }))

  app.get('/api/dashboard', requireAuth, asyncRoute(async (_request, response) => {
    const { tenant } = getAuth(response)
    const courses = await repository.listCourses(tenant.id)
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const ranked = (await repository.listTasks(tenant.id))
      .filter((task) => task.status === 'confirmed')
      .map((task) => {
        const course = courseById.get(task.courseId)
        if (!course) return undefined
        return { task, course, assessment: assessPriority(task, course) }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.assessment.score - left.assessment.score)

    response.json({
      rankedTasks: ranked,
      recommendation: ranked[0] ? {
        task: ranked[0].task,
        course: ranked[0].course,
        assessment: ranked[0].assessment,
        firstStep: `Open ${ranked[0].task.title} and complete the first concrete requirement.`,
        estimatedMinutes: Math.min(45, ranked[0].task.estimatedMinutes),
      } : null,
    })
  }))

  app.get('/api/tasks', requireAuth, asyncRoute(async (_request, response) => {
    const { tenant } = getAuth(response)
    response.json({ tasks: await repository.listTasks(tenant.id), courses: await repository.listCourses(tenant.id) })
  }))

  app.post('/api/tasks', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(TaskCreateInputSchema, request.body)
    if (!await repository.getCourse(tenant.id, input.courseId)) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found.')
    const task = await repository.createTask(tenant.id, {
      ...input,
      status: 'confirmed',
      sourceKind: 'manual',
      confidence: 1,
      evidence: ['Entered and confirmed by the student'],
    })
    response.status(201).json({ task })
  }))

  app.patch('/api/tasks/:taskId', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(TaskPatchInputSchema, request.body)
    if (input.courseId && !await repository.getCourse(tenant.id, input.courseId)) {
      throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found.')
    }
    const task = await repository.updateTask(tenant.id, routeParam(request.params.taskId), input)
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', 'Task was not found.')
    response.json({ task })
  }))

  app.post('/api/priority-assessments', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const { taskId } = parseBody(z.object({ taskId: z.string().min(1) }), request.body)
    const task = await repository.getTask(tenant.id, taskId)
    if (!task || task.status !== 'confirmed') throw new ApiError(404, 'TASK_NOT_FOUND', 'Confirmed task was not found.')
    const course = await repository.getCourse(tenant.id, task.courseId)
    if (!course) throw new ApiError(409, 'COURSE_MISSING', 'The task has no available course context.')
    const assessment = await repository.saveAssessment(assessPriority(task, course))
    response.status(201).json({ assessment })
  }))

  app.post('/api/documents', requireAuth, uploadDocument.single('file'), asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    if (!request.file) throw new ApiError(400, 'FILE_REQUIRED', 'Attach one file in the file field.')
    const id = randomUUID()
    const storageKey = `${tenant.id}/${id}`
    await objectStore.put(storageKey, request.file.buffer)
    const document: SourceDocument = {
      id,
      tenantId: tenant.id,
      filename: request.file.originalname,
      mimeType: request.file.mimetype,
      sizeBytes: request.file.size,
      storageKey,
      status: 'uploaded',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
    }
    await repository.saveDocument(document)
    response.status(201).json({ document })
  }))

  app.post('/api/documents/:documentId/extract', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const document = await repository.getDocument(tenant.id, routeParam(request.params.documentId))
    if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.')
    if (document.rawDeletedAt) throw new ApiError(410, 'RAW_FILE_EXPIRED', 'The raw file has been deleted under the retention policy.')
    if (document.status === 'confirmed') throw new ApiError(409, 'DOCUMENT_ALREADY_CONFIRMED', 'Confirmed imports cannot be extracted again.')
    await repository.saveDocument({ ...document, status: 'processing' })
    try {
      const content = await objectStore.get(document.storageKey)
      const rawExtraction = await aiProvider.extractDocument({
        filename: document.filename,
        mimeType: document.mimeType,
        content,
      })
      const extraction = validateExtractionDates(DocumentExtractionSchema.parse(rawExtraction))
      const updated = await repository.saveDocument({
        ...document,
        status: 'needs_review',
        extraction,
        extractionProvider: aiProvider.name,
      })
      response.json({ document: updated, extraction, requiresConfirmation: true })
    } catch (error) {
      await repository.saveDocument({ ...document, status: 'failed' })
      throw new ApiError(502, 'EXTRACTION_FAILED', error instanceof Error ? error.message : 'Document extraction failed.')
    }
  }))

  app.post('/api/documents/:documentId/confirm', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const document = await repository.getDocument(tenant.id, routeParam(request.params.documentId))
    if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.')
    if (document.status === 'confirmed') {
      response.json({
        document,
        courses: (await repository.listCourses(tenant.id)).filter((course) => course.sourceDocumentId === document.id),
        tasks: (await repository.listTasks(tenant.id)).filter((task) => task.sourceDocumentId === document.id),
      })
      return
    }
    if (document.status !== 'needs_review' || !document.extraction) {
      throw new ApiError(409, 'EXTRACTION_NOT_READY', 'Extract and review this document before confirming it.')
    }
    const submitted = parseBody(z.object({ extraction: DocumentExtractionSchema.optional() }), request.body ?? {})
    const extraction = validateExtractionDates(submitted.extraction ?? document.extraction)
    const courses = await Promise.all(extraction.courses.map((course) => repository.createCourse(tenant.id, {
      code: course.code,
      name: course.name,
      currentScore: course.currentScore,
      targetScore: course.targetScore,
      sourceDocumentId: document.id,
    })))
    const courseByCode = new Map(courses.map((course) => [course.code.toLowerCase(), course]))
    const fallbackCourse = courses[0] ?? await repository.createCourse(tenant.id, {
      code: `DOC-${document.id.slice(0, 6)}`,
      name: 'Imported course',
      currentScore: null,
      targetScore: null,
      sourceDocumentId: document.id,
    })
    const tasks = await Promise.all(extraction.tasks.map((task) => repository.createTask(tenant.id, {
      courseId: courseByCode.get(task.courseCode.toLowerCase())?.id ?? fallbackCourse.id,
      title: task.title,
      dueAt: task.dueAt,
      gradeWeight: task.gradeWeight,
      estimatedMinutes: task.estimatedMinutes,
      status: 'confirmed',
      sourceKind: 'document',
      sourceDocumentId: document.id,
      confidence: task.confidence,
      evidence: task.evidence,
    })))
    const updated = await repository.saveDocument({ ...document, extraction, status: 'confirmed' })
    response.json({ document: updated, courses, tasks })
  }))

  app.delete('/api/documents/:documentId', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const document = await repository.getDocument(tenant.id, routeParam(request.params.documentId))
    if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.')
    await objectStore.delete(document.storageKey)
    await repository.deleteDocument(tenant.id, document.id)
    response.status(204).end()
  }))

  app.post('/api/imports/ics', requireAuth, uploadDocument.single('file'), asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    if (!request.file) throw new ApiError(400, 'FILE_REQUIRED', 'Attach one ICS file in the file field.')
    let preview: ReturnType<typeof parseIcsPreview>
    try {
      preview = parseIcsPreview(request.file.buffer.toString('utf8'))
    } catch {
      throw new ApiError(400, 'INVALID_ICS', 'The calendar file could not be parsed.')
    }
    const draft: ImportDraft = {
      id: randomUUID(),
      tenantId: tenant.id,
      kind: 'ics',
      status: 'needs_review',
      ...preview,
      createdAt: new Date().toISOString(),
    }
    await repository.saveImportDraft(draft)
    response.status(201).json({ draft, requiresConfirmation: true })
  }))

  app.post('/api/imports/:draftId/confirm', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const draft = await repository.getImportDraft(tenant.id, routeParam(request.params.draftId))
    if (!draft) throw new ApiError(404, 'IMPORT_NOT_FOUND', 'Import draft was not found.')
    if (draft.status === 'confirmed') throw new ApiError(409, 'IMPORT_ALREADY_CONFIRMED', 'This import is already confirmed.')
    const course = await repository.createCourse(tenant.id, {
      code: 'CALENDAR',
      name: 'Calendar imports',
      currentScore: null,
      targetScore: null,
    })
    const tasks = await Promise.all(draft.tasks.map((task) => repository.createTask(tenant.id, {
      courseId: course.id,
      title: task.title,
      dueAt: task.dueAt,
      gradeWeight: null,
      estimatedMinutes: task.estimatedMinutes,
      status: 'confirmed',
      sourceKind: 'ics',
      confidence: task.confidence,
      evidence: task.evidence,
    })))
    const busyBlocks = await Promise.all(draft.busyBlocks.map((block) => repository.createAvailabilityBlock(tenant.id, {
      ...block,
      sourceKind: 'ics',
    })))
    await repository.saveImportDraft({ ...draft, status: 'confirmed' })
    response.json({ tasks, busyBlocks })
  }))

  app.post('/api/connectors/canvas/start', requireAuth, (_request, response) => {
    if (!config.canvasClientId || !config.canvasBaseUrl) {
      response.json({
        status: 'configuration_required',
        message: 'Canvas OAuth is not configured for this environment.',
        fallback: { type: 'document_upload', endpoint: '/api/documents' },
      })
      return
    }
    const authorizeUrl = new URL('/login/oauth2/auth', config.canvasBaseUrl)
    authorizeUrl.searchParams.set('client_id', config.canvasClientId)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('state', randomBytes(24).toString('base64url'))
    response.json({ status: 'ready', authorizationUrl: authorizeUrl.toString(), scope: 'read_only' })
  })

  app.post('/api/connectors/google-calendar/start', requireAuth, (_request, response) => {
    if (!config.googleClientId) {
      response.json({
        status: 'configuration_required',
        message: 'Google Calendar OAuth is not configured for this environment.',
        fallback: { type: 'ics_import', endpoint: '/api/imports/ics' },
      })
      return
    }
    response.json({ status: 'ready', scope: 'https://www.googleapis.com/auth/calendar.readonly' })
  })

  app.delete('/api/connectors/:provider', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const provider = routeParam(request.params.provider)
    const purpose = provider === 'canvas' ? 'canvas_read' : provider === 'google-calendar' ? 'calendar_read' : undefined
    if (!purpose) throw new ApiError(404, 'CONNECTOR_NOT_FOUND', 'Connector was not found.')
    const consent: ConsentAudit = {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      purpose,
      granted: false,
      source: 'connector',
      createdAt: new Date().toISOString(),
    }
    await repository.saveConsent(consent)
    response.json({ status: 'revoked', provider, consent })
  }))

  app.post('/api/plans/generate', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(PlanGenerateInputSchema, request.body)
    const courses = new Map((await repository.listCourses(tenant.id)).map((course) => [course.id, course]))
    const rankedTasks = (await repository.listTasks(tenant.id))
      .filter((task) => task.status === 'confirmed')
      .map((task) => {
        const course = courses.get(task.courseId)
        return course ? { task, assessment: assessPriority(task, course) } : undefined
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.assessment.score - left.assessment.score)
    const repositoryBusyBlocks = await repository.listAvailabilityBlocks(tenant.id)
    const items = schedulePlan({
      rankedTasks,
      startsAt: input.startsAt,
      availableMinutes: input.availableMinutes,
      coachMode: input.coachMode,
      busyBlocks: [...repositoryBusyBlocks, ...input.busyBlocks],
    })
    if (items.length === 0) throw new ApiError(409, 'NO_SCHEDULABLE_TASKS', 'No confirmed tasks fit the available time.')
    const plan: StudyPlan = {
      id: randomUUID(),
      tenantId: tenant.id,
      version: await repository.nextPlanVersion(tenant.id),
      status: 'proposed',
      items,
      rationale: `A ${input.coachMode} plan ranked by academic impact, failure risk, cost of delay, goal alignment, and actionability.`,
      createdAt: new Date().toISOString(),
    }
    await repository.savePlan(plan)
    response.status(201).json({ plan, requiresApproval: true })
  }))

  app.post('/api/plans/:planId/approve', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(PlanApprovalInputSchema, request.body)
    const plan = await repository.getPlan(tenant.id, routeParam(request.params.planId))
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan was not found.')
    if (plan.version !== input.expectedVersion) throw new ApiError(409, 'PLAN_VERSION_CONFLICT', 'The plan changed. Review the latest version before approval.')
    if (plan.status === 'approved') {
      response.json({ plan })
      return
    }
    if (plan.status !== 'proposed') throw new ApiError(409, 'PLAN_NOT_APPROVABLE', 'Only a proposed plan can be approved.')
    const approved = await repository.savePlan({
      ...plan,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvalReceipt: randomBytes(18).toString('base64url'),
    })
    response.json({ plan: approved })
  }))

  app.post('/api/check-ins', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(CheckInInputSchema, request.body)
    const plan = await repository.getPlan(tenant.id, input.planId)
    if (!plan || plan.status !== 'approved') throw new ApiError(409, 'APPROVED_PLAN_REQUIRED', 'Check-ins can only replan an approved plan.')
    const checkIn = await repository.saveCheckIn({
      id: randomUUID(),
      tenantId: tenant.id,
      planId: plan.id,
      friction: input.friction,
      note: input.note,
      createdAt: new Date().toISOString(),
    })
    const coaching = await aiProvider.draftCoachingProposal({ friction: input.friction, note: input.note, plan })
    const proposedItems = plan.items.map((item, index) => {
      if (index !== 0) return item
      const endsAt = new Date(new Date(item.startsAt).getTime() + coaching.estimatedMinutes * 60_000).toISOString()
      return { ...item, minutes: coaching.estimatedMinutes, endsAt, firstStep: coaching.firstStep }
    })
    const proposal: ReplanProposal = {
      id: randomUUID(),
      tenantId: tenant.id,
      checkInId: checkIn.id,
      basePlanId: plan.id,
      basePlanVersion: plan.version,
      status: 'proposed',
      title: coaching.title,
      rationale: coaching.rationale,
      changes: coaching.changes,
      proposedItems,
      createdAt: new Date().toISOString(),
    }
    await repository.saveReplanProposal(proposal)
    response.status(201).json({ checkIn, proposal, requiresApproval: true })
  }))

  app.post('/api/replan-proposals/:proposalId/approve', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(ReplanApprovalInputSchema, request.body)
    const proposal = await repository.getReplanProposal(tenant.id, routeParam(request.params.proposalId))
    if (!proposal) throw new ApiError(404, 'REPLAN_NOT_FOUND', 'Replan proposal was not found.')
    if (proposal.status !== 'proposed') throw new ApiError(409, 'REPLAN_NOT_APPROVABLE', 'Only a proposed replan can be approved.')
    const basePlan = await repository.getPlan(tenant.id, proposal.basePlanId)
    if (!basePlan || basePlan.status !== 'approved' || basePlan.version !== input.expectedPlanVersion || proposal.basePlanVersion !== input.expectedPlanVersion) {
      throw new ApiError(409, 'PLAN_VERSION_CONFLICT', 'The approved plan changed. Generate a fresh proposal.')
    }
    await repository.savePlan({ ...basePlan, status: 'superseded' })
    const approvedPlan: StudyPlan = {
      id: randomUUID(),
      tenantId: tenant.id,
      version: await repository.nextPlanVersion(tenant.id),
      status: 'approved',
      previousPlanId: basePlan.id,
      items: proposal.proposedItems,
      rationale: proposal.rationale,
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvalReceipt: randomBytes(18).toString('base64url'),
    }
    await repository.savePlan(approvedPlan)
    await repository.saveReplanProposal({ ...proposal, status: 'approved', approvedPlanId: approvedPlan.id })
    response.json({ plan: approvedPlan })
  }))

  app.get('/api/consents', requireAuth, asyncRoute(async (_request, response) => {
    const { tenant } = getAuth(response)
    response.json({ consents: await repository.listConsents(tenant.id) })
  }))

  app.post('/api/consents', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(ConsentInputSchema, request.body)
    const consent: ConsentAudit = {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      ...input,
      createdAt: new Date().toISOString(),
    }
    await repository.saveConsent(consent)
    response.status(201).json({ consent })
  }))

  app.post('/api/events', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(z.object({
      name: z.enum(['onboarding_completed', 'plan_generated', 'plan_approved', 'focus_started', 'focus_completed', 'replan_approved', 'top_task_completed']),
      properties: z.record(z.string(), z.unknown()).default({}),
    }), request.body)
    const event = await repository.saveEvent({ tenantId: tenant.id, userId: user.id, ...input })
    response.status(202).json({ event })
  }))

  app.get('/api/metrics/me', requireAuth, asyncRoute(async (_request, response) => {
    const { tenant } = getAuth(response)
    response.json({ metrics: await repository.getMetrics(tenant.id) })
  }))

  app.delete('/api/account', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const { confirmation } = parseBody(z.object({ confirmation: z.string() }), request.body)
    if (confirmation.trim().toLowerCase() !== user.email) {
      throw new ApiError(400, 'DELETION_CONFIRMATION_MISMATCH', 'Enter the account email to confirm deletion.')
    }
    const documents = await repository.listDocuments(tenant.id)
    await Promise.all(documents.map((document) => objectStore.delete(document.storageKey)))
    await repository.deleteTenant(tenant.id)
    response.status(204).end()
  }))

  app.post('/api/internal/maintenance/purge-documents', asyncRoute(async (request, response) => {
    if (!config.maintenanceSecret || request.header('x-maintenance-secret') !== config.maintenanceSecret) {
      throw new ApiError(401, 'MAINTENANCE_UNAUTHORIZED', 'A valid maintenance secret is required.')
    }
    response.json(await purgeExpiredDocuments(repository, objectStore))
  }))

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } })
  })

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } })
      return
    }
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: { code: 'UPLOAD_ERROR', message: error.message } })
      return
    }
    console.error(error)
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } })
  })

  return { app, config, repository, objectStore, aiProvider }
}
