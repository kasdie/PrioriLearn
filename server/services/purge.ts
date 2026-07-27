import type { Repository } from '../repository.js'
import type { ObjectStore } from '../storage.js'

export async function processLifecycleJobs(
  repository: Repository,
  objectStore: ObjectStore,
  batchSize = 25,
  now = new Date(),
): Promise<{ claimed: number; completed: number; retried: number; deferred: number; failed: number }> {
  const jobs = await repository.claimLifecycleJobs(batchSize, now)
  let completed = 0
  let retried = 0
  let deferred = 0
  let failed = 0

  for (const job of jobs) {
    try {
      if (job.kind === 'document_raw_delete') {
        if (!job.storageKey) throw new Error('LIFECYCLE_DOCUMENT_STORAGE_KEY_MISSING')
        await objectStore.delete(job.storageKey)
      }
      const didComplete = await repository.completeLifecycleJob(job, now)
      if (didComplete) completed += 1
      else deferred += 1
    } catch (error) {
      const outcome = await repository.failLifecycleJob(job, error instanceof Error ? error.message : 'Lifecycle processing failed.', now)
      if (outcome === 'failed') failed += 1
      else retried += 1
    }
  }
  return { claimed: jobs.length, completed, retried, deferred, failed }
}
