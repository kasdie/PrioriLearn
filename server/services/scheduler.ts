import { randomUUID } from 'node:crypto'
import type { CoachMode, PlanItem, PriorityAssessment, Task } from '../domain/contracts.js'

type BusyBlock = { startsAt: string; endsAt: string }
type RankedTask = { task: Task; assessment: PriorityAssessment }

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
    const minutes = Math.min(task.estimatedMinutes, sessionLimit, remaining)
    cursor = movePastConflicts(cursor, minutes, sortedBusyBlocks)
    const end = new Date(cursor.getTime() + minutes * 60_000)
    items.push({
      id: randomUUID(),
      taskId: task.id,
      startsAt: cursor.toISOString(),
      endsAt: end.toISOString(),
      minutes,
      firstStep: `Open ${task.title} and complete the first concrete requirement.`,
      rationale: `Priority ${assessment.score}: ${assessment.evidence.slice(0, 2).join('; ')}.`,
    })
    remaining -= minutes
    cursor = new Date(end.getTime() + 10 * 60_000)
  }
  return items
}
