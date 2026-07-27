import { parse } from 'csv-parse/sync'
import {
  DocumentExtractionSchema,
  type DocumentExtraction,
} from '../domain/contracts.js'

type StructuredFormat = 'csv' | 'json' | 'jsonl'

export type StructuredImportResult = {
  extraction: DocumentExtraction
  provider: `structured-${StructuredFormat}`
}

export class StructuredImportError extends Error {
  constructor(
    readonly code: 'INVALID_CSV' | 'INVALID_JSON',
    message: string,
  ) {
    super(message)
    this.name = 'StructuredImportError'
  }
}

type UnknownRecord = Record<string, unknown>
type IndexedRecord = Map<string, { key: string; value: unknown }>
type CourseDraft = DocumentExtraction['courses'][number]
type TaskDraft = DocumentExtraction['tasks'][number]

type BuildState = {
  courses: Map<string, CourseDraft>
  tasks: TaskDraft[]
  warnings: Set<string>
  defaultedMinutes: number
  derivedCourseCodes: number
  invalidDeadlines: number
  invalidNumbers: number
}

const courseCodeAliases = [
  'course_code',
  'coursecode',
  'course_id',
  'courseid',
  'subject_code',
  'class_code',
  'module_code',
  'ma_mon_hoc',
  'ma_mon',
  'code',
] as const

const courseNameAliases = [
  'course_name',
  'coursename',
  'subject_name',
  'class_name',
  'module_name',
  'ten_mon_hoc',
  'ten_mon',
  'course_title',
] as const

const genericCourseAliases = ['course', 'subject', 'class', 'module', 'mon_hoc'] as const

const taskTitleAliases = [
  'task_title',
  'assignment_title',
  'assessment_title',
  'task',
  'assignment',
  'assessment',
  'activity',
  'bai_tap',
  'ten_bai_tap',
  'noi_dung',
  'title',
] as const

const dueAtAliases = [
  'due_at',
  'due_date',
  'due',
  'deadline',
  'submission_date',
  'end_date',
  'han_nop',
  'ngay_nop',
] as const

const weightAliases = [
  'grade_weight',
  'gradeweight',
  'weight',
  'weight_percent',
  'percentage',
  'percent',
  'contribution',
  'trong_so',
  'ty_le',
] as const

const minutesAliases = [
  'estimated_minutes',
  'estimatedminutes',
  'estimate_minutes',
  'duration_minutes',
  'study_minutes',
  'minutes',
  'thoi_luong_phut',
  'so_phut',
] as const

const currentScoreAliases = [
  'current_score',
  'currentscore',
  'current_grade',
  'currentgrade',
  'score',
  'grade',
  'diem_hien_tai',
  'diem',
] as const

const targetScoreAliases = [
  'target_score',
  'targetscore',
  'target_grade',
  'targetgrade',
  'goal_score',
  'goal_grade',
  'diem_muc_tieu',
] as const

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function indexRecord(record: UnknownRecord): IndexedRecord {
  return new Map(Object.entries(record).map(([key, value]) => [
    normalizeKey(key),
    { key, value },
  ]))
}

function read(index: IndexedRecord, aliases: readonly string[]): { key: string; value: unknown } | undefined {
  for (const alias of aliases) {
    const entry = index.get(alias)
    if (entry) return entry
  }
  return undefined
}

function readArray(record: UnknownRecord, aliases: readonly string[]): unknown[] | undefined {
  const entry = read(indexRecord(record), aliases)
  return Array.isArray(entry?.value) ? entry.value : undefined
}

function toText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().replace(/%$/, '').replace(/\s/g, '')
  if (!cleaned) return undefined
  const decimal = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '')
  const parsed = Number(decimal)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boundedNumber(
  value: unknown,
  min: number,
  max: number,
  state: BuildState,
): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = toNumber(value)
  if (parsed === undefined || parsed < min || parsed > max) {
    state.invalidNumbers += 1
    return null
  }
  return parsed
}

function deriveCourseCode(name: string): string {
  const normalized = normalizeKey(name)
  const initials = normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (initials || normalized.replace(/_/g, '').toUpperCase() || 'GENERAL').slice(0, 16)
}

