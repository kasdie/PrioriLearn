import { useCallback, useRef, useState } from 'react'
import { ApiClientError, prioriApi, type ApiSourceDocument, type DocumentExtraction } from '../../lib/api'

export type ImportReview =
  | { kind: 'document'; documentId: string; filename: string; extraction: DocumentExtraction; provider?: string }
  | { kind: 'ics'; draftId: string; filename: string; taskCount: number; busyBlockCount: number }

export type ImportQueueItem = {
  id: string
  kind: 'document' | 'ics'
  filename: string
  status: 'queued' | 'processing' | 'review' | 'confirming' | 'confirmed' | 'error'
  error?: string
  review?: ImportReview
  file?: File
  documentId?: string
  idempotencyKey?: string
}

type ImportStatus = 'idle' | 'uploading' | 'processing' | 'review' | 'confirming' | 'confirmed' | 'error'
type ImportApi = Pick<typeof prioriApi, 'uploadAndExtract' | 'extractDocument' | 'confirmDocument' | 'importIcs' | 'confirmIcs'>

type UseImportFlowOptions = {
  api?: ImportApi
  locale?: 'vi' | 'en'
  onConfirmed?: (kind: ImportReview['kind']) => Promise<void> | void
}

const queueId = () => globalThis.crypto?.randomUUID?.() ?? `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`

function readableImportError(cause: unknown, locale: 'vi' | 'en', phase: 'prepare' | 'confirm'): string {
  if (cause instanceof ApiClientError && locale === 'vi') {
    const messages: Record<string, string> = {
      UNSUPPORTED_FILE: 'Định dạng tệp này chưa được hỗ trợ.',
      INVALID_FILE_CONTENT: 'Nội dung tệp không khớp với định dạng đã chọn.',
      UPLOAD_FAILED: 'Không thể lưu tệp gốc. Hãy thử tải lại.',
      EXTRACTION_FAILED: 'AI chưa thể đọc tệp này. Hãy thử xử lý lại.',
      EXTRACTION_PENDING: 'AI vẫn đang đọc tệp. Hãy tiếp tục lại sau ít phút.',
      RAW_FILE_EXPIRED: 'Tệp gốc đã hết thời hạn lưu và không thể xử lý lại.',
      EXTRACTION_NOT_READY: 'Tệp chưa sẵn sàng để xác nhận.',
    }
    return messages[cause.code] ?? (phase === 'prepare'
      ? 'Không thể chuẩn bị tệp này. Chưa có dữ liệu nào được xác nhận.'
      : 'Chưa có dữ liệu nào được xác nhận. Hãy xem lại bản nháp và thử lại.')
  }
  if (cause instanceof Error && locale === 'en') return cause.message
  return locale === 'vi'
    ? phase === 'prepare' ? 'Không thể chuẩn bị tệp này. Chưa có dữ liệu nào được xác nhận.' : 'Chưa có dữ liệu nào được xác nhận. Hãy xem lại bản nháp và thử lại.'
    : phase === 'prepare' ? 'The import could not be prepared. Your file was not confirmed.' : 'Nothing was confirmed. Review the draft and try again.'
}

