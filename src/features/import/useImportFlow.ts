import { useCallback, useRef, useState } from 'react'
import { prioriApi, type DocumentExtraction } from '../../lib/api'

export type ImportReview =
  | { kind: 'document'; documentId: string; filename: string; extraction: DocumentExtraction; provider?: string }
  | { kind: 'ics'; draftId: string; filename: string; taskCount: number; busyBlockCount: number }

type PendingImport = { kind: 'document' | 'ics'; file: File; idempotencyKey?: string }
type ImportStatus = 'idle' | 'uploading' | 'processing' | 'review' | 'confirming' | 'confirmed' | 'error'
type ImportApi = Pick<typeof prioriApi, 'uploadAndExtract' | 'confirmDocument' | 'importIcs' | 'confirmIcs'>

type UseImportFlowOptions = {
  api?: ImportApi
  onConfirmed?: (kind: ImportReview['kind']) => Promise<void> | void
}

export function useImportFlow({ api = prioriApi, onConfirmed }: UseImportFlowOptions = {}) {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [review, setReview] = useState<ImportReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmedKinds, setConfirmedKinds] = useState<Set<ImportReview['kind']>>(() => new Set())
  const pendingRef = useRef<PendingImport | null>(null)
  const onConfirmedRef = useRef(onConfirmed)
  onConfirmedRef.current = onConfirmed

  const load = useCallback(async (pending: PendingImport) => {
    pendingRef.current = pending
    setStatus(pending.kind === 'document' ? 'processing' : 'uploading')
    setError(null)
    try {
      if (pending.kind === 'document') {
        const result = await api.uploadAndExtract(pending.file, pending.idempotencyKey as string)
        setReview({
          kind: 'document',
          documentId: result.documentId,
          filename: pending.file.name,
          extraction: result.extraction,
          provider: result.provider,
        })
      } else {
        const result = await api.importIcs(pending.file)
        setReview({
          kind: 'ics',
          draftId: result.draftId,
          filename: pending.file.name,
          taskCount: result.taskCount,
          busyBlockCount: result.busyBlockCount,
        })
      }
      setStatus('review')
    } catch (cause) {
      setReview(null)
      setStatus('error')
      setError(cause instanceof Error ? cause.message : 'The import could not be prepared. Your file was not confirmed.')
    }
  }, [api])

  const confirm = useCallback(async () => {
    if (!review || status === 'confirming') return false
    setStatus('confirming')
    setError(null)
    try {
      if (review.kind === 'document') await api.confirmDocument(review.documentId, review.extraction)
      else await api.confirmIcs(review.draftId)
      setConfirmedKinds((current) => new Set(current).add(review.kind))
      setStatus('confirmed')
      pendingRef.current = null
      await onConfirmedRef.current?.(review.kind)
      return true
    } catch (cause) {
      setStatus('error')
      setError(cause instanceof Error ? cause.message : 'Nothing was confirmed. Review the draft and try again.')
      return false
    }
  }, [api, review, status])

  const retry = useCallback(async () => {
    if (review) {
      await confirm()
      return
    }
    if (pendingRef.current) await load(pendingRef.current)
  }, [confirm, load, review])

  const updateDocumentExtraction = useCallback((extraction: DocumentExtraction) => {
    setReview((current) => current?.kind === 'document' ? { ...current, extraction } : current)
  }, [])

  return {
    status,
    review,
    error,
    busy: status === 'uploading' || status === 'processing' || status === 'confirming',
    documentConfirmed: confirmedKinds.has('document'),
    calendarConfirmed: confirmedKinds.has('ics'),
    selectDocument: (file: File) => load({
      kind: 'document',
      file,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
    selectCalendar: (file: File) => load({ kind: 'ics', file }),
    confirm,
    updateDocumentExtraction,
    retry,
    closeReview: () => {
      setReview(null)
      setError(null)
      setStatus('idle')
    },
  }
}
