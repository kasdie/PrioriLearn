import { useEffect, useMemo, useState } from 'react'
import { Check, Clock3, LoaderCircle, MessageSquareText, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import {
  ApiClientError,
  prioriApi,
  type ApiPlanningDraft,
  type ApiPlanningMessage,
  type ApiPlanningPreferences,
  type ApiStudyWindow,
} from '../../lib/api'

type Locale = 'vi' | 'en'

type Props = {
  locale: Locale
  onSaved: (preferences: ApiPlanningPreferences) => void
}

const orderedDays = [1, 2, 3, 4, 5, 6, 0]

function initialDraft(locale: Locale): ApiPlanningDraft {
  return {
    locale,
    coachMode: 'focus',
    dailyMinutes: 120,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
    windows: [],
  }
}

function minuteValue(value: number): string {
  const safeValue = Math.max(0, Math.min(1439, value))
  const hours = Math.floor(safeValue / 60).toString().padStart(2, '0')
  const minutes = (safeValue % 60).toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

function parseMinuteValue(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return Math.max(0, Math.min(1439, (hours ?? 0) * 60 + (minutes ?? 0)))
}

function sortWindows(windows: ApiStudyWindow[]): ApiStudyWindow[] {
  return [...windows].sort((left, right) => {
    const leftDay = orderedDays.indexOf(left.dayOfWeek)
    const rightDay = orderedDays.indexOf(right.dayOfWeek)
    return leftDay - rightDay || left.startMinute - right.startMinute
  })
}

export function PlanningAssistant({ locale, onSaved }: Props) {
  const [preferences, setPreferences] = useState<ApiPlanningPreferences | null>(null)
  const [draft, setDraft] = useState<ApiPlanningDraft>(() => initialDraft(locale))
  const [messages, setMessages] = useState<ApiPlanningMessage[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [chatBusy, setChatBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const text = locale === 'vi'
    ? {
      eyebrow: 'Trao đổi trước khi xếp lịch',
      title: 'Bạn rảnh khi nào trong tuần?',
      detail: 'Priori dùng cuộc trao đổi này để tạo bản nháp. Chỉ các khung giờ bạn lưu mới được dùng để xếp kế hoạch.',
      greeting: 'Bạn có thể nói lịch rảnh và mức năng lượng của mình, ví dụ: “Tôi rảnh 19:00-21:00 thứ Hai, Tư, Sáu và muốn học vừa sức”.',
      placeholder: 'Mô tả thời gian rảnh hoặc khối lượng bạn muốn...',
      messageLabel: 'Tin nhắn về thời gian rảnh và khối lượng học',
      send: 'Gửi cho Priori',
      intensity: 'Cường độ',
      gentle: 'Nhẹ',
      focus: 'Vừa',
      discipline: 'Cao',
      dailyLimit: 'Tối đa mỗi ngày',
      minutes: 'phút',
      freeWindows: 'Khung giờ rảnh đã chọn',
      noWindow: 'Chưa chọn',
      addWindow: 'Thêm khung giờ',
      removeWindow: 'Xóa khung giờ',
      startTime: 'Giờ bắt đầu',
      endTime: 'Giờ kết thúc',
      save: 'Lưu lịch rảnh',
      saved: 'Đã lưu',
      loading: 'Đang tải cấu hình lịch...',
      chooseWindow: 'Hãy chọn ít nhất một khung giờ rảnh trước khi lưu.',
      loadError: 'Chưa thể tải cấu hình lịch. Hãy thử lại.',
      chatError: 'Priori chưa thể trả lời. Nội dung bạn nhập vẫn được giữ lại.',
      saveError: 'Chưa thể lưu lịch rảnh. Bản nháp vẫn được giữ lại.',
      versionConflict: 'Lịch đã đổi ở một tab khác. Phiên bản mới nhất đã được tải lại.',
    }
    : {
      eyebrow: 'Talk before scheduling',
      title: 'When are you free this week?',
      detail: 'Priori uses this conversation to prepare a draft. Only windows you save are used to build a plan.',
      greeting: 'Tell me about your free time and energy, for example: “I am free 19:00-21:00 Monday, Wednesday, Friday and want a moderate pace.”',
      placeholder: 'Describe your free time or preferred workload...',
      messageLabel: 'Message about free time and study workload',
      send: 'Send to Priori',
      intensity: 'Intensity',
      gentle: 'Gentle',
      focus: 'Moderate',
      discipline: 'High',
      dailyLimit: 'Daily maximum',
      minutes: 'minutes',
      freeWindows: 'Selected free windows',
      noWindow: 'Not selected',
      addWindow: 'Add window',
      removeWindow: 'Remove window',
      startTime: 'Start time',
      endTime: 'End time',
      save: 'Save availability',
      saved: 'Saved',
      loading: 'Loading schedule settings...',
      chooseWindow: 'Choose at least one free window before saving.',
      loadError: 'Schedule settings could not be loaded. Try again.',
      chatError: 'Priori could not reply yet. Your message is still here.',
      saveError: 'Availability could not be saved. Your draft is still here.',
      versionConflict: 'The schedule changed in another tab. The latest version was loaded.',
    }

  useEffect(() => {
    let active = true
    setLoading(true)
    void prioriApi.planningPreferences()
      .then((stored) => {
        if (!active) return
        setPreferences(stored)
        setDraft(stored
          ? {
            locale,
            coachMode: stored.coachMode,
            dailyMinutes: stored.dailyMinutes,
            timezone: stored.timezone,
            utcOffsetMinutes: stored.utcOffsetMinutes,
            windows: sortWindows(stored.windows),
          }
          : initialDraft(locale))
      })
      .catch(() => {
        if (active) setError(text.loadError)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [locale, text.loadError])

  useEffect(() => {
    setMessages([{ role: 'assistant', content: text.greeting }])
    setDraft((current) => ({ ...current, locale }))
    setMessage('')
  }, [locale, text.greeting])

  const dayFormatter = useMemo(() => new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'long' }), [locale])
  const dayLabel = (dayOfWeek: number) => {
    const referenceSunday = new Date(2026, 0, 4)
    referenceSunday.setDate(referenceSunday.getDate() + dayOfWeek)
    return dayFormatter.format(referenceSunday)
  }

  const windowsForDay = (dayOfWeek: number) => draft.windows
    .map((window, index) => ({ window, index }))
    .filter(({ window }) => window.dayOfWeek === dayOfWeek)

  const toggleDay = (dayOfWeek: number, enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      windows: enabled
        ? sortWindows([...current.windows, { dayOfWeek, startMinute: 19 * 60, endMinute: 21 * 60 }])
        : current.windows.filter((window) => window.dayOfWeek !== dayOfWeek),
    }))
  }

  const updateWindow = (index: number, patch: Partial<ApiStudyWindow>) => {
    setDraft((current) => ({
      ...current,
      windows: sortWindows(current.windows.map((window, candidateIndex) => candidateIndex === index ? { ...window, ...patch } : window)),
    }))
  }

  const addWindow = (dayOfWeek: number) => {
    const dayWindows = windowsForDay(dayOfWeek)
    const lastEnd = dayWindows.at(-1)?.window.endMinute ?? 18 * 60
    const startMinute = lastEnd + (dayWindows.length ? 30 : 0)
    const endMinute = Math.min(startMinute + 60, 1439)
    if (endMinute <= startMinute) return
    setDraft((current) => ({ ...current, windows: sortWindows([...current.windows, { dayOfWeek, startMinute, endMinute }]) }))
  }

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = message.trim()
    if (!content || chatBusy) return
    const userMessage: ApiPlanningMessage = { role: 'user', content }
    setMessages((current) => [...current, userMessage])
    setMessage('')
    setChatBusy(true)
    setError(null)
    try {
      const reply = await prioriApi.planningChat({
        message: content,
        history: messages.slice(-10),
        locale,
        draft: { ...draft, locale },
      })
      setMessages((current) => [...current, { role: 'assistant', content: reply.message }])
      setDraft({ ...reply.draft, locale, windows: sortWindows(reply.draft.windows) })
    } catch {
      setMessage(content)
      setError(text.chatError)
    } finally {
      setChatBusy(false)
    }
  }

  const save = async () => {
    if (saveBusy) return
    if (draft.windows.length === 0) {
      setError(text.chooseWindow)
      return
    }
    if (draft.windows.some((window) => window.endMinute <= window.startMinute)) {
      setError(text.chooseWindow)
      return
    }
    setSaveBusy(true)
    setError(null)
    try {
      const saved = await prioriApi.updatePlanningPreferences(preferences?.version ?? 0, { ...draft, locale })
      setPreferences(saved)
      setDraft({
        locale,
        coachMode: saved.coachMode,
        dailyMinutes: saved.dailyMinutes,
        timezone: saved.timezone,
        utcOffsetMinutes: saved.utcOffsetMinutes,
        windows: sortWindows(saved.windows),
      })
      onSaved(saved)
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'PLANNING_PREFERENCES_VERSION_CONFLICT') {
        const latest = await prioriApi.planningPreferences().catch(() => null)
        if (latest) {
          setPreferences(latest)
          setDraft({
            locale,
            coachMode: latest.coachMode,
            dailyMinutes: latest.dailyMinutes,
            timezone: latest.timezone,
            utcOffsetMinutes: latest.utcOffsetMinutes,
            windows: sortWindows(latest.windows),
          })
        }
        setError(text.versionConflict)
      } else {
        setError(text.saveError)
      }
    } finally {
      setSaveBusy(false)
    }
  }

  if (loading) {
    return <section className="planning-assistant planning-loading" aria-live="polite"><LoaderCircle className="inline-spinner" size={19} /> {text.loading}</section>
  }

  return (
    <section className="planning-assistant" aria-labelledby="planning-assistant-title">
      <div className="planning-assistant-heading">
        <div>
          <p className="eyebrow"><Sparkles size={15} /> {text.eyebrow}</p>
          <h2 id="planning-assistant-title">{text.title}</h2>
          <p>{text.detail}</p>
        </div>
        {preferences && <span className="planning-saved"><Check size={14} /> {text.saved}</span>}
      </div>

      <div className="planning-intake-layout">
        <div className="planning-chat">
          <div className="planning-messages" aria-live="polite">
            {messages.map((item, index) => <div className={`planning-message ${item.role}`} key={`${item.role}-${index}`}><span>{item.role === 'assistant' && <Sparkles size={14} />}</span><p>{item.content}</p></div>)}
            {chatBusy && <div className="planning-message assistant"><span><LoaderCircle className="inline-spinner" size={14} /></span><p>...</p></div>}
          </div>
          <form className="planning-chat-form" onSubmit={(event) => void sendMessage(event)}>
            <MessageSquareText size={17} />
            <textarea aria-label={text.messageLabel} rows={2} maxLength={2000} value={message} placeholder={text.placeholder} onChange={(event) => setMessage(event.target.value)} />
            <button className="icon-button" type="submit" title={text.send} aria-label={text.send} disabled={chatBusy || !message.trim()}><Send size={17} /></button>
          </form>
        </div>

        <div className="planning-preferences">
          <div className="planning-setting-row">
            <span>{text.intensity}</span>
            <div className="planning-segmented" role="group" aria-label={text.intensity}>
              {(['gentle', 'focus', 'discipline'] as const).map((mode) => <button type="button" className={draft.coachMode === mode ? 'selected' : ''} aria-pressed={draft.coachMode === mode} key={mode} onClick={() => setDraft((current) => ({ ...current, coachMode: mode }))}>{text[mode]}</button>)}
            </div>
          </div>
          <label className="planning-daily-limit"><span>{text.dailyLimit}</span><input type="number" min="15" max="480" step="15" value={draft.dailyMinutes} onChange={(event) => setDraft((current) => ({ ...current, dailyMinutes: Number(event.target.value) }))} /><small>{text.minutes}</small></label>
          <div className="planning-window-heading"><Clock3 size={16} /><strong>{text.freeWindows}</strong><span>{draft.timezone}</span></div>
          <div className="planning-window-list">
            {orderedDays.map((dayOfWeek) => {
              const dayWindows = windowsForDay(dayOfWeek)
              return <div className="planning-day-row" key={dayOfWeek}>
                <label className="planning-day-toggle"><input type="checkbox" checked={dayWindows.length > 0} onChange={(event) => toggleDay(dayOfWeek, event.target.checked)} /><span>{dayLabel(dayOfWeek)}</span></label>
                <div className="planning-day-windows">
                  {dayWindows.length === 0 ? <span className="planning-no-window">{text.noWindow}</span> : dayWindows.map(({ window, index }) => <div className="planning-window-inputs" key={`${dayOfWeek}-${index}`}>
                    <input aria-label={`${dayLabel(dayOfWeek)}: ${text.startTime}`} type="time" value={minuteValue(window.startMinute)} onChange={(event) => updateWindow(index, { startMinute: parseMinuteValue(event.target.value) })} />
                    <span>-</span>
                    <input aria-label={`${dayLabel(dayOfWeek)}: ${text.endTime}`} type="time" value={minuteValue(window.endMinute)} onChange={(event) => updateWindow(index, { endMinute: parseMinuteValue(event.target.value) })} />
                    <button className="icon-button quiet" type="button" title={text.removeWindow} aria-label={text.removeWindow} onClick={() => setDraft((current) => ({ ...current, windows: current.windows.filter((_candidate, candidateIndex) => candidateIndex !== index) }))}><Trash2 size={14} /></button>
                  </div>)}
                  {dayWindows.length > 0 && dayWindows.length < 4 && (dayWindows.at(-1)?.window.endMinute ?? 1440) < 1409 && <button className="text-button planning-add-window" type="button" onClick={() => addWindow(dayOfWeek)}><Plus size={14} /> {text.addWindow}</button>}
                </div>
              </div>
            })}
          </div>
        </div>
      </div>
      {error && <p className="planning-error" role="alert">{error}</p>}
      <div className="planning-save-row"><span>{locale === 'vi' ? 'AI không thể tự lưu hoặc duyệt kế hoạch.' : 'AI cannot save or approve a plan by itself.'}</span><button className="primary-button" type="button" disabled={saveBusy || draft.windows.length === 0} aria-busy={saveBusy} onClick={() => void save()}><Check size={17} /> {text.save}</button></div>
    </section>
  )
}
