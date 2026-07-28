import { CalendarDays, CircleAlert, Clock3 } from 'lucide-react'
import type { ApiPlan, ApiTask } from '../../lib/api'
import { isMissedPlanItem } from '../plan/planStatus'

type Locale = 'vi' | 'en'
type PlanItem = NonNullable<ApiPlan['items']>[number]

type Props = {
  plan: ApiPlan
  locale: Locale
  taskName: (taskId: string) => string
  taskStatus: (taskId: string) => ApiTask['status'] | undefined
  onRecoverMissed: () => void
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function WeeklyPlanBoard({ plan, locale, taskName, taskStatus, onRecoverMissed }: Props) {
  const items = [...(plan.items ?? [])].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
  const firstItemDate = items[0] ? startOfDay(new Date(items[0].startsAt)) : startOfDay(new Date())
  const today = startOfDay(new Date())
  const boardStart = firstItemDate < today ? firstItemDate : today
  const days = Array.from({ length: 7 }, (_value, index) => {
    const date = new Date(boardStart)
    date.setDate(boardStart.getDate() + index)
    return date
  })
  const grouped = items.reduce<Map<string, PlanItem[]>>((map, item) => {
    const key = dayKey(new Date(item.startsAt))
    map.set(key, [...(map.get(key) ?? []), item])
    return map
  }, new Map())
  const dayFormatter = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'short' })
  const dateFormatter = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit' })
  const timeFormatter = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' })

  return (
    <section className="weekly-plan" aria-label={locale === 'vi' ? 'Kế hoạch bảy ngày' : 'Seven-day plan'}>
      <div className="weekly-plan-heading"><CalendarDays size={18} /><div><strong>{locale === 'vi' ? 'Bảy ngày sắp tới' : 'Next seven days'}</strong><span>{locale === 'vi' ? 'Các phiên được đặt trong khung giờ rảnh đã xác nhận.' : 'Blocks are placed inside confirmed free windows.'}</span></div></div>
      <div className="weekly-grid">
        {days.map((day) => {
          const key = dayKey(day)
          const dayItems = grouped.get(key) ?? []
          const isToday = key === dayKey(today)
          return <section className={isToday ? 'weekly-day today' : 'weekly-day'} key={key} aria-label={day.toLocaleDateString()}>
            <header><span>{dayFormatter.format(day)}</span><strong>{dateFormatter.format(day)}</strong></header>
            <div className="weekly-day-body">
              {dayItems.length === 0 ? <span className="weekly-empty">{locale === 'vi' ? 'Không có phiên' : 'No blocks'}</span> : dayItems.map((item) => {
                const missed = isMissedPlanItem(item.endsAt, taskStatus(item.taskId))
                return <article className={missed ? 'weekly-block missed' : 'weekly-block'} key={item.id}>
                  <span className="weekly-block-time"><Clock3 size={12} /> {timeFormatter.format(new Date(item.startsAt))}-{timeFormatter.format(new Date(item.endsAt))}</span>
                  <strong>{taskName(item.taskId)}</strong>
                  <small>{item.minutes} {locale === 'vi' ? 'phút' : 'min'}</small>
                  <p>{locale === 'vi' ? `Mở ${taskName(item.taskId)} và hoàn thành yêu cầu cụ thể đầu tiên.` : `Open ${taskName(item.taskId)} and complete the first concrete requirement.`}</p>
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
