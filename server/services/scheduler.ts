import { randomUUID } from 'node:crypto'
import type {
  CoachMode,
  Locale,
  PlanItem,
  PlanSchedulingWarning,
  PlanningPreferences,
  PriorityAssessment,
  Task,
} from '../domain/contracts.js'

type BusyBlock = { startsAt: string; endsAt: string }
type RankedTask = { task: Task; assessment: PriorityAssessment }
type ConcreteStudyWindow = { startsAt: Date; endsAt: Date; localDayKey: string }
type LocalDateParts = { year: number; month: number; day: number }

export type PlanValidationIssue = {
  code: 'TASK_NOT_FOUND' | 'TASK_NOT_CONFIRMED' | 'DURATION_MISMATCH' | 'ITEM_OVERLAP' | 'BUSY_TIME_CONFLICT' | 'OUTSIDE_FREE_WINDOW' | 'DAILY_LIMIT_EXCEEDED' | 'SESSION_LIMIT_EXCEEDED' | 'AFTER_DEADLINE'
  taskId?: string
  itemId?: string
  message: string
}

export type WeeklyPlanResult = {
  items: PlanItem[]
  schedulingWarnings: PlanSchedulingWarning[]
}

export function summarizeSchedulingWarnings(
  tasks: Task[],
  items: PlanItem[],
  horizonEnd: Date,
): PlanSchedulingWarning[] {
  const scheduledMinutes = new Map<string, number>()
  for (const item of items) scheduledMinutes.set(item.taskId, (scheduledMinutes.get(item.taskId) ?? 0) + item.minutes)
  return tasks.flatMap((task) => {
    const scheduled = scheduledMinutes.get(task.id) ?? 0
    const remainingMinutes = Math.max(0, task.estimatedMinutes - scheduled)
    if (remainingMinutes < 5) return []
    const deadline = task.dueAt ? new Date(task.dueAt) : undefined
    const belongsToThisHorizon = !deadline || deadline <= horizonEnd || scheduled > 0
    if (!belongsToThisHorizon) return []
    return [{
      taskId: task.id,
      remainingMinutes,
      reason: deadline && deadline <= horizonEnd ? 'deadline_too_close' as const : 'insufficient_capacity' as const,
    }]
  })
}

const MODE_SESSION_LIMIT: Record<CoachMode, number> = {
  gentle: 20,
  focus: 35,
  discipline: 45,
}

function nextQuarterHour(date: Date): Date {
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 15) * 15)
  return rounded
}

function fixedOffsetLocalDateParts(date: Date, utcOffsetMinutes: number): LocalDateParts {
  const shifted = new Date(date.getTime() + utcOffsetMinutes * 60_000)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function localDateParts(date: Date, preferences: PlanningPreferences): LocalDateParts {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: preferences.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
    const result = { year: value('year'), month: value('month'), day: value('day') }
    if (Object.values(result).every(Number.isInteger)) return result
  } catch {
    // Fall back to the browser-confirmed offset when an IANA zone is unavailable.
  }
  return fixedOffsetLocalDateParts(date, preferences.utcOffsetMinutes)
}

function timeZoneOffsetMilliseconds(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  const representedAsUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return representedAsUtc - Math.floor(date.getTime() / 1_000) * 1_000
}

function localMinuteToUtc(localDate: Date, minute: number, preferences: PlanningPreferences): Date {
  const localTimestamp = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
  ) + minute * 60_000
  let candidate = localTimestamp - preferences.utcOffsetMinutes * 60_000
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = localTimestamp - timeZoneOffsetMilliseconds(new Date(candidate), preferences.timezone)
      if (next === candidate) break
      candidate = next
    }
  } catch {
    // The fixed-offset candidate is already available as a deterministic fallback.
  }
  return new Date(candidate)
}

function movePastConflicts(start: Date, minutes: number, busyBlocks: BusyBlock[]): Date {
  let candidate = new Date(start)
  let moved = true
  while (moved) {
    moved = false
    const end = new Date(candidate.getTime() + minutes * 60_000)
    for (const block of busyBlocks) {
      const busyStart = new Date(block.startsAt)
      const busyEnd = new Date(block.endsAt)
      if (candidate < busyEnd && end > busyStart) {
        candidate = new Date(busyEnd)
        moved = true
        break
      }
    }
  }
  return candidate
}