function parseGenericCourse(value: string): { code?: string; name?: string } {
  const split = value.match(/^\s*([A-Za-z]{1,10}[- ]?\d{1,6}[A-Za-z]?)\s*[-:|]\s*(.+)$/)
  if (split?.[1] && split[2]) return { code: split[1].trim(), name: split[2].trim() }
  if (!value.includes(' ') && value.length <= 24) return { code: value, name: value }
  return { name: value }
}

function evidenceFor(index: IndexedRecord, source: string): string[] {
  const columns = [...index.values()]
    .filter((entry) => toText(entry.value) !== undefined)
    .map((entry) => entry.key)
    .slice(0, 8)
  return [`${source}: ${columns.length > 0 ? columns.join(', ') : 'structured record'}`]
}

function createState(): BuildState {
  return {
    courses: new Map(),
    tasks: [],
    warnings: new Set(),
    defaultedMinutes: 0,
    derivedCourseCodes: 0,
    invalidDeadlines: 0,
    invalidNumbers: 0,
  }
}

function upsertCourse(state: BuildState, course: CourseDraft): void {
  const key = course.code.trim().toLowerCase()
  const existing = state.courses.get(key)
  if (!existing) {
    state.courses.set(key, course)
    return
  }

  state.courses.set(key, {
    ...existing,
    name: existing.name === existing.code && course.name !== course.code ? course.name : existing.name,
    currentScore: existing.currentScore ?? course.currentScore,
    targetScore: existing.targetScore ?? course.targetScore,
    confidence: Math.max(existing.confidence, course.confidence),
    evidence: [...new Set([...existing.evidence, ...course.evidence])],
  })
}

function courseIdentity(
  index: IndexedRecord,
  state: BuildState,
): { code?: string; name?: string; derived: boolean } {
  let code = toText(read(index, courseCodeAliases)?.value)
  let name = toText(read(index, courseNameAliases)?.value)
  const generic = toText(read(index, genericCourseAliases)?.value)

  if (generic && (!code || !name)) {
    const parsed = parseGenericCourse(generic)
    code ??= parsed.code
    name ??= parsed.name
  }

  let derived = false
  if (!code && name) {
    code = deriveCourseCode(name)
    derived = true
    state.derivedCourseCodes += 1
  }
  if (code && !name) name = code
  return { code, name, derived }
}

function addCourseRecord(record: UnknownRecord, source: string, state: BuildState): { code?: string; name?: string } {
  const index = indexRecord(record)
  let identity = courseIdentity(index, state)
  const genericName = toText(index.get('name')?.value)
  const recordId = toText(index.get('id')?.value)
  if (recordId && !read(index, courseCodeAliases)) {
    if (identity.derived && identity.code) {
      state.derivedCourseCodes = Math.max(0, state.derivedCourseCodes - 1)
    }
    identity = { code: recordId, name: genericName ?? identity.name ?? recordId, derived: false }
  } else if (!identity.code && !identity.name && genericName) {
    identity = { code: deriveCourseCode(genericName), name: genericName, derived: true }
    state.derivedCourseCodes += 1
  } else if (identity.code && genericName && (!identity.name || identity.name === identity.code)) {
    identity = { ...identity, name: genericName }
  }
  if (!identity.code || !identity.name) return identity

  upsertCourse(state, {
    code: identity.code,
    name: identity.name,
    currentScore: boundedNumber(read(index, currentScoreAliases)?.value, 0, 100, state),
    targetScore: boundedNumber(read(index, targetScoreAliases)?.value, 0, 100, state),
    confidence: identity.derived ? 0.78 : 0.96,
    evidence: evidenceFor(index, source),
  })
  return identity
}

function addGenericRecord(record: UnknownRecord, source: string, state: BuildState): void {
  const index = indexRecord(record)
  const hasCourseCode = Boolean(read(index, courseCodeAliases))
  const hasGenericName = Boolean(toText(index.get('name')?.value))
  const hasExplicitTaskTitle = Boolean(read(index, taskTitleAliases))
  const hasTaskMetadata = Boolean(
    read(index, dueAtAliases)
    || read(index, weightAliases)
    || read(index, minutesAliases),
  )

  if (hasCourseCode && hasGenericName && !hasExplicitTaskTitle && !hasTaskMetadata) {
    addCourseRecord(record, source, state)
    return
  }
  addTaskRecord(record, source, state, { allowNameAsTitle: true })
}

