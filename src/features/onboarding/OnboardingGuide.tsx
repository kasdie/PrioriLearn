import { useEffect, useRef, type RefObject } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Focus,
  ListChecks,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import './OnboardingGuide.css'

export const ONBOARDING_GUIDE_VERSION = 1 as const

type Locale = 'vi' | 'en'

type OnboardingGuideProps = {
  locale: Locale
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onLocaleChange: (locale: Locale) => void
  onDismiss: () => void
  onStart: () => void
}

const guideCopy = {
  vi: {
    kicker: 'Thiết lập không gian học riêng',
    title: 'Bắt đầu với PrioriLearn',
    description: 'Năm bước dưới đây là vòng lặp bạn sẽ dùng để biến dữ liệu học tập thành một kế hoạch tuần có thể thực hiện.',
    columns: ['Bước', 'Bạn thực hiện', 'PrioriLearn hỗ trợ'],
    steps: [
      {
        title: 'Thêm dữ liệu',
        action: 'Tải đồng thời nhiều PDF, PNG, JPG, TXT, CSV, JSON, JSONL, ICS hoặc thêm nhiệm vụ thủ công.',
        support: 'Đọc từng tệp và tạo bản nháp có nguồn bằng chứng để bạn kiểm tra.',
      },
      {
        title: 'Xem lại',
        action: 'Sửa môn học, nhiệm vụ, hạn nộp, điểm số và xác nhận những gì chính xác.',
        support: 'Không đưa bất kỳ dữ liệu nào vào kế hoạch trước khi bạn xác nhận.',
      },
      {
        title: 'Cho biết thời gian',
        action: 'Chat về giờ rảnh, giới hạn học mỗi ngày và mức độ hỗ trợ bạn muốn.',
        support: 'Đề xuất khung học phù hợp với thời gian và khối lượng đã xác nhận.',
      },
      {
        title: 'Tạo kế hoạch tuần',
        action: 'Xem bảng 7 ngày, chỉnh giờ hoặc thời lượng, rồi phê duyệt phiên bản phù hợp.',
        support: 'Kiểm tra xung đột và giải thích đề xuất; AI không tự phê duyệt thay bạn.',
      },
      {
        title: 'Học và điều chỉnh',
        action: 'Dùng Hôm nay, Focus, Coach, check-in và replan khi tình hình thay đổi.',
        support: 'Giải thích ưu tiên, làm rõ hậu quả trì hoãn và luôn đưa thay đổi về cho bạn duyệt.',
      },
    ],
    trustTitle: 'AI đề xuất, bạn quyết định',
    trustBody: 'Dữ liệu và kế hoạch thuộc không gian riêng của bạn. PrioriLearn không tự xác nhận dữ liệu hoặc phê duyệt lịch học.',
    later: 'Để sau',
    start: 'Bắt đầu thêm dữ liệu',
    close: 'Đóng hướng dẫn',
    language: 'Ngôn ngữ hướng dẫn',
  },
  en: {
    kicker: 'Set up your private workspace',
    title: 'Get started with PrioriLearn',
    description: 'These five steps form the loop you will use to turn study data into a practical weekly plan.',
    columns: ['Step', 'What you do', 'How PrioriLearn helps'],
    steps: [
      {
        title: 'Add data',
        action: 'Upload multiple PDF, PNG, JPG, TXT, CSV, JSON, JSONL, or ICS files, or add a task manually.',
        support: 'Reads each file and creates an evidence-linked draft for you to inspect.',
      },
      {
        title: 'Review',
        action: 'Correct courses, tasks, deadlines, and scores, then confirm what is accurate.',
        support: 'Keeps every item out of planning until you explicitly confirm it.',
      },
      {
        title: 'Share your time',
        action: 'Chat about free time, your daily study limit, and the level of coaching you want.',
        support: 'Suggests study windows that fit your confirmed time and workload.',
      },
      {
        title: 'Build your week',
        action: 'Review the seven-day board, adjust times or duration, then approve the right version.',
        support: 'Checks conflicts and explains the proposal; AI never approves a plan for you.',
      },
      {
        title: 'Study and adapt',
        action: 'Use Today, Focus, Coach, check-ins, and replanning when circumstances change.',
        support: 'Explains priorities and delay consequences, and returns every schedule change for your approval.',
      },
    ],
    trustTitle: 'AI proposes, you decide',
    trustBody: 'Your data and plans stay in your private workspace. PrioriLearn never confirms data or approves a schedule on its own.',
    later: 'Maybe later',
    start: 'Start adding data',
    close: 'Close guide',
    language: 'Guide language',
  },
} as const

const stepIcons = [Upload, ListChecks, Clock3, CalendarDays, Focus]

export function OnboardingGuide({
  locale,
  returnFocusRef,
  onLocaleChange,
  onDismiss,
  onStart,
}: OnboardingGuideProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const dismissRef = useRef(onDismiss)
  const copy = guideCopy[locale]

  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const returnFocusTarget = returnFocusRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )]
    const frame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const targets = focusable()
      if (targets.length === 0) {
        event.preventDefault()
        return
      }
      const first = targets[0]
      const last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => returnFocusTarget?.focus())
    }
  }, [returnFocusRef])

  return (
    <div className="onboarding-backdrop">
      <section
        ref={dialogRef}
        className="onboarding-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-guide-title"
        aria-describedby="onboarding-guide-description"
      >
        <header className="onboarding-header">
          <div className="onboarding-heading">
            <span className="onboarding-kicker"><ShieldCheck size={15} /> {copy.kicker}</span>
            <h2 id="onboarding-guide-title">{copy.title}</h2>
            <p id="onboarding-guide-description">{copy.description}</p>
          </div>
          <div className="onboarding-header-actions">
            <div className="onboarding-language" aria-label={copy.language}>
              <button className={locale === 'vi' ? 'selected' : ''} type="button" onClick={() => onLocaleChange('vi')}>VI</button>
              <button className={locale === 'en' ? 'selected' : ''} type="button" onClick={() => onLocaleChange('en')}>EN</button>
            </div>
            <button
              className="onboarding-close"
              type="button"
              title={copy.close}
              aria-label={copy.close}
              data-autofocus
              onClick={onDismiss}
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="onboarding-table" role="table" aria-label={copy.title}>
          <div className="onboarding-table-head" role="row">
            {copy.columns.map((column) => <span key={column} role="columnheader">{column}</span>)}
          </div>
          <ol className="onboarding-steps" role="rowgroup">
            {copy.steps.map((step, index) => {
              const Icon = stepIcons[index]
              return (
                <li key={step.title} className={`onboarding-step step-${index + 1}`} role="row">
                  <div className="onboarding-step-title" role="cell">
                    <span className="onboarding-step-icon"><Icon size={18} /></span>
                    <span><small>{String(index + 1).padStart(2, '0')}</small><strong>{step.title}</strong></span>
                  </div>
                  <p role="cell">{step.action}</p>
                  <p role="cell">{step.support}</p>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="onboarding-trust">
          <ShieldCheck size={19} />
          <div><strong>{copy.trustTitle}</strong><p>{copy.trustBody}</p></div>
        </div>

        <footer className="onboarding-footer">
          <button className="secondary-button" type="button" onClick={onDismiss}>{copy.later}</button>
          <button className="primary-button" type="button" onClick={onStart}>{copy.start} <ArrowRight size={17} /></button>
        </footer>
      </section>
    </div>
  )
}
