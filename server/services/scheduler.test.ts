import { describe, expect, it } from 'vitest'
import type { PlanningPreferences, PriorityAssessment, Task } from '../domain/contracts.js'
import { schedulePlan, scheduleWeeklyPlan } from './scheduler.js'

const task = (id: string): Task => ({
  id,
  tenantId: 'tenant-1',
  courseId: 'course-1',
  title: `Task ${id}`,
  dueAt: '2026-06-18T12:00:00.000Z',
  gradeWeight: 20,
  estimatedMinutes: 60,
  status: 'confirmed',
  sourceKind: 'manual',
  confidence: 1,
  evidence: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
})

const assessment = (taskId: string): PriorityAssessment => ({
  id: `assessment-${taskId}`,
  tenantId: 'tenant-1',
  taskId,
  score: 90,
  factors: { academicImpact: 90, failureRisk: 90, costOfDelay: 90, goalAlignment: 90, actionability: 90 },
  weights: { academicImpact: 0.3, failureRisk: 0.25, costOfDelay: 0.2, goalAlignment: 0.15, actionability: 0.1 },
  costOfDelay: {
    delayHours: 48,
    completionProbabilityNow: 90,
    completionProbabilityAfterDelay: 60,
    riskIncreasePercentagePoints: 30,
    message: 'Test',
  },
  evidence: [],
  assumptions: [],
  uncertainty: 'low',
  createdAt: '2026-06-01T00:00:00.000Z',
})

const preferences = (overrides: Partial<PlanningPreferences> = {}): PlanningPreferences => ({
  id: 'preferences-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  locale: 'en',
  coachMode: 'focus',
  dailyMinutes: 60,
  timezone: 'UTC',
  utcOffsetMinutes: 0,
  windows: [
    { dayOfWeek: 1, startMinute: 18 * 60, endMinute: 20 * 60 },
    { dayOfWeek: 2, startMinute: 18 * 60, endMinute: 20 * 60 },
  ],
  version: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...overrides,
})

describe('schedulePlan', () => {
  it('moves a session past a calendar conflict', () => {
    const items = schedulePlan({
      rankedTasks: [{ task: task('one'), assessment: assessment('one') }],
      startsAt: '2026-06-16T16:00:00.000Z',
      availableMinutes: 60,
      coachMode: 'discipline',
      busyBlocks: [{ startsAt: '2026-06-16T16:15:00.000Z', endsAt: '2026-06-16T17:00:00.000Z' }],
    })
    expect(items[0]?.startsAt).toBe('2026-06-16T17:00:00.000Z')
  })

  it('enforces coach-mode session limits', () => {
    const rankedTasks = [{ task: task('one'), assessment: assessment('one') }]
    expect(schedulePlan({ rankedTasks, startsAt: '2026-06-16T16:00:00.000Z', availableMinutes: 90, coachMode: 'gentle', busyBlocks: [] })[0]?.minutes).toBe(20)
    expect(schedulePlan({ rankedTasks, startsAt: '2026-06-16T16:00:00.000Z', availableMinutes: 90, coachMode: 'focus', busyBlocks: [] })[0]?.minutes).toBe(35)
    expect(schedulePlan({ rankedTasks, startsAt: '2026-06-16T16:00:00.000Z', availableMinutes: 90, coachMode: 'discipline', busyBlocks: [] })[0]?.minutes).toBe(45)
  })

  it('counts recovery breaks inside the available-time budget', () => {
    const items = schedulePlan({
      rankedTasks: [
        { task: task('one'), assessment: assessment('one') },
        { task: task('two'), assessment: assessment('two') },
      ],
      startsAt: '2026-06-16T16:00:00.000Z',
      availableMinutes: 90,
      coachMode: 'discipline',
      busyBlocks: [],
    })
    expect(items.map((item) => item.minutes)).toEqual([45, 35])
    const elapsedMinutes = (Date.parse(items[1]!.endsAt) - Date.parse(items[0]!.startsAt)) / 60_000
    expect(elapsedMinutes).toBe(90)
  })

  it('distributes estimated work across confirmed windows on multiple days', () => {
    const items = scheduleWeeklyPlan({
      rankedTasks: [
        { task: task('one'), assessment: assessment('one') },
        { task: task('two'), assessment: assessment('two') },
      ],
      preferences: preferences(),
      busyBlocks: [],
      startsAt: '2026-06-15T08:00:00.000Z',
    })

    expect(items.map((item) => item.minutes)).toEqual([35, 25, 35, 25])
    expect(items.slice(0, 2).every((item) => item.startsAt.startsWith('2026-06-15'))).toBe(true)
    expect(items.slice(2).every((item) => item.startsAt.startsWith('2026-06-16'))).toBe(true)
  })

  it('removes busy calendar time from a confirmed free window', () => {
    const items = scheduleWeeklyPlan({
      rankedTasks: [{ task: task('one'), assessment: assessment('one') }],
      preferences: preferences({ dailyMinutes: 90, coachMode: 'discipline' }),
      busyBlocks: [{ startsAt: '2026-06-15T18:00:00.000Z', endsAt: '2026-06-15T19:00:00.000Z' }],
      startsAt: '2026-06-15T08:00:00.000Z',
    })

    expect(items[0]?.startsAt).toBe('2026-06-15T19:00:00.000Z')
    expect(items.reduce((total, item) => total + item.minutes, 0)).toBe(60)
  })

  it('uses the selected locale for generated plan guidance', () => {
    const items = scheduleWeeklyPlan({
      rankedTasks: [{ task: task('one'), assessment: assessment('one') }],
      preferences: preferences({ locale: 'vi' }),
      busyBlocks: [],
      startsAt: '2026-06-15T08:00:00.000Z',
    })

    expect(items[0]?.firstStep).toContain('Mở')
    expect(items[0]?.rationale).toContain('khung giờ rảnh')
  })

  it('uses the IANA timezone offset for each scheduled date', () => {
    const items = scheduleWeeklyPlan({
      rankedTasks: [{ task: task('one'), assessment: assessment('one') }],
      preferences: preferences({
        timezone: 'America/New_York',
        utcOffsetMinutes: -300,
        windows: [{ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 10 * 60 }],
      }),
      busyBlocks: [],
      startsAt: '2026-03-07T12:00:00.000Z',
    })

    expect(items[0]?.startsAt).toBe('2026-03-08T13:00:00.000Z')
  })
})
