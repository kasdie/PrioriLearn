export type ApiPlan = {
  id: string
  version: number
  status: 'proposed' | 'approved' | 'superseded'
}

export type ApiReplanProposal = {
  id: string
  basePlanVersion: number
  status: 'proposed' | 'approved' | 'rejected'
}

export type ApiCourse = {
  id: string
  code: string
  name: string
  currentScore: number | null
  targetScore: number | null
}

export type ApiTask = {
  id: string
  courseId: string
  title: string
  dueAt: string | null
  gradeWeight: number | null
  estimatedMinutes: number
  status: 'draft' | 'confirmed' | 'completed'
  confidence: number
}

export type ApiPriorityAssessment = {
  score: number
  costOfDelay: {
    message: string
    riskIncreasePercentagePoints: number
  }
}

export type ApiDashboard = {
  rankedTasks: Array<{
    task: ApiTask
    course: ApiCourse
    assessment: ApiPriorityAssessment
  }>
  recommendation: {
    task: ApiTask
    course: ApiCourse
    assessment: ApiPriorityAssessment
    firstStep: string
    estimatedMinutes: number
  } | null
}

export type ApiUser = {
  id: string
  tenantId: string
  email: string
  name: string
  locale: 'vi' | 'en'
  role: 'student' | 'support' | 'admin'
  createdAt: string
}

export type ApiTenant = {
  id: string
  kind: 'personal' | 'organization'
  name: string
  createdAt: string
}

export type ApiSession = {
  user: ApiUser
  tenant: ApiTenant
}

export type DocumentExtraction = {
  courses: Array<{ code: string; name: string }>
  tasks: Array<{ title: string }>
  warnings: string[]
}

type ApiErrorPayload = { error?: { code?: string; message?: string } }

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let sessionToken: string | undefined
const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/+$/, '')

function apiUrl(path: string): string {
  return `${apiOrigin}/api${path}`
}

function readStoredSession(): string | undefined {
  try {
    return window.localStorage.getItem('priorilearn.session') ?? undefined
  } catch {
    return undefined
  }
}

function persistSession(token: string): void {
  sessionToken = token
  try {
    window.localStorage.setItem('priorilearn.session', token)
  } catch {
    // Private browsing or a denied storage policy should not prevent a session.
  }
}

function clearSession(): void {
  sessionToken = undefined
  try {
    window.localStorage.removeItem('priorilearn.session')
  } catch {
    // A denied storage policy does not prevent the in-memory session from ending.
  }
}

function currentSessionToken(): string | undefined {
  sessionToken ??= readStoredSession()
  return sessionToken
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  const payload = await response.json().catch(() => ({})) as ApiErrorPayload
  throw new ApiClientError(
    response.status,
    payload.error?.code ?? 'API_ERROR',
    payload.error?.message ?? `API request failed with status ${response.status}.`,
  )
}

async function createSession(path: string, input?: unknown): Promise<ApiSession> {
  const headers = new Headers()
  if (input !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: input === undefined ? undefined : JSON.stringify(input),
  })
  const auth = await parseResponse<ApiSession & { token: string }>(response)
  persistSession(auth.token)
  return { user: auth.user, tenant: auth.tenant }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = currentSessionToken()
  if (!token) throw new ApiClientError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  try {
    return await parseResponse<T>(await fetch(apiUrl(path), { ...init, headers }))
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      clearSession()
      window.dispatchEvent(new Event('priorilearn:session-expired'))
    }
    throw error
  }
}