export function schedulePlan(input: {
  rankedTasks: RankedTask[]
  startsAt?: string
  availableMinutes: number
  coachMode: CoachMode
  busyBlocks: BusyBlock[]
  locale?: Locale
}): PlanItem[] {
  const sessionLimit = MODE_SESSION_LIMIT[input.coachMode]
  const sortedBusyBlocks = [...input.busyBlocks].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  let cursor = nextQuarterHour(input.startsAt ? new Date(input.startsAt) : new Date())
  let remaining = input.availableMinutes
  const items: PlanItem[] = []

  for (const { task, assessment } of input.rankedTasks) {
    if (items.length > 0) {
      if (remaining <= 10) break
      remaining -= 10
    }
    if (remaining < 15) break
    let minutes = Math.min(task.estimatedMinutes, sessionLimit, remaining)
    cursor = movePastConflicts(cursor, minutes, sortedBusyBlocks)
    if (task.dueAt) {
      const deadlineMinutes = Math.floor((Date.parse(task.dueAt) - cursor.getTime()) / 60_000)
      minutes = Math.min(minutes, deadlineMinutes)
      if (minutes < 5) continue
    }
    const end = new Date(cursor.getTime() + minutes * 60_000)
    items.push({
      id: randomUUID(),
      taskId: task.id,
      startsAt: cursor.toISOString(),
      endsAt: end.toISOString(),
      minutes,
      firstStep: input.locale === 'vi'
        ? `Mở ${task.title} và hoàn thành yêu cầu cụ thể đầu tiên.`
        : `Open ${task.title} and complete the first concrete requirement.`,
      rationale: input.locale === 'vi'
        ? `Mức ưu tiên ${assessment.score}: ${assessment.evidence.slice(0, 2).join('; ')}.`
        : `Priority ${assessment.score}: ${assessment.evidence.slice(0, 2).join('; ')}.`,
    })
    remaining -= minutes
    cursor = new Date(end.getTime() + 10 * 60_000)
  }
  return items
}

function expandStudyWindows(
  preferences: PlanningPreferences,
  notBefore: Date,
  horizonDays: number,
): ConcreteStudyWindow[] {
  const localStart = localDateParts(notBefore, preferences)
  const localMidnight = Date.UTC(localStart.year, localStart.month - 1, localStart.day)
  const windows: ConcreteStudyWindow[] = []

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const localDate = new Date(localMidnight + dayOffset * 86_400_000)
    const dayOfWeek = localDate.getUTCDay()
    const localDayKey = localDate.toISOString().slice(0, 10)
    for (const window of preferences.windows) {
      if (window.dayOfWeek !== dayOfWeek) continue
      const startsAt = localMinuteToUtc(localDate, window.startMinute, preferences)
      const endsAt = localMinuteToUtc(localDate, window.endMinute, preferences)
      if (endsAt <= notBefore) continue
      windows.push({
        startsAt: startsAt < notBefore ? nextQuarterHour(notBefore) : startsAt,
        endsAt,
        localDayKey,
      })
    }
  }

  return windows
    .filter((window) => window.endsAt > window.startsAt)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
}

function subtractBusyBlocks(windows: ConcreteStudyWindow[], busyBlocks: BusyBlock[]): ConcreteStudyWindow[] {
  const busy = busyBlocks
    .map((block) => ({ startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt) }))
    .filter((block) => !Number.isNaN(block.startsAt.getTime()) && block.endsAt > block.startsAt)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())

  return windows.flatMap((window) => {
    let segments: ConcreteStudyWindow[] = [window]
    for (const block of busy) {
      if (block.endsAt <= window.startsAt || block.startsAt >= window.endsAt) continue
      segments = segments.flatMap((segment) => {
        if (block.endsAt <= segment.startsAt || block.startsAt >= segment.endsAt) return [segment]
        const next: ConcreteStudyWindow[] = []
        if (block.startsAt > segment.startsAt) {
          next.push({ ...segment, endsAt: new Date(Math.min(block.startsAt.getTime(), segment.endsAt.getTime())) })
        }
        if (block.endsAt < segment.endsAt) {
          next.push({ ...segment, startsAt: new Date(Math.max(block.endsAt.getTime(), segment.startsAt.getTime())) })
        }
        return next
      })
    }
    return segments.filter((segment) => segment.endsAt.getTime() - segment.startsAt.getTime() >= 5 * 60_000)
  })
}

