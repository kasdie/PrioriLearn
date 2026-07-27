import { z } from 'zod'
import { DocumentExtractionSchema, type DocumentExtraction } from '../domain/contracts.js'
import type { Repository } from '../repository.js'
import type { ObjectStore } from '../storage.js'
import type { AiProvider } from './ai-provider.js'
import { extractStructuredDocument, StructuredImportError } from './structured-import.js'

export type ExtractionWorkerResult = {
  claimed: number
  completed: number
  retried: number
  failed: number
}

class PermanentExtractionError extends Error {}

export function validateExtractionDates(extraction: DocumentExtraction): DocumentExtraction {
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

export async function processExtractionJobs(input: {
  repository: Repository
  objectStore: ObjectStore
  aiProvider: AiProvider
  batchSize?: number
  now?: Date
}): Promise<ExtractionWorkerResult> {
  const now = input.now ?? new Date()
  const jobs = await input.repository.claimExtractionJobs(input.batchSize ?? 2, now)
  const result: ExtractionWorkerResult = {
    claimed: jobs.length,
    completed: 0,
    retried: 0,
    failed: 0,
  }

  for (const job of jobs) {
    try {
      const document = await input.repository.getDocument(job.tenantId, job.documentId)
      if (!document) throw new PermanentExtractionError('The queued document no longer exists.')
      if (document.rawDeletedAt) throw new PermanentExtractionError('The raw file expired before extraction completed.')
      const content = await input.objectStore.get(document.storageKey)
      const documentInput = {
        filename: document.filename,
        mimeType: document.mimeType,
        content,
      }
      const structured = extractStructuredDocument(documentInput)
      const rawExtraction = structured?.extraction ?? await input.aiProvider.extractDocument(documentInput)
      const extraction = validateExtractionDates(DocumentExtractionSchema.parse(rawExtraction))
      await input.repository.completeExtractionJob(
        job,
        extraction,
        structured?.provider ?? input.aiProvider.name,
        now,
      )
      result.completed += 1
    } catch (error) {
      const retryable = !(error instanceof PermanentExtractionError)
        && !(error instanceof StructuredImportError)
        && !(error instanceof z.ZodError)
      const outcome = await input.repository.failExtractionJob(
        job,
        error instanceof Error ? error.message : 'Document extraction failed.',
        retryable,
        now,
      )
      if (outcome === 'failed') result.failed += 1
      else result.retried += 1
    }
  }
  return result
}
