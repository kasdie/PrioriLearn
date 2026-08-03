// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prioriApi } from './api'

const sessionPayload = {
  user: {
    id: 'user-1', tenantId: 'tenant-1', email: 'student@example.test', name: 'Student',
    locale: 'en', role: 'student', emailVerified: true, onboardingGuideSeenVersion: 1,
    createdAt: '2026-07-20T00:00:00.000Z',
  },
  tenant: { id: 'tenant-1', kind: 'personal', name: 'Student', createdAt: '2026-07-20T00:00:00.000Z' },
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('browser session transport', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses relative credentialed requests without browser token storage', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(sessionPayload))
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')

    await prioriApi.login({ email: 'student@example.test', password: 'password' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/auth/login')
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(storageWrite).not.toHaveBeenCalled()
  })

  it('restores through the HttpOnly cookie instead of a local token gate', async () => {
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ session: sessionPayload }))

    await expect(prioriApi.bootstrap()).resolves.toEqual(sessionPayload)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/health', '/api/auth/session'])
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true)
  })

  it('polls the durable extraction job until a review draft is ready', async () => {
    vi.useFakeTimers()
    const extraction = {
      courses: [],
      tasks: [{
        courseCode: 'CS101',
        title: 'Queued assignment',
        dueAt: null,
        gradeWeight: 20,
        estimatedMinutes: 30,
        confidence: .9,
        evidence: ['Task row'],
      }],
      warnings: [],
    }
    const baseDocument = {
      id: 'document-1',
      filename: 'course.json',
      mimeType: 'application/json',
      sizeBytes: 10,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ document: { ...baseDocument, status: 'uploaded' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ document: { ...baseDocument, status: 'extracting' }, queued: true }, 202))
      .mockResolvedValueOnce(jsonResponse({
        document: {
          ...baseDocument,
          status: 'review',
          extraction,
          extractionProvider: 'structured-json',
        },
      }))

    const resultPromise = prioriApi.uploadAndExtract(
      new File(['{}'], 'course.json', { type: 'application/json' }),
      'document-upload-key',
    )
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(resultPromise).resolves.toEqual({
      documentId: 'document-1',
      extraction,
      provider: 'structured-json',
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/documents',
      '/api/documents/document-1/extract',
      '/api/documents/document-1',
    ])
  })

  it('saves learner signals with an explicit profile version', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({
      profile: {
        version: 2,
        signals: [{ id: 'focus', kind: 'focus_duration', value: '25 minutes' }],
        sourceEventCount: 0,
      },
    }))

    await expect(prioriApi.updateLearnerProfile({
      version: 1,
      signals: [{ id: 'focus', kind: 'focus_duration', value: '25 minutes' }],
    })).resolves.toMatchObject({ version: 2 })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/learner-profile')
    expect(init?.method).toBe('PUT')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedVersion: 1,
      signals: [{ id: 'focus', kind: 'focus_duration', value: '25 minutes' }],
    })
  })
})
