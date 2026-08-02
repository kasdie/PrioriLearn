import { describe, expect, it } from 'vitest'
import {
  extractStructuredDocument,
  StructuredImportError,
} from './structured-import.js'

describe('structured study-data imports', () => {
  it('maps semicolon-delimited CSV headers, including Vietnamese school exports', () => {
    const result = extractStructuredDocument({
      filename: 'hoc-ky.csv',
      mimeType: 'text/csv',
      content: Buffer.from([
        'Mã môn học;Tên môn học;Điểm hiện tại;Điểm mục tiêu;Bài tập;Hạn nộp;Trọng số;Thời lượng phút',
        'CS304;Programming;54;78;Service integration;2027-08-15T23:59:00Z;20%;60',
      ].join('\n')),
    })

    expect(result).toMatchObject({
      provider: 'structured-csv',
      extraction: {
        courses: [{
          code: 'CS304',
          name: 'Programming',
          currentScore: 54,
          targetScore: 78,
        }],
        tasks: [{
          courseCode: 'CS304',
          title: 'Service integration',
          dueAt: '2027-08-15T23:59:00.000Z',
          gradeWeight: 20,
          estimatedMinutes: 60,
        }],
        warnings: [],
      },
    })
  })

  it('joins common JSON course IDs to tasks and flags fields that need review', () => {
    const result = extractStructuredDocument({
      filename: 'student-export.json',
      mimeType: 'application/json',
      content: Buffer.from(JSON.stringify({
        courses: [{
          id: 'programming',
          name: 'Programming',
          currentScore: 54,
          targetScore: 78,
        }],
        tasks: [{
          courseId: 'programming',
          title: 'API design',
          due: 'not-a-date',
          gradeWeight: '30%',
        }],
      })),
    })

    expect(result?.provider).toBe('structured-json')
    expect(result?.extraction.courses).toContainEqual(expect.objectContaining({
      code: 'programming',
      name: 'Programming',
      currentScore: 54,
      targetScore: 78,
    }))
    expect(result?.extraction.tasks).toEqual([
      expect.objectContaining({
        courseCode: 'programming',
        title: 'API design',
        dueAt: null,
        gradeWeight: 30,
        estimatedMinutes: 45,
      }),
    ])
    expect(result?.extraction.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('45 minutes'),
      expect.stringContaining('deadline'),
    ]))
  })

  it('supports JSONL rows and derives a reviewable course code when only a name is supplied', () => {
    const result = extractStructuredDocument({
      filename: 'assignments.jsonl',
      mimeType: 'application/x-ndjson',
      content: Buffer.from([
        JSON.stringify({ courseName: 'Applied Statistics', task: 'Problem set', estimatedMinutes: 35 }),
        JSON.stringify({ courseName: 'Applied Statistics', task: 'Quiz review', estimatedMinutes: 20 }),
      ].join('\n')),
    })

    expect(result?.provider).toBe('structured-jsonl')
    expect(result?.extraction.courses).toHaveLength(1)
    expect(result?.extraction.tasks).toHaveLength(2)
    expect(result?.extraction.tasks[0]?.courseCode).toBe(result?.extraction.courses[0]?.code)
    expect(result?.extraction.warnings).toEqual([
      expect.stringContaining('generated code'),
    ])
  })

  it('localizes generated evidence and review warnings for Vietnamese mode', () => {
    const result = extractStructuredDocument({
      filename: 'hoc-ky.csv',
      mimeType: 'text/csv',
      locale: 'vi',
      content: Buffer.from([
        'course_name,task_title,due_date',
        'Lập trình,Bài tập tích hợp,không hợp lệ',
      ].join('\n')),
    })

    expect(result?.extraction.tasks[0]?.evidence[0]).toContain('Dòng CSV 2')
    expect(result?.extraction.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('nhiệm vụ'),
      expect.stringContaining('môn học'),
      expect.stringContaining('thời hạn'),
    ]))
    expect(result?.extraction.warnings.join(' ')).not.toContain('task(s)')
  })

  it('returns null for a valid structured file with no recognized study fields', () => {
    const result = extractStructuredDocument({
      filename: 'unknown.csv',
      mimeType: 'text/csv',
      content: Buffer.from('alpha,beta\none,two'),
    })
    expect(result).toBeNull()
  })

  it('returns an actionable validation error for malformed JSON', () => {
    expect(() => extractStructuredDocument({
      filename: 'broken.json',
      mimeType: 'application/json',
      content: Buffer.from('{not valid json'),
    })).toThrowError(StructuredImportError)
  })
})
