import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { extname } from 'node:path'
import cors from 'cors'
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import multer from 'multer'
import { z, type ZodType } from 'zod'
import { loadConfig, type AppConfig } from './config.js'
import {
  CheckInInputSchema,
  CourseCreateInputSchema,
  ConsentInputSchema,
  DocumentExtractionSchema,
  EmailVerificationConfirmInputSchema,
  GoogleLoginInputSchema,
  LoginInputSchema,
  LearnerProfileUpdateInputSchema,
  PasswordResetConfirmInputSchema,
  PasswordResetRequestInputSchema,
  PlanningChatInputSchema,
  PlanningPreferencesUpsertInputSchema,
  PlanApprovalInputSchema,
  PlanEditInputSchema,
  PlanGenerateInputSchema,
  RegisterInputSchema,
  ReplanApprovalInputSchema,
  TaskCreateInputSchema,
  TaskPatchInputSchema,
  UserLocaleInputSchema,
  type ConsentAudit,
  type AuthActionPurpose,
  type ImportDraft,
  type ReplanProposal,
  type SourceDocument,
} from './domain/contracts.js'
import { createAuthActionToken, hashAuthActionToken, hashPassword, verifyPassword } from './lib/auth.js'
import { PostgresRepository } from './postgres-repository.js'
import { InMemoryRepository, RepositoryError, type AuthSession, type Repository } from './repository.js'
import { createAiProvider, type AiProvider } from './services/ai-provider.js'
import { nextDailyDigestRun, processNotificationJobs } from './services/digest.js'
import { createEmailSender, sendAuthActionEmail, type EmailSender } from './services/email.js'
import { processExtractionJobs, validateExtractionDates, type ExtractionWorkerResult } from './services/extraction.js'
import { createErrorReporter, type ErrorReporter } from './services/error-reporter.js'
import { InvalidGoogleIdentityError, type GoogleTokenVerifier, verifyGoogleIdToken } from './services/google-auth.js'
import { parseIcsPreview } from './services/ics.js'
import { assessPriority } from './services/priority.js'
import { processLifecycleJobs } from './services/purge.js'
import {
  schedulePlan,
  scheduleWeeklyPlanWithReport,
  summarizeSchedulingWarnings,
  validatePlanItems,
} from './services/scheduler.js'
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

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngEndMarker = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

function normalizeUploadedMimeType(file: Express.Multer.File): string {
  const extension = extname(file.originalname).toLowerCase()
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) return file.mimetype

  const isPng = file.buffer.length >= 33
    && file.buffer.subarray(0, pngSignature.length).equals(pngSignature)
    && file.buffer.subarray(12, 16).toString('ascii') === 'IHDR'
    && file.buffer.readUInt32BE(16) > 0
    && file.buffer.readUInt32BE(20) > 0
    && file.buffer.subarray(-pngEndMarker.length).equals(pngEndMarker)
  const isJpeg = file.buffer.length >= 4
    && file.buffer[0] === 0xff
    && file.buffer[1] === 0xd8
    && file.buffer[2] === 0xff
    && file.buffer[file.buffer.length - 2] === 0xff
    && file.buffer[file.buffer.length - 1] === 0xd9
  const detectedMimeType = isPng
    ? 'image/png'
    : isJpeg
      ? 'image/jpeg'
      : undefined
  const expectedMimeType = extension === '.png' ? 'image/png' : 'image/jpeg'
  if (detectedMimeType !== expectedMimeType) {
    throw new ApiError(
      415,
      'INVALID_FILE_CONTENT',
      'The image contents do not match a valid PNG or JPEG file.',
    )
  }
  return detectedMimeType
}

export type ApplicationContext = {
  app: express.Express
  config: AppConfig
  repository: Repository
  objectStore: ObjectStore
  aiProvider: AiProvider
  emailSender: EmailSender
  errorReporter: ErrorReporter
  processExtractionQueue: () => Promise<ExtractionWorkerResult>
}

type ApplicationOptions = {
  config?: Partial<AppConfig>
  repository?: Repository
  objectStore?: ObjectStore
  aiProvider?: AiProvider
  emailSender?: EmailSender
  errorReporter?: ErrorReporter
  googleTokenVerifier?: GoogleTokenVerifier
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

function decodeDocumentCursor(value: unknown): { createdAt: string; id: string } | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 500) throw new ApiError(400, 'INVALID_CURSOR', 'The document cursor is invalid.')
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const result = z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).safeParse(parsed)
    if (!result.success) throw new Error('Invalid cursor')
    return result.data
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'The document cursor is invalid.')
  }
}

function encodeDocumentCursor(cursor: { createdAt: string; id: string } | undefined): string | undefined {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : undefined
}

function decodeTaskCursor(value: unknown): { createdAt: string; id: string } | undefined {
  try {
    return decodeDocumentCursor(value)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'INVALID_CURSOR') {
      throw new ApiError(400, 'INVALID_CURSOR', 'The task cursor is invalid.')
    }
    throw error
  }
}

function publicUser(user: AuthContext['user']) {
  const {
    passwordHash: _passwordHash,
    googleSubject: _googleSubject,
    emailVerifiedAt,
    ...safeUser
  } = user
  return { ...safeUser, emailVerified: Boolean(emailVerifiedAt) }
}

