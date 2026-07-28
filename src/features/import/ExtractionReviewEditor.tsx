import { useMemo, useState } from 'react'
import { Check, CircleAlert, FileSearch } from 'lucide-react'
import type { DocumentExtraction } from '../../lib/api'

type Locale = 'vi' | 'en'

type Props = {
  locale: Locale
  extraction: DocumentExtraction
  busy: boolean
  onChange: (extraction: DocumentExtraction) => void
  onConfirm: () => void
}

function toLocalInput(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 16) : ''
}

export function ExtractionReviewEditor({ locale, extraction, busy, onChange, onConfirm }: Props) {
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<Set<string>>(() => new Set())
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const text = locale === 'vi'
    ? {
      aria: 'Xem lại dữ liệu trích xuất', title: 'Xem lại dữ liệu học tập đã trích xuất',
      detail: 'Giá trị chưa biết vẫn được để trống. Chỉ các trường bên dưới được thêm sau khi bạn xác nhận.',
      courses: 'Môn học', courseCode: 'Mã môn', courseName: 'Tên môn', currentScore: 'Điểm hiện tại', targetScore: 'Điểm mục tiêu',
      unknown: 'Chưa biết', known: 'Có giá trị', tasks: 'Nhiệm vụ và hạn nộp', task: 'Nhiệm vụ', deadline: 'Hạn nộp', weight: 'Trọng số điểm', minutes: 'Số phút',
      high: 'Độ tin cậy cao', check: 'Cần kiểm tra', low: 'Độ tin cậy thấp', noEvidence: 'Không có bằng chứng nguồn',
      warnings: 'Cảnh báo cần xem lại', required: 'Hãy điền đủ các trường bắt buộc của môn học và nhiệm vụ trước khi xác nhận.',
      acknowledge: 'Hãy đánh dấu đã xem từng cảnh báo trước khi xác nhận.', transaction: 'Xác nhận sẽ ghi toàn bộ dữ liệu đã duyệt trong một giao dịch.', confirm: 'Xác nhận dữ liệu đã duyệt',
    }
    : {
      aria: 'Extraction review', title: 'Review extracted study data',
      detail: 'Unknown values stay unknown. Only the fields below are added after confirmation.',
      courses: 'Courses', courseCode: 'Course code', courseName: 'Course name', currentScore: 'Current score', targetScore: 'Target score',
      unknown: 'Unknown', known: 'Known value', tasks: 'Tasks and deadlines', task: 'Task', deadline: 'Deadline', weight: 'Grade weight', minutes: 'Minutes',
      high: 'High confidence', check: 'Needs a check', low: 'Low confidence', noEvidence: 'No source evidence supplied',
      warnings: 'Review warnings', required: 'Complete the required course and task fields before confirming.',
      acknowledge: 'Acknowledge each warning before confirming this import.', transaction: 'Confirmation writes the reviewed records in one transaction.', confirm: 'Confirm reviewed data',
    }
  const confidenceLabel = (confidence: number) => confidence >= 0.85 ? text.high : confidence >= 0.6 ? text.check : text.low
  const evidence = (items: string[]) => items.length === 0
    ? <span className="review-evidence empty">{text.noEvidence}</span>
    : <span className="review-evidence">{items.join(' · ')}</span>
  const warningsAcknowledged = extraction.warnings.every((warning) => acknowledgedWarnings.has(warning))
  const requiredFieldsComplete = useMemo(() => (
    extraction.courses.every((course) => course.code.trim() && course.name.trim())
    && extraction.tasks.every((task) => task.courseCode.trim() && task.title.trim() && Number.isInteger(task.estimatedMinutes) && task.estimatedMinutes >= 5)
  ), [extraction])

  const updateCourse = (index: number, patch: Partial<DocumentExtraction['courses'][number]>) => {
    onChange({
      ...extraction,
      courses: extraction.courses.map((course, current) => current === index ? { ...course, ...patch } : course),
    })
  }
  const updateTask = (index: number, patch: Partial<DocumentExtraction['tasks'][number]>) => {
    onChange({
      ...extraction,
      tasks: extraction.tasks.map((task, current) => current === index ? { ...task, ...patch } : task),
    })
  }
  const submit = () => {
    if (!requiredFieldsComplete) {
      setValidationMessage(text.required)
      return
    }
    if (!warningsAcknowledged) {
      setValidationMessage(text.acknowledge)
      return
    }
    setValidationMessage(null)
    onConfirm()
  }

  return <section className="extraction-editor" aria-label={text.aria}>
    <div className="review-summary"><FileSearch size={19} /><div><strong>{text.title}</strong><p>{text.detail}</p></div></div>
    <div className="extraction-section">
      <div className="extraction-section-heading"><h3>{text.courses}</h3><span>{extraction.courses.length}</span></div>
      {extraction.courses.map((course, index) => <article className="extraction-row" key={`${course.code}-${index}`}>
        <div className="extraction-fields two-columns">
          <label>{text.courseCode}<input required value={course.code} onChange={(event) => updateCourse(index, { code: event.target.value })} /></label>
          <label>{text.courseName}<input required value={course.name} onChange={(event) => updateCourse(index, { name: event.target.value })} /></label>
          <label>{text.currentScore}
            <select value={course.currentScore === null ? 'unknown' : 'value'} onChange={(event) => updateCourse(index, { currentScore: event.target.value === 'unknown' ? null : 0 })}>
              <option value="unknown">{text.unknown}</option><option value="value">{text.known}</option>
            </select>
            {course.currentScore !== null && <input aria-label={`${text.currentScore}: ${course.code || index + 1}`} type="number" min="0" max="100" value={course.currentScore} onChange={(event) => updateCourse(index, { currentScore: event.target.value === '' ? null : Number(event.target.value) })} />}
          </label>
          <label>{text.targetScore}
            <select value={course.targetScore === null ? 'unknown' : 'value'} onChange={(event) => updateCourse(index, { targetScore: event.target.value === 'unknown' ? null : 0 })}>
              <option value="unknown">{text.unknown}</option><option value="value">{text.known}</option>
            </select>
            {course.targetScore !== null && <input aria-label={`${text.targetScore}: ${course.code || index + 1}`} type="number" min="0" max="100" value={course.targetScore} onChange={(event) => updateCourse(index, { targetScore: event.target.value === '' ? null : Number(event.target.value) })} />}
          </label>
        </div>
        <aside className="review-context"><span className={course.confidence >= .85 ? 'confidence high' : 'confidence'}>{confidenceLabel(course.confidence)} ({Math.round(course.confidence * 100)}%)</span>{evidence(course.evidence)}</aside>
      </article>)}
    </div>
    <div className="extraction-section">
      <div className="extraction-section-heading"><h3>{text.tasks}</h3><span>{extraction.tasks.length}</span></div>
      {extraction.tasks.map((task, index) => <article className="extraction-row" key={`${task.title}-${index}`}>
        <div className="extraction-fields task-columns">
          <label>{text.courseCode}<input required value={task.courseCode} onChange={(event) => updateTask(index, { courseCode: event.target.value })} /></label>
          <label>{text.task}<input required value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} /></label>
          <label>{text.deadline}
            <select value={task.dueAt === null ? 'unknown' : 'value'} onChange={(event) => updateTask(index, { dueAt: event.target.value === 'unknown' ? null : new Date().toISOString() })}>
              <option value="unknown">{text.unknown}</option><option value="value">{text.known}</option>
            </select>
            {task.dueAt !== null && <input aria-label={`${text.deadline}: ${task.title || index + 1}`} type="datetime-local" value={toLocalInput(task.dueAt)} onChange={(event) => updateTask(index, { dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })} />}
          </label>
          <label>{text.weight}
            <select value={task.gradeWeight === null ? 'unknown' : 'value'} onChange={(event) => updateTask(index, { gradeWeight: event.target.value === 'unknown' ? null : 0 })}>
              <option value="unknown">{text.unknown}</option><option value="value">{text.known}</option>
            </select>
            {task.gradeWeight !== null && <input aria-label={`${text.weight}: ${task.title || index + 1}`} type="number" min="0" max="100" value={task.gradeWeight} onChange={(event) => updateTask(index, { gradeWeight: event.target.value === '' ? null : Number(event.target.value) })} />}
          </label>
          <label>{text.minutes}<input required type="number" min="5" max="1440" value={task.estimatedMinutes} onChange={(event) => updateTask(index, { estimatedMinutes: Number(event.target.value) })} /></label>
        </div>
        <aside className="review-context"><span className={task.confidence >= .85 ? 'confidence high' : 'confidence'}>{confidenceLabel(task.confidence)} ({Math.round(task.confidence * 100)}%)</span>{evidence(task.evidence)}</aside>
      </article>)}
    </div>
    {extraction.warnings.length > 0 && <fieldset className="review-warnings"><legend><CircleAlert size={17} /> {text.warnings}</legend>{extraction.warnings.map((warning) => <label key={warning}><input type="checkbox" checked={acknowledgedWarnings.has(warning)} onChange={(event) => setAcknowledgedWarnings((current) => { const next = new Set(current); if (event.target.checked) next.add(warning); else next.delete(warning); return next })} />{warning}</label>)}</fieldset>}
    {validationMessage && <p className="editor-validation" role="alert">{validationMessage}</p>}
    <div className="review-actions"><p>{text.transaction}</p><button className="primary-button" type="button" disabled={busy} aria-busy={busy} onClick={submit}><Check size={17} /> {text.confirm}</button></div>
  </section>
}
