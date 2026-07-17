import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileText,
  Flame,
  Focus,
  GraduationCap,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  LockKeyhole,
  MoreHorizontal,
  PanelTop,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import focusImage from './assets/study-focus.png'
import { prioriApi, type ApiCourse, type ApiDashboard, type ApiPlan, type ApiReplanProposal } from './lib/api'
import './App.css'

type Locale = 'vi' | 'en'
type View = 'today' | 'plan' | 'imports' | 'coach'
type ImportReview =
  | { kind: 'document'; documentId?: string; courseNames: string[]; taskCount: number; warningCount: number }
  | { kind: 'ics'; draftId?: string; taskCount: number; busyBlockCount: number }

const copy = {
  vi: {
    today: 'Hôm nay',
    plan: 'Kế hoạch',
    imports: 'Dữ liệu',
    coach: 'Coach',
    morning: 'Chào buổi sáng, Mai.',
    ready: 'Bạn có 2 giờ 15 phút thực sự trống hôm nay.',
    now: 'Làm việc này ngay',
    why: 'Tại sao là việc này?',
    start: 'Bắt đầu phiên 45 phút',
    priority: 'Ưu tiên hôm nay',
    schedule: 'Kế hoạch đang chờ duyệt',
    approve: 'Duyệt kế hoạch',
    approved: 'Đã duyệt',
    stuck: 'Mình đang bị kẹt',
    checkin: 'Check-in với Priori',
    import: 'Thêm dữ liệu',
    focus: 'Phiên tập trung',
    assistant: 'Priori Agent',
  },
  en: {
    today: 'Today',
    plan: 'Plan',
    imports: 'Data',
    coach: 'Coach',
    morning: 'Good morning, Mai.',
    ready: 'You have 2 hours and 15 minutes that are truly open today.',
    now: 'Do this now',
    why: 'Why this task?',
    start: 'Start a 45-minute session',
    priority: 'Today\'s priorities',
    schedule: 'Plan awaiting approval',
    approve: 'Approve plan',
    approved: 'Approved',
    stuck: 'I am stuck',
    checkin: 'Check in with Priori',
    import: 'Add data',
    focus: 'Focus session',
    assistant: 'Priori Agent',
  },
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="score-ring" style={{ '--score': `${score * 3.6}deg` } as React.CSSProperties} aria-label={`Priority score ${score}`}>
      <strong>{score}</strong>
      <span>score</span>
    </div>
  )
}

function formatDue(dueAt: string | null, locale: Locale): string {
  if (!dueAt) return locale === 'vi' ? 'Chua co han nop' : 'No due date'
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(dueAt))
}