function publicLearnerProfile(profile: Awaited<ReturnType<Repository['getLearnerProfile']>>) {
  return profile
    ? {
      version: profile.version,
      signals: profile.approvedSignals.map(({ id, kind, value }) => ({ id, kind, value })),
      sourceEventCount: profile.sourceEventCount,
      updatedAt: profile.updatedAt,
    }
    : { version: 0, signals: [], sourceEventCount: 0 }
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const sessionMaxAgeMs = 7 * 24 * 60 * 60 * 1_000

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.header('cookie')
  if (!cookieHeader) return undefined

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    const key = pair.slice(0, separator).trim()
    if (key !== name) continue
    const value = pair.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return undefined
    }
  }
  return undefined
}

function sessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: 'lax' as const,
    path: '/',
  }
}

function issueSessionCookie(response: Response, config: AppConfig, token: string): void {
  response.cookie(config.sessionCookieName, token, {
    ...sessionCookieOptions(config),
    maxAge: sessionMaxAgeMs,
  })
}

function clearSessionCookie(response: Response, config: AppConfig): void {
  response.clearCookie(config.sessionCookieName, sessionCookieOptions(config))
}

function secretsMatch(supplied: string | undefined, expected: string | undefined): boolean {
  if (!supplied || !expected) return false
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}

function createRateLimit(options: {
  maxAttempts: number
  windowMs: number
  code: string
  message: string
  key: (request: Request, response: Response) => string
}): RequestHandler {
  const buckets = new Map<string, { attempts: number; resetsAt: number }>()
  const maxBuckets = 5_000

  return (request, response, next) => {
    const now = Date.now()
    const key = options.key(request, response)
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
          code: options.code,
          message: options.message,
        },
      })
      return
    }

    bucket.attempts += 1
    next()
  }
}

