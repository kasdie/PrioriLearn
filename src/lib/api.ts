export type ApiPlan = {
  id: string
  version: number
  status: 'proposed' | 'approved' | 'superseded'
  items?: Array<{
    id: string
    taskId: string
    startsAt: string
    endsAt: string
    minutes: number
    firstStep: string
    rationale: string
  }>
  rationale?: string
}

export type ApiReplanProposal = {
  id: string
  basePlanVersion: number
  status: 'proposed' | 'approved' | 'rejected'
  title: string
  rationale: string
  changes: string[]
  proposedItems: NonNullable<ApiPlan['items']>
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
  factors: {
    academicImpact: number
    failureRisk: number
    costOfDelay: number
    goalAlignment: number
    actionability: number
  }
  weights: {
    academicImpact: number
    failureRisk: number
    costOfDelay: number
    goalAlignment: number
    actionability: number
  }
  costOfDelay: {
    delayHours: number
    completionProbabilityNow: number
    completionProbabilityAfterDelay: number
    message: string
    riskIncreasePercentagePoints: number
  }
  evidence: string[]
  assumptions: string[]
  uncertainty: 'low' | 'medium' | 'high'
}

export type ApiMetrics = Record<string, number>

export type ApiConsent = {
  id: string
  purpose: 'product_terms' | 'calendar_read' | 'canvas_read' | 'email_digest' | 'research_metrics'
  granted: boolean
  source: 'onboarding' | 'settings' | 'connector' | 'api'
  createdAt: string
}

export type ApiLearnerSignal = {
  id: string
  kind: 'focus_duration' | 'study_window' | 'friction_pattern' | 'coach_preference'
  value: string
}

export type ApiLearnerProfile = {
  version: number
  signals: ApiLearnerSignal[]
  sourceEventCount: number
  updatedAt?: string
}

export type ApiAccountDeletionReceipt = {
  id: string
  status: 'pending' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
}

export type ApiDashboard = {
  confirmedTaskCount: number
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
  role: 'student' | 'institution_admin'
  emailVerified: boolean
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
  courses: Array<{
    code: string
    name: string
    currentScore: number | null
    targetScore: number | null
    confidence: number
    evidence: string[]
  }>
  tasks: Array<{
    courseCode: string
    title: string
    dueAt: string | null
    gradeWeight: number | null
    estimatedMinutes: number
    confidence: number
    evidence: string[]
  }>
  warnings: string[]
}

export type ApiSourceDocument = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: 'uploading' | 'upload_failed' | 'uploaded' | 'extracting' | 'extraction_failed' | 'review' | 'confirmed'
  extraction?: DocumentExtraction
  extractionProvider?: string
  expiresAt: string
  updatedAt?: string
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

function apiUrl(path: string): string {
  return `/api${path}`
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
    credentials: 'include',
  })
  return parseResponse<ApiSession>(response)
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  try {
    return await parseResponse<T>(await fetch(apiUrl(path), { ...init, headers, credentials: 'include' }))
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      window.dispatchEvent(new Event('priorilearn:session-expired'))
    }
    throw error
  }
}

