import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceDocument } from '../domain/contracts.js'
import { InMemoryRepository } from '../repository.js'
import { MemoryObjectStore } from '../storage.js'
import { processLifecycleJobs } from './purge.js'

describe('processLifecycleJobs', () => {
  it('removes raw files and metadata after the retention window', async () => {
    const repository = new InMemoryRepository()
    await repository.seedDemo()
    const tenantId = repository.getDemoUser().tenantId
    const objectStore = new MemoryObjectStore()
    const id = randomUUID()
    const document: SourceDocument = {
      id,
      tenantId,
      filename: 'expired.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      storageKey: `${tenantId}/${id}`,
      status: 'uploading',
      idempotencyKey: 'expired-document-upload',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-31T00:00:00.000Z',
    }
    repository.beginDocumentUpload(document)
    await objectStore.put(document.storageKey, Buffer.from('test'))
    repository.saveDocument({ ...document, status: 'uploaded' })

    await expect(processLifecycleJobs(repository, objectStore, 25, new Date('2026-02-01T00:00:00.000Z')))
      .resolves.toEqual({ claimed: 1, completed: 1, retried: 0, deferred: 0, failed: 0 })
    expect(repository.getDocument(tenantId, id)?.rawDeletedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(objectStore.has(document.storageKey)).toBe(false)
  })

  it('backs off a poisoned object cleanup and eventually marks it failed', async () => {
    const repository = new InMemoryRepository()
    await repository.seedDemo()
    const tenantId = repository.getDemoUser().tenantId
    const id = randomUUID()
    repository.beginDocumentUpload({
      id,
      tenantId,
      filename: 'unreachable.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      storageKey: `${tenantId}/${id}`,
      status: 'uploading',
      idempotencyKey: 'poisoned-document-upload',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    const failingStore = new class extends MemoryObjectStore {
      override async delete(): Promise<void> { throw new Error('Storage is unavailable.') }
    }()

    let finalResult: Awaited<ReturnType<typeof processLifecycleJobs>> | undefined
    for (let attempt = 0; attempt < 12; attempt += 1) {
      finalResult = await processLifecycleJobs(repository, failingStore, 25, new Date(`2026-02-${String(attempt + 1).padStart(2, '0')}T00:00:00.000Z`))
    }
    expect(finalResult).toEqual({ claimed: 1, completed: 0, retried: 0, deferred: 0, failed: 1 })
    await expect(processLifecycleJobs(repository, failingStore, 25, new Date('2026-03-01T00:00:00.000Z')))
      .resolves.toEqual({ claimed: 0, completed: 0, retried: 0, deferred: 0, failed: 0 })
  })
})
