import { describe, expect, it } from 'vitest'
import { parseIcsPreview } from './ics.js'

function calendarWithEvent(summary?: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:event-1',
    'DTSTAMP:20260803T000000Z',
    'DTSTART:20260805T090000Z',
    'DTEND:20260805T100000Z',
    ...(summary ? [`SUMMARY:${summary}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

describe('ICS preview localization', () => {
  it('recognizes Vietnamese assessment language and localizes evidence', () => {
    const preview = parseIcsPreview(calendarWithEvent('Hạn nộp bài tập lớn'), 'vi')

    expect(preview.tasks).toHaveLength(1)
    expect(preview.busyBlocks).toHaveLength(0)
    expect(preview.tasks[0]).toMatchObject({
      title: 'Hạn nộp bài tập lớn',
      evidence: ['Phát hiện từ khóa đánh giá trong sự kiện ICS'],
    })
  })

  it('keeps ordinary Vietnamese events as busy time with a localized fallback', () => {
    const preview = parseIcsPreview(calendarWithEvent(), 'vi')

    expect(preview.tasks).toHaveLength(0)
    expect(preview.busyBlocks).toEqual([
      expect.objectContaining({ title: 'Mục lịch chưa có tiêu đề' }),
    ])
  })

  it('preserves the English parser behavior', () => {
    const preview = parseIcsPreview(calendarWithEvent('Final exam'), 'en')

    expect(preview.tasks[0]).toMatchObject({
      title: 'Final exam',
      evidence: ['Detected assessment language in an ICS event'],
    })
  })
})
