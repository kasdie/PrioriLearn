import { describe, expect, it } from 'vitest'
import type { PlanningPreferences, PriorityAssessment, Task } from '../domain/contracts.js'
import { schedulePlan, scheduleWeeklyPlan, scheduleWeeklyPlanWithReport, validatePlanItems } from './scheduler.js'

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

  it('never schedules past a deadline and reports the remaining work', () => {
    const urgent = { ...task('urgent'), dueAt: '2026-06-15T18:20:00.000Z' }
    const result = scheduleWeeklyPlanWithReport({
      rankedTasks: [{ task: urgent, assessment: assessment('urgent') }],
      preferences: preferences(),
      busyBlocks: [],
      startsAt: '2026-06-15T08:00:00.000Z',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.endsAt).toBe('2026-06-15T18:20:00.000Z')
    expect(result.schedulingWarnings).toEqual([{
      taskId: 'urgent',
      remainingMinutes: 40,
      reason: 'deadline_too_close',
    }])
  })

  it('reports tasks that do not fit instead of silently dropping them', () => {
    const result = scheduleWeeklyPlanWithReport({
      rankedTasks: [
        { task: { ...task('one'), dueAt: null }, assessment: assessment('one') },
        { task: { ...task('two'), dueAt: null }, assessment: assessment('two') },
      ],
      preferences: preferences({
        dailyMinutes: 35,
        windows: [{ dayOfWeek: 1, startMinute: 18 * 60, endMinute: 18 * 60 + 35 }],
      }),
      busyBlocks: [],
      startsAt: '2026-06-15T08:00:00.000Z',
    })

    expect(result.items.map((item) => item.taskId)).toEqual(['one'])
    expect(result.schedulingWarnings).toEqual([
      { taskId: 'one', remainingMinutes: 25, reason: 'insufficient_capacity' },
      { taskId: 'two', remainingMinutes: 60, reason: 'insufficient_capacity' },
    ])
  })

  it('rejects foreign tasks, overlaps, busy time, and limits in edited plans', () => {
    const first = {
      id: 'item-one', taskId: 'one', startsAt: '2026-06-15T18:00:00.000Z', endsAt: '2026-06-15T18:35:00.000Z',
      minutes: 35, firstStep: 'Start.', rationale: 'Test.',
    }
    const issues = validatePlanItems({
      items: [
        first,
        { ...first, id: 'item-two', startsAt: '2026-06-15T18:20:00.000Z', endsAt: '2026-06-15T19:05:00.000Z', minutes: 45 },
        { ...first, id: 'item-three', taskId: 'other-tenant' },
      ],
      tasks: [task('one')],
      preferences: preferences({ dailyMinutes: 40 }),
      busyBlocks: [{ startsAt: '2026-06-15T18:10:00.000Z', endsAt: '2026-06-15T18:15:00.000Z' }],
    })

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'TASK_NOT_FOUND',
      'ITEM_OVERLAP',
      'BUSY_TIME_CONFLICT',
      'DAILY_LIMIT_EXCEEDED',
      'SESSION_LIMIT_EXCEEDED',
    ]))
  })

  it('accepts a session ending exactly at midnight inside a confirmed window', () => {
    const lateTask = { ...task('late'), dueAt: null }
    const issues = validatePlanItems({
      items: [{
        id: 'late-item',
        taskId: lateTask.id,
        startsAt: '2026-06-15T23:30:00.000Z',
        endsAt: '2026-06-16T00:00:00.000Z',
        minutes: 30,
        firstStep: 'Start.',
        rationale: 'Test.',
      }],
      tasks: [lateTask],
      preferences: preferences({
        windows: [{ dayOfWeek: 1, startMinute: 23 * 60, endMinute: 24 * 60 }],
      }),
      busyBlocks: [],
    })

    expect(issues).toEqual([])
  })

  it('detects overlap with an earlier long session, not only the adjacent item', () => {
    const baseItem = {
      taskId: 'one',
      minutes: 30,
      firstStep: 'Start.',
      rationale: 'Test.',
    }
    const issues = validatePlanItems({
      items: [
        { ...baseItem, id: 'long', startsAt: '2026-06-15T18:00:00.000Z', endsAt: '2026-06-15T19:00:00.000Z', minutes: 60 },
        { ...baseItem, id: 'nested', startsAt: '2026-06-15T18:10:00.000Z', endsAt: '2026-06-15T18:20:00.000Z', minutes: 10 },
        { ...baseItem, id: 'later', startsAt: '2026-06-15T18:30:00.000Z', endsAt: '2026-06-15T19:00:00.000Z' },
      ],
      tasks: [task('one')],
      busyBlocks: [],
    })

    expect(issues.filter((issue) => issue.code === 'ITEM_OVERLAP').map((issue) => issue.itemId))
      .toEqual(['nested', 'later'])
  })
})
