import { CalendarDays, CircleAlert, Clock3, LockKeyhole } from 'lucide-react'
import type { ApiAvailabilityBlock, ApiPlan, ApiPlanningPreferences, ApiTask } from '../../lib/api'
import { isMissedPlanItem } from '../plan/planStatus'

type Locale = 'vi' | 'en'
type PlanItem = NonNullable<ApiPlan['items']>[number]

type Props = {
  plan: ApiPlan
  locale: Locale
  tasks: ApiTask[]
  availabilityBlocks: ApiAvailabilityBlock[]
  preferences: ApiPlanningPreferences | null
  onRecoverMissed: () => void
}

function zonedDayKey(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function WeeklyPlanBoard({ plan, locale, tasks, availabilityBlocks, preferences, onRecoverMissed }: Props) {
  const timezone = preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const items = [...(plan.items ?? [])].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
  const todayKey = zonedDayKey(new Date(), timezone)
  const firstItemKey = items[0] ? zonedDayKey(new Date(items[0].startsAt), timezone) : todayKey
  const boardStartKey = firstItemKey < todayKey ? firstItemKey : todayKey
  const days = Array.from({ length: 7 }, (_value, index) => addDays(boardStartKey, index))
  const groupedItems = items.reduce<Map<string, PlanItem[]>>((map, item) => {
    const key = zonedDayKey(new Date(item.startsAt), timezone)
    map.set(key, [...(map.get(key) ?? []), item])
    return map
  }, new Map())
  const groupedBusy = availabilityBlocks.reduce<Map<string, ApiAvailabilityBlock[]>>((map, block) => {
    const key = zonedDayKey(new Date(block.startsAt), timezone)
    map.set(key, [...(map.get(key) ?? []), block])
    return map
  }, new Map())
  const groupedDeadlines = tasks.filter((task) => task.status === 'confirmed' && task.dueAt).reduce<Map<string, ApiTask[]>>((map, task) => {
    const key = zonedDayKey(new Date(task.dueAt!), timezone)
    map.set(key, [...(map.get(key) ?? []), task])
    return map
  }, new Map())
  const dayFormatter = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'short', timeZone: 'UTC' })
  const dateFormatter = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const timeFormatter = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: timezone })

  return (
    <section className="weekly-plan" aria-label={locale === 'vi' ? 'Kế hoạch bảy ngày' : 'Seven-day plan'}>
      <div className="weekly-plan-heading"><CalendarDays size={18} /><div><strong>{locale === 'vi' ? 'Bảy ngày sắp tới' : 'Next seven days'}</strong><span>{locale === 'vi' ? `Phiên học, lịch bận và hạn nộp theo múi giờ ${timezone}.` : `Study blocks, busy time, and deadlines in ${timezone}.`}</span></div></div>
      <div className="weekly-grid">
        {days.map((key) => {
          const displayDate = new Date(`${key}T12:00:00.000Z`)
          const dayItems = groupedItems.get(key) ?? []
          const busy = groupedBusy.get(key) ?? []
          const deadlines = groupedDeadlines.get(key) ?? []
          const dayOfWeek = displayDate.getUTCDay()
          const freeWindows = preferences?.windows.filter((window) => window.dayOfWeek === dayOfWeek) ?? []
          const isToday = key === todayKey
          return <section className={isToday ? 'weekly-day today' : 'weekly-day'} key={key} aria-label={displayDate.toLocaleDateString()}>
            <header><span>{dayFormatter.format(displayDate)}</span><strong>{dateFormatter.format(displayDate)}</strong></header>
            <div className="weekly-day-context">
              {freeWindows.map((window, index) => <span className="weekly-free" key={`${key}-${index}`}>{minuteLabel(window.startMinute)}-{minuteLabel(window.endMinute)}</span>)}
              {busy.map((block) => <span className="weekly-busy" key={block.id}><LockKeyhole size={10} /> {timeFormatter.format(new Date(block.startsAt))}-{timeFormatter.format(new Date(block.endsAt))} {block.title}</span>)}
              {deadlines.map((task) => <span className="weekly-deadline" key={task.id}><CircleAlert size={10} /> {timeFormatter.format(new Date(task.dueAt!))} {task.title}</span>)}
            </div>
            <div className="weekly-day-body">
              {dayItems.length === 0 ? <span className="weekly-empty">{locale === 'vi' ? 'Không có phiên học' : 'No study blocks'}</span> : dayItems.map((item) => {
                const task = taskById.get(item.taskId)
                const taskName = task?.title ?? (locale === 'vi' ? 'Nhiệm vụ đã xác nhận' : 'Confirmed task')
                const missed = isMissedPlanItem(item.endsAt, task?.status)
                return <article className={missed ? 'weekly-block missed' : 'weekly-block'} key={item.id}>
                  <span className="weekly-block-time"><Clock3 size={12} /> {timeFormatter.format(new Date(item.startsAt))}-{timeFormatter.format(new Date(item.endsAt))}</span>
                  <strong>{taskName}</strong>
                  <small>{item.minutes} {locale === 'vi' ? 'phút' : 'min'}</small>
                  <p>{item.firstStep}</p>
                  {missed && <button type="button" onClick={onRecoverMissed}><CircleAlert size={13} /> {locale === 'vi' ? 'Xếp lại' : 'Recover'}</button>}
                </article>
              })}
            </div>
          </section>
        })}
      </div>
    </section>
  )
}
