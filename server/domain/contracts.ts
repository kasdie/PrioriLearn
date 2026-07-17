import { z } from 'zod'

export const LocaleSchema = z.enum(['vi', 'en'])
export const CoachModeSchema = z.enum(['gentle', 'focus', 'discipline'])

export type Locale = z.infer<typeof LocaleSchema>
export type CoachMode = z.infer<typeof CoachModeSchema>

export type Tenant = {
  id: string
  kind: 'personal' | 'institution'
  name: string
  createdAt: string
}

export type User = {
  id: string
  tenantId: string
  email: string
  name: string
  locale: Locale
  role: 'student' | 'institution_admin'
  passwordHash: string
  createdAt: string
}

export type Course = {
  id: string
  tenantId: string
  code: string
  name: string
  currentScore: number | null
  targetScore: number | null
  sourceDocumentId?: string
  createdAt: string
}

export type TaskStatus = 'draft' | 'confirmed' | 'completed'

export type Task = {
  id: string
  tenantId: string
  courseId: string
  title: string
  dueAt: string | null
  gradeWeight: number | null
  estimatedMinutes: number
  status: TaskStatus
  sourceKind: 'manual' | 'document' | 'ics' | 'canvas' | 'demo'
  sourceDocumentId?: string
  confidence: number
  evidence: string[]
  createdAt: string
  updatedAt: string
}

export type SourceDocument = {
  id: string
  tenantId: string
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  status: 'uploaded' | 'processing' | 'needs_review' | 'confirmed' | 'failed'
  extraction?: DocumentExtraction
  extractionProvider?: string
  createdAt: string
  expiresAt: string
  rawDeletedAt?: string
}

export type AvailabilityBlock = {
  id: string
  tenantId: string
  title: string
  startsAt: string
  endsAt: string
  sourceKind: 'manual' | 'ics' | 'google_calendar'
  createdAt: string
}

export const ExtractedCourseSchema = z.object({
  code: z.string(),
  name: z.string(),
  currentScore: z.number().min(0).max(100).nullable(),
  targetScore: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
})

export const ExtractedTaskSchema = z.object({
  courseCode: z.string(),
  title: z.string(),
  dueAt: z.string().nullable(),
  gradeWeight: z.number().min(0).max(100).nullable(),
  estimatedMinutes: z.number().int().min(5).max(1440),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
})

export const DocumentExtractionSchema = z.object({
  courses: z.array(ExtractedCourseSchema),
  tasks: z.array(ExtractedTaskSchema),
  warnings: z.array(z.string()),
})

export type DocumentExtraction = z.infer<typeof DocumentExtractionSchema>

export type PriorityFactors = {
  academicImpact: number
  failureRisk: number
  costOfDelay: number
  goalAlignment: number
  actionability: number
}

export type PriorityAssessment = {
  id: string
  tenantId: string
  taskId: string
  score: number
  factors: PriorityFactors
  weights: PriorityFactors
  costOfDelay: {
    delayHours: number
    completionProbabilityNow: number
    completionProbabilityAfterDelay: number
    riskIncreasePercentagePoints: number
    message: string
  }
  evidence: string[]
  assumptions: string[]
  uncertainty: 'low' | 'medium' | 'high'
  createdAt: string
}

export type PlanItem = {
  id: string
  taskId: string
  startsAt: string
  endsAt: string
  minutes: number
  firstStep: string
  rationale: string
}

export type StudyPlan = {
  id: string
  tenantId: string
  version: number
  status: 'proposed' | 'approved' | 'superseded'
  previousPlanId?: string
  items: PlanItem[]
  rationale: string
  createdAt: string
  approvedAt?: string
  approvalReceipt?: string
}

export type CoachCheckIn = {
  id: string
  tenantId: string
  planId: string
  friction: 'cannot_start' | 'too_tired' | 'schedule_changed' | 'lost_focus'
  note?: string
  createdAt: string
}

export type ReplanProposal = {
  id: string
  tenantId: string
  checkInId: string
  basePlanId: string
  basePlanVersion: number
  status: 'proposed' | 'approved' | 'rejected'
  title: string
  rationale: string
  changes: string[]
  proposedItems: PlanItem[]
  createdAt: string
  approvedPlanId?: string
}

export type ConsentAudit = {
  id: string
  tenantId: string
  userId: string
  purpose: 'product_terms' | 'calendar_read' | 'canvas_read' | 'email_digest' | 'research_metrics'
  granted: boolean
  source: 'onboarding' | 'settings' | 'connector' | 'api'
  createdAt: string
}

export type ImportDraft = {
  id: string
  tenantId: string
  kind: 'ics'
  status: 'needs_review' | 'confirmed'
  tasks: Array<Pick<Task, 'title' | 'dueAt' | 'estimatedMinutes' | 'confidence' | 'evidence'>>
  busyBlocks: Array<{ title: string; startsAt: string; endsAt: string }>
  createdAt: string
}

export const RegisterInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().min(2).max(100),
  locale: LocaleSchema.default('vi'),
})

export const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
})

export const TaskCreateInputSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1).max(240),
  dueAt: z.string().nullable().default(null),
  gradeWeight: z.number().min(0).max(100).nullable().default(null),
  estimatedMinutes: z.number().int().min(5).max(600).default(45),
})

export const TaskPatchInputSchema = TaskCreateInputSchema.partial().extend({
  status: z.enum(['confirmed', 'completed']).optional(),
})

export const PlanGenerateInputSchema = z.object({
  startsAt: z.string().optional(),
  availableMinutes: z.number().int().min(15).max(720).default(135),
  coachMode: CoachModeSchema.default('discipline'),
  busyBlocks: z.array(z.object({
    title: z.string().default('Busy'),
    startsAt: z.string(),
    endsAt: z.string(),
  })).default([]),
})

export const PlanApprovalInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
})

export const CheckInInputSchema = z.object({
  planId: z.string().min(1),
  friction: z.enum(['cannot_start', 'too_tired', 'schedule_changed', 'lost_focus']),
  note: z.string().max(1000).optional(),
})

export const ReplanApprovalInputSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
})

export const ConsentInputSchema = z.object({
  purpose: z.enum(['product_terms', 'calendar_read', 'canvas_read', 'email_digest', 'research_metrics']),
  granted: z.boolean(),
  source: z.enum(['onboarding', 'settings', 'connector', 'api']).default('api'),
})

export const CoachingProposalSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  changes: z.array(z.string()),
  firstStep: z.string(),
  estimatedMinutes: z.number().int().positive(),
})

export type CoachingProposal = z.infer<typeof CoachingProposalSchema>