function localDateTime(date: Date, preferences: PlanningPreferences): { dayKey: string; dayOfWeek: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: preferences.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
    const year = value('year')
    const month = value('month')
    const day = value('day')
    const hour = value('hour')
    const minute = value('minute')
    if ([year, month, day, hour, minute].every(Number.isInteger)) {
      return {
        dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
        minute: hour * 60 + minute,
      }
    }
  } catch {
    // Use the student-confirmed fixed offset below.
  }
  const shifted = new Date(date.getTime() + preferences.utcOffsetMinutes * 60_000)
  return {
    dayKey: shifted.toISOString().slice(0, 10),
    dayOfWeek: shifted.getUTCDay(),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

function overlaps(startsAt: Date, endsAt: Date, otherStartsAt: Date, otherEndsAt: Date): boolean {
  return startsAt < otherEndsAt && endsAt > otherStartsAt
}

function nextDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function validatePlanItems(input: {
  items: PlanItem[]
  tasks: Task[]
  preferences?: PlanningPreferences
  busyBlocks: BusyBlock[]
}): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const tasks = new Map(input.tasks.map((task) => [task.id, task]))
  const sortedItems = [...input.items].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
  const usedByDay = new Map<string, number>()

  for (const [index, item] of sortedItems.entries()) {
    const task = tasks.get(item.taskId)
    const startsAt = new Date(item.startsAt)
    const endsAt = new Date(item.endsAt)
    const duration = (endsAt.getTime() - startsAt.getTime()) / 60_000
    if (!task) {
      issues.push({ code: 'TASK_NOT_FOUND', taskId: item.taskId, itemId: item.id, message: 'The plan item references a task outside this workspace.' })
      continue
    }
    if (task.status !== 'confirmed') {
      issues.push({ code: 'TASK_NOT_CONFIRMED', taskId: task.id, itemId: item.id, message: 'Only confirmed, incomplete tasks can be scheduled.' })
    }
    if (!Number.isInteger(duration) || duration !== item.minutes) {
      issues.push({ code: 'DURATION_MISMATCH', taskId: task.id, itemId: item.id, message: 'The item duration does not match its start and end time.' })
    }
    const overlapsEarlierItem = sortedItems
      .slice(0, index)
      .some((previous) => startsAt < new Date(previous.endsAt))
    if (overlapsEarlierItem) {
      issues.push({ code: 'ITEM_OVERLAP', taskId: task.id, itemId: item.id, message: 'Study sessions cannot overlap.' })
    }
    if (input.busyBlocks.some((block) => overlaps(startsAt, endsAt, new Date(block.startsAt), new Date(block.endsAt)))) {
      issues.push({ code: 'BUSY_TIME_CONFLICT', taskId: task.id, itemId: item.id, message: 'This session overlaps a busy calendar block.' })
    }
    if (task.dueAt && endsAt > new Date(task.dueAt)) {
      issues.push({ code: 'AFTER_DEADLINE', taskId: task.id, itemId: item.id, message: 'A study session cannot end after the task deadline.' })
    }

    if (input.preferences) {
      const startLocal = localDateTime(startsAt, input.preferences)
      const endLocal = localDateTime(endsAt, input.preferences)
      const endMinute = startLocal.dayKey === endLocal.dayKey
        ? endLocal.minute
        : endLocal.dayKey === nextDayKey(startLocal.dayKey) && endLocal.minute === 0
          ? 24 * 60
          : null
      const insideWindow = endMinute !== null
        && input.preferences.windows.some((window) => (
          window.dayOfWeek === startLocal.dayOfWeek
          && startLocal.minute >= window.startMinute
          && endMinute <= window.endMinute
        ))
      if (!insideWindow) {
        issues.push({ code: 'OUTSIDE_FREE_WINDOW', taskId: task.id, itemId: item.id, message: 'This session is outside the free time you confirmed.' })
      }
      if (item.minutes > MODE_SESSION_LIMIT[input.preferences.coachMode]) {
        issues.push({ code: 'SESSION_LIMIT_EXCEEDED', taskId: task.id, itemId: item.id, message: 'This session exceeds the selected intensity limit.' })
      }
      const nextUsed = (usedByDay.get(startLocal.dayKey) ?? 0) + item.minutes
      usedByDay.set(startLocal.dayKey, nextUsed)
      if (nextUsed > input.preferences.dailyMinutes) {
        issues.push({ code: 'DAILY_LIMIT_EXCEEDED', taskId: task.id, itemId: item.id, message: 'The total study time exceeds the daily limit.' })
      }
    }
  }

  return issues
}

