// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useImportFlow } from './useImportFlow'

const file = new File(['syllabus'], 'syllabus.txt', { type: 'text/plain' })

describe('useImportFlow', () => {
  it('keeps a failed upload unconfirmed and available for retry', async () => {
    const api = {
      uploadAndExtract: vi.fn().mockRejectedValue(new Error('Upload failed.')),
      confirmDocument: vi.fn(),
      importIcs: vi.fn(),
      confirmIcs: vi.fn(),
    }
    const { result } = renderHook(() => useImportFlow({ api }))

    await act(() => result.current.selectDocument(file))

    expect(result.current.review).toBeNull()
    expect(result.current.documentConfirmed).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Upload failed.')

    api.uploadAndExtract.mockResolvedValueOnce({
      documentId: 'document-1',
      extraction: { courses: [], tasks: [], warnings: [] },
    })
    await act(() => result.current.retry())
    expect(result.current.review).toMatchObject({ kind: 'document', documentId: 'document-1' })
  })

  it('does not mark a review confirmed when confirmation fails', async () => {
    const api = {
      uploadAndExtract: vi.fn().mockResolvedValue({
        documentId: 'document-1',
        extraction: { courses: [], tasks: [], warnings: [] },
      }),
      confirmDocument: vi.fn().mockRejectedValue(new Error('Confirmation timed out.')),
      importIcs: vi.fn(),
      confirmIcs: vi.fn(),
    }
    const { result } = renderHook(() => useImportFlow({ api }))

    await act(() => result.current.selectDocument(file))
    await act(() => result.current.confirm())

    expect(result.current.review).toMatchObject({ documentId: 'document-1' })
    expect(result.current.documentConfirmed).toBe(false)
    expect(result.current.error).toBe('Confirmation timed out.')
  })
})