function parseDueAt(value: unknown, state: BuildState): string | null {
  const text = toText(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  if (Number.isNaN(timestamp)) {
    state.invalidDeadlines += 1
    return null
  }
  return new Date(timestamp).toISOString()
}

function addTaskRecord(
  record: UnknownRecord,
  source: string,
  state: BuildState,
  options: { allowNameAsTitle?: boolean; fallbackCourse?: { code?: string; name?: string } } = {},
): void {
  const index = indexRecord(record)
  const titleAliases = options.allowNameAsTitle ? [...taskTitleAliases, 'name'] : taskTitleAliases
  const title = toText(read(index, titleAliases)?.value)

  if (!title) {
    addCourseRecord(record, source, state)
    return
  }

  let identity = courseIdentity(index, state)

  if (!identity.code && options.fallbackCourse?.code) {
    identity = {
      code: options.fallbackCourse.code,
      name: options.fallbackCourse.name ?? options.fallbackCourse.code,
      derived: false,
    }
  }

  if (!identity.code) {
    identity = { code: 'GENERAL', name: 'General', derived: true }
    state.derivedCourseCodes += 1
  }
  const courseCode = identity.code ?? 'GENERAL'
  const courseName = identity.name ?? courseCode
  upsertCourse(state, {
    code: courseCode,
    name: courseName,
    currentScore: boundedNumber(read(index, currentScoreAliases)?.value, 0, 100, state),
    targetScore: boundedNumber(read(index, targetScoreAliases)?.value, 0, 100, state),
    confidence: identity.derived ? 0.72 : 0.94,
    evidence: evidenceFor(index, source),
  })

  const estimateValue = read(index, minutesAliases)?.value
  const parsedEstimate = toNumber(estimateValue)
  const estimatedMinutes = parsedEstimate !== undefined
    && Number.isInteger(parsedEstimate)
    && parsedEstimate >= 5
    && parsedEstimate <= 1440
    ? parsedEstimate
    : 45
  if (estimatedMinutes === 45 && parsedEstimate !== 45) state.defaultedMinutes += 1

  state.tasks.push({
    courseCode,
    title,
    dueAt: parseDueAt(read(index, dueAtAliases)?.value, state),
    gradeWeight: boundedNumber(read(index, weightAliases)?.value, 0, 100, state),
    estimatedMinutes,
    confidence: identity.derived ? 0.74 : 0.95,
    evidence: evidenceFor(index, source),
  })
}

function finish(state: BuildState, provider: StructuredImportResult['provider']): StructuredImportResult | null {
  if (state.courses.size === 0 && state.tasks.length === 0) return null

  if (state.defaultedMinutes > 0) {
    state.warnings.add(`${state.defaultedMinutes} task(s) had no valid duration; 45 minutes was proposed for review.`)
  }
  if (state.derivedCourseCodes > 0) {
    state.warnings.add(`${state.derivedCourseCodes} course reference(s) needed a generated code; review the highlighted course fields.`)
  }
  if (state.invalidDeadlines > 0) {
    state.warnings.add(`${state.invalidDeadlines} deadline value(s) could not be parsed and were left unknown.`)
  }
  if (state.invalidNumbers > 0) {
    state.warnings.add(`${state.invalidNumbers} score or weight value(s) were outside the supported range and were left unknown.`)
  }

  return {
    provider,
    extraction: DocumentExtractionSchema.parse({
      courses: [...state.courses.values()],
      tasks: state.tasks,
      warnings: [...state.warnings],
    }),
  }
}

function extractCsv(content: Buffer): StructuredImportResult | null {
  let rows: unknown
  try {
    rows = parse(content.toString('utf8'), {
      bom: true,
      columns: true,
      delimiter: [',', ';', '\t'],
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    })
  } catch {
    throw new StructuredImportError(
      'INVALID_CSV',
      'The CSV file could not be read. Check that it has one header row and a consistent delimiter.',
    )
  }

  if (!Array.isArray(rows)) return null
  const state = createState()
  rows.forEach((row, index) => {
    if (isRecord(row)) addTaskRecord(row, `CSV row ${index + 2}`, state)
  })
  return finish(state, 'structured-csv')
}

function addNestedCourse(record: UnknownRecord, index: number, state: BuildState): void {
  const source = `JSON course ${index + 1}`
  const identity = addCourseRecord(record, source, state)
  const tasks = readArray(record, ['tasks', 'assignments', 'assessments', 'activities', 'deadlines', 'bai_tap'])
  tasks?.forEach((task, taskIndex) => {
    if (isRecord(task)) {
      addTaskRecord(task, `${source}, task ${taskIndex + 1}`, state, {
        allowNameAsTitle: true,
        fallbackCourse: identity,
      })
    }
  })
}

function tableRows(record: UnknownRecord): UnknownRecord[] | undefined {
  const headers = readArray(record, ['headers', 'columns'])
  const rows = readArray(record, ['rows', 'data'])
  if (!headers || !rows || !headers.every((header) => typeof header === 'string')) return undefined

  return rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header as string, row[index]])))
}

