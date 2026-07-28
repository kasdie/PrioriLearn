import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InMemoryRepository } from '../repository.js'
import { MemoryObjectStore } from '../storage.js'
import type { AiProvider } from './ai-provider.js'
import { MockAiProvider } from './ai-provider.js'
import { processExtractionJobs } from './extraction.js'

async function queuedDocument(filename = 'course.pdf', mimeType = 'application/pdf') {
  const repository = new InMemoryRepository()
  await repository.seedDemo()
  const user = await repository.getDemoUser()
  const objectStore = new MemoryObjectStore()
  const id = randomUUID()
  const document = {
    id,
    tenantId: user.tenantId,
    filename,
    mimeType,
    sizeBytes: 12,
    storageKey: `${user.tenantId}/${id}`,
    status: 'uploading' as const,
    idempotencyKey: `test-${id}`,
    createdAt: '2026-07-24T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
  repository.beginDocumentUpload(document)
  repository.saveDocument({ ...document, status: 'uploaded' })
  await objectStore.put(document.storageKey, Buffer.from('test document'))
  const queued = repository.enqueueDocumentExtraction(user.tenantId, document.id)
  return { repository, objectStore, user, document, queued }
}

describe('extraction worker', () => {
  it('claims an idempotent job and persists a review draft', async () => {
    const setup = await queuedDocument()
    const duplicate = setup.repository.enqueueDocumentExtraction(setup.user.tenantId, setup.document.id)
    expect(duplicate.job.id).toBe(setup.queued.job.id)

    const result = await processExtractionJobs({
      repository: setup.repository,
      objectStore: setup.objectStore,
      aiProvider: new MockAiProvider(),
      now: new Date(Date.now() + 60_000),
    })

    expect(result).toEqual({ claimed: 1, completed: 1, retried: 0, failed: 0 })
    expect(setup.repository.getDocument(setup.user.tenantId, setup.document.id)).toMatchObject({
      status: 'review',
      extractionProvider: 'deterministic-demo',
      extraction: { tasks: [expect.objectContaining({ title: expect.any(String) })] },
    })
  })

  it('backs off a transient provider failure and succeeds on retry', async () => {
    const setup = await queuedDocument()
    let attempts = 0
    const provider: AiProvider = {
      name: 'transient-test',
      async extractDocument(input) {
        attempts += 1
        if (attempts === 1) throw new Error('Temporary provider outage.')
        return new MockAiProvider().extractDocument(input)
      },
      async draftCoachingProposal(input) {
        return new MockAiProvider().draftCoachingProposal(input)
      },
      async draftPlanningPreferences(input) {
        return new MockAiProvider().draftPlanningPreferences(input)
      },
    }

    const firstAttemptAt = new Date(Date.now() + 60_000)
    const first = await processExtractionJobs({
      repository: setup.repository,
      objectStore: setup.objectStore,
      aiProvider: provider,
      now: firstAttemptAt,
    })
    expect(first).toMatchObject({ claimed: 1, retried: 1 })
    expect(setup.repository.getDocument(setup.user.tenantId, setup.document.id)?.status).toBe('extracting')

    const second = await processExtractionJobs({
      repository: setup.repository,
      objectStore: setup.objectStore,
      aiProvider: provider,
      now: new Date(firstAttemptAt.getTime() + 10 * 60_000),
    })
    expect(second).toMatchObject({ claimed: 1, completed: 1 })
  })

  it('marks deterministic structured-data errors as terminal and allows a manual retry', async () => {
    const setup = await queuedDocument('broken.json', 'application/json')
    await setup.objectStore.put(setup.document.storageKey, Buffer.from('{broken json'))

    const failed = await processExtractionJobs({
      repository: setup.repository,
      objectStore: setup.objectStore,
      aiProvider: new MockAiProvider(),
      now: new Date(Date.now() + 60_000),
    })
    expect(failed).toMatchObject({ claimed: 1, failed: 1, retried: 0 })
    expect(setup.repository.getDocument(setup.user.tenantId, setup.document.id)?.status).toBe('extraction_failed')

    const retried = setup.repository.enqueueDocumentExtraction(setup.user.tenantId, setup.document.id)
    expect(retried.job).toMatchObject({ status: 'pending', attempts: 0 })
    expect(retried.document.status).toBe('extracting')
  })
})
