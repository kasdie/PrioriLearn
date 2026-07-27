import { useMemo, useState } from 'react'
import { Check, CircleAlert, FileSearch } from 'lucide-react'
import type { DocumentExtraction } from '../../lib/api'

type Props = {
  extraction: DocumentExtraction
  busy: boolean
  onChange: (extraction: DocumentExtraction) => void
  onConfirm: () => void
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return 'High confidence'
  if (confidence >= 0.6) return 'Needs a check'
  return 'Low confidence'
}

function toLocalInput(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 16) : ''
}

function Evidence({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="review-evidence empty">No source evidence supplied</span>
  return <span className="review-evidence">{items.join(' · ')}</span>
}

export function ExtractionReviewEditor({ extraction, busy, onChange, onConfirm }: Props) {
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<Set<string>>(() => new Set())
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
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
      setValidationMessage('Complete the required course and task fields before confirming.')
      return
    }
    if (!warningsAcknowledged) {
      setValidationMessage('Acknowledge each warning before confirming this import.')
      return
    }
    setValidationMessage(null)
    onConfirm()
  }

  return <section className="extraction-editor" aria-label="Extraction review">
    <div className="review-summary"><FileSearch size={19} /><div><strong>Review extracted study data</strong><p>Unknown values stay unknown. Only the fields below are added after confirmation.</p></div></div>
    <div className="extraction-section">
      <div className="extraction-section-heading"><h3>Courses</h3><span>{extraction.courses.length}</span></div>
      {extraction.courses.map((course, index) => <article className="extraction-row" key={`${course.code}-${index}`}>
        <div className="extraction-fields two-columns">
          <label>Course code<input required value={course.code} onChange={(event) => updateCourse(index, { code: event.target.value })} /></label>
          <label>Course name<input required value={course.name} onChange={(event) => updateCourse(index, { name: event.target.value })} /></label>
          <label>Current score
            <select value={course.currentScore === null ? 'unknown' : 'value'} onChange={(event) => updateCourse(index, { currentScore: event.target.value === 'unknown' ? null : 0 })}>
              <option value="unknown">Unknown</option><option value="value">Known value</option>
            </select>
            {course.currentScore !== null && <input aria-label={`Current score value for ${course.code || `course ${index + 1}`}`} type="number" min="0" max="100" value={course.currentScore} onChange={(event) => updateCourse(index, { currentScore: event.target.value === '' ? null : Number(event.target.value) })} />}
          </label>
          <label>Target score
            <select value={course.targetScore === null ? 'unknown' : 'value'} onChange={(event) => updateCourse(index, { targetScore: event.target.value === 'unknown' ? null : 0 })}>
              <option value="unknown">Unknown</option><option value="value">Known value</option>
            </select>
            {course.targetScore !== null && <input aria-label={`Target score value for ${course.code || `course ${index + 1}`}`} type="number" min="0" max="100" value={course.targetScore} onChange={(event) => updateCourse(index, { targetScore: event.target.value === '' ? null : Number(event.target.value) })} />}
          </label>
        </div>
        <aside className="review-context"><span className={course.confidence >= .85 ? 'confidence high' : 'confidence'}>{confidenceLabel(course.confidence)} ({Math.round(course.confidence * 100)}%)</span><Evidence items={course.evidence} /></aside>
      </article>)}
    </div>
    <div className="extraction-section">
      <div className="extraction-section-heading"><h3>Tasks and deadlines</h3><span>{extraction.tasks.length}</span></div>
      {extraction.tasks.map((task, index) => <article className="extraction-row" key={`${task.title}-${index}`}>
        <div className="extraction-fields task-columns">
          <label>Course code<input required value={task.courseCode} onChange={(event) => updateTask(index, { courseCode: event.target.value })} /></label>
          <label>Task<input required value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} /></label>
          <label>Deadline
            <select value={task.dueAt === null ? 'unknown' : 'value'} onChange={(event) => updateTask(index, { dueAt: event.target.value === 'unknown' ? null : new Date().toISOString() })}>
              <option value="unknown">Unknown</option><option value="value">Known value</option>
            </select>
            {task.dueAt !== null && <input aria-label={`Deadline value for ${task.title || `task ${index + 1}`}`} type="datetime-local" value={toLocalInput(task.dueAt)} onChange={(event) => updateTask(index, { dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })} />}
          </label>
          <label>Grade weight
            <select value={task.gradeWeight === null ? 'unknown' : 'value'} onChange={(event) => updateTask(index, { gradeWeight: event.target.value === 'unknown' ? null : 0 })}>
              <option value="unknown">Unknown</option><option value="value">Known value</option>
            </select>
            {task.gradeWeight !== null && <input aria-label={`Grade weight value for ${task.title || `task ${index + 1}`}`} type="number" min="0" max="100" value={task.gradeWeight} onChange={(event) => updateTask(index, { gradeWeight: event.target.value === '' ? null : Number(event.target.value) })} />}
          </label>
          <label>Minutes<input required type="number" min="5" max="1440" value={task.estimatedMinutes} onChange={(event) => updateTask(index, { estimatedMinutes: Number(event.target.value) })} /></label>
        </div>
        <aside className="review-context"><span className={task.confidence >= .85 ? 'confidence high' : 'confidence'}>{confidenceLabel(task.confidence)} ({Math.round(task.confidence * 100)}%)</span><Evidence items={task.evidence} /></aside>
      </article>)}
    </div>
    {extraction.warnings.length > 0 && <fieldset className="review-warnings"><legend><CircleAlert size={17} /> Review warnings</legend>{extraction.warnings.map((warning) => <label key={warning}><input type="checkbox" checked={acknowledgedWarnings.has(warning)} onChange={(event) => setAcknowledgedWarnings((current) => { const next = new Set(current); if (event.target.checked) next.add(warning); else next.delete(warning); return next })} />{warning}</label>)}</fieldset>}
    {validationMessage && <p className="editor-validation" role="alert">{validationMessage}</p>}
    <div className="review-actions"><p>Confirmation writes the reviewed records in one transaction.</p><button className="primary-button" type="button" disabled={busy} aria-busy={busy} onClick={submit}><Check size={17} /> Confirm reviewed data</button></div>
  </section>
}