export function useImportFlow({ api = prioriApi, locale = 'en', onConfirmed }: UseImportFlowOptions = {}) {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [review, setReview] = useState<ImportReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<ImportQueueItem[]>([])
  const [confirmedKinds, setConfirmedKinds] = useState<Set<ImportReview['kind']>>(() => new Set())
  const queueRef = useRef<ImportQueueItem[]>([])
  const onConfirmedRef = useRef(onConfirmed)
  onConfirmedRef.current = onConfirmed

  const replaceQueue = useCallback((next: ImportQueueItem[]) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  const updateQueueItem = useCallback((id: string, update: (item: ImportQueueItem) => ImportQueueItem) => {
    replaceQueue(queueRef.current.map((item) => item.id === id ? update(item) : item))
  }, [replaceQueue])

  const processItem = useCallback(async (pending: ImportQueueItem): Promise<ImportReview | null> => {
    updateQueueItem(pending.id, (item) => ({ ...item, status: 'processing', error: undefined }))
    try {
      const nextReview: ImportReview = pending.kind === 'document'
        ? await (pending.documentId
          ? api.extractDocument(pending.documentId)
          : api.uploadAndExtract(pending.file as File, pending.idempotencyKey as string)).then((result) => ({
          kind: 'document' as const,
          documentId: result.documentId,
          filename: pending.filename,
          extraction: result.extraction,
          provider: result.provider,
        }))
        : await api.importIcs(pending.file as File).then((result) => ({
          kind: 'ics' as const,
          draftId: result.draftId,
          filename: pending.filename,
          taskCount: result.taskCount,
          busyBlockCount: result.busyBlockCount,
        }))
      updateQueueItem(pending.id, (item) => ({ ...item, status: 'review', review: nextReview, error: undefined }))
      return nextReview
    } catch (cause) {
      const message = readableImportError(cause, locale, 'prepare')
      updateQueueItem(pending.id, (item) => ({ ...item, status: 'error', review: undefined, error: message }))
      return null
    }
  }, [api, locale, updateQueueItem])

  const processItems = useCallback(async (pendingItems: ImportQueueItem[]) => {
    if (pendingItems.length === 0) return
    setStatus(pendingItems.some((item) => item.kind === 'document') ? 'processing' : 'uploading')
    setError(null)
    const reviews: ImportReview[] = []
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < pendingItems.length) {
        const item = pendingItems[nextIndex]
        nextIndex += 1
        if (!item) continue
        const prepared = await processItem(item)
        if (prepared) reviews.push(prepared)
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, pendingItems.length) }, () => worker()))
    const failed = queueRef.current.find((item) => item.status === 'error')
    const firstReview = reviews[0] ?? queueRef.current.find((item) => item.status === 'review')?.review ?? null
    setReview((current) => current ?? firstReview)
    setError(failed?.error ?? null)
    setStatus(firstReview ? 'review' : failed ? 'error' : 'idle')
  }, [processItem])

  const addItems = useCallback(async (files: File[], kind: ImportQueueItem['kind']) => {
    const pendingItems = files.slice(0, 10).map<ImportQueueItem>((file) => ({
      id: queueId(),
      kind,
      filename: file.name,
      status: 'queued',
      file,
      idempotencyKey: kind === 'document' ? queueId() : undefined,
    }))
    replaceQueue([...queueRef.current, ...pendingItems])
    await processItems(pendingItems)
  }, [processItems, replaceQueue])

  const confirm = useCallback(async () => {
    if (!review || status === 'confirming') return false
    const queueItem = queueRef.current.find((item) => item.review === review)
    if (queueItem) updateQueueItem(queueItem.id, (item) => ({ ...item, status: 'confirming' }))
    setStatus('confirming')
    setError(null)
    try {
      if (review.kind === 'document') await api.confirmDocument(review.documentId, review.extraction)
      else await api.confirmIcs(review.draftId)
      if (queueItem) updateQueueItem(queueItem.id, (item) => ({ ...item, status: 'confirmed', error: undefined }))
      setConfirmedKinds((current) => new Set(current).add(review.kind))
      const nextReview = queueRef.current.find((item) => item.status === 'review' && item.id !== queueItem?.id)?.review ?? null
      setReview(nextReview)
      setStatus(nextReview ? 'review' : 'confirmed')
      await onConfirmedRef.current?.(review.kind)
      return true
    } catch (cause) {
      const message = readableImportError(cause, locale, 'confirm')
      if (queueItem) updateQueueItem(queueItem.id, (item) => ({ ...item, status: 'error', error: message }))
      setStatus('error')
      setError(message)
      return false
    }
  }, [api, locale, review, status, updateQueueItem])

  const retry = useCallback(async (itemId?: string) => {
    if (!itemId && review) {
      await confirm()
      return
    }
    const failed = queueRef.current.find((item) => item.id === itemId || (!itemId && item.status === 'error'))
    if (!failed) return
    await processItems([failed])
  }, [confirm, processItems, review])

  const updateDocumentExtraction = useCallback((extraction: DocumentExtraction) => {
    setReview((current) => {
      if (current?.kind !== 'document') return current
      const nextReview = { ...current, extraction }
      const queueItem = queueRef.current.find((item) => item.review === current)
      if (queueItem) updateQueueItem(queueItem.id, (item) => ({ ...item, review: nextReview }))
      return nextReview
    })
  }, [updateQueueItem])

  const busy = queue.some((item) => item.status === 'processing' || item.status === 'confirming')

  return {
    status,
    review,
    queue,
    error,
    busy,
    documentConfirmed: confirmedKinds.has('document') || queue.some((item) => item.kind === 'document' && item.status === 'confirmed'),
    calendarConfirmed: confirmedKinds.has('ics') || queue.some((item) => item.kind === 'ics' && item.status === 'confirmed'),
    selectDocument: (file: File) => addItems([file], 'document'),
    selectDocuments: (files: File[]) => addItems(files, 'document'),
    selectCalendar: (file: File) => addItems([file], 'ics'),
    resumeDocument: async (document: ApiSourceDocument) => {
      const existing = queueRef.current.find((item) => item.documentId === document.id)
      if (existing?.review) {
        setReview(existing.review)
        setStatus('review')
        setError(null)
        return
      }
      const reviewItem: ImportReview | undefined = document.extraction && (document.status === 'review' || document.status === 'confirmed')
        ? {
          kind: 'document',
          documentId: document.id,
          filename: document.filename,
          extraction: document.extraction,
          provider: document.extractionProvider,
        }
        : undefined
      const pending: ImportQueueItem = {
        id: `persisted-${document.id}`,
        kind: 'document',
        documentId: document.id,
        filename: document.filename,
        status: reviewItem ? 'review' : 'queued',
        review: reviewItem,
      }
      replaceQueue([...queueRef.current.filter((item) => item.documentId !== document.id), pending])
      if (reviewItem) {
        setReview(reviewItem)
        setStatus('review')
        setError(null)
      } else {
        await processItems([pending])
      }
    },
    confirm,
    updateDocumentExtraction,
    retry,
    openReview: (itemId: string) => {
      const selected = queueRef.current.find((item) => item.id === itemId && item.status === 'review')?.review
      if (selected) {
        setReview(selected)
        setStatus('review')
        setError(null)
      }
    },
    closeReview: () => {
      setReview(null)
      setError(null)
      setStatus(queueRef.current.some((item) => item.status === 'error') ? 'error' : 'idle')
    },
  }
}
