import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ApiLearnerProfile, ApiLearnerSignal } from '../../lib/api'

type Locale = 'vi' | 'en'

type Props = {
  locale: Locale
  profile: ApiLearnerProfile
  busy: boolean
  onSave: (signals: ApiLearnerSignal[]) => Promise<void>
}

const signalCopy: Record<ApiLearnerSignal['kind'], Record<Locale, { label: string; placeholder: string }>> = {
  focus_duration: {
    vi: { label: 'Thời lượng tập trung', placeholder: 'Ví dụ: 25 phút' },
    en: { label: 'Focus length', placeholder: 'For example: 25 minutes' },
  },
  study_window: {
    vi: { label: 'Khoảng thời gian học', placeholder: 'Ví dụ: Buổi tối thường dễ tập trung' },
    en: { label: 'Study window', placeholder: 'For example: I focus best in the evening' },
  },
  friction_pattern: {
    vi: { label: 'Trở ngại thường gặp', placeholder: 'Ví dụ: Khó bắt đầu khi task quá lớn' },
    en: { label: 'Common friction', placeholder: 'For example: I stall when a task feels too large' },
  },
  coach_preference: {
    vi: { label: 'Cách Priori hỗ trợ', placeholder: 'Ví dụ: Nhắc tôi bằng một bước đầu tiên rất nhỏ' },
    en: { label: 'Coach preference', placeholder: 'For example: Give me one very small first step' },
  },
}

function newSignal(): ApiLearnerSignal {
  return {
    id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    kind: 'focus_duration',
    value: '',
  }
}

export function LearnerProfilePanel({ locale, profile, busy, onSave }: Props) {
  const [signals, setSignals] = useState<ApiLearnerSignal[]>(profile.signals)

  useEffect(() => {
    setSignals(profile.signals)
  }, [profile.version, profile.signals])

  const invalid = signals.some((signal) => !signal.value.trim())
  const canSave = !busy && !invalid && (profile.version > 0 || signals.length > 0)
  const copy = locale === 'vi'
    ? {
      title: 'Hồ sơ học tập',
      detail: 'Chỉ các tín hiệu bạn lưu mới được dùng trong đề xuất của Priori. Chúng không tự động thay đổi kế hoạch.',
      empty: 'Chưa có tín hiệu nào. Thêm một sở thích để Priori có thêm ngữ cảnh.',
      add: 'Thêm tín hiệu',
      save: 'Lưu hồ sơ',
      remove: 'Xóa tín hiệu',
    }
    : {
      title: 'Learner profile',
      detail: 'Only signals you save are included in Coach proposals. They never change a plan automatically.',
      empty: 'No signals saved yet. Add a preference to give Coach more context.',
      add: 'Add signal',
      save: 'Save profile',
      remove: 'Remove signal',
    }

  const save = async () => {
    if (!canSave) return
    await onSave(signals.map((signal) => ({ ...signal, value: signal.value.trim() })))
  }

  return (
    <section className="settings-panel learner-profile-panel" aria-labelledby="learner-profile-title">
      <div className="settings-panel-heading">
        <div>
          <h2 id="learner-profile-title">{copy.title}</h2>
          <p>{copy.detail}</p>
        </div>
      </div>
      {signals.length === 0 ? <p className="learner-profile-empty">{copy.empty}</p> : <div className="learner-signal-list">
        {signals.map((signal) => {
          const text = signalCopy[signal.kind][locale]
          return <div className="learner-signal-row" key={signal.id}>
            <label>
              <span>{text.label}</span>
              <select
                aria-label={text.label}
                disabled={busy}
                value={signal.kind}
                onChange={(event) => setSignals((current) => current.map((item) => item.id === signal.id ? { ...item, kind: event.target.value as ApiLearnerSignal['kind'] } : item))}
              >
                {(Object.keys(signalCopy) as ApiLearnerSignal['kind'][]).map((kind) => <option key={kind} value={kind}>{signalCopy[kind][locale].label}</option>)}
              </select>
            </label>
            <label>
              <span className="visually-hidden">{text.label}</span>
              <input
                aria-label={`${text.label} value`}
                disabled={busy}
                maxLength={180}
                placeholder={text.placeholder}
                value={signal.value}
                onChange={(event) => setSignals((current) => current.map((item) => item.id === signal.id ? { ...item, value: event.target.value } : item))}
              />
            </label>
            <button
              className="mini-action learner-signal-delete"
              type="button"
              title={copy.remove}
              aria-label={copy.remove}
              disabled={busy}
              onClick={() => setSignals((current) => current.filter((item) => item.id !== signal.id))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        })}
      </div>}
      <div className="learner-profile-actions">
        <button className="text-button" type="button" disabled={busy || signals.length >= 12} onClick={() => setSignals((current) => [...current, newSignal()])}>
          <Plus size={16} /> {copy.add}
        </button>
        <button className="secondary-button" type="button" disabled={!canSave} aria-busy={busy} onClick={() => void save()}>
          <Save size={16} /> {copy.save}
        </button>
      </div>
    </section>
  )
}
