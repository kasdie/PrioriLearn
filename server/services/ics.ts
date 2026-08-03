import * as ical from 'node-ical'
import type { ImportDraft, Locale } from '../domain/contracts.js'

function parameterValue(value: unknown, locale: Locale): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'val' in value && typeof value.val === 'string') return value.val
  return locale === 'vi' ? 'Mục lịch chưa có tiêu đề' : 'Untitled calendar item'
}

function isAssessmentTitle(title: string): boolean {
  const searchable = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  return /(^|\W)(assignment|quiz|exam|midterm|deadline|due|project|bai tap|kiem tra|ky thi|thi|giua ky|han nop|do an|du an)(\W|$)/i.test(searchable)
}

export function parseIcsPreview(content: string, locale: Locale = 'en'): Pick<ImportDraft, 'tasks' | 'busyBlocks'> {
  const calendar = ical.sync.parseICS(content)
  const tasks: ImportDraft['tasks'] = []
  const busyBlocks: ImportDraft['busyBlocks'] = []

  for (const item of Object.values(calendar)) {
    if (!item || item.type === 'VCALENDAR' || item.type === 'VTIMEZONE') continue
    if (item.type === 'VTODO') {
      tasks.push({
        title: parameterValue(item.summary, locale),
        dueAt: item.due?.toISOString() ?? null,
        estimatedMinutes: 45,
        confidence: 0.85,
        evidence: [locale === 'vi' ? 'Được nhập từ mục VTODO trong tệp ICS' : 'Imported from an ICS VTODO item'],
      })
      continue
    }
    if (item.type !== 'VEVENT') continue

    const title = parameterValue(item.summary, locale)
    if (isAssessmentTitle(title)) {
      tasks.push({
        title,
        dueAt: item.start.toISOString(),
        estimatedMinutes: 45,
        confidence: 0.72,
        evidence: [locale === 'vi' ? 'Phát hiện từ khóa đánh giá trong sự kiện ICS' : 'Detected assessment language in an ICS event'],
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
