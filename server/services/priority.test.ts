import { describe, expect, it } from 'vitest'
import type { Course, Task } from '../domain/contracts.js'
import { assessPriority, PRIORITY_WEIGHTS } from './priority.js'

const course: Course = {
  id: 'course-1',
  tenantId: 'tenant-1',
  code: 'CS304',
  name: 'Programming',
  currentScore: 54,
  targetScore: 78,
  createdAt: '2026-06-01T00:00:00.000Z',
}

const task: Task = {
  id: 'task-1',
  tenantId: 'tenant-1',
  courseId: course.id,
  title: 'Assignment 3: API design',
  dueAt: '2026-06-18T12:00:00.000Z',
  gradeWeight: 30,
  estimatedMinutes: 45,
  status: 'confirmed',
  sourceKind: 'manual',
  confidence: 0.95,
  evidence: ['Assignment brief'],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

describe('assessPriority', () => {
  it('uses the published 30/25/20/15/10 weights', () => {
    expect(PRIORITY_WEIGHTS).toEqual({
      academicImpact: 0.3,
      failureRisk: 0.25,
      costOfDelay: 0.2,
      goalAlignment: 0.15,
      actionability: 0.1,
    })
  })

  it('keeps evidence and uncertainty visible', () => {
    const assessment = assessPriority(task, course, new Date('2026-06-16T12:00:00.000Z'))
    expect(assessment.score).toBe(95)
    expect(assessment.costOfDelay.completionProbabilityNow).toBe(92)
    expect(assessment.costOfDelay.completionProbabilityAfterDelay).toBe(74)
    expect(assessment.costOfDelay.completionProbabilityAfterDelay).toBeLessThan(assessment.costOfDelay.completionProbabilityNow)
    expect(assessment.evidence).toContain('30% of the course grade')
    expect(assessment.uncertainty).toBe('low')
  })
})