export const prioriApi = {
  async bootstrap(): Promise<ApiSession | null> {
    await parseResponse(await fetch(apiUrl('/health')))
    if (!currentSessionToken()) return null
    try {
      return await apiFetch<ApiSession>('/me')
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) return null
      throw error
    }
  },

  register(input: { email: string; password: string; name: string; locale: 'vi' | 'en' }): Promise<ApiSession> {
    return createSession('/auth/register', input)
  },

  login(input: { email: string; password: string }): Promise<ApiSession> {
    return createSession('/auth/login', input)
  },

  enterDemo(): Promise<ApiSession> {
    return createSession('/auth/demo')
  },

  async logout(): Promise<void> {
    try {
      if (currentSessionToken()) await apiFetch('/auth/logout', { method: 'POST' })
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.status !== 401) throw error
    } finally {
      clearSession()
    }
  },

  async dashboard(): Promise<ApiDashboard> {
    return apiFetch<ApiDashboard>('/dashboard')
  },

  async tasks(): Promise<{ tasks: ApiTask[]; courses: ApiCourse[] }> {
    return apiFetch('/tasks')
  },

  async createTask(input: {
    courseId: string
    title: string
    dueAt: string | null
    gradeWeight: number | null
    estimatedMinutes: number
  }): Promise<ApiTask> {
    const response = await apiFetch<{ task: ApiTask }>('/tasks', { method: 'POST', body: JSON.stringify(input) })
    return response.task
  },

  async uploadAndExtract(file: File): Promise<{ documentId: string; extraction: DocumentExtraction }> {
    const form = new FormData()
    form.append('file', file)
    const uploaded = await apiFetch<{ document: { id: string } }>('/documents', { method: 'POST', body: form })
    const extracted = await apiFetch<{ extraction: DocumentExtraction }>(`/documents/${uploaded.document.id}/extract`, { method: 'POST' })
    return { documentId: uploaded.document.id, extraction: extracted.extraction }
  },

  confirmDocument(documentId: string): Promise<unknown> {
    return apiFetch(`/documents/${documentId}/confirm`, { method: 'POST', body: '{}' })
  },

  async importIcs(file: File): Promise<{ draftId: string; taskCount: number; busyBlockCount: number }> {
    const form = new FormData()
    form.append('file', file)
    const imported = await apiFetch<{ draft: { id: string; tasks: unknown[]; busyBlocks: unknown[] } }>('/imports/ics', { method: 'POST', body: form })
    return {
      draftId: imported.draft.id,
      taskCount: imported.draft.tasks.length,
      busyBlockCount: imported.draft.busyBlocks.length,
    }
  },

  confirmIcs(draftId: string): Promise<unknown> {
    return apiFetch(`/imports/${draftId}/confirm`, { method: 'POST', body: '{}' })
  },

  async generatePlan(): Promise<ApiPlan> {
    const response = await apiFetch<{ plan: ApiPlan }>('/plans/generate', {
      method: 'POST',
      body: JSON.stringify({ availableMinutes: 135, coachMode: 'discipline' }),
    })
    return response.plan
  },

  async approvePlan(plan: ApiPlan): Promise<ApiPlan> {
    const response = await apiFetch<{ plan: ApiPlan }>(`/plans/${plan.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: plan.version }),
    })
    return response.plan
  },

  async createReplan(plan: ApiPlan): Promise<ApiReplanProposal> {
    const response = await apiFetch<{ proposal: ApiReplanProposal }>('/check-ins', {
      method: 'POST',
      body: JSON.stringify({ planId: plan.id, friction: 'cannot_start' }),
    })
    return response.proposal
  },

  async approveReplan(proposal: ApiReplanProposal): Promise<ApiPlan> {
    const response = await apiFetch<{ plan: ApiPlan }>(`/replan-proposals/${proposal.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expectedPlanVersion: proposal.basePlanVersion }),
    })
    return response.plan
  },

  async canvasStatus(): Promise<{ status: string; message?: string }> {
    return apiFetch('/connectors/canvas/start', { method: 'POST', body: '{}' })
  },

  track(name: 'onboarding_completed' | 'plan_generated' | 'plan_approved' | 'focus_started' | 'focus_completed' | 'replan_approved' | 'top_task_completed'): Promise<unknown> {
    return apiFetch('/events', { method: 'POST', body: JSON.stringify({ name, properties: {} }) })
  },
}