export async function createApplication(options: ApplicationOptions = {}): Promise<ApplicationContext> {
  const config = loadConfig(options.config)
  const googleTokenVerifier = options.googleTokenVerifier ?? verifyGoogleIdToken
  if (config.persistenceDriver === 'postgres' && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required when PERSISTENCE_DRIVER=postgres.')
  }
  const repository = options.repository
    ?? (config.persistenceDriver === 'postgres' ? new PostgresRepository(config.databaseUrl as string) : new InMemoryRepository())
  if (config.persistenceDriver === 'memory' || options.repository instanceof InMemoryRepository) await repository.seedDemo()
  const useLocalStorage = config.persistenceDriver === 'memory'
  const supabaseStorageValues = [config.supabaseUrl, config.supabaseServiceRoleKey, config.supabaseStorageBucket]
  const supabaseStorageConfigured = !useLocalStorage && supabaseStorageValues.every(Boolean)
  if (!useLocalStorage && supabaseStorageValues.some(Boolean) && !supabaseStorageConfigured) {
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
  const emailSender = options.emailSender ?? createEmailSender(config)
  const errorReporter = options.errorReporter ?? createErrorReporter(config)
  const processExtractionQueue = () => processExtractionJobs({
    repository,
    objectStore,
    aiProvider,
    batchSize: config.extractionWorkerBatchSize,
  })
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(cors({ origin: config.appOrigin, credentials: true }))
  app.use('/api', (request, response, next) => {
    const suppliedRequestId = request.header('x-request-id')
    const requestId = suppliedRequestId && /^[A-Za-z0-9_-]{8,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID()
    const startedAt = Date.now()
    response.locals.requestId = requestId
    response.setHeader('X-Request-Id', requestId)
    if (config.structuredLogging) {
      response.once('finish', () => {
        console.info(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'info',
          event: 'http_request',
          requestId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        }))
      })
    }
    next()
  })
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0')
    response.setHeader('Pragma', 'no-cache')
    next()
  })
  app.use('/api', (request, response, next) => {
    if (!config.enforceOriginCheck || safeMethods.has(request.method) || request.path.startsWith('/internal/maintenance/')) {
      next()
      return
    }

    const origin = request.header('origin')
    if (origin === config.appOrigin) {
      next()
      return
    }

    response.status(403).json({
      error: {
        code: 'UNTRUSTED_ORIGIN',
        message: 'This write request did not come from the PrioriLearn application.',
      },
    })
  })
  app.use(express.json({ limit: '1mb' }))
  const authRateLimit = createRateLimit({
    maxAttempts: config.authRateLimitMax,
    windowMs: config.authRateLimitWindowMs,
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many authentication attempts. Wait before trying again.',
    key: (request) => `${request.path}:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
  })
  const aiRateLimit = createRateLimit({
    maxAttempts: config.aiRateLimitMax,
    windowMs: config.aiRateLimitWindowMs,
    code: 'AI_RATE_LIMITED',
    message: 'Too many AI requests. Wait before trying again.',
    key: (_request, response) => `ai:${(response.locals.auth as AuthContext | undefined)?.user.id ?? 'anonymous'}`,
  })

  const uploadDocument = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const allowedByExtension: Record<string, string[]> = {
        '.pdf': ['application/pdf', 'application/octet-stream'],
        '.txt': ['text/plain', 'application/octet-stream'],
        '.ics': ['text/calendar', 'text/plain', 'application/octet-stream'],
        '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'],
        '.json': ['application/json', 'text/json', 'text/plain', 'application/octet-stream'],
        '.jsonl': ['application/x-ndjson', 'application/json', 'text/plain', 'application/octet-stream'],
        '.png': ['image/png', 'application/octet-stream'],
        '.jpg': ['image/jpeg', 'image/jpg', 'application/octet-stream'],
        '.jpeg': ['image/jpeg', 'image/jpg', 'application/octet-stream'],
      }
      const extension = extname(file.originalname).toLowerCase()
      if (allowedByExtension[extension]?.includes(file.mimetype.toLowerCase())) callback(null, true)
      else callback(new ApiError(415, 'UNSUPPORTED_FILE', 'Upload a PDF, PNG, JPG, TXT, CSV, JSON, JSONL, or ICS file.'))
    },
  })

  const requireAuth: RequestHandler = (request, response, next) => {
    void (async () => {
      const token = readCookie(request, config.sessionCookieName)
      const auth = token ? await repository.resolveSession(token) : undefined
      if (!auth) {
        clearSessionCookie(response, config)
        response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
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
      emailProvider: emailSender.name,
      emailConfigured: emailSender.configured,
      errorReporter: errorReporter.name,
      errorReportingConfigured: errorReporter.configured,
      extractionQueue: 'durable',
      timestamp: new Date().toISOString(),
    })
  })

  const createAndSendAuthAction = async (user: AuthContext['user'], purpose: AuthActionPurpose): Promise<void> => {
    if (!emailSender.configured) {
      throw new ApiError(503, 'EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured for this environment.')
    }
    const token = createAuthActionToken()
    const tokenHash = hashAuthActionToken(token)
    const lifetimeMs = purpose === 'email_verification' ? 24 * 60 * 60_000 : 60 * 60_000
    await repository.createAuthActionToken(
      user,
      purpose,
      tokenHash,
      new Date(Date.now() + lifetimeMs).toISOString(),
    )
    await sendAuthActionEmail({
      sender: emailSender,
      appOrigin: config.appOrigin,
      user,
      purpose,
      token,
      tokenHash,
    })
  }

  app.post('/api/auth/register', authRateLimit, asyncRoute(async (request, response) => {
    const input = parseBody(RegisterInputSchema, request.body)
    try {
      const user = await repository.createPersonalAccount(input)
      const token = await repository.createSession(user)
      issueSessionCookie(response, config, token)
      response.status(201).json({ user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
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
    issueSessionCookie(response, config, token)
    response.json({ user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.post('/api/auth/google', authRateLimit, asyncRoute(async (request, response) => {
    if (!config.googleClientId) {
      throw new ApiError(503, 'GOOGLE_SIGN_IN_NOT_CONFIGURED', 'Google Sign-In is not configured for this environment.')
    }

    const input = parseBody(GoogleLoginInputSchema, request.body)
    let identity
    try {
      identity = await googleTokenVerifier(input.credential, config.googleClientId)
    } catch (error) {
      if (error instanceof InvalidGoogleIdentityError) {
        throw new ApiError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this sign-in credential.')
      }
      throw error
    }
    if (!identity.emailVerified) {
      throw new ApiError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google did not return a verified email address.')
    }

    let user = await repository.findUserByGoogleSubject(identity.subject)
    if (!user) {
      const matchingEmail = await repository.findUserByEmail(identity.email)
      try {
        user = matchingEmail
          ? await repository.linkGoogleSubject(matchingEmail.tenantId, matchingEmail.id, identity.subject)
          : await repository.createPersonalAccount({
            email: identity.email,
            name: identity.name,
            locale: input.locale,
            googleSubject: identity.subject,
            password: randomBytes(48).toString('base64url'),
          })
      } catch (error) {
        if (error instanceof Error && (error.message === 'GOOGLE_SUBJECT_EXISTS' || error.message === 'EMAIL_EXISTS')) {
          throw new ApiError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'This Google account is already linked to another PrioriLearn account.')
        }
        throw error
      }
    }
    if (!user) {
      throw new ApiError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'This Google account could not be linked safely.')
    }
    user = await repository.markEmailVerified(user.tenantId, user.id) ?? user

    const token = await repository.createSession(user)
    issueSessionCookie(response, config, token)
    response.json({ user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.post('/api/auth/demo', authRateLimit, asyncRoute(async (_request, response) => {
    const user = await repository.getDemoUser()
    const token = await repository.createSession(user)
    issueSessionCookie(response, config, token)
    response.json({ user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.get('/api/auth/session', asyncRoute(async (request, response) => {
    const token = readCookie(request, config.sessionCookieName)
    const auth = token ? await repository.resolveSession(token) : undefined
    if (!auth) {
      clearSessionCookie(response, config)
      response.json({ session: null })
      return
    }
    response.json({ session: { user: publicUser(auth.user), tenant: auth.tenant } })
  }))

  app.get('/api/me', requireAuth, (_request, response) => {
    const { user, tenant } = getAuth(response)
    response.json({ user: publicUser(user), tenant })
  })

  app.patch('/api/me', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(UserLocaleInputSchema, request.body)
    const updated = await repository.updateUserLocale(tenant.id, user.id, input.locale)
    if (!updated) throw new ApiError(404, 'USER_NOT_FOUND', 'User was not found.')
    response.locals.auth = { user: updated, tenant }
    response.json({ user: publicUser(updated), tenant })
  }))

  app.post('/api/auth/logout', requireAuth, asyncRoute(async (_request, response) => {
    await repository.revokeSession(response.locals.sessionToken as string)
    clearSessionCookie(response, config)
    response.status(204).end()
  }))

  app.post('/api/auth/email-verification/request', authRateLimit, requireAuth, asyncRoute(async (_request, response) => {
    const { user } = getAuth(response)
    if (!user.emailVerifiedAt) {
      try {
        await createAndSendAuthAction(user, 'email_verification')
      } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'The verification email could not be sent. Try again shortly.')
      }
    }
    response.status(202).json({ accepted: true })
  }))

  app.post('/api/auth/email-verification/confirm', authRateLimit, asyncRoute(async (request, response) => {
    const input = parseBody(EmailVerificationConfirmInputSchema, request.body)
    const user = await repository.verifyEmailWithToken(hashAuthActionToken(input.token))
    if (!user) {
      throw new ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This verification link is invalid or has expired.')
    }
    const token = await repository.createSession(user)
    issueSessionCookie(response, config, token)
    response.json({ user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.post('/api/auth/password-reset/request', authRateLimit, asyncRoute(async (request, response) => {
    if (!emailSender.configured) {
      throw new ApiError(503, 'EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured for this environment.')
    }
    const input = parseBody(PasswordResetRequestInputSchema, request.body)
    const user = await repository.findUserByEmail(input.email)
    if (user) {
      try {
        await createAndSendAuthAction(user, 'password_reset')
      } catch (error) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'password_reset_delivery_failed',
          requestId: response.locals.requestId,
          message: error instanceof Error ? error.message : 'Unknown email delivery error',
        }))
      }
    }
    response.status(202).json({ accepted: true })
  }))

  app.post('/api/auth/password-reset/confirm', authRateLimit, asyncRoute(async (request, response) => {
    const input = parseBody(PasswordResetConfirmInputSchema, request.body)
    const passwordHash = await hashPassword(input.password)
    const user = await repository.resetPasswordWithToken(hashAuthActionToken(input.token), passwordHash)
    if (!user) {
      throw new ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This password reset link is invalid or has expired.')
    }
    const token = await repository.createSession(user)
    issueSessionCookie(response, config, token)
    response.json({ user: publicUser(user), tenant: await repository.getTenant(user.tenantId) })
  }))

  app.get('/api/dashboard', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const query = parseBody(z.object({ locale: z.enum(['vi', 'en']).optional() }), request.query)
    const locale = query.locale ?? user.locale
    const courses = await repository.listCourses(tenant.id)
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const ranked = (await repository.listTasks(tenant.id))
      .filter((task) => task.status === 'confirmed')
      .map((task) => {
        const course = courseById.get(task.courseId)
        if (!course) return undefined
        return { task, course, assessment: assessPriority(task, course, new Date(), locale) }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.assessment.score - left.assessment.score)

    const rankedWindow = ranked.slice(0, 10)
    response.json({
      rankedTasks: rankedWindow,
      confirmedTaskCount: ranked.length,
      recommendation: rankedWindow[0] ? {
        task: rankedWindow[0].task,
        course: rankedWindow[0].course,
        assessment: rankedWindow[0].assessment,
        firstStep: locale === 'vi'
          ? `Mở ${rankedWindow[0].task.title} và hoàn thành yêu cầu cụ thể đầu tiên.`
          : `Open ${rankedWindow[0].task.title} and complete the first concrete requirement.`,
        estimatedMinutes: Math.min(45, rankedWindow[0].task.estimatedMinutes),
      } : null,
    })
  }))

  app.get('/api/tasks', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const query = parseBody(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().optional() }), request.query)
    const page = await repository.listTasksPage(tenant.id, { limit: query.limit, before: decodeTaskCursor(query.cursor) })
    response.json({
      tasks: page.items,
      courses: await repository.listCourses(tenant.id),
      availabilityBlocks: await repository.listAvailabilityBlocks(tenant.id),
      nextCursor: encodeDocumentCursor(page.next),
    })
  }))

  app.post('/api/courses', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(CourseCreateInputSchema, request.body)
    const course = await repository.createCourse(tenant.id, input)
    response.status(201).json({ course })
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
    const { user, tenant } = getAuth(response)
    const { taskId } = parseBody(z.object({ taskId: z.string().min(1) }), request.body)
    const task = await repository.getTask(tenant.id, taskId)
    if (!task || task.status !== 'confirmed') throw new ApiError(404, 'TASK_NOT_FOUND', 'Confirmed task was not found.')
    const course = await repository.getCourse(tenant.id, task.courseId)
    if (!course) throw new ApiError(409, 'COURSE_MISSING', 'The task has no available course context.')
    const assessment = await repository.saveAssessment(assessPriority(task, course, new Date(), user.locale))
    response.status(201).json({ assessment })
  }))

  app.post('/api/documents', requireAuth, uploadDocument.single('file'), asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    if (!request.file) throw new ApiError(400, 'FILE_REQUIRED', 'Attach one file in the file field.')
    const mimeType = normalizeUploadedMimeType(request.file)
    const idempotencyKey = request.header('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide one Idempotency-Key header for this upload.')
    }
    const id = randomUUID()
    const storageKey = `${tenant.id}/${id}`
    const document: SourceDocument = {
      id,
      tenantId: tenant.id,
      filename: request.file.originalname,
      mimeType,
      sizeBytes: request.file.size,
      storageKey,
      status: 'uploading',
      idempotencyKey,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
    }
    const started = await repository.beginDocumentUpload(document)
    const resumable = started.document
    const matchingFile = resumable.filename === request.file.originalname
      && resumable.mimeType === mimeType
      && resumable.sizeBytes === request.file.size
    if (!matchingFile) {
      throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key belongs to a different file.')
    }
    if (resumable.status === 'uploaded' || resumable.status === 'extracting' || resumable.status === 'extraction_failed' || resumable.status === 'review' || resumable.status === 'confirmed') {
      response.status(200).json({ document: resumable, resumed: true })
      return
    }

    try {
      await objectStore.put(resumable.storageKey, request.file.buffer)
      const uploaded = await repository.saveDocument({ ...resumable, status: 'uploaded' })
      response.status(started.created ? 201 : 200).json({ document: uploaded, resumed: !started.created })
    } catch (error) {
      await repository.saveDocument({ ...resumable, status: 'upload_failed' })
      throw new ApiError(502, 'UPLOAD_FAILED', error instanceof Error ? error.message : 'The raw file could not be stored.')
    }
  }))

  app.get('/api/documents', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const query = parseBody(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().optional() }), request.query)
    const page = await repository.listDocumentsPage(tenant.id, { limit: query.limit, before: decodeDocumentCursor(query.cursor) })
    response.json({ documents: page.items, nextCursor: encodeDocumentCursor(page.next) })
  }))

  app.get('/api/documents/:documentId', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const document = await repository.getDocument(tenant.id, routeParam(request.params.documentId))
    if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.')
    response.json({ document })
  }))

  app.post('/api/documents/:documentId/extract', requireAuth, aiRateLimit, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const document = await repository.getDocument(tenant.id, routeParam(request.params.documentId))
    if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.')
    if (document.rawDeletedAt) throw new ApiError(410, 'RAW_FILE_EXPIRED', 'The raw file has been deleted under the retention policy.')
    if (document.status === 'confirmed') throw new ApiError(409, 'DOCUMENT_ALREADY_CONFIRMED', 'Confirmed imports cannot be extracted again.')
    if (document.status === 'review' && document.extraction) {
      response.json({ document, extraction: document.extraction, requiresConfirmation: true })
      return
    }
    if (document.status === 'uploading' || document.status === 'upload_failed') {
      throw new ApiError(409, 'UPLOAD_NOT_READY', 'Retry the file upload before extraction.')
    }
    const queued = await repository.enqueueDocumentExtraction(tenant.id, document.id)
    response.status(202).json({ document: queued.document, queued: true })
  }))

  app.post('/api/documents/:documentId/confirm', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const document = await repository.getDocument(tenant.id, routeParam(request.params.documentId))
    if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.')
    if (document.status !== 'confirmed' && (document.status !== 'review' || !document.extraction)) {
      throw new ApiError(409, 'EXTRACTION_NOT_READY', 'Extract and review this document before confirming it.')
    }
    const submitted = parseBody(z.object({ extraction: DocumentExtractionSchema.optional() }), request.body ?? {})
    const reviewExtraction = submitted.extraction ?? document.extraction
    if (!reviewExtraction) throw new ApiError(409, 'EXTRACTION_NOT_READY', 'Extract and review this document before confirming it.')
    const extraction = validateExtractionDates(reviewExtraction)
    response.json(await repository.confirmDocumentImport(tenant.id, document.id, extraction))
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
      status: 'review',
      ...preview,
      createdAt: new Date().toISOString(),
    }
    await repository.saveImportDraft(draft)
    response.status(201).json({ draft, requiresConfirmation: true })
  }))

  app.post('/api/imports/:draftId/confirm', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    response.json(await repository.confirmIcsImport(tenant.id, routeParam(request.params.draftId)))
  }))

  app.get('/api/imports/:draftId', requireAuth, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const draft = await repository.getImportDraft(tenant.id, routeParam(request.params.draftId))
    if (!draft) throw new ApiError(404, 'IMPORT_NOT_FOUND', 'Import draft was not found.')
    response.json({ draft })
  }))

  app.get('/api/planning/preferences', requireAuth, asyncRoute(async (_request, response) => {
    const { user, tenant } = getAuth(response)
    response.json({ preferences: await repository.getPlanningPreferences(tenant.id, user.id) ?? null })
  }))

  app.put('/api/planning/preferences', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(PlanningPreferencesUpsertInputSchema, request.body)
    const { expectedVersion, ...preferencesInput } = input
    const preferences = await repository.updatePlanningPreferences(
      tenant.id,
      user.id,
      expectedVersion,
      preferencesInput,
    )
    response.json({ preferences })
  }))

  app.post('/api/planning/chat', requireAuth, aiRateLimit, asyncRoute(async (request, response) => {
    const { tenant } = getAuth(response)
    const input = parseBody(PlanningChatInputSchema, request.body)
    const now = new Date()
    const courses = new Map((await repository.listCourses(tenant.id)).map((course) => [course.id, course]))
    const confirmedTasks = (await repository.listTasks(tenant.id))
      .filter((task) => task.status === 'confirmed')
      .slice(0, 50)
      .flatMap((task) => {
        const course = courses.get(task.courseId)
        if (!course) return []
        const assessment = assessPriority(task, course, now, input.locale)
        return [{
          taskId: task.id,
          title: task.title,
          courseName: course.name,
          dueAt: task.dueAt,
          estimatedMinutes: task.estimatedMinutes,
          priorityScore: assessment.score,
          costOfDelay: assessment.costOfDelay.message,
        }]
      })
    const currentPlan = await repository.getCurrentPlan(tenant.id)
    const plan = currentPlan.pending ?? currentPlan.active
    const taskTitles = new Map(confirmedTasks.map((task) => [task.taskId, task.title]))
    const reply = await aiProvider.draftPlanningPreferences({
      locale: input.locale,
      message: input.message,
      history: input.history,
      draft: input.draft,
      confirmedTasks,
      busyBlocks: (await repository.listAvailabilityBlocks(tenant.id)).map(({ title, startsAt, endsAt }) => ({ title, startsAt, endsAt })),
      currentPlanItems: (plan?.items ?? []).map((item) => ({
        taskId: item.taskId,
        title: taskTitles.get(item.taskId) ?? (input.locale === 'vi' ? 'Nhiệm vụ đã xác nhận' : 'Confirmed task'),
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        minutes: item.minutes,
      })),
      now: now.toISOString(),
    })
    response.json({
      reply: {
        message: reply.message,
        draft: {
          ...input.draft,
          locale: input.locale,
          coachMode: reply.suggestion.coachMode,
          dailyMinutes: reply.suggestion.dailyMinutes,
          windows: reply.suggestion.windows,
        },
        missingInformation: reply.missingInformation,
      },
    })
  }))

  app.post('/api/plans/generate', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(PlanGenerateInputSchema, request.body)
    const current = await repository.getCurrentPlan(tenant.id)
    if (current.pending && !input.replacePending) {
      response.json({ plan: current.pending, requiresApproval: true, reused: true })
      return
    }
    const courses = new Map((await repository.listCourses(tenant.id)).map((course) => [course.id, course]))
    const rankedTasks = (await repository.listTasks(tenant.id))
      .filter((task) => task.status === 'confirmed')
      .map((task) => {
        const course = courses.get(task.courseId)
        return course ? { task, assessment: assessPriority(task, course, new Date(), input.locale ?? user.locale) } : undefined
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.assessment.score - left.assessment.score)
    const repositoryBusyBlocks = await repository.listAvailabilityBlocks(tenant.id)
    const planningPreferences = await repository.getPlanningPreferences(tenant.id, user.id)
    const busyBlocks = [...repositoryBusyBlocks, ...input.busyBlocks]
    const weeklyResult = planningPreferences?.windows.length
      ? scheduleWeeklyPlanWithReport({
        rankedTasks,
        startsAt: input.startsAt,
        preferences: { ...planningPreferences, locale: input.locale ?? planningPreferences.locale },
        busyBlocks,
      })
      : undefined
    const items = weeklyResult?.items ?? schedulePlan({
        rankedTasks,
        startsAt: input.startsAt,
        availableMinutes: input.availableMinutes,
        coachMode: input.coachMode,
        busyBlocks,
        locale: input.locale ?? user.locale,
      })
    if (items.length === 0) throw new ApiError(409, 'NO_SCHEDULABLE_TASKS', 'No confirmed tasks fit the available time.')
    const proposalInput = {
      items,
      schedulingWarnings: weeklyResult?.schedulingWarnings ?? [],
      rationale: input.locale === 'vi' || (!input.locale && user.locale === 'vi')
        ? `Kế hoạch ${planningPreferences?.coachMode ?? input.coachMode} được xếp theo tác động học tập, rủi ro, chi phí trì hoãn, mục tiêu và khả năng bắt đầu.`
        : `A ${planningPreferences?.coachMode ?? input.coachMode} plan ranked by academic impact, failure risk, cost of delay, goal alignment, and actionability.`,
      previousPlanId: current.active?.id,
    }
    const plan = current.pending
      ? await repository.replacePlanProposal(tenant.id, current.pending.id, current.pending.version, proposalInput)
      : await repository.createPlanProposal(tenant.id, proposalInput)
    response.status(201).json({ plan, requiresApproval: true })
  }))

  app.get('/api/plans/current', requireAuth, asyncRoute(async (_request, response) => {
    const { tenant } = getAuth(response)
    response.json(await repository.getCurrentPlan(tenant.id))
  }))

  app.put('/api/plans/:planId/proposal', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(PlanEditInputSchema, request.body)
    const currentPlan = await repository.getPlan(tenant.id, routeParam(request.params.planId))
    if (!currentPlan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan was not found.')
    const tasks = await repository.listTasks(tenant.id)
    const busyBlocks = await repository.listAvailabilityBlocks(tenant.id)
    const planningPreferences = await repository.getPlanningPreferences(tenant.id, user.id)
    const items = input.items.map((item) => ({ ...item, id: item.id ?? randomUUID() }))
    const validationIssues = validatePlanItems({ items, tasks, busyBlocks, preferences: planningPreferences })
    if (validationIssues.length > 0) {
      throw new ApiError(409, 'INVALID_PLAN_SCHEDULE', 'The edited plan conflicts with confirmed tasks or availability.', { issues: validationIssues })
    }
    const latestEnd = Math.max(Date.now() + 7 * 86_400_000, ...items.map((item) => Date.parse(item.endsAt)))
    const schedulingWarnings = planningPreferences
      ? summarizeSchedulingWarnings(
        tasks.filter((task) => task.status === 'confirmed'),
        items,
        new Date(latestEnd),
      )
      : currentPlan.schedulingWarnings
    const plan = await repository.replacePlanProposal(
      tenant.id,
      routeParam(request.params.planId),
      input.expectedVersion,
      {
        items,
        schedulingWarnings,
        rationale: input.locale === 'vi' || (!input.locale && user.locale === 'vi')
          ? 'Đề xuất do sinh viên chỉnh sửa, đã kiểm tra thời gian và thứ tự.'
          : 'Student-edited proposal with schedule and order validation.',
      },
    )
    response.status(201).json({ plan, requiresApproval: true })
  }))

  app.post('/api/plans/:planId/approve', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(PlanApprovalInputSchema, request.body)
    const candidate = await repository.getPlan(tenant.id, routeParam(request.params.planId))
    if (!candidate) throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan was not found.')
    const tasks = await repository.listTasks(tenant.id)
    const busyBlocks = await repository.listAvailabilityBlocks(tenant.id)
    const planningPreferences = await repository.getPlanningPreferences(tenant.id, user.id)
    const validationIssues = validatePlanItems({
      items: candidate.items,
      tasks,
      busyBlocks,
      preferences: planningPreferences,
    })
    if (validationIssues.length > 0) {
      throw new ApiError(409, 'INVALID_PLAN_SCHEDULE', 'The plan conflicts with current tasks or availability. Generate a fresh proposal.', { issues: validationIssues })
    }
    const latestEnd = Math.max(Date.now() + 7 * 86_400_000, ...candidate.items.map((item) => Date.parse(item.endsAt)))
    const schedulingWarnings = planningPreferences
      ? summarizeSchedulingWarnings(
        tasks.filter((task) => task.status === 'confirmed'),
        candidate.items,
        new Date(latestEnd),
      )
      : candidate.schedulingWarnings
    if (schedulingWarnings.length > 0) {
      throw new ApiError(409, 'PLAN_HAS_UNSCHEDULED_WORK', 'Resolve the unscheduled work before approving this plan.', { warnings: schedulingWarnings })
    }
    const approved = await repository.approvePlan(
      tenant.id,
      routeParam(request.params.planId),
      input.expectedVersion,
      randomBytes(18).toString('base64url'),
    )
    response.json({ plan: approved })
  }))

  app.post('/api/check-ins', requireAuth, aiRateLimit, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
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
    const learnerProfile = await repository.getLearnerProfile(tenant.id, user.id)
    const coaching = await aiProvider.draftCoachingProposal({
      friction: input.friction,
      note: input.note,
      plan,
      learnerSignals: learnerProfile?.approvedSignals,
      locale: input.locale ?? user.locale,
    })
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
    const { user, tenant } = getAuth(response)
    const input = parseBody(ReplanApprovalInputSchema, request.body)
    const proposal = await repository.getReplanProposal(tenant.id, routeParam(request.params.proposalId))
    if (!proposal) throw new ApiError(404, 'REPLAN_NOT_FOUND', 'Replan proposal was not found.')
    if (proposal.status !== 'proposed') throw new ApiError(409, 'REPLAN_NOT_APPROVABLE', 'Only a proposed replan can be approved.')
    const basePlan = await repository.getPlan(tenant.id, proposal.basePlanId)
    if (!basePlan || basePlan.status !== 'approved' || basePlan.version !== input.expectedPlanVersion || proposal.basePlanVersion !== input.expectedPlanVersion) {
      throw new ApiError(409, 'PLAN_VERSION_CONFLICT', 'The approved plan changed. Generate a fresh proposal.')
    }
    const current = await repository.getCurrentPlan(tenant.id)
    if (current.pending) throw new ApiError(409, 'PENDING_PLAN_REVIEW_REQUIRED', 'Review the existing pending plan before approving a replan.')
    const tasks = await repository.listTasks(tenant.id)
    const validationIssues = validatePlanItems({
      items: proposal.proposedItems,
      tasks,
      busyBlocks: await repository.listAvailabilityBlocks(tenant.id),
      preferences: await repository.getPlanningPreferences(tenant.id, user.id),
    })
    if (validationIssues.length > 0) {
      throw new ApiError(409, 'INVALID_PLAN_SCHEDULE', 'The replan conflicts with confirmed tasks or availability.', { issues: validationIssues })
    }
    const proposedPlan = await repository.createPlanProposal(tenant.id, {
      previousPlanId: basePlan.id,
      items: proposal.proposedItems,
      schedulingWarnings: basePlan.schedulingWarnings,
      rationale: proposal.rationale,
    })
    const approvedPlan = await repository.approvePlan(
      tenant.id,
      proposedPlan.id,
      proposedPlan.version,
      randomBytes(18).toString('base64url'),
    )
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
    if (input.purpose === 'email_digest' && input.granted) {
      if (!user.emailVerifiedAt) {
        throw new ApiError(409, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email before enabling the daily digest.')
      }
      if (!emailSender.configured) {
        throw new ApiError(503, 'EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured for this environment.')
      }
    }
    const consent: ConsentAudit = {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      ...input,
      createdAt: new Date().toISOString(),
    }
    await repository.saveConsent(consent)
    if (input.purpose === 'email_digest') {
      if (input.granted) await repository.scheduleDailyDigest(tenant.id, user.id, nextDailyDigestRun())
      else await repository.cancelDailyDigestJobs(tenant.id, user.id)
    }
    response.status(201).json({ consent })
  }))

  app.get('/api/learner-profile', requireAuth, asyncRoute(async (_request, response) => {
    const { user, tenant } = getAuth(response)
    const profile = await repository.getLearnerProfile(tenant.id, user.id)
    response.json({ profile: publicLearnerProfile(profile) })
  }))

  app.put('/api/learner-profile', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const input = parseBody(LearnerProfileUpdateInputSchema, request.body)
    const profile = await repository.updateLearnerProfile(
      tenant.id,
      user.id,
      input.expectedVersion,
      input.signals.map((signal) => ({ ...signal, source: 'student' as const })),
    )
    response.json({ profile: publicLearnerProfile(profile) })
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

  app.get('/api/account/export', requireAuth, asyncRoute(async (_request, response) => {
    const { user, tenant } = getAuth(response)
    const [courses, tasks, documents, availabilityBlocks, plans, consents, learnerProfile, planningPreferences] = await Promise.all([
      repository.listCourses(tenant.id),
      repository.listTasks(tenant.id),
      repository.listDocuments(tenant.id),
      repository.listAvailabilityBlocks(tenant.id),
      repository.listPlans(tenant.id),
      repository.listConsents(tenant.id),
      repository.getLearnerProfile(tenant.id, user.id),
      repository.getPlanningPreferences(tenant.id, user.id),
    ])
    const sourceDocuments = documents.map(({ storageKey: _storageKey, idempotencyKey: _idempotencyKey, ...document }) => document)
    response.setHeader('Content-Disposition', `attachment; filename="priorilearn-export-${new Date().toISOString().slice(0, 10)}.json"`)
    response.json({
      format: 'priorilearn/account-export-v1',
      exportedAt: new Date().toISOString(),
      user: publicUser(user),
      tenant,
      courses,
      tasks,
      sourceDocuments,
      availabilityBlocks,
      plans,
      consents,
      learnerProfile: publicLearnerProfile(learnerProfile),
      planningPreferences: planningPreferences ?? null,
    })
  }))

  app.delete('/api/account', requireAuth, asyncRoute(async (request, response) => {
    const { user, tenant } = getAuth(response)
    const { confirmation } = parseBody(z.object({ confirmation: z.string() }), request.body)
    if (confirmation.trim().toLowerCase() !== user.email) {
      throw new ApiError(400, 'DELETION_CONFIRMATION_MISMATCH', 'Enter the account email to confirm deletion.')
    }
    const receipt = await repository.requestAccountDeletion(tenant.id, user.id)
    clearSessionCookie(response, config)
    response.status(202).json({ receipt })
  }))

  const requireMaintenanceSecret = (request: Request) => {
    const supplied = request.header('x-maintenance-secret')
    const accepted = secretsMatch(supplied, config.maintenanceSecret)
      || secretsMatch(supplied, config.maintenancePreviousSecret)
    if (!accepted) {
      throw new ApiError(401, 'MAINTENANCE_UNAUTHORIZED', 'A valid maintenance secret is required.')
    }
  }
  const runPurgeMaintenance = asyncRoute(async (request, response) => {
    requireMaintenanceSecret(request)
    response.json(await processLifecycleJobs(repository, objectStore))
  })
  const runDailyMaintenance = asyncRoute(async (request, response) => {
    requireMaintenanceSecret(request)
    const [lifecycle, notifications, extractions] = await Promise.all([
      processLifecycleJobs(repository, objectStore),
      processNotificationJobs({
        repository,
        emailSender,
        appOrigin: config.appOrigin,
      }),
      processExtractionQueue(),
    ])
    response.json({ lifecycle, notifications, extractions })
  })
  app.post('/api/internal/maintenance/purge-documents', runPurgeMaintenance)
  app.post('/api/internal/purge', runPurgeMaintenance)
  app.post('/api/internal/maintenance/daily', runDailyMaintenance)

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } })
  })

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      if (error.status >= 500) {
        errorReporter.captureException(error, {
          requestId: response.locals.requestId,
          method: request.method,
          path: request.path,
          status: error.status,
          code: error.code,
          source: 'api',
        })
      }
      if (config.structuredLogging && error.status >= 500) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'api_error',
          requestId: response.locals.requestId,
          code: error.code,
          status: error.status,
          message: error.message,
        }))
      }
      response.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } })
      return
    }
    if (error instanceof RepositoryError) {
      const status = error.code === 'PLAN_NOT_FOUND' || error.code === 'DOCUMENT_NOT_FOUND' || error.code === 'IMPORT_NOT_FOUND' ? 404 : 409
      response.status(status).json({ error: { code: error.code, message: error.message } })
      return
    }
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: { code: 'UPLOAD_ERROR', message: error.message } })
      return
    }
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'unhandled_error',
      requestId: response.locals.requestId,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }))
    errorReporter.captureException(error, {
      requestId: response.locals.requestId,
      method: request.method,
      path: request.path,
      status: 500,
      code: 'INTERNAL_ERROR',
      source: 'api',
    })
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } })
  })

  return { app, config, repository, objectStore, aiProvider, emailSender, errorReporter, processExtractionQueue }
}
