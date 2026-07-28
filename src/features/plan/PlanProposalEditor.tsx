import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Save, Trash2 } from 'lucide-react'
import { prioriApi, type ApiPlan } from '../../lib/api'

type PlanItem = NonNullable<ApiPlan['items']>[number]
type PlanEditorApi = Pick<typeof prioriApi, 'editPlan'>

type PlanProposalEditorProps = {
  plan: ApiPlan
  locale: 'vi' | 'en'
  taskName: (taskId: string) => string
  onSaved: (plan: ApiPlan) => void
  api?: PlanEditorApi
}

function localDateTimeValue(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function withTiming(item: PlanItem, startsAt: string, minutes: number): PlanItem {
  const start = new Date(startsAt)
  return {
    ...item,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    minutes,
  }
}

export function PlanProposalEditor({ plan, locale, taskName, onSaved, api = prioriApi }: PlanProposalEditorProps) {
  const [items, setItems] = useState<PlanItem[]>(plan.items ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = locale === 'vi'
    ? {
      aria: 'Trình chỉnh sửa đề xuất kế hoạch', failed: 'Chưa lưu được đề xuất', retained: 'Các chỉnh sửa hiện tại vẫn được giữ.',
      block: 'Phiên', start: 'Bắt đầu', minutes: 'Số phút', reorder: 'Sắp xếp lại', earlier: 'Đưa lên trước', later: 'Đưa xuống sau',
      remove: 'Xóa phiên', note: 'Mỗi lần lưu sẽ tạo một phiên bản đề xuất mới. Chưa có gì được duyệt.', save: 'Lưu chỉnh sửa',
    }
    : {
      aria: 'Plan proposal editor', failed: 'The proposal was not saved', retained: 'Your current edit is still available.',
      block: 'Block', start: 'Start', minutes: 'Minutes', reorder: 'Reorder', earlier: 'Move earlier', later: 'Move later',
      remove: 'Remove block', note: 'Saving creates a new proposal version. Nothing is approved yet.', save: 'Save edits',
    }

  useEffect(() => {
    setItems(plan.items ?? [])
    setError(null)
  }, [plan.id, plan.items])

  const update = (index: number, item: PlanItem) => {
    setItems((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? item : candidate))
  }

  const move = (index: number, direction: -1 | 1) => {
    setItems((current) => {
      const destination = index + direction
      if (destination < 0 || destination >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (!item) return current
      next.splice(destination, 0, item)
      return next
    })
  }

  const save = async () => {
    if (busy || items.length === 0) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.editPlan(plan, items, locale))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${text.failed}. ${text.retained}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="proposal-editor" aria-label={text.aria}>
      {error && <div className="inline-alert" role="alert"><div><strong>{text.failed}</strong><p>{error} {text.retained}</p></div></div>}
      <div className="proposal-editor-list">
        {items.map((item, index) => (
          <article className="proposal-editor-row" key={item.id}>
            <div className="proposal-editor-title"><span>{text.block} {index + 1}</span><strong>{taskName(item.taskId)}</strong></div>
            <label>{text.start}<input aria-label={`${text.start} ${taskName(item.taskId)}`} type="datetime-local" value={localDateTimeValue(item.startsAt)} onChange={(event) => update(index, withTiming(item, event.target.value, item.minutes))} /></label>
            <label>{text.minutes}<input aria-label={`${text.minutes} ${taskName(item.taskId)}`} type="number" min="5" max="720" step="5" value={item.minutes} onChange={(event) => update(index, withTiming(item, item.startsAt, Number(event.target.value)))} /></label>
            <div className="proposal-editor-actions" aria-label={`${text.reorder} ${taskName(item.taskId)}`}>
              <button className="icon-button" type="button" title={text.earlier} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
              <button className="icon-button" type="button" title={text.later} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
              <button className="icon-button danger-icon" type="button" title={text.remove} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}><Trash2 size={17} /></button>
            </div>
          </article>
        ))}
      </div>
      <div className="proposal-editor-save"><span>{text.note}</span><button className="secondary-button" type="button" disabled={busy || items.length === 0} aria-busy={busy} onClick={() => void save()}><Save size={17} /> {text.save}</button></div>
    </section>
  )
}
