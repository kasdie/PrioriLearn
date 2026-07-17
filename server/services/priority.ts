import { randomUUID } from 'node:crypto'
import type { Course, PriorityAssessment, PriorityFactors, Task } from '../domain/contracts.js'

export const PRIORITY_WEIGHTS: PriorityFactors = {
  academicImpact: 0.3,
  failureRisk: 0.25,
  costOfDelay: 0.2,
  goalAlignment: 0.15,
  actionability: 0.1,
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value))

function deadlinePressure(dueAt: string | null, now: Date): number {
  if (!dueAt) return 40
  const hours = (new Date(dueAt).getTime() - now.getTime()) / 3_600_000
  if (hours <= 24) return 100
  if (hours <= 48) return 95
  if (hours <= 72) return 85
  if (hours <= 168) return 65
  return 35
}

export function assessPriority(task: Task, course: Course, now = new Date()): PriorityAssessment {
  const gradeWeight = task.gradeWeight ?? 5
  const scoreGap = Math.max(0, (course.targetScore ?? 75) - (course.currentScore ?? 70))
  const urgency = deadlinePressure(task.dueAt, now)
  const factors: PriorityFactors = {
    academicImpact: clamp((gradeWeight / 30) * 100),
    failureRisk: clamp(40 + scoreGap * 2.3),
    costOfDelay: urgency,
    goalAlignment: clamp(40 + scoreGap * 2.1),
    actionability: task.estimatedMinutes <= 45 ? 85 : task.estimatedMinutes <= 90 ? 75 : 55,
  }
  const score = Math.round(
    factors.academicImpact * PRIORITY_WEIGHTS.academicImpact
      + factors.failureRisk * PRIORITY_WEIGHTS.failureRisk
      + factors.costOfDelay * PRIORITY_WEIGHTS.costOfDelay
      + factors.goalAlignment * PRIORITY_WEIGHTS.goalAlignment
      + factors.actionability * PRIORITY_WEIGHTS.actionability,
  )
  const completionProbabilityNow = clamp(Math.round(92 - Math.max(0, task.estimatedMinutes - 45) * 0.12), 45, 92)
  const probabilityDrop = Math.round(clamp(6 + urgency * 0.08 + gradeWeight * 0.15, 8, 24))
  const completionProbabilityAfterDelay = clamp(completionProbabilityNow - probabilityDrop, 20, 95)
  const uncertainty = task.confidence >= 0.9 ? 'low' : task.confidence >= 0.7 ? 'medium' : 'high'

  return {
    id: randomUUID(),
    tenantId: task.tenantId,
    taskId: task.id,
    score,
    factors,
    weights: PRIORITY_WEIGHTS,
    costOfDelay: {
      delayHours: 48,
      completionProbabilityNow,
      completionProbabilityAfterDelay,
      riskIncreasePercentagePoints: completionProbabilityNow - completionProbabilityAfterDelay,
      message: `Delaying 48 hours lowers estimated on-time completion from ${completionProbabilityNow}% to ${completionProbabilityAfterDelay}%.`,
    },
    evidence: [
      `${gradeWeight}% of the course grade`,
      `${scoreGap.toFixed(0)} point gap to the target score`,
      task.dueAt ? `Deadline ${task.dueAt}` : 'No confirmed deadline',
      ...task.evidence,
    ],
    assumptions: [
      'The confirmed grade weight and deadline are accurate.',
      'Available study time is not interrupted by a new calendar event.',
    ],
    uncertainty,
    createdAt: now.toISOString(),
  }
}