export const prioriApi = {
  async bootstrap(): Promise<ApiSession | null> {
    await parseResponse(await fetch(apiUrl('/health'), { credentials: 'include' }))
    const { session } = await apiFetch<{ session: ApiSession | null }>('/auth/session')
    return session
  },

  register(input: { email: string; password: string; name: string; locale: 'vi' | 'en' }): Promise<ApiSession> {
    return createSession('/auth/register', input)
  },

  login(input: { email: string; password: string }): Promise<ApiSession> {
    return createSession('/auth/login', input)
  },

  googleLogin(input: { credential: string; locale: 'vi' | 'en' }): Promise<ApiSession> {
    return createSession('/auth/google', input)
  },

  enterDemo(): Promise<ApiSession> {
    return createSession('/auth/demo')
  },

  async requestEmailVerification(): Promise<void> {
    await apiFetch('/auth/email-verification/request', { method: 'POST' })
  },

  confirmEmailVerification(token: string): Promise<ApiSession> {
    return createSession('/auth/email-verification/confirm', { token })
  },

  async requestPasswordReset(email: string): Promise<void> {
    await apiFetch('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  confirmPasswordReset(token: string, password: string): Promise<ApiSession> {
    return createSession('/auth/password-reset/confirm', { token, password })
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.status !== 401) throw error
    }
  },

  async dashboard(): Promise<ApiDashboard> {
    return apiFetch<ApiDashboard>('/dashboard')
  },

  async metrics(): Promise<ApiMetrics> {
    const response = await apiFetch<{ metrics: ApiMetrics }>('/metrics/me')
    return response.metrics
  },

  async consents(): Promise<ApiConsent[]> {
    const response = await apiFetch<{ consents: ApiConsent[] }>('/consents')
    return response.consents
  },

  async setConsent(input: Pick<ApiConsent, 'purpose' | 'granted'>): Promise<ApiConsent> {
    const response = await apiFetch<{ consent: ApiConsent }>('/consents', {
      method: 'POST',
      body: JSON.stringify({ ...input, source: 'settings' }),
    })
    return response.consent
  },

  async learnerProfile(): Promise<ApiLearnerProfile> {
    const response = await apiFetch<{ profile: ApiLearnerProfile }>('/learner-profile')
    return response.profile
  },

  async updateLearnerProfile(input: Pick<ApiLearnerProfile, 'version' | 'signals'>): Promise<ApiLearnerProfile> {
    const response = await apiFetch<{ profile: ApiLearnerProfile }>('/learner-profile', {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: input.version, signals: input.signals }),
    })
    return response.profile
  },

  exportData(): Promise<unknown> {
    return apiFetch('/account/export')
  },

  async requestAccountDeletion(confirmation: string): Promise<ApiAccountDeletionReceipt> {
    const response = await apiFetch<{ receipt: ApiAccountDeletionReceipt }>('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation }),
    })
    return response.receipt
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

  async updateTask(taskId: string, input: Partial<Pick<ApiTask, 'status'>>): Promise<ApiTask> {
    const response = await apiFetch<{ task: ApiTask }>(`/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return response.task
  },

  async createCourse(input: {
    code: string
    name: string
    currentScore?: number | null
    targetScore?: number | null
  }): Promise<ApiCourse> {
    const response = await apiFetch<{ course: ApiCourse }>('/courses', { method: 'POST', body: JSON.stringify(input) })
    return response.course
  },

  async uploadAndExtract(file: File, idempotencyKey: string): Promise<{ documentId: string; extraction: DocumentExtraction; provider?: string }> {
    const form = new FormData()
    form.append('file', file)
    const uploaded = await apiFetch<{ document: ApiSourceDocument }>('/documents', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    let document = (await apiFetch<{ document: ApiSourceDocument }>(`/documents/${uploaded.document.id}/extract`, {
      method: 'POST',
    })).document
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if ((document.status === 'review' || document.status === 'confirmed') && document.extraction) {
        return {
          documentId: document.id,
          extraction: document.extraction,
          provider: document.extractionProvider,
        }
      }
      if (document.status === 'extraction_failed') {
        throw new ApiClientError(422, 'EXTRACTION_FAILED', 'Document extraction failed. Retry to start a fresh queue attempt.')
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500))
      document = (await apiFetch<{ document: ApiSourceDocument }>(`/documents/${document.id}`)).document
    }
    throw new ApiClientError(202, 'EXTRACTION_PENDING', 'Extraction is still running. Retry shortly to resume this document.')
  },

  confirmDocument(documentId: string, extraction?: DocumentExtraction): Promise<unknown> {
    return apiFetch(`/documents/${documentId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(extraction ? { extraction } : {}),
    })
  },

  document(documentId: string): Promise<{ document: ApiSourceDocument }> {
    return apiFetch(`/documents/${documentId}`)
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

  importDraft(draftId: string): Promise<{ draft: { id: string; status: 'review' | 'confirmed'; tasks: unknown[]; busyBlocks: unknown[] } }> {
    return apiFetch(`/imports/${draftId}`)
  },

  async generatePlan(): Promise<ApiPlan> {
    const response = await apiFetch<{ plan: ApiPlan }>('/plans/generate', {
      method: 'POST',
      body: JSON.stringify({ availableMinutes: 135, coachMode: 'discipline' }),
    })
    return response.plan
  },

  currentPlan(): Promise<{ active: ApiPlan | null; pending: ApiPlan | null }> {
    return apiFetch('/plans/current')
  },

  async editPlan(plan: ApiPlan, items: NonNullable<ApiPlan['items']>): Promise<ApiPlan> {
    const response = await apiFetch<{ plan: ApiPlan }>(`/plans/${plan.id}/proposal`, {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: plan.version, items }),
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

  async createReplan(plan: ApiPlan, friction: 'cannot_start' | 'too_tired' | 'schedule_changed' | 'lost_focus'): Promise<ApiReplanProposal> {
    const response = await apiFetch<{ proposal: ApiReplanProposal }>('/check-ins', {
      method: 'POST',
      body: JSON.stringify({ planId: plan.id, friction }),
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

  track(
    name: 'onboarding_completed' | 'plan_generated' | 'plan_approved' | 'focus_started' | 'focus_completed' | 'replan_approved' | 'top_task_completed',
    properties: Record<string, unknown> = {},
  ): Promise<unknown> {
    return apiFetch('/events', { method: 'POST', body: JSON.stringify({ name, properties }) })
  },
}
