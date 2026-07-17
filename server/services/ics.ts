import * as ical from 'node-ical'
import type { ImportDraft } from '../domain/contracts.js'

function parameterValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'val' in value && typeof value.val === 'string') return value.val
  return 'Untitled calendar item'
}

export function parseIcsPreview(content: string): Pick<ImportDraft, 'tasks' | 'busyBlocks'> {
  const calendar = ical.sync.parseICS(content)
  const tasks: ImportDraft['tasks'] = []
  const busyBlocks: ImportDraft['busyBlocks'] = []
  const assessmentPattern = /assignment|quiz|exam|midterm|deadline|due|project/i

  for (const item of Object.values(calendar)) {
    if (!item || item.type === 'VCALENDAR' || item.type === 'VTIMEZONE') continue
    if (item.type === 'VTODO') {
      tasks.push({
        title: parameterValue(item.summary),
        dueAt: item.due?.toISOString() ?? null,
        estimatedMinutes: 45,
        confidence: 0.85,
        evidence: ['Imported from an ICS VTODO item'],
      })
      continue
    }
    if (item.type !== 'VEVENT') continue

    const title = parameterValue(item.summary)
    if (assessmentPattern.test(title)) {
      tasks.push({
        title,
        dueAt: item.start.toISOString(),
        estimatedMinutes: 45,
        confidence: 0.72,
        evidence: ['Detected assessment language in an ICS event'],
      })
    } else {
      busyBlocks.push({
        title,
        startsAt: item.start.toISOString(),
        endsAt: (item.end ?? new Date(item.start.getTime() + 60 * 60 * 1000)).toISOString(),
      })
    }
  }
  return { tasks, busyBlocks }
}