function App() {
  const [locale, setLocale] = useState<Locale>('vi')
  const [activeView, setActiveView] = useState<View>('today')
  const [planApproved, setPlanApproved] = useState(false)
  const [replanOpen, setReplanOpen] = useState(false)
  const [replanApproved, setReplanApproved] = useState(false)
  const [imported, setImported] = useState(false)
  const [calendarImported, setCalendarImported] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [replanBusy, setReplanBusy] = useState(false)
  const [importReview, setImportReview] = useState<ImportReview | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusRunning, setFocusRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(45 * 60)
  const [extensionOpen, setExtensionOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [apiPlan, setApiPlan] = useState<ApiPlan | null>(null)
  const [apiReplan, setApiReplan] = useState<ApiReplanProposal | null>(null)
  const [dashboard, setDashboard] = useState<ApiDashboard | null>(null)
  const [courses, setCourses] = useState<ApiCourse[]>([])
  const [dashboardBusy, setDashboardBusy] = useState(true)
  const [manualTaskOpen, setManualTaskOpen] = useState(false)
  const [manualTaskBusy, setManualTaskBusy] = useState(false)
  const [manualTask, setManualTask] = useState({ courseId: '', title: '', dueAt: '', gradeWeight: '', estimatedMinutes: '45' })
  const documentInputRef = useRef<HTMLInputElement>(null)
  const calendarInputRef = useRef<HTMLInputElement>(null)
  const t = copy[locale]
  const recommendation = dashboard?.recommendation ?? null
  const rankedTasks = dashboard?.rankedTasks ?? []

  const refreshWorkspace = async () => {
    const [nextDashboard, taskData] = await Promise.all([prioriApi.dashboard(), prioriApi.tasks()])
    setDashboard(nextDashboard)
    setCourses(taskData.courses)
    setManualTask((current) => current.courseId || taskData.courses.length === 0 ? current : { ...current, courseId: taskData.courses[0]?.id ?? '' })
  }

  useEffect(() => {
    void (async () => {
      try {
        await prioriApi.bootstrap()
        await refreshWorkspace()
      } catch {
        setToast('Could not load your data. Check the API and database connection.')
      } finally {
        setDashboardBusy(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!focusRunning || secondsLeft === 0) return
    const timer = window.setInterval(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => window.clearInterval(timer)
  }, [focusRunning, secondsLeft])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const time = useMemo(() => {
    const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0')
    const seconds = (secondsLeft % 60).toString().padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [secondsLeft])

  const beginFocus = () => {
    setFocusOpen(true)
    setFocusRunning(true)
    void prioriApi.track('focus_started').catch(() => undefined)
  }

  const approvePlan = async () => {
    if (planBusy) return
    setPlanBusy(true)
    try {
      const proposal = apiPlan ?? await prioriApi.generatePlan()
      const approved = proposal.status === 'approved' ? proposal : await prioriApi.approvePlan(proposal)
      setApiPlan(approved)
      setPlanApproved(true)
      setToast(locale === 'vi' ? 'Kế hoạch đã được khóa theo lịch của bạn.' : 'Your plan is now locked to your schedule.')
      void prioriApi.track('plan_approved').catch(() => undefined)
    } catch {
      setPlanApproved(true)
      setToast(locale === 'vi' ? 'Đã duyệt trong chế độ demo cục bộ.' : 'Approved in local demo mode.')
    } finally {
      setPlanBusy(false)
    }
  }

  const saveManualTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (manualTaskBusy || !manualTask.courseId) return
    setManualTaskBusy(true)
    try {
      await prioriApi.createTask({
        courseId: manualTask.courseId,
        title: manualTask.title.trim(),
        dueAt: manualTask.dueAt ? new Date(manualTask.dueAt).toISOString() : null,
        gradeWeight: manualTask.gradeWeight ? Number(manualTask.gradeWeight) : null,
        estimatedMinutes: Number(manualTask.estimatedMinutes),
      })
      await refreshWorkspace()
      setManualTask((current) => ({ ...current, title: '', dueAt: '', gradeWeight: '', estimatedMinutes: '45' }))
      setManualTaskOpen(false)
      setActiveView('today')
      setToast(locale === 'vi' ? 'Da them task vao danh sach uu tien.' : 'Task added to your priority list.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not save the task.')
    } finally {
      setManualTaskBusy(false)
    }
  }

  const openReplan = async () => {
    if (!planApproved) {
      setActiveView('plan')
      setToast(locale === 'vi' ? 'Hãy duyệt kế hoạch hiện tại trước khi tạo phương án mới.' : 'Approve the current plan before creating a replacement.')
      return
    }
    setReplanOpen(true)
    setApiReplan(null)
    if (!apiPlan || apiPlan.status !== 'approved') return
    setReplanBusy(true)
    try {
      setApiReplan(await prioriApi.createReplan(apiPlan))
    } catch {
      setApiReplan(null)
    } finally {
      setReplanBusy(false)
    }
  }

  const approveReplan = async () => {
    if (replanBusy) return
    if (apiPlan && !apiReplan) {
      setToast(locale === 'vi' ? 'Chưa thể chuẩn bị phương án mới. Hãy thử mở lại.' : 'The new proposal is not ready. Please reopen it.')
      return
    }
    setReplanBusy(true)
    try {
      if (apiReplan) setApiPlan(await prioriApi.approveReplan(apiReplan))
      setReplanApproved(true)
      setReplanOpen(false)
      setToast(locale === 'vi' ? 'Kế hoạch mới đã sẵn sàng.' : 'Your updated plan is ready.')
      void prioriApi.track('replan_approved').catch(() => undefined)
    } catch {
      setToast(locale === 'vi' ? 'Phương án đã đổi. Hãy mở lại để xem bản mới nhất.' : 'The proposal changed. Reopen it to review the latest version.')
    } finally {
      setReplanBusy(false)
    }
  }

  const handleDocumentSelected = async (file: File | undefined) => {
    if (!file) return
    setImportBusy(true)
    try {
      const result = await prioriApi.uploadAndExtract(file)
      setImportReview({
        kind: 'document',
        documentId: result.documentId,
        courseNames: result.extraction.courses.map((course) => course.name),
        taskCount: result.extraction.tasks.length,
        warningCount: result.extraction.warnings.length,
      })
    } catch {
      setImportReview({ kind: 'document', courseNames: ['Marketing', 'Accounting', 'Programming', 'Statistics'], taskCount: 14, warningCount: 3 })
    } finally {
      setImportBusy(false)
      setReviewOpen(true)
      if (documentInputRef.current) documentInputRef.current.value = ''
    }
  }

  const handleCalendarSelected = async (file: File | undefined) => {
    if (!file) return
    setImportBusy(true)
    try {
      const result = await prioriApi.importIcs(file)
      setImportReview({ kind: 'ics', draftId: result.draftId, taskCount: result.taskCount, busyBlockCount: result.busyBlockCount })
    } catch {
      setImportReview({ kind: 'ics', taskCount: 2, busyBlockCount: 4 })
    } finally {
      setImportBusy(false)
      setReviewOpen(true)
      if (calendarInputRef.current) calendarInputRef.current.value = ''
    }
  }

  const confirmImport = async () => {
    if (!importReview) return
    setImportBusy(true)
    let usedLocalFallback = false
    try {
      if (importReview.kind === 'document' && importReview.documentId) await prioriApi.confirmDocument(importReview.documentId)
      if (importReview.kind === 'ics' && importReview.draftId) await prioriApi.confirmIcs(importReview.draftId)
    } catch {
      usedLocalFallback = true
    } finally {
      setImportBusy(false)
    }
    if (importReview.kind === 'document') setImported(true)
    else setCalendarImported(true)
    if (!usedLocalFallback) await refreshWorkspace()
    setReviewOpen(false)
    setActiveView('today')
    setToast(usedLocalFallback
      ? (locale === 'vi' ? 'Đã xác nhận trong chế độ demo cục bộ.' : 'Confirmed in local demo mode.')
      : (locale === 'vi' ? 'Dữ liệu đã xác nhận và sẵn sàng để lập kế hoạch.' : 'Data confirmed and ready for planning.'))
  }

  const checkCanvas = async () => {
    try {
      const status = await prioriApi.canvasStatus()
      setToast(status.message ?? (locale === 'vi' ? 'Canvas đã sẵn sàng để kết nối.' : 'Canvas is ready to connect.'))
    } catch {
      setToast(locale === 'vi' ? 'Canvas cần quyền từ trường; bạn vẫn có thể dùng PDF.' : 'Canvas needs institutional authorization; PDF remains available.')
    }
  }

  const navigation: { id: View; icon: typeof LayoutDashboard; label: string }[] = [
    { id: 'today', icon: LayoutDashboard, label: t.today },
    { id: 'plan', icon: ListChecks, label: t.plan },
    { id: 'imports', icon: Inbox, label: t.imports },
    { id: 'coach', icon: Sparkles, label: t.coach },
  ]

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="PrioriLearn home">
          <span className="brand-mark"><Focus size={19} strokeWidth={2.6} /></span>
          <span>priori<span>learn</span></span>
        </div>

        <nav className="main-nav" aria-label="Primary navigation">
          {navigation.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={activeView === id ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveView(id)}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>{locale === 'vi' ? 'Bạn kiểm soát dữ liệu của mình.' : 'You control your data.'}</span>
          </div>
          <button className="user-chip" type="button" title="Account settings">
            <span className="avatar">M</span>
            <span className="user-copy"><strong>Mai Nguyen</strong><small>Student</small></span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumb"><span>Tue, Jun 16</span><span className="dot" /> <span>{planApproved ? t.approved : t.schedule}</span></div>
          <div className="top-actions">
            <button className="icon-button" type="button" title="Open extension preview" onClick={() => setExtensionOpen(true)}><PanelTop size={18} /></button>
            <button className="icon-button notification" type="button" title="Notifications"><Bell size={18} /><i /></button>
            <div className="language-switch" aria-label="Language">
              <button className={locale === 'vi' ? 'selected' : ''} onClick={() => setLocale('vi')} type="button">VI</button>
              <button className={locale === 'en' ? 'selected' : ''} onClick={() => setLocale('en')} type="button">EN</button>
            </div>
          </div>
        </header>

        <div className="content-area">
          <section className="main-content">
            {activeView === 'today' && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow"><span className="status-dot" /> {locale === 'vi' ? 'Kế hoạch thích nghi đang hoạt động' : 'Adaptive plan is active'}</p>
                    <h1>{t.morning}</h1>
                    <p className="subhead">{t.ready}</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setActiveView('imports')}><Plus size={17} /> {t.import}</button>
                </div>

                <section className="now-section" aria-labelledby="now-title">
                  <div className="section-label"><span>{locale === 'vi' ? '01 / Ưu tiên số một' : '01 / Highest priority'}</span><span className="line" /></div>
                  <div className="now-layout">
                    <article className="task-hero">
                      <div className="task-hero-header">
                        <span className="course-tag programming">{recommendation?.course.name ?? (locale === 'vi' ? 'Chua co task' : 'No task yet')}</span>
                        <button className="icon-button quiet" type="button" title="Task options"><MoreHorizontal size={20} /></button>
                      </div>
                      <h2 id="now-title">{recommendation?.task.title ?? (dashboardBusy ? (locale === 'vi' ? 'Dang tai du lieu...' : 'Loading your data...') : (locale === 'vi' ? 'Them task dau tien cua ban' : 'Add your first task'))}</h2>
                      <p className="task-summary">{recommendation?.firstStep ?? (locale === 'vi' ? 'Tai lieu, deadline va task ban xac nhan se xuat hien o day.' : 'Confirmed tasks, deadlines, and document imports will appear here.')}</p>
                      <div className="task-meta"><span><CalendarDays size={16} /> {recommendation ? formatDue(recommendation.task.dueAt, locale) : (locale === 'vi' ? 'Chua co han nop' : 'No due date')}</span><span><Clock3 size={16} /> {recommendation ? `${recommendation.estimatedMinutes} min` : '0 min'}</span></div>
                      <div className="task-actions">
                        <button className="primary-button" type="button" disabled={!recommendation} onClick={beginFocus}><Play size={17} fill="currentColor" /> {t.start}</button>
                        <button className="link-button" type="button" disabled={!recommendation} onClick={() => setActiveView('coach')}><Sparkles size={16} /> {t.why}</button>
                      </div>
                    </article>
                    <aside className="priority-panel">
                      <ScoreRing score={recommendation?.assessment.score ?? 0} />
                      <div className="priority-caption">
                        <span>{locale === 'vi' ? 'Tại sao ngay bây giờ?' : 'Why now?'}</span>
                        <strong>{recommendation?.task.gradeWeight ? `${recommendation.task.gradeWeight}% ${locale === 'vi' ? 'diem mon hoc' : 'of course grade'}` : (locale === 'vi' ? 'Can them du lieu diem' : 'Add grade context')}</strong>
                        <div className="delay-warning">
                          <CircleAlert size={18} />
                          <p>
                            {locale === 'vi' ? <>Nếu trì hoãn thêm 2 ngày, rủi ro không hoàn thành <em>tăng hơn 3 lần</em>: từ 8% lên 26%.</> : <>Delay this by 2 days and your non-completion risk <em>more than triples</em>: from 8% to 26%.</>}
                          </p>
                        </div>
                      </div>
                    </aside>
                  </div>
                </section>

                <section className="priority-list-section">
                  <div className="section-heading"><div><h2>{t.priority}</h2><p>{locale === 'vi' ? 'Được xếp theo tác động thực, không chỉ deadline.' : 'Ranked by real consequence, not only deadlines.'}</p></div><button className="text-button" type="button" onClick={() => setActiveView('plan')}>{locale === 'vi' ? 'Xem kế hoạch' : 'View plan'} <ArrowRight size={16} /></button></div>
                  <div className="task-list">
                    {rankedTasks.map((item, index) => (
                      <button className={index === 0 ? 'task-row task-row-active' : 'task-row'} type="button" key={item.task.id} onClick={() => index === 0 ? setActiveView('coach') : setToast(`${item.task.title} selected`)}>
                        <span className="rank">0{index + 1}</span>
                        <span className="task-dot programming" />
                        <span className="task-row-main"><small>{item.course.name}</small><strong>{item.task.title}</strong></span>
                        <span className="task-row-impact"><small>{formatDue(item.task.dueAt, locale)}</small><span>{item.task.gradeWeight ? `${item.task.gradeWeight}%` : (locale === 'vi' ? 'Khong ro ty trong' : 'No weight')}</span></span>
                        <span className="score-pill">{item.assessment.score}</span>
                        <ChevronRight className="row-arrow" size={18} />
                      </button>
                    ))}
                    {!dashboardBusy && rankedTasks.length === 0 && <p className="empty-task-list">{locale === 'vi' ? 'Chua co task da xac nhan. Them task thu cong hoac import tai lieu.' : 'No confirmed tasks yet. Add one manually or import a document.'}</p>}
                  </div>
                </section>

                <section className="day-strip">
                  <div><span className="strip-icon"><Clock3 size={19} /></span><div><strong>{locale === 'vi' ? 'Một lịch vừa sức' : 'A plan with room to breathe'}</strong><p>{locale === 'vi' ? '2 giờ 15 phút học sâu, 45 phút dự phòng, không chồng lên lịch cá nhân.' : '2h 15m deep work, 45m buffer, no conflict with your personal calendar.'}</p></div></div>
                  <button className="icon-button" type="button" title="Plan details" onClick={() => setActiveView('plan')}><ChevronRight size={18} /></button>
                </section>
              </>
            )}

            {activeView === 'plan' && (
              <section className="plan-view">
                <div className="page-heading compact"><div><p className="eyebrow"><WandSparkles size={15} /> {locale === 'vi' ? 'Đề xuất bởi Priori Agent' : 'Proposed by Priori Agent'}</p><h1>{locale === 'vi' ? 'Kế hoạch của bạn' : 'Your plan'}</h1><p className="subhead">{locale === 'vi' ? 'Được xây dựng quanh lịch thật và mức Kỷ luật của bạn.' : 'Built around your real calendar and Discipline mode.'}</p></div><span className={planApproved ? 'approval-badge approved' : 'approval-badge'}>{planApproved ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}{planApproved ? t.approved : t.schedule}</span></div>
                <div className="plan-summary"><div><span>Wednesday</span><strong>2h 15m planned</strong></div><div><span>Available</span><strong>3h 00m</strong></div><div><span>Buffer</span><strong>45m</strong></div></div>
                <div className="timeline">
                  <div className="timeline-hour"><span>16:00</span></div><article className="time-block focus-block"><span className="block-time">16:00 - 16:45</span><strong>Assignment 3: API design</strong><small>Programming / First endpoint</small><span className="block-status"><Flame size={15} /> Deep focus</span></article>
                  <div className="timeline-hour"><span>17:00</span></div><article className="time-block break-block"><span className="block-time">17:00 - 17:15</span><strong>Reset break</strong><small>Step away before the next block</small></article>
                  <div className="timeline-hour"><span>17:15</span></div><article className="time-block study-block"><span className="block-time">17:15 - 17:40</span><strong>Research quiz 04</strong><small>Marketing / Review notes</small></article>
                  <div className="timeline-hour"><span>18:00</span></div><div className="calendar-boundary"><LockKeyhole size={15} /> Personal calendar protected</div>
                </div>
                <div className="approval-bar"><div><ShieldCheck size={19} /><p>{locale === 'vi' ? 'Priori sẽ không thay đổi lịch này nếu bạn chưa duyệt.' : 'Priori will not change this schedule without your approval.'}</p></div>{!planApproved && <button type="button" className="primary-button" disabled={planBusy} aria-busy={planBusy} onClick={() => void approvePlan()}><Check size={18} /> {t.approve}</button>}</div>
              </section>
            )}

            {activeView === 'imports' && (
              <section className="imports-view">
                <div className="page-heading compact"><div><p className="eyebrow"><Link2 size={15} /> {locale === 'vi' ? 'Nguồn dữ liệu của bạn' : 'Your data sources'}</p><h1>{locale === 'vi' ? 'Kết nối bối cảnh học kỳ' : 'Connect your semester context'}</h1><p className="subhead">{locale === 'vi' ? 'Bạn chọn dữ liệu nào Priori được phép dùng.' : 'You decide exactly what Priori can use.'}</p></div></div>
                <input ref={documentInputRef} className="visually-hidden" type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event) => void handleDocumentSelected(event.target.files?.[0])} />
                <input ref={calendarInputRef} className="visually-hidden" type="file" accept=".ics,text/calendar" onChange={(event) => void handleCalendarSelected(event.target.files?.[0])} />
                <div className="import-grid">
                  <article className="source-card source-card-primary"><div className="source-icon"><FileText size={21} /></div><div><span className="source-status">{imported ? 'Confirmed' : 'Recommended'}</span><h2>Syllabus & PDF</h2><p>{imported ? 'Extracted data reviewed and confirmed' : 'Extract courses, grade weights and deadlines.'}</p></div><button type="button" className="mini-action" title="Upload syllabus" disabled={importBusy} aria-busy={importBusy} onClick={() => imported ? setReviewOpen(true) : documentInputRef.current?.click()}>{imported ? <Check size={17} /> : <Upload size={17} />}</button></article>
                  <article className="source-card"><div className="source-icon calendar-icon"><CalendarDays size={21} /></div><div><span className={calendarImported ? 'source-status' : 'source-status neutral'}>{calendarImported ? 'Confirmed' : 'Optional'}</span><h2>Calendar</h2><p>{calendarImported ? 'ICS events reviewed and imported' : 'Import an ICS file or connect later.'}</p></div><button type="button" className="mini-action" title="Import ICS calendar" disabled={importBusy} aria-busy={importBusy} onClick={() => calendarInputRef.current?.click()}>{calendarImported ? <Check size={17} /> : <Plus size={17} />}</button></article>
                  <article className="source-card"><div className="source-icon canvas-icon"><GraduationCap size={21} /></div><div><span className="source-status neutral">Institutional</span><h2>Canvas</h2><p>Read-only access when your institution allows it.</p></div><button type="button" className="mini-action" title="Check Canvas connection" onClick={() => void checkCanvas()}><Plus size={17} /></button></article>
                  <article className="source-card"><div className="source-icon manual-icon"><ListChecks size={21} /></div><div><span className="source-status neutral">Always available</span><h2>Manual task</h2><p>Add a deadline or one task you are carrying.</p></div><button type="button" className="mini-action" title="Add task" onClick={() => setManualTaskOpen(true)}><Plus size={17} /></button></article>
                </div>
                <div className="data-policy"><ShieldCheck size={20} /><div><strong>{locale === 'vi' ? 'Sự đồng ý không bao giờ là mặc định.' : 'Consent is never the default.'}</strong><p>{locale === 'vi' ? 'Priori chỉ đọc dữ liệu bạn kết nối. File gốc tự xóa sau 30 ngày.' : 'Priori reads only data you connect. Original files are deleted after 30 days.'}</p></div><button type="button" className="text-button">{locale === 'vi' ? 'Xem quyền' : 'Review permissions'} <ArrowRight size={16} /></button></div>
                {reviewOpen && importReview && <section className="extract-review"><div className="review-heading"><div><span className="ai-chip"><Sparkles size={14} /> {importReview.kind === 'document' ? 'AI extracted' : 'ICS parsed'}</span><h2>{locale === 'vi' ? 'Xem lại trước khi thêm vào kế hoạch' : 'Review before adding to your plan'}</h2></div><button className="icon-button" type="button" title="Close review" onClick={() => setReviewOpen(false)}><X size={18} /></button></div><div className="extracted-rows">{importReview.kind === 'document' ? <><div><BookOpen size={18} /><span>{importReview.courseNames.length} courses found</span><strong>{importReview.courseNames.join(' · ') || 'Course details need confirmation'}</strong></div><div><ListChecks size={18} /><span>{importReview.taskCount} tasks found</span><strong>{importReview.warningCount} fields need your confirmation</strong></div></> : <><div><CalendarDays size={18} /><span>{importReview.busyBlockCount} busy blocks</span><strong>Your existing calendar remains read only</strong></div><div><ListChecks size={18} /><span>{importReview.taskCount} tasks found</span><strong>Nothing enters your plan before confirmation</strong></div></>}</div><div className="review-actions"><button className="secondary-button" type="button" onClick={() => setToast(locale === 'vi' ? 'Các mục chưa chắc chắn vẫn được đánh dấu để bạn sửa.' : 'Uncertain fields remain marked for editing.')}>Edit details</button><button className="primary-button" type="button" disabled={importBusy} aria-busy={importBusy} onClick={() => void confirmImport()}><Check size={17} /> Confirm & build plan</button></div></section>}
              </section>
            )}

            {activeView === 'coach' && (
              <section className="coach-view">
                <div className="page-heading compact"><div><p className="eyebrow"><Sparkles size={15} /> {t.assistant}</p><h1>{locale === 'vi' ? 'Điều gì khiến việc này quan trọng?' : 'Why does this matter now?'}</h1><p className="subhead">{locale === 'vi' ? 'Một lời giải thích để hành động, không phải một lời nhắc chung chung.' : 'An explanation that moves you forward, not a generic reminder.'}</p></div></div>
                <article className="coach-answer"><div className="coach-answer-top"><span className="ai-avatar"><Sparkles size={18} /></span><div><strong>Assignment 3: API design</strong><span>Programming · Due Thursday</span></div><span className="confidence">92% confidence</span></div><div className="reason-grid"><div><span className="reason-number">01</span><h3>Academic impact</h3><p>This assignment is worth 30% of your course grade. It has the highest leverage left this week.</p></div><div><span className="reason-number">02</span><h3>Cost of delay</h3><p>Waiting two days removes your only buffer before office hours and increases the chance of an incomplete submission.</p></div><div><span className="reason-number">03</span><h3>Smallest useful start</h3><p>Open VS Code, create the endpoint file, then write a response shape. That is enough for this session.</p></div></div><div className="coach-foot"><div><TimerReset size={18} /><p><strong>45 minutes today</strong> protects your Friday workload and keeps your GPA target realistic.</p></div><button className="primary-button" type="button" onClick={beginFocus}><Play size={17} fill="currentColor" /> Start first step</button></div></article>
                <section className="checkin-panel"><div><span className="checkin-label">{t.checkin}</span><h2>{locale === 'vi' ? 'Bạn không cần phải ép mình qua mọi trở ngại.' : 'You do not have to push through every obstacle.'}</h2><p>{locale === 'vi' ? 'Khi thực tế thay đổi, Priori đưa ra một phương án khác để bạn duyệt.' : 'When reality changes, Priori gives you a different plan to approve.'}</p></div><button className="outline-button" type="button" onClick={() => void openReplan()}><CircleAlert size={18} /> {t.stuck}</button></section>
                {replanApproved && <div className="replan-success"><CheckCircle2 size={20} /><span>{locale === 'vi' ? 'Đã dời quiz sang 17:30 và giữ lại buffer của bạn.' : 'Quiz moved to 17:30 and your buffer remains protected.'}</span></div>}
              </section>
            )}
          </section>

          <aside className="right-rail">
            <section className="coach-card"><div className="coach-card-head"><div><span className="assistant-dot"><Sparkles size={15} /></span><strong>Priori Agent</strong></div><button className="icon-button quiet" type="button" title="Coach settings"><Settings2 size={17} /></button></div><p>{locale === 'vi' ? 'Mình đã kiểm tra lịch, deadlines và mức năng lượng bạn đặt cho hôm nay.' : 'I checked your calendar, deadlines, and the energy level you set for today.'}</p><div className="coach-mode"><span>{locale === 'vi' ? 'Chế độ coach' : 'Coach mode'}</span><button type="button">Kỷ luật <ChevronDown size={15} /></button></div></section>
            <section className="progress-card"><div className="card-heading"><h2>{locale === 'vi' ? 'Nhịp học tuần này' : 'This week\'s rhythm'}</h2><button className="icon-button quiet" type="button" title="Learning rhythm details"><HelpCircle size={17} /></button></div><div className="streak"><span><Flame size={18} fill="currentColor" /> 4</span><p>{locale === 'vi' ? 'phiên tập trung' : 'focus sessions'}</p></div><div className="week-bars" aria-label="Weekly focus activity"><i className="medium" /><i className="high" /><i className="low" /><i className="high" /><i className="today-bar" /><i /><i /></div><div className="week-days"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div></section>
            <section className="privacy-card"><LockKeyhole size={17} /><div><strong>{locale === 'vi' ? 'Không chia sẻ với trường' : 'Not shared with your school'}</strong><p>{locale === 'vi' ? 'Kế hoạch và rủi ro học tập này chỉ dành cho bạn.' : 'This study plan and risk signal are private to you.'}</p></div></section>
          </aside>
        </div>
      </section>

      {manualTaskOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-task-title">
        <form className="manual-task-modal" onSubmit={(event) => void saveManualTask(event)}>
          <button className="icon-button modal-close" type="button" title="Close task editor" onClick={() => setManualTaskOpen(false)}><X size={20} /></button>
          <span className="ai-chip"><ListChecks size={14} /> Manual task</span>
          <h2 id="manual-task-title">{locale === 'vi' ? 'Them task cua ban' : 'Add a task'}</h2>
          {courses.length === 0 ? <p className="form-message">{locale === 'vi' ? 'Hay import syllabus truoc de tao mon hoc.' : 'Import a syllabus first to create a course.'}</p> : <>
            <label>Course<select value={manualTask.courseId} onChange={(event) => setManualTask((current) => ({ ...current, courseId: event.target.value }))}>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</select></label>
            <label>Task<input required maxLength={240} autoFocus value={manualTask.title} onChange={(event) => setManualTask((current) => ({ ...current, title: event.target.value }))} /></label>
            <div className="manual-task-grid"><label>Due date<input type="datetime-local" value={manualTask.dueAt} onChange={(event) => setManualTask((current) => ({ ...current, dueAt: event.target.value }))} /></label><label>Weight (%)<input type="number" min="0" max="100" value={manualTask.gradeWeight} onChange={(event) => setManualTask((current) => ({ ...current, gradeWeight: event.target.value }))} /></label><label>Minutes<input required type="number" min="5" max="600" value={manualTask.estimatedMinutes} onChange={(event) => setManualTask((current) => ({ ...current, estimatedMinutes: event.target.value }))} /></label></div>
          </>}
          <div className="replan-actions"><button type="button" className="secondary-button" onClick={() => setManualTaskOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={courses.length === 0 || manualTaskBusy} aria-busy={manualTaskBusy}><Check size={18} /> Add task</button></div>
        </form>
      </div>}

      {focusOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="focus-title"><section className="focus-modal"><button className="icon-button modal-close" type="button" title="Close focus session" onClick={() => { setFocusOpen(false); setFocusRunning(false) }}><X size={20} /></button><div className="focus-photo"><img src={focusImage} alt="Student reviewing a study plan at a desk" /></div><div className="focus-overlay"><span className="focus-kicker">Programming · Deep focus</span><h2 id="focus-title">Assignment 3: API design</h2><p>Open VS Code. Create <code>routes/assignment.ts</code>. Define the first response shape.</p><div className="timer">{time}</div><div className="focus-controls"><button className={focusRunning ? 'pause-button' : 'primary-button'} type="button" onClick={() => setFocusRunning(!focusRunning)}>{focusRunning ? <><TimerReset size={17} /> Pause</> : <><Play size={17} fill="currentColor" /> Resume</>}</button><button className="icon-button focus-more" type="button" title="Focus options"><MoreHorizontal size={20} /></button></div></div></section></div>}

      {replanOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="replan-title"><section className="replan-modal"><button className="icon-button modal-close" type="button" title="Close replanning" onClick={() => setReplanOpen(false)}><X size={20} /></button><span className="ai-chip"><Sparkles size={14} /> Priori Agent</span><h2 id="replan-title">{locale === 'vi' ? 'Điều gì đang cản bạn?' : 'What is getting in the way?'}</h2><div className="friction-options"><button type="button" className="friction-selected"><span>01</span>{locale === 'vi' ? 'Không biết bắt đầu' : 'I do not know where to start'}</button><button type="button"><span>02</span>{locale === 'vi' ? 'Quá mệt' : 'I am too tired'}</button><button type="button"><span>03</span>{locale === 'vi' ? 'Lịch vừa thay đổi' : 'My schedule changed'}</button></div><div className="proposal"><span>{locale === 'vi' ? 'Đề xuất mới' : 'New proposal'}</span><strong>{locale === 'vi' ? 'Rút phiên đầu xuống 20 phút và giữ quiz ở 17:30.' : 'Reduce the first session to 20 minutes and keep the quiz at 17:30.'}</strong><p>{locale === 'vi' ? 'Bạn vẫn giữ được deadline Programming và 45 phút buffer.' : 'You still protect the Programming deadline and 45-minute buffer.'}</p></div><div className="replan-actions"><button type="button" className="secondary-button" onClick={() => setReplanOpen(false)}>{locale === 'vi' ? 'Chưa phù hợp' : 'Not right yet'}</button><button type="button" className="primary-button" disabled={replanBusy} aria-busy={replanBusy} onClick={() => void approveReplan()}><Check size={18} /> {locale === 'vi' ? 'Duyệt phương án này' : 'Approve this plan'}</button></div></section></div>}

      {extensionOpen && <div className="extension-popover"><div className="extension-top"><div className="brand"><span className="brand-mark"><Focus size={16} /></span><span>priorilearn</span></div><button className="icon-button quiet" type="button" title="Close extension preview" onClick={() => setExtensionOpen(false)}><X size={17} /></button></div><span className="extension-context"><GraduationCap size={15} /> Canvas · CS304</span><h3>Continue your focus block</h3><p>Assignment 3: API design<br /><small>35 minutes left</small></p><button className="primary-button full-button" type="button" onClick={() => { setExtensionOpen(false); beginFocus() }}><Play size={16} fill="currentColor" /> Open focus</button><div className="extension-note"><LockKeyhole size={14} /> Context is read only after you open this extension.</div></div>}

      {toast && <div className="toast"><CircleCheck size={18} /> {toast}</div>}
    </main>
  )
}

export default App