function extractJsonValue(value: unknown, format: 'json' | 'jsonl'): StructuredImportResult | null {
  if (format === 'json') {
    const direct = DocumentExtractionSchema.safeParse(value)
    if (direct.success) return { provider: 'structured-json', extraction: direct.data }
  }

  const state = createState()
  if (Array.isArray(value)) {
    value.forEach((record, index) => {
      if (isRecord(record)) addGenericRecord(record, `JSON row ${index + 1}`, state)
    })
    return finish(state, `structured-${format}`)
  }
  if (!isRecord(value)) return null

  const tabular = tableRows(value)
  if (tabular) {
    tabular.forEach((record, index) => addGenericRecord(record, `JSON row ${index + 1}`, state))
  }

  const courses = readArray(value, ['courses', 'subjects', 'modules', 'classes', 'mon_hoc'])
  courses?.forEach((course, index) => {
    if (isRecord(course)) addNestedCourse(course, index, state)
  })

  const tasks = readArray(value, ['tasks', 'assignments', 'assessments', 'activities', 'deadlines', 'bai_tap'])
  tasks?.forEach((task, index) => {
    if (isRecord(task)) addTaskRecord(task, `JSON task ${index + 1}`, state, { allowNameAsTitle: true })
  })

  const rows = readArray(value, ['data', 'records', 'items'])
  rows?.forEach((row, index) => {
    if (isRecord(row)) addGenericRecord(row, `JSON row ${index + 1}`, state)
  })

  if (!tabular && !courses && !tasks && !rows) {
    addGenericRecord(value, 'JSON record', state)
  }
  return finish(state, `structured-${format}`)
}

function extractJson(content: Buffer, format: 'json' | 'jsonl'): StructuredImportResult | null {
  const text = content.toString('utf8').replace(/^\uFEFF/, '').trim()
  try {
    if (format === 'jsonl') {
      const values = text
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as unknown)
      return extractJsonValue(values, format)
    }
    return extractJsonValue(JSON.parse(text) as unknown, format)
  } catch (error) {
    if (error instanceof StructuredImportError) throw error
    throw new StructuredImportError(
      'INVALID_JSON',
      `The ${format.toUpperCase()} file could not be read. Check that its structure is valid.`,
    )
  }
}

function detectFormat(filename: string, mimeType: string): StructuredFormat | undefined {
  const lowerFilename = filename.toLowerCase()
  const normalizedMime = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  if (lowerFilename.endsWith('.jsonl') || normalizedMime === 'application/x-ndjson') return 'jsonl'
  if (
    lowerFilename.endsWith('.json')
    || normalizedMime === 'application/json'
    || normalizedMime === 'text/json'
  ) return 'json'
  if (
    lowerFilename.endsWith('.csv')
    || normalizedMime === 'text/csv'
    || normalizedMime === 'application/csv'
  ) return 'csv'
  return undefined
}

export function extractStructuredDocument(input: {
  filename: string
  mimeType: string
  content: Buffer
}): StructuredImportResult | null {
  const format = detectFormat(input.filename, input.mimeType)
  if (format === 'csv') return extractCsv(input.content)
  if (format === 'json' || format === 'jsonl') return extractJson(input.content, format)
  return null
}
