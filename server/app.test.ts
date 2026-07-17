import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApplication, type ApplicationContext } from './app.js'
import { MockAiProvider } from './services/ai-provider.js'
import { MemoryObjectStore } from './storage.js'

describe('PrioriLearn API', () => {
  let context: ApplicationContext
  let token: string

  beforeEach(async () => {
    context = await createApplication({
      config: { maintenanceSecret: 'test-secret', persistenceDriver: 'memory' },
      objectStore: new MemoryObjectStore(),
      aiProvider: new MockAiProvider(),
    })
    const demo = await request(context.app).post('/api/auth/demo').expect(200)
    token = demo.body.token as string
  })

  const authorized = () => ({ Authorization: `Bearer ${token}` })

  it('reports its runtime boundaries', async () => {
    const response = await request(context.app).get('/api/health').expect(200)
    expect(response.body).toMatchObject({ status: 'ok', persistence: 'memory', aiProvider: 'deterministic-demo' })
  })

  it('keeps extracted data out of planning until the student confirms it', async () => {
    const before = await request(context.app).get('/api/tasks').set(authorized()).expect(200)
    const uploaded = await request(context.app)
      .post('/api/documents')
      .set(authorized())
      .attach('file', Buffer.from('%PDF demo syllabus'), { filename: 'syllabus.pdf', contentType: 'application/pdf' })
      .expect(201)
    const documentId = uploaded.body.document.id as string
    const extraction = await request(context.app)
      .post(`/api/documents/${documentId}/extract`)
      .set(authorized())
      .expect(200)
    expect(extraction.body.requiresConfirmation).toBe(true)

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

    const checkIn = await request(context.app)
      .post('/api/check-ins')
      .set(authorized())
      .send({ planId: proposedPlan.id, friction: 'cannot_start' })
      .expect(201)
    const proposal = checkIn.body.proposal
    expect(proposal.status).toBe('proposed')
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
    expect(preview.body.draft.status).toBe('needs_review')
    expect(preview.body.draft.busyBlocks).toHaveLength(1)

    const confirmation = await request(context.app)
      .post(`/api/imports/${preview.body.draft.id}/confirm`)
      .set(authorized())
      .expect(200)
    expect(confirmation.body.tasks).toHaveLength(1)
    expect(confirmation.body.busyBlocks).toHaveLength(1)
  })

  it('records connector revocation as a new consent decision', async () => {
    const revocation = await request(context.app)
      .delete('/api/connectors/canvas')
      .set(authorized())
      .expect(200)
    expect(revocation.body).toMatchObject({ status: 'revoked', provider: 'canvas' })
    expect(revocation.body.consent).toMatchObject({ purpose: 'canvas_read', granted: false, source: 'connector' })

    const consents = await request(context.app).get('/api/consents').set(authorized()).expect(200)
    expect(consents.body.consents).toContainEqual(expect.objectContaining({ purpose: 'canvas_read', granted: false }))
  })
})
