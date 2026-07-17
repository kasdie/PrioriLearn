import type { Repository } from '../repository.js'
import type { ObjectStore } from '../storage.js'

export async function purgeExpiredDocuments(
  repository: Repository,
  objectStore: ObjectStore,
  now = new Date(),
): Promise<{ purged: number }> {
  const expired = await repository.listExpiredDocuments(now)
  for (const document of expired) {
    await objectStore.delete(document.storageKey)
    await repository.saveDocument({ ...document, rawDeletedAt: now.toISOString() })
  }
  return { purged: expired.length }
}
