import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceDocument } from '../domain/contracts.js'
import { InMemoryRepository } from '../repository.js'
import { MemoryObjectStore } from '../storage.js'
import { purgeExpiredDocuments } from './purge.js'

describe('purgeExpiredDocuments', () => {
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
      status: 'uploaded',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-31T00:00:00.000Z',
    }
    repository.saveDocument(document)
    await objectStore.put(document.storageKey, Buffer.from('test'))

    await expect(purgeExpiredDocuments(repository, objectStore, new Date('2026-02-01T00:00:00.000Z'))).resolves.toEqual({ purged: 1 })
    expect(repository.getDocument(tenantId, id)?.rawDeletedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(objectStore.has(document.storageKey)).toBe(false)
  })
})
