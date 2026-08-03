import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApplication, type ApplicationContext } from './app.js'
import { MockAiProvider } from './services/ai-provider.js'
import { MemoryEmailSender } from './services/email.js'
import { MemoryErrorReporter } from './services/error-reporter.js'
import { InvalidGoogleIdentityError } from './services/google-auth.js'
import { processLifecycleJobs } from './services/purge.js'
import { MemoryWebPushSender } from './services/web-push.js'
import { MemoryObjectStore } from './storage.js'

describe('PrioriLearn API', () => {
  let context: ApplicationContext
  let cookie: string
  let errorReporter: MemoryErrorReporter

  const sessionCookie = (response: request.Response): string => {
    const header = response.headers['set-cookie']
    const value = Array.isArray(header) ? header[0] : header
    if (!value) throw new Error('Expected a session cookie.')
    return value.split(';')[0] ?? ''
  }

  beforeEach(async () => {
    errorReporter = new MemoryErrorReporter()
    context = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      errorReporter,
    })
    const demo = await request(context.app).post('/api/auth/demo').expect(200)
    cookie = sessionCookie(demo)
  })

  const authorized = () => ({ Cookie: cookie })

  it('reports its runtime boundaries', async () => {
    const response = await request(context.app)
      .get('/api/health')
      .set('X-Request-Id', 'test-request-123')
      .expect(200)
    expect(response.body).toMatchObject({
      status: 'ok',
      persistence: 'memory',
      aiProvider: 'deterministic-demo',
      errorReporter: 'memory',
      errorReportingConfigured: true,
    })
    expect(response.headers['x-request-id']).toBe('test-request-123')
  })

  it('publishes safe auth capabilities and can disable shared or unverifiable signup paths', async () => {
    const capabilities = await request(context.app).get('/api/auth/capabilities').expect(200)
    expect(capabilities.body).toEqual({
      passwordLoginEnabled: true,
      passwordRegistrationEnabled: true,
      passwordResetEnabled: false,
      googleSignInConfigured: Boolean(context.config.googleClientId),
      demoAccessEnabled: true,
    })

    const locked = await createApplication({
      config: {
        maintenanceSecret: 'test-secret',
        persistenceDriver: 'memory',
        demoAccessEnabled: false,
        passwordRegistrationEnabled: false,
        googleClientId: undefined,
      },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
    })
    await request(locked.app).get('/api/auth/capabilities').expect(200, {
      passwordLoginEnabled: true,
      passwordRegistrationEnabled: false,
      passwordResetEnabled: false,
      googleSignInConfigured: false,
      demoAccessEnabled: false,
    })
    const registration = await request(locked.app)
      .post('/api/auth/register')
      .send({ email: 'blocked@example.com', password: 'strong-password', name: 'Blocked User', locale: 'en' })
      .expect(503)
    expect(registration.body.error.code).toBe('PASSWORD_REGISTRATION_DISABLED')
    const demo = await request(locked.app).post('/api/auth/demo').expect(404)
    expect(demo.body.error.code).toBe('DEMO_ACCESS_DISABLED')
  })

  it('shares one AI request quota across AI-backed routes for each account', async () => {
    const limited = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory', aiRateLimitMax: 2 },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      errorReporter: new MemoryErrorReporter(),
    })
    const demo = await request(limited.app).post('/api/auth/demo').expect(200)
    const limitedCookie = sessionCookie(demo)

    await request(limited.app).post('/api/planning/chat').set({ Cookie: limitedCookie }).send({}).expect(400)
    await request(limited.app).post('/api/check-ins').set({ Cookie: limitedCookie }).send({}).expect(400)
    const blocked = await request(limited.app)
      .post('/api/documents/00000000-0000-4000-8000-000000000001/extract')
      .set({ Cookie: limitedCookie })
      .expect(429)
    expect(blocked.body.error.code).toBe('AI_RATE_LIMITED')
    expect(blocked.headers['retry-after']).toBeDefined()
  })

  it('reports unexpected API failures with only safe correlation metadata', async () => {
    vi.spyOn(context.repository, 'listCourses').mockRejectedValueOnce(new Error('Database request failed'))

    const response = await request(context.app)
      .get('/api/dashboard?token=must-not-leak')
      .set(authorized())
      .set('X-Request-Id', 'safe-request-123')
      .expect(500)

    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    })
    expect(errorReporter.events).toHaveLength(1)
    expect(errorReporter.events[0]?.context).toEqual({
      requestId: 'safe-request-123',
      method: 'GET',
      path: '/api/dashboard',
      status: 500,
      code: 'INTERNAL_ERROR',
      source: 'api',
    })
    expect(JSON.stringify(errorReporter.events[0]?.context)).not.toContain('must-not-leak')
  })

  it('accepts the previous maintenance secret only during a controlled rotation', async () => {
    const rotating = await createApplication({
      config: {
        maintenanceSecret: 'new-maintenance-secret',
        maintenancePreviousSecret: 'old-maintenance-secret',
        persistenceDriver: 'memory',
      },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      errorReporter: new MemoryErrorReporter(),
    })

    await request(rotating.app)
      .post('/api/internal/maintenance/daily')
      .set('X-Maintenance-Secret', 'old-maintenance-secret')
      .expect(200)
    await request(rotating.app)
      .post('/api/internal/maintenance/daily')
      .set('X-Maintenance-Secret', 'not-valid')
      .expect(401)
  })

  it('returns source-grounded assessment data for the workspace', async () => {
    const response = await request(context.app).get('/api/dashboard').set(authorized()).expect(200)
    expect(response.body.confirmedTaskCount).toBeGreaterThanOrEqual(response.body.rankedTasks.length)
    expect(response.body.rankedTasks.length).toBeGreaterThan(0)
    expect(response.body.recommendation).toMatchObject({
      task: expect.objectContaining({ id: expect.any(String), title: expect.any(String) }),
      course: expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
      firstStep: expect.any(String),
      estimatedMinutes: expect.any(Number),
      assessment: expect.objectContaining({
        score: expect.any(Number),
        factors: expect.objectContaining({ academicImpact: expect.any(Number), costOfDelay: expect.any(Number) }),
        evidence: expect.any(Array),
        assumptions: expect.any(Array),
        uncertainty: expect.stringMatching(/low|medium|high/),
        costOfDelay: expect.objectContaining({
          delayHours: expect.any(Number),
          completionProbabilityNow: expect.any(Number),
          completionProbabilityAfterDelay: expect.any(Number),
          message: expect.any(String),
        }),
      }),
    })
  })

  it('marks a tenant-owned task complete and removes it from active ranking', async () => {
    const before = await request(context.app).get('/api/dashboard').set(authorized()).expect(200)
    const taskId = before.body.recommendation.task.id as string

    const completed = await request(context.app)
      .patch(`/api/tasks/${taskId}`)
      .set(authorized())
      .send({ status: 'completed' })
      .expect(200)
    expect(completed.body.task).toMatchObject({ id: taskId, status: 'completed' })

    const after = await request(context.app).get('/api/dashboard').set(authorized()).expect(200)
    expect(after.body.rankedTasks).not.toContainEqual(expect.objectContaining({ task: expect.objectContaining({ id: taskId }) }))
    const tasks = await request(context.app).get('/api/tasks').set(authorized()).expect(200)
    expect(tasks.body.tasks).toContainEqual(expect.objectContaining({ id: taskId, status: 'completed' }))
  })

  it('exports the authenticated tenant without internal storage credentials', async () => {
    const response = await request(context.app).get('/api/account/export').set(authorized()).expect(200)
    expect(response.headers['content-disposition']).toContain('attachment;')
    expect(response.body).toMatchObject({
      format: 'priorilearn/account-export-v1',
      user: expect.objectContaining({ email: 'mai@demo.priorilearn.app' }),
      tenant: expect.objectContaining({ kind: 'personal' }),
      courses: expect.any(Array),
      tasks: expect.any(Array),
      sourceDocuments: expect.any(Array),
      availabilityBlocks: expect.any(Array),
      plans: expect.any(Array),
      consents: expect.any(Array),
      productEvents: expect.any(Array),
    })
    expect(JSON.stringify(response.body)).not.toContain('storageKey')
    expect(JSON.stringify(response.body)).not.toContain('idempotencyKey')
  })

  it('keeps personal activity while research consent controls aggregate eligibility', async () => {
    const beforeConsent = await request(context.app)
      .post('/api/events')
      .set(authorized())
      .send({ name: 'focus_started', properties: { source: 'test' } })
      .expect(202)
    expect(beforeConsent.body.event.researchEligible).toBe(false)

    await request(context.app)
      .post('/api/consents')
      .set(authorized())
      .send({ purpose: 'research_metrics', granted: true, source: 'settings' })
      .expect(201)

    const afterConsent = await request(context.app)
      .post('/api/events')
      .set(authorized())
      .send({ name: 'focus_completed', properties: { source: 'test' } })
      .expect(202)
    expect(afterConsent.body.event.researchEligible).toBe(true)

    await request(context.app)
      .post('/api/consents')
      .set(authorized())
      .send({ purpose: 'research_metrics', granted: false, source: 'settings' })
      .expect(201)

    const exported = await request(context.app).get('/api/account/export').set(authorized()).expect(200)
    expect(exported.body.productEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'focus_started', researchEligible: false }),
      expect.objectContaining({ name: 'focus_completed', researchEligible: false }),
    ]))

    const metrics = await request(context.app).get('/api/metrics/me').set(authorized()).expect(200)
    expect(metrics.body.metrics).toMatchObject({ focus_started: 1, focus_completed: 1 })
  })

  it('keeps learner signals tenant-private, versioned, and exportable', async () => {
    const initial = await request(context.app).get('/api/learner-profile').set(authorized()).expect(200)
    expect(initial.body.profile).toEqual({ version: 0, signals: [], sourceEventCount: 0 })

    const saved = await request(context.app)
      .put('/api/learner-profile')
      .set(authorized())
      .send({
        expectedVersion: 0,
        signals: [{ id: 'focus-length', kind: 'focus_duration', value: '35 minutes' }],
      })
      .expect(200)
    expect(saved.body.profile).toMatchObject({
      version: 1,
      signals: [{ id: 'focus-length', kind: 'focus_duration', value: '35 minutes' }],
    })

    await request(context.app)
      .put('/api/learner-profile')
      .set(authorized())
      .send({ expectedVersion: 0, signals: [] })
      .expect(409)
      .expect({ error: { code: 'LEARNER_PROFILE_VERSION_CONFLICT', message: 'The learner profile changed. Reload it before saving again.' } })

    const exported = await request(context.app).get('/api/account/export').set(authorized()).expect(200)
    expect(exported.body.learnerProfile).toMatchObject({ version: 1, signals: [{ value: '35 minutes' }] })

    const registration = await request(context.app)
      .post('/api/auth/register')
      .send({ email: 'profile-private@example.test', password: 'strong-password', name: 'Private Student', locale: 'en' })
      .expect(201)
    const otherProfile = await request(context.app)
      .get('/api/learner-profile')
      .set({ Cookie: sessionCookie(registration) })
      .expect(200)
    expect(otherProfile.body.profile).toEqual({ version: 0, signals: [], sourceEventCount: 0 })
  })

  it('drafts planning preferences without mutating them, then saves a versioned weekly schedule', async () => {
    const initial = await request(context.app).get('/api/planning/preferences').set(authorized()).expect(200)
    expect(initial.body.preferences).toBeNull()

    const draft = {
      locale: 'vi',
      coachMode: 'focus',
      dailyMinutes: 90,
      timezone: 'UTC',
      utcOffsetMinutes: 0,
      windows: [],
    }
    const chat = await request(context.app)
      .post('/api/planning/chat')
      .set(authorized())
      .send({ message: 'Tôi muốn xếp lịch học trong tuần.', history: [], locale: 'vi', draft })
      .expect(200)
    expect(chat.body.reply.message).toContain('Mình')
    expect(chat.body.reply.missingInformation).toContain('availability')
    await request(context.app).get('/api/planning/preferences').set(authorized()).expect(200, { preferences: null })

    await request(context.app)
      .put('/api/planning/preferences')
      .set(authorized())
      .send({ expectedVersion: 0, ...draft })
      .expect(400)

    const saved = await request(context.app)
      .put('/api/planning/preferences')
      .set(authorized())
      .send({
        expectedVersion: 0,
        ...draft,
        windows: [
          { dayOfWeek: 1, startMinute: 18 * 60, endMinute: 20 * 60 },
          { dayOfWeek: 2, startMinute: 18 * 60, endMinute: 20 * 60 },
        ],
      })
      .expect(200)
    expect(saved.body.preferences).toMatchObject({ version: 1, locale: 'vi', coachMode: 'focus', dailyMinutes: 90 })

    await request(context.app)
      .put('/api/planning/preferences')
      .set(authorized())
      .send({ expectedVersion: 0, ...draft, windows: [{ dayOfWeek: 3, startMinute: 600, endMinute: 660 }] })
      .expect(409)
      .expect({ error: { code: 'PLANNING_PREFERENCES_VERSION_CONFLICT', message: 'Planning preferences changed. Reload them before saving again.' } })

    const generated = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-06-15T08:00:00.000Z', locale: 'vi' })
      .expect(201)
    expect(generated.body.plan.items.length).toBeGreaterThan(0)
    expect(generated.body.plan.items[0].firstStep).toContain('Mở')
    expect(generated.body.plan.rationale).toContain('Kế hoạch')
    expect(generated.body.plan.rationale).toContain('tập trung')

    const exported = await request(context.app).get('/api/account/export').set(authorized()).expect(200)
    expect(exported.body.planningPreferences).toMatchObject({ version: 1, windows: expect.any(Array) })
  })

  it('creates a private account and revokes its session on logout', async () => {
    await request(context.app).get('/api/auth/session').expect(200, { session: null })

    const registration = await request(context.app)
      .post('/api/auth/register')
      .send({ email: 'student@example.com', password: 'strong-password', name: 'New Student', locale: 'en' })
      .expect(201)
    const privateCookie = sessionCookie(registration)
    const privateAuth = { Cookie: privateCookie }

    expect(registration.body.user).toMatchObject({ email: 'student@example.com', name: 'New Student', locale: 'en' })
    expect(registration.body.user).not.toHaveProperty('passwordHash')
    expect(registration.body).not.toHaveProperty('token')
    expect(registration.headers['set-cookie']?.[0]).toContain('HttpOnly')
    expect(registration.headers['set-cookie']?.[0]).toContain('SameSite=Lax')

    const dashboard = await request(context.app).get('/api/dashboard').set(privateAuth).expect(200)
    expect(dashboard.body.rankedTasks).toEqual([])
    const activationMetrics = await request(context.app).get('/api/metrics/me').set(privateAuth).expect(200)
    expect(activationMetrics.body.metrics).toMatchObject({
      onboarding_completed: 1,
      workspace_opened: 1,
      active_days: 1,
      d7_retained: 0,
    })

    await request(context.app).get('/api/me').set(privateAuth).expect(200)
    const restoredSession = await request(context.app).get('/api/auth/session').set(privateAuth).expect(200)
    expect(restoredSession.body.session).toMatchObject({
      user: { email: 'student@example.com' },
    })
    await request(context.app).post('/api/auth/logout').set(privateAuth).expect(204)
    await request(context.app).get('/api/auth/session').expect(200, { session: null })
    await request(context.app).get('/api/me').set(privateAuth).expect(401)

    const login = await request(context.app)
      .post('/api/auth/login')
      .send({ email: 'student@example.com', password: 'strong-password' })
      .expect(200)
    expect(login.body).not.toHaveProperty('token')
    expect(sessionCookie(login)).not.toBe(privateCookie)
  })

  it('creates, reuses, and safely links accounts through verified Google identities', async () => {
    const google = await createApplication({
      config: { googleClientId: 'test-google-client', maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      googleTokenVerifier: async (credential) => {
        if (credential === 'invalid') throw new InvalidGoogleIdentityError('Invalid test credential.')
        if (credential === 'linked') return { subject: 'google-linked', email: 'existing@example.com', name: 'Existing User', emailVerified: true }
        return { subject: 'google-new', email: 'google@example.com', name: 'Google Student', emailVerified: true }
      },
    })

    const first = await request(google.app)
      .post('/api/auth/google')
      .send({ credential: 'new', locale: 'en' })
      .expect(200)
    const second = await request(google.app)
      .post('/api/auth/google')
      .send({ credential: 'new', locale: 'en' })
      .expect(200)
    expect(first.body.user).toMatchObject({ email: 'google@example.com', name: 'Google Student' })
    expect(first.body.user.id).toBe(second.body.user.id)
    expect(first.body.user).not.toHaveProperty('googleSubject')
    expect(sessionCookie(first)).toContain('priorilearn_session=')
    const googleMetrics = await request(google.app)
      .get('/api/metrics/me')
      .set('Cookie', sessionCookie(second))
      .expect(200)
    expect(googleMetrics.body.metrics).toMatchObject({ onboarding_completed: 1 })

    const existing = await request(google.app)
      .post('/api/auth/register')
      .send({ email: 'existing@example.com', password: 'strong-password', name: 'Existing User', locale: 'en' })
      .expect(201)
    const unsafeLink = await request(google.app)
      .post('/api/auth/google')
      .send({ credential: 'linked', locale: 'en' })
      .expect(409)
    expect(unsafeLink.body.error.code).toBe('GOOGLE_EMAIL_LINK_REQUIRES_VERIFICATION')
    await google.repository.markEmailVerified(existing.body.user.tenantId, existing.body.user.id)
    const linked = await request(google.app)
      .post('/api/auth/google')
      .send({ credential: 'linked', locale: 'en' })
      .expect(200)
    expect(linked.body.user.id).toBe(existing.body.user.id)
    const linkedUser = await google.repository.findUserByGoogleSubject('google-linked')
    expect(linkedUser).toMatchObject({ id: existing.body.user.id })
    await request(google.app).post('/api/auth/google').send({ credential: 'invalid', locale: 'en' }).expect(401)

    const unconfigured = await createApplication({
      config: { googleClientId: undefined, maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
    })
    await request(unconfigured.app).post('/api/auth/google').send({ credential: 'new', locale: 'en' }).expect(503)
  })

  it('verifies an email with a one-time expiring action token', async () => {
    const emailSender = new MemoryEmailSender()
    const emailContext = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      emailSender,
    })
    const registration = await request(emailContext.app)
      .post('/api/auth/register')
      .send({ email: 'verify@example.com', password: 'strong-password', name: 'Verify Student', locale: 'en' })
      .expect(201)
    const registrationCookie = sessionCookie(registration)
    expect(registration.body.user.emailVerified).toBe(false)

    await request(emailContext.app)
      .post('/api/auth/email-verification/request')
      .set('Cookie', registrationCookie)
      .expect(202)
    expect(emailSender.messages).toHaveLength(1)
    const verificationLink = emailSender.messages[0]?.text.split('\n').find((line) => line.startsWith('http'))
    if (!verificationLink) throw new Error('Expected a verification link in the email.')
    const token = new URL(verificationLink).searchParams.get('token')
    if (!token) throw new Error('Expected a verification token in the email link.')

    const confirmed = await request(emailContext.app)
      .post('/api/auth/email-verification/confirm')
      .send({ token })
      .expect(200)
    expect(confirmed.body.user.emailVerified).toBe(true)
    await request(emailContext.app)
      .post('/api/auth/email-verification/confirm')
      .send({ token })
      .expect(400)
  })

  it('resets a password without disclosing accounts and revokes every old session', async () => {
    const emailSender = new MemoryEmailSender()
    const emailContext = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      emailSender,
    })
    const registration = await request(emailContext.app)
      .post('/api/auth/register')
      .send({ email: 'reset@example.com', password: 'old-password', name: 'Reset Student', locale: 'en' })
      .expect(201)
    const oldCookie = sessionCookie(registration)

    await request(emailContext.app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'missing@example.com' })
      .expect(202)
    expect(emailSender.messages).toHaveLength(0)

    await request(emailContext.app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'reset@example.com' })
      .expect(202)
    expect(emailSender.messages).toHaveLength(1)
    const resetLink = emailSender.messages[0]?.text.split('\n').find((line) => line.startsWith('http'))
    if (!resetLink) throw new Error('Expected a password reset link in the email.')
    const token = new URL(resetLink).searchParams.get('token')
    if (!token) throw new Error('Expected a password reset token in the email link.')

    const confirmed = await request(emailContext.app)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'new-password' })
      .expect(200)
    expect(confirmed.body.user.emailVerified).toBe(true)
    await request(emailContext.app).get('/api/me').set('Cookie', oldCookie).expect(401)
    await request(emailContext.app)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'another-password' })
      .expect(400)
    await request(emailContext.app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'old-password' })
      .expect(401)
    await request(emailContext.app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'new-password' })
      .expect(200)
  })

  it('reports missing email delivery configuration consistently', async () => {
    await request(context.app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'missing@example.com' })
      .expect(503)
    await request(context.app)
      .post('/api/auth/email-verification/request')
      .set(authorized())
      .expect(202)

    const registration = await request(context.app)
      .post('/api/auth/register')
      .send({ email: 'unverified@example.com', password: 'strong-password', name: 'Unverified Student', locale: 'en' })
      .expect(201)
    await request(context.app)
      .post('/api/auth/email-verification/request')
      .set('Cookie', sessionCookie(registration))
      .expect(503)
  })

  it('requires verified opt-in and sends the daily digest through maintenance', async () => {
    const emailSender = new MemoryEmailSender()
    const digestContext = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      emailSender,
    })
    const registration = await request(digestContext.app)
      .post('/api/auth/register')
      .send({ email: 'digest@example.com', password: 'strong-password', name: 'Digest Student', locale: 'en' })
      .expect(201)
    const digestCookie = sessionCookie(registration)
    await request(digestContext.app)
      .post('/api/consents')
      .set('Cookie', digestCookie)
      .send({ purpose: 'email_digest', granted: true, source: 'settings' })
      .expect(409)

    const userId = registration.body.user.id as string
    const tenantId = registration.body.user.tenantId as string
    await digestContext.repository.markEmailVerified(tenantId, userId)
    const course = await digestContext.repository.createCourse(tenantId, {
      code: 'DIGEST101',
      name: 'Digest testing',
      currentScore: 55,
      targetScore: 80,
    })
    await digestContext.repository.createTask(tenantId, {
      courseId: course.id,
      title: 'Review the daily priority',
      dueAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      gradeWeight: 25,
      estimatedMinutes: 40,
      status: 'confirmed',
      sourceKind: 'manual',
      confidence: 1,
      evidence: ['API test task'],
    })
    await request(digestContext.app)
      .post('/api/consents')
      .set('Cookie', digestCookie)
      .send({ purpose: 'email_digest', granted: true, source: 'settings' })
      .expect(201)
    await digestContext.repository.scheduleDailyDigest(
      tenantId,
      userId,
      new Date(Date.now() - 60_000).toISOString(),
    )

    const maintenance = await request(digestContext.app)
      .post('/api/internal/maintenance/daily')
      .set('x-maintenance-secret', 'test-secret')
      .expect(200)
    expect(maintenance.body.notifications).toMatchObject({ configured: true, claimed: 1, sent: 1 })
    expect(emailSender.messages[0]?.subject).toContain('Review the daily priority')

    await request(digestContext.app)
      .post('/api/consents')
      .set('Cookie', digestCookie)
      .send({ purpose: 'email_digest', granted: false, source: 'settings' })
      .expect(201)
  })

  it('manages per-device web push consent and delivers without email configuration', async () => {
    const webPushSender = new MemoryWebPushSender()
    const pushContext = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
      webPushSender,
    })
    const registration = await request(pushContext.app)
      .post('/api/auth/register')
      .send({ email: 'push@example.com', password: 'strong-password', name: 'Push Student', locale: 'en' })
      .expect(201)
    const pushCookie = sessionCookie(registration)
    const tenantId = registration.body.user.tenantId as string
    const userId = registration.body.user.id as string

    const initial = await request(pushContext.app)
      .get('/api/push-subscriptions/status')
      .set('Cookie', pushCookie)
      .expect(200)
    expect(initial.body).toMatchObject({ configured: true, subscriptionCount: 0, consentGranted: false })
    expect(initial.body.publicKey).toBe(webPushSender.publicKey)

    const subscription = {
      endpoint: 'https://push.example.test/device-1',
      expirationTime: null,
      keys: { p256dh: 'device-public-encryption-key', auth: 'device-auth-secret' },
    }
    await request(pushContext.app)
      .post('/api/push-subscriptions')
      .set('Cookie', pushCookie)
      .send({ ...subscription, endpoint: 'https://127.0.0.1/internal' })
      .expect(400)
    const enabled = await request(pushContext.app)
      .post('/api/push-subscriptions')
      .set('Cookie', pushCookie)
      .send(subscription)
      .expect(201)
    expect(enabled.body.status).toMatchObject({ subscriptionCount: 1, consentGranted: true })

    const checked = await request(pushContext.app)
      .post('/api/push-subscriptions/check')
      .set('Cookie', pushCookie)
      .send({ endpoint: subscription.endpoint })
      .expect(200)
    expect(checked.body.registered).toBe(true)

    const course = await pushContext.repository.createCourse(tenantId, {
      code: 'PUSH101', name: 'Push testing', currentScore: 60, targetScore: 85,
    })
    await pushContext.repository.createTask(tenantId, {
      courseId: course.id,
      title: 'Review browser reminders',
      dueAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      gradeWeight: 20,
      estimatedMinutes: 30,
      status: 'confirmed',
      sourceKind: 'manual',
      confidence: 1,
      evidence: ['API test task'],
    })
    await pushContext.repository.scheduleDailyDigest(
      tenantId,
      userId,
      '2020-01-01T03:00:00.000Z',
      'web_push',
    )
    const maintenance = await request(pushContext.app)
      .post('/api/internal/maintenance/daily')
      .set('x-maintenance-secret', 'test-secret')
      .expect(200)
    expect(maintenance.body.notifications).toMatchObject({
      emailConfigured: false,
      webPushConfigured: true,
      claimed: 1,
      sent: 1,
    })
    expect(webPushSender.messages[0]?.payload.title).toContain('Review browser reminders')

    const disabled = await request(pushContext.app)
      .delete('/api/push-subscriptions')
      .set('Cookie', pushCookie)
      .send({ endpoint: subscription.endpoint })
      .expect(200)
    expect(disabled.body).toMatchObject({ removed: true, status: { subscriptionCount: 0, consentGranted: false } })
  })

  it('rejects untrusted writes and prevents private response caching', async () => {
    const guarded = await createApplication({
      config: {
        appOrigin: 'https://app.priorilearn.test',
        enforceOriginCheck: true,
        maintenanceSecret: 'test-secret',
        persistenceDriver: 'memory',
        sessionCookieSecure: true,
      },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
    })

    await request(guarded.app).post('/api/auth/demo').expect(403)
    const signedIn = await request(guarded.app)
      .post('/api/auth/demo')
      .set('Origin', 'https://app.priorilearn.test')
      .expect(200)
    const guardedCookie = sessionCookie(signedIn)
    expect(signedIn.headers['set-cookie']?.[0]).toContain('Secure')

    const me = await request(guarded.app).get('/api/me').set('Cookie', guardedCookie).expect(200)
    expect(me.headers['cache-control']).toContain('no-store')

    await request(guarded.app)
      .post('/api/auth/logout')
      .set('Cookie', guardedCookie)
      .set('Origin', 'https://evil.example')
      .expect(403)
  })

  it('rate limits repeated authentication attempts', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(context.app).post('/api/auth/login').send({}).expect(400)
    }

    const blocked = await request(context.app).post('/api/auth/login').send({}).expect(429)
    expect(blocked.body.error.code).toBe('AUTH_RATE_LIMITED')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('keeps extracted data out of planning until the student confirms it', async () => {
    const before = await request(context.app).get('/api/tasks').set(authorized()).expect(200)
    const uploaded = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', 'syllabus-upload-1')
      .attach('file', Buffer.from('%PDF demo syllabus'), { filename: 'syllabus.pdf', contentType: 'application/pdf' })
      .expect(201)
    const documentId = uploaded.body.document.id as string
    const queued = await request(context.app)
      .post(`/api/documents/${documentId}/extract`)
      .set(authorized())
      .expect(202)
    expect(queued.body).toMatchObject({ queued: true, document: { status: 'extracting' } })
    expect(await context.processExtractionQueue()).toMatchObject({ claimed: 1, completed: 1 })
    const extraction = await request(context.app)
      .get(`/api/documents/${documentId}`)
      .set(authorized())
      .expect(200)
    expect(extraction.body.document).toMatchObject({ status: 'review', extraction: expect.any(Object) })

    const whileUnconfirmed = await request(context.app).get('/api/tasks').set(authorized()).expect(200)
    expect(whileUnconfirmed.body.tasks).toHaveLength(before.body.tasks.length)

    await request(context.app)
      .post(`/api/documents/${documentId}/confirm`)
      .set(authorized())
      .send({})
      .expect(200)
    const after = await request(context.app).get('/api/tasks').set(authorized()).expect(200)
    expect(after.body.tasks).toHaveLength(before.body.tasks.length + 1)
  })

  it('accepts PNG and JPEG study images after validating their contents', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2l0sAAAAASUVORK5CYII=', 'base64')
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])
    const fixtures = [
      { key: 'image-png-upload', filename: 'schedule.png', contentType: 'image/png', content: png, mimeType: 'image/png' },
      { key: 'image-jpeg-upload', filename: 'assignment.jpg', contentType: 'image/jpeg', content: jpeg, mimeType: 'image/jpeg' },
    ]

    for (const fixture of fixtures) {
      const uploaded = await request(context.app)
        .post('/api/documents')
        .set(authorized())
        .set('Idempotency-Key', fixture.key)
        .attach('file', fixture.content, { filename: fixture.filename, contentType: fixture.contentType })
        .expect(201)
      expect(uploaded.body.document).toMatchObject({
        filename: fixture.filename,
        mimeType: fixture.mimeType,
        status: 'uploaded',
      })
    }
  })

  it('rejects renamed or malformed images before storing them', async () => {
    const invalid = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', 'invalid-image-upload')
      .attach('file', Buffer.from('not an image'), { filename: 'fake.png', contentType: 'image/png' })
      .expect(415)
    expect(invalid.body).toMatchObject({ error: { code: 'INVALID_FILE_CONTENT' } })

    const pngRenamedAsJpeg = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2l0sAAAAASUVORK5CYII=', 'base64')
    const mismatched = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', 'mismatched-image-upload')
      .attach('file', pngRenamedAsJpeg, { filename: 'fake.jpg', contentType: 'application/octet-stream' })
      .expect(415)
    expect(mismatched.body).toMatchObject({ error: { code: 'INVALID_FILE_CONTENT' } })
  })

  it('accepts CSV and JSON school exports and prepares deterministic review drafts', async () => {
    const fixtures = [
      {
        key: 'structured-csv-upload',
        filename: 'semester.csv',
        contentType: 'text/csv',
        content: [
          'course_code,course_name,task_title,due_date,grade_weight,estimated_minutes',
          'CS401,Distributed Systems,Consensus exercise,2027-09-01T12:00:00Z,25,50',
        ].join('\n'),
        provider: 'structured-csv',
        title: 'Consensus exercise',
      },
      {
        key: 'structured-json-upload',
        filename: 'semester.json',
        contentType: 'application/json',
        content: JSON.stringify({
          courses: [{ id: 'MATH210', name: 'Applied Mathematics' }],
          tasks: [{ courseId: 'MATH210', title: 'Problem set 2', estimatedMinutes: 40 }],
        }),
        provider: 'structured-json',
        title: 'Problem set 2',
      },
    ]

    for (const fixture of fixtures) {
      const uploaded = await request(context.app)
        .post('/api/documents')
        .set(authorized())
        .set('Idempotency-Key', fixture.key)
        .attach('file', Buffer.from(fixture.content), {
          filename: fixture.filename,
          contentType: fixture.contentType,
        })
        .expect(201)

      await request(context.app)
        .post(`/api/documents/${uploaded.body.document.id}/extract`)
        .set(authorized())
        .expect(202)
      expect(await context.processExtractionQueue()).toMatchObject({ claimed: 1, completed: 1 })
      const extracted = await request(context.app)
        .get(`/api/documents/${uploaded.body.document.id}`)
        .set(authorized())
        .expect(200)

      expect(extracted.body).toMatchObject({
        document: {
          status: 'review',
          extractionProvider: fixture.provider,
          extraction: { tasks: [expect.objectContaining({ title: fixture.title })] },
        },
      })
    }
  })

  it('rejects malformed structured files without confirming or replacing the raw upload', async () => {
    const uploaded = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', 'malformed-json-upload')
      .attach('file', Buffer.from('{broken json'), {
        filename: 'broken.json',
        contentType: 'application/json',
      })
      .expect(201)

    await request(context.app)
      .post(`/api/documents/${uploaded.body.document.id}/extract`)
      .set(authorized())
      .expect(202)
    expect(await context.processExtractionQueue()).toMatchObject({ claimed: 1, failed: 1 })

    const stored = await request(context.app)
      .get(`/api/documents/${uploaded.body.document.id}`)
      .set(authorized())
      .expect(200)
    expect(stored.body.document.status).toBe('extraction_failed')

    await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', 'spoofed-extension-upload')
      .attach('file', Buffer.from('{}'), {
        filename: 'payload.exe',
        contentType: 'application/json',
      })
      .expect(415)
  })

  it('resumes an upload with one idempotency key and does not duplicate confirmed records', async () => {
    const key = 'same-file-retry-key'
    const first = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', key)
      .attach('file', Buffer.from('course outline'), { filename: 'outline.txt', contentType: 'text/plain' })
      .expect(201)
    const retried = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .set('Idempotency-Key', key)
      .attach('file', Buffer.from('course outline'), { filename: 'outline.txt', contentType: 'text/plain' })
      .expect(200)
    expect(retried.body.document.id).toBe(first.body.document.id)
    expect(retried.body.resumed).toBe(true)

    const documentId = first.body.document.id as string
    await request(context.app).post(`/api/documents/${documentId}/extract`).set(authorized()).expect(202)
    expect(await context.processExtractionQueue()).toMatchObject({ claimed: 1, completed: 1 })
    const firstConfirmation = await request(context.app)
      .post(`/api/documents/${documentId}/confirm`).set(authorized()).send({}).expect(200)
    const retriedConfirmation = await request(context.app)
      .post(`/api/documents/${documentId}/confirm`).set(authorized()).send({}).expect(200)
    expect(retriedConfirmation.body.tasks.map((task: { id: string }) => task.id))
      .toEqual(firstConfirmation.body.tasks.map((task: { id: string }) => task.id))
  })

  it('returns source documents through a bounded cursor page', async () => {
    for (const [key, filename] of [['source-page-one', 'one.txt'], ['source-page-two', 'two.txt']] as const) {
      await request(context.app)
        .post('/api/documents')
        .set(authorized())
        .set('Idempotency-Key', key)
        .attach('file', Buffer.from(filename), { filename, contentType: 'text/plain' })
        .expect(201)
    }

    const first = await request(context.app).get('/api/documents?limit=1').set(authorized()).expect(200)
    expect(first.body.documents).toHaveLength(1)
    expect(first.body.nextCursor).toEqual(expect.any(String))
    const second = await request(context.app)
      .get(`/api/documents?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set(authorized())
      .expect(200)
    expect(second.body.documents).toHaveLength(1)
    expect(second.body.documents[0].id).not.toBe(first.body.documents[0].id)
    await request(context.app).get('/api/documents?cursor=bad-cursor').set(authorized()).expect(400)
  })

  it('returns tasks through bounded cursor pages', async () => {
    const first = await request(context.app).get('/api/tasks?limit=1').set(authorized()).expect(200)
    expect(first.body.tasks).toHaveLength(1)
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await request(context.app)
      .get(`/api/tasks?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set(authorized())
      .expect(200)
    expect(second.body.tasks).toHaveLength(1)
    expect(second.body.tasks[0].id).not.toBe(first.body.tasks[0].id)
    await request(context.app).get('/api/tasks?limit=101').set(authorized()).expect(400)
    await request(context.app).get('/api/tasks?cursor=bad-cursor').set(authorized()).expect(400)
  })

  it('does not apply a plan or replan without explicit versioned approval', async () => {
    const generated = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-07-16T09:00:00.000Z', availableMinutes: 90, coachMode: 'discipline' })
      .expect(201)
    const proposedPlan = generated.body.plan
    expect(proposedPlan.status).toBe('proposed')
    expect(context.repository.getPlan(context.repository.getDemoUser().tenantId, proposedPlan.id)?.status).toBe('proposed')

    await request(context.app)
      .post('/api/check-ins')
      .set(authorized())
      .send({ planId: proposedPlan.id, friction: 'cannot_start' })
      .expect(409)
    await request(context.app)
      .post(`/api/plans/${proposedPlan.id}/approve`)
      .set(authorized())
      .send({ expectedVersion: proposedPlan.version + 1 })
      .expect(409)

    const approval = await request(context.app)
      .post(`/api/plans/${proposedPlan.id}/approve`)
      .set(authorized())
      .send({ expectedVersion: proposedPlan.version })
      .expect(200)
    expect(approval.body.plan.status).toBe('approved')

    await request(context.app)
      .put('/api/learner-profile')
      .set(authorized())
      .send({ expectedVersion: 0, signals: [{ id: 'focus-35', kind: 'focus_duration', value: '35 minutes' }] })
      .expect(200)

    const checkIn = await request(context.app)
      .post('/api/check-ins')
      .set(authorized())
      .send({ planId: proposedPlan.id, friction: 'cannot_start' })
      .expect(201)
    const proposal = checkIn.body.proposal
    expect(proposal.status).toBe('proposed')
    expect(proposal).toMatchObject({
      title: expect.any(String),
      rationale: expect.any(String),
      changes: expect.any(Array),
      proposedItems: expect.any(Array),
    })
    expect(proposal.proposedItems[0].minutes).toBe(35)
    expect(context.repository.getPlan(context.repository.getDemoUser().tenantId, proposedPlan.id)?.status).toBe('approved')

    await request(context.app)
      .post(`/api/replan-proposals/${proposal.id}/approve`)
      .set(authorized())
      .send({ expectedPlanVersion: proposedPlan.version + 1 })
      .expect(409)
    const replanApproval = await request(context.app)
      .post(`/api/replan-proposals/${proposal.id}/approve`)
      .set(authorized())
      .send({ expectedPlanVersion: proposedPlan.version })
      .expect(200)
    expect(replanApproval.body.plan.status).toBe('approved')
    expect(replanApproval.body.plan.version).toBeGreaterThan(proposedPlan.version)
    const metrics = await request(context.app).get('/api/metrics/me').set(authorized()).expect(200)
    expect(metrics.body.metrics).toMatchObject({
      plan_generated: 1,
      plan_approved: 1,
      replan_approved: 1,
      plan_acceptance_rate: 1,
      plan_edit_rate: 0,
    })
  })

  it('keeps one active and one pending plan through generate, edit, approve, and reload', async () => {
    const firstGeneration = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-07-16T09:00:00.000Z', availableMinutes: 90, coachMode: 'discipline' })
      .expect(201)
    const firstProposal = firstGeneration.body.plan

    const repeatedGeneration = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-07-17T09:00:00.000Z', availableMinutes: 120, coachMode: 'focus' })
      .expect(200)
    expect(repeatedGeneration.body.plan.id).toBe(firstProposal.id)

    const editedItems = firstProposal.items.map((item: { startsAt: string; endsAt: string; minutes: number }, index: number) => {
      if (index !== 0) return item
      const startsAt = new Date(new Date(item.startsAt).getTime() + 15 * 60_000).toISOString()
      const minutes = item.minutes - 15
      return { ...item, startsAt, minutes, endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString() }
    })
    const edited = await request(context.app)
      .put(`/api/plans/${firstProposal.id}/proposal`)
      .set(authorized())
      .send({ expectedVersion: firstProposal.version, items: editedItems })
      .expect(201)
    expect(edited.body.plan.version).toBe(firstProposal.version + 1)
    expect(edited.body.plan.id).not.toBe(firstProposal.id)
    expect(edited.body.plan.items.map((item: { id: string }) => item.id))
      .not.toEqual(firstProposal.items.map((item: { id: string }) => item.id))

    const stale = await request(context.app)
      .put(`/api/plans/${edited.body.plan.id}/proposal`)
      .set(authorized())
      .send({ expectedVersion: firstProposal.version, items: editedItems })
      .expect(409)
    expect(stale.body.error.code).toBe('PLAN_VERSION_CONFLICT')

    const approved = await request(context.app)
      .post(`/api/plans/${edited.body.plan.id}/approve`)
      .set(authorized())
      .send({ expectedVersion: edited.body.plan.version })
      .expect(200)
    expect(approved.body.plan.status).toBe('approved')
    const metrics = await request(context.app).get('/api/metrics/me').set(authorized()).expect(200)
    expect(metrics.body.metrics).toMatchObject({
      plan_generated: 1,
      plan_edited: 1,
      plan_approved: 1,
      plan_acceptance_rate: 1,
      plan_edit_rate: 1,
    })

    const afterApproval = await request(context.app).get('/api/plans/current').set(authorized()).expect(200)
    expect(afterApproval.body.active.id).toBe(edited.body.plan.id)
    expect(afterApproval.body.pending).toBeNull()

    const nextGeneration = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-07-18T09:00:00.000Z', availableMinutes: 90, coachMode: 'focus' })
      .expect(201)
    const current = await request(context.app).get('/api/plans/current').set(authorized()).expect(200)
    expect(current.body.active.id).toBe(edited.body.plan.id)
    expect(current.body.pending.id).toBe(nextGeneration.body.plan.id)
    expect(current.body.active.items.length).toBeGreaterThan(0)
    expect(current.body.pending.items.length).toBeGreaterThan(0)
  })

  it('enforces tenant ownership at the API boundary', async () => {
    const account = await request(context.app)
      .post('/api/auth/register')
      .send({ email: 'second@example.com', password: 'strong-password', name: 'Second Student', locale: 'en' })
      .expect(201)
    const secondTenantId = account.body.tenant.id as string
    const secondCourse = context.repository.createCourse(secondTenantId, {
      code: 'PRIVATE101',
      name: 'Private course',
      currentScore: 80,
      targetScore: 90,
    })
    const secondTask = context.repository.createTask(secondTenantId, {
      courseId: secondCourse.id,
      title: 'Private task',
      dueAt: null,
      gradeWeight: 10,
      estimatedMinutes: 30,
      status: 'confirmed',
      sourceKind: 'manual',
      confidence: 1,
      evidence: [],
    })

    await request(context.app)
      .post('/api/priority-assessments')
      .set(authorized())
      .send({ taskId: secondTask.id })
      .expect(404)
    const demoTasks = await request(context.app).get('/api/tasks').set(authorized()).expect(200)
    expect(demoTasks.body.tasks.some((task: { id: string }) => task.id === secondTask.id)).toBe(false)

    const generated = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-07-16T09:00:00.000Z', availableMinutes: 90, coachMode: 'discipline' })
      .expect(201)
    const foreignTaskItems = generated.body.plan.items.map((item: { taskId: string }, index: number) => (
      index === 0 ? { ...item, taskId: secondTask.id } : item
    ))
    const rejected = await request(context.app)
      .put(`/api/plans/${generated.body.plan.id}/proposal`)
      .set(authorized())
      .send({ expectedVersion: generated.body.plan.version, items: foreignTaskItems })
      .expect(409)
    expect(rejected.body.error.code).toBe('INVALID_PLAN_SCHEDULE')
    expect(rejected.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TASK_NOT_FOUND', taskId: secondTask.id }),
    ]))
  })

  it('persists the selected locale in the authenticated account', async () => {
    const updated = await request(context.app)
      .patch('/api/me')
      .set(authorized())
      .send({ locale: 'en' })
      .expect(200)
    expect(updated.body.user.locale).toBe('en')

    const restored = await request(context.app).get('/api/auth/session').set(authorized()).expect(200)
    expect(restored.body.session.user.locale).toBe('en')
  })

  it('persists the current onboarding guide version once per authenticated account', async () => {
    const registration = await request(context.app)
      .post('/api/auth/register')
      .send({ email: 'guide@example.test', password: 'strong-password', name: 'Guide User', locale: 'en' })
      .expect(201)
    const privateCookie = sessionCookie(registration)
    expect(registration.body.user).toMatchObject({ onboardingGuideSeenVersion: 0 })
    expect(registration.body.user.onboardingGuideSeenAt).toBeUndefined()

    await request(context.app)
      .put('/api/me/onboarding-guide/seen')
      .send({ version: 1 })
      .expect(401)

    const first = await request(context.app)
      .put('/api/me/onboarding-guide/seen')
      .set({ Cookie: privateCookie })
      .send({ version: 1 })
      .expect(200)
    expect(first.body.user.onboardingGuideSeenVersion).toBe(1)
    expect(first.body.user.onboardingGuideSeenAt).toEqual(expect.any(String))

    const repeated = await request(context.app)
      .put('/api/me/onboarding-guide/seen')
      .set({ Cookie: privateCookie })
      .send({ version: 1 })
      .expect(200)
    expect(repeated.body.user.onboardingGuideSeenAt).toBe(first.body.user.onboardingGuideSeenAt)

    const invalid = await request(context.app)
      .put('/api/me/onboarding-guide/seen')
      .set({ Cookie: privateCookie })
      .send({ version: 2 })
      .expect(400)
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR')

    const restored = await request(context.app)
      .get('/api/auth/session')
      .set({ Cookie: privateCookie })
      .expect(200)
    expect(restored.body.session.user).toMatchObject({ onboardingGuideSeenVersion: 1 })
  })

  it('does not approve a weekly proposal while work is still unscheduled', async () => {
    const user = await context.repository.getDemoUser()
    const task = (await context.repository.listTasks(user.tenantId))[0]
    if (!task) throw new Error('Demo task was not created.')
    const plan = await context.repository.createPlanProposal(user.tenantId, {
      items: [{
        id: 'temporary-item-id', taskId: task.id, startsAt: '2026-07-16T09:00:00.000Z', endsAt: '2026-07-16T09:15:00.000Z',
        minutes: 15, firstStep: 'Open the task.', rationale: 'Test capacity warning.',
      }],
      schedulingWarnings: [{ taskId: task.id, remainingMinutes: 30, reason: 'insufficient_capacity' }],
      rationale: 'Incomplete weekly proposal.',
    })

    const approval = await request(context.app)
      .post(`/api/plans/${plan.id}/approve`)
      .set(authorized())
      .send({ expectedVersion: plan.version })
      .expect(409)
    expect(approval.body.error.code).toBe('PLAN_HAS_UNSCHEDULED_WORK')
  })

  it('revalidates current availability immediately before plan approval', async () => {
    const generated = await request(context.app)
      .post('/api/plans/generate')
      .set(authorized())
      .send({ startsAt: '2026-07-16T09:00:00.000Z', availableMinutes: 90, coachMode: 'discipline' })
      .expect(201)
    const firstItem = generated.body.plan.items[0]
    const user = await context.repository.getDemoUser()
    await context.repository.createAvailabilityBlock(user.tenantId, {
      title: 'New calendar conflict',
      startsAt: firstItem.startsAt,
      endsAt: firstItem.endsAt,
      sourceKind: 'ics',
    })

    const approval = await request(context.app)
      .post(`/api/plans/${generated.body.plan.id}/approve`)
      .set(authorized())
      .send({ expectedVersion: generated.body.plan.version })
      .expect(409)
    expect(approval.body.error.code).toBe('INVALID_PLAN_SCHEDULE')
    expect(approval.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BUSY_TIME_CONFLICT', itemId: firstItem.id }),
    ]))
  })

  it('imports ICS through a review draft and stores busy blocks only after confirmation', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:class-1',
      'DTSTAMP:20260716T000000Z',
      'DTSTART:20260716T090000Z',
      'DTEND:20260716T100000Z',
      'SUMMARY:Lecture',
      'END:VEVENT',
      'BEGIN:VTODO',
      'UID:task-1',
      'DTSTAMP:20260716T000000Z',
      'DUE:20260718T120000Z',
      'SUMMARY:Submit quiz',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n')
    const preview = await request(context.app)
      .post('/api/imports/ics')
      .set(authorized())
      .attach('file', Buffer.from(ics), { filename: 'calendar.ics', contentType: 'text/calendar' })
      .expect(201)
    expect(preview.body.draft.status).toBe('review')
    expect(preview.body.draft.busyBlocks).toHaveLength(1)
    expect(preview.body.draft.tasks[0].evidence).toEqual(['Được nhập từ mục VTODO trong tệp ICS'])

    const confirmation = await request(context.app)
      .post(`/api/imports/${preview.body.draft.id}/confirm`)
      .set(authorized())
      .expect(200)
    expect(confirmation.body.tasks).toHaveLength(1)
    expect(confirmation.body.busyBlocks).toHaveLength(1)
  })

  it('revokes access immediately and schedules account deletion for the lifecycle worker', async () => {
    const deletion = await request(context.app)
      .delete('/api/account')
      .set(authorized())
      .send({ confirmation: 'mai@demo.priorilearn.app' })
      .expect(202)
    expect(deletion.body.receipt).toMatchObject({ status: 'pending' })
    await request(context.app).get('/api/me').set(authorized()).expect(401)
    await request(context.app)
      .get(`/api/account/deletion-receipts/${deletion.body.receipt.id}`)
      .query({ tenantId: deletion.body.receipt.tenantId })
      .expect(200, { receipt: deletion.body.receipt })

    await expect(processLifecycleJobs(context.repository, context.objectStore, 25, new Date(Date.now() + 60_000)))
      .resolves.toMatchObject({ claimed: 1, completed: 1, failed: 0 })
    const completed = await request(context.app)
      .get(`/api/account/deletion-receipts/${deletion.body.receipt.id}`)
      .query({ tenantId: deletion.body.receipt.tenantId })
      .expect(200)
    expect(completed.body.receipt).toMatchObject({ status: 'completed' })
    await request(context.app)
      .get(`/api/account/deletion-receipts/${deletion.body.receipt.id}`)
      .query({ tenantId: '00000000-0000-4000-8000-000000000001' })
      .expect(404)
  })
})