export function scheduleWeeklyPlanWithReport(input: {
  rankedTasks: RankedTask[]
  preferences: PlanningPreferences
  busyBlocks: BusyBlock[]
  startsAt?: string
  horizonDays?: number
  now?: Date
}): WeeklyPlanResult {
  const parsedStart = input.startsAt ? new Date(input.startsAt) : input.now ?? new Date()
  const notBefore = Number.isNaN(parsedStart.getTime()) ? input.now ?? new Date() : parsedStart
  const windows = subtractBusyBlocks(
    expandStudyWindows(input.preferences, notBefore, input.horizonDays ?? 7),
    input.busyBlocks,
  ).map((window) => ({ ...window, cursor: new Date(window.startsAt) }))
  const sessionLimit = MODE_SESSION_LIMIT[input.preferences.coachMode]
  const usedByDay = new Map<string, number>()
  const items: PlanItem[] = []
  let windowIndex = 0
  const horizonEnd = windows.at(-1)?.endsAt ?? new Date(notBefore.getTime() + (input.horizonDays ?? 7) * 86_400_000)

  for (const { task, assessment } of input.rankedTasks) {
    let taskMinutesRemaining = task.estimatedMinutes
    while (taskMinutesRemaining >= 5 && windowIndex < windows.length && items.length < 100) {
      const window = windows[windowIndex]
      if (!window) break
      const deadline = task.dueAt ? new Date(task.dueAt) : undefined
      if (deadline && window.cursor >= deadline) break
      const dailyRemaining = input.preferences.dailyMinutes - (usedByDay.get(window.localDayKey) ?? 0)
      const effectiveWindowEnd = deadline && deadline < window.endsAt ? deadline : window.endsAt
      const windowRemaining = Math.floor((effectiveWindowEnd.getTime() - window.cursor.getTime()) / 60_000)
      const minutes = Math.min(taskMinutesRemaining, sessionLimit, dailyRemaining, windowRemaining)

      if (minutes < 5) {
        windowIndex += 1
        continue
      }

      const startsAt = new Date(window.cursor)
      const endsAt = new Date(startsAt.getTime() + minutes * 60_000)
      items.push({
        id: randomUUID(),
        taskId: task.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        minutes,
        firstStep: input.preferences.locale === 'vi'
          ? `Mở ${task.title} và hoàn thành yêu cầu cụ thể đầu tiên.`
          : `Open ${task.title} and complete the first concrete requirement.`,
        rationale: input.preferences.locale === 'vi'
          ? `Mức ưu tiên ${assessment.score}; được xếp trong khung giờ rảnh bạn đã xác nhận.`
          : `Priority ${assessment.score}; scheduled inside a free window you confirmed.`,
      })
      usedByDay.set(window.localDayKey, (usedByDay.get(window.localDayKey) ?? 0) + minutes)
      taskMinutesRemaining -= minutes
      window.cursor = new Date(endsAt.getTime() + 10 * 60_000)

      if (window.cursor >= window.endsAt || (usedByDay.get(window.localDayKey) ?? 0) >= input.preferences.dailyMinutes) {
        windowIndex += 1
      }
    }
  }

  const schedulingWarnings = summarizeSchedulingWarnings(
    input.rankedTasks.map(({ task }) => task),
    items,
    horizonEnd,
  )

  return { items, schedulingWarnings }
}

export function scheduleWeeklyPlan(input: {
  rankedTasks: RankedTask[]
  preferences: PlanningPreferences
  busyBlocks: BusyBlock[]
  startsAt?: string
  horizonDays?: number
  now?: Date
}): PlanItem[] {
  return scheduleWeeklyPlanWithReport(input).items
}
