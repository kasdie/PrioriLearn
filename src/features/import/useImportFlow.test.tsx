// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useImportFlow } from './useImportFlow'

const file = new File(['syllabus'], 'syllabus.txt', { type: 'text/plain' })

describe('useImportFlow', () => {
  it('keeps a failed upload unconfirmed and available for retry', async () => {
    const api = {
      uploadAndExtract: vi.fn().mockRejectedValue(new Error('Upload failed.')),
      extractDocument: vi.fn(),
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

  it('does not expose an English browser network error in Vietnamese mode', async () => {
    const api = {
      uploadAndExtract: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      extractDocument: vi.fn(),
      confirmDocument: vi.fn(),
      importIcs: vi.fn(),
      confirmIcs: vi.fn(),
    }
    const { result } = renderHook(() => useImportFlow({ api, locale: 'vi' }))

    await act(() => result.current.selectDocument(file))

    expect(result.current.error).toBe('Không thể chuẩn bị tệp này. Chưa có dữ liệu nào được xác nhận.')
    expect(result.current.error).not.toContain('Failed to fetch')
  })

  it('does not mark a review confirmed when confirmation fails', async () => {
    const api = {
      uploadAndExtract: vi.fn().mockResolvedValue({
        documentId: 'document-1',
        extraction: { courses: [], tasks: [], warnings: [] },
      }),
      extractDocument: vi.fn(),
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

  it('prepares multiple files independently and keeps a failed file available for retry', async () => {
    const second = new File(['second'], 'second.txt', { type: 'text/plain' })
    const api = {
      uploadAndExtract: vi.fn().mockImplementation(async (selected: File) => {
        if (selected.name === 'second.txt') throw new Error('Second file failed.')
        return { documentId: 'document-1', extraction: { courses: [], tasks: [], warnings: [] } }
      }),
      extractDocument: vi.fn(),
      confirmDocument: vi.fn(),
      importIcs: vi.fn(),
      confirmIcs: vi.fn(),
    }
    const { result } = renderHook(() => useImportFlow({ api }))

    await act(() => result.current.selectDocuments([file, second]))

    expect(api.uploadAndExtract).toHaveBeenCalledTimes(2)
    expect(result.current.queue).toHaveLength(2)
    expect(result.current.queue.map((item) => item.status).sort()).toEqual(['error', 'review'])
    expect(result.current.review).toMatchObject({ kind: 'document', documentId: 'document-1' })
    expect(result.current.error).toBe('Second file failed.')
  })

  it('reopens a persisted review without uploading the file again', async () => {
    const extraction = { courses: [], tasks: [], warnings: [] }
    const api = {
      uploadAndExtract: vi.fn(),
      extractDocument: vi.fn(),
      confirmDocument: vi.fn(),
      importIcs: vi.fn(),
      confirmIcs: vi.fn(),
    }
    const { result } = renderHook(() => useImportFlow({ api, locale: 'vi' }))

    await act(() => result.current.resumeDocument({
      id: 'persisted-1',
      filename: 'notes.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      status: 'review',
      extraction,
      extractionProvider: 'openai',
      expiresAt: '2026-08-27T00:00:00.000Z',
      createdAt: '2026-07-28T00:00:00.000Z',
    }))

    expect(api.uploadAndExtract).not.toHaveBeenCalled()
    expect(api.extractDocument).not.toHaveBeenCalled()
    expect(result.current.review).toMatchObject({ documentId: 'persisted-1', filename: 'notes.jpg', extraction })
    expect(result.current.queue).toHaveLength(1)
    expect(result.current.queue[0]?.status).toBe('review')
  })
})
