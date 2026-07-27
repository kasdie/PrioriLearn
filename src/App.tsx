import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  FileText,
  Flame,
  Focus,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MailCheck,
  MoreHorizontal,
  PanelTop,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import focusImage from './assets/study-focus.png'
import { AuthActionScreen, type AuthAction } from './AuthActionScreen'
import { AuthScreen } from './AuthScreen'
import { useImportFlow } from './features/import/useImportFlow'
import { ExtractionReviewEditor } from './features/import/ExtractionReviewEditor'
import { LearnerProfilePanel } from './features/profile/LearnerProfilePanel'
import { PlanProposalEditor } from './features/plan/PlanProposalEditor'
import { isMissedPlanItem } from './features/plan/planStatus'
import { usePlanFlow } from './features/plan/usePlanFlow'
import { useSession } from './features/session/useSession'
import { ApiClientError, prioriApi, type ApiConsent, type ApiCourse, type ApiDashboard, type ApiLearnerProfile, type ApiLearnerSignal, type ApiMetrics, type ApiReplanProposal, type ApiSession, type ApiTask } from './lib/api'
import './App.css'

type Locale = 'vi' | 'en'
type View = 'today' | 'plan' | 'imports' | 'coach' | 'settings'
const copy = {
  vi: {
    today: 'Hôm nay',
    plan: 'Kế hoạch',
    imports: 'Dữ liệu',
    coach: 'Coach',
    ready: 'Các task đã xác nhận đang được xếp theo dữ liệu học tập của bạn.',
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
    settings: 'Cài đặt',
  },
  en: {
    today: 'Today',
    plan: 'Plan',
    imports: 'Data',
    coach: 'Coach',
    ready: 'Your confirmed tasks are ranked from your academic context.',
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
    settings: 'Settings',
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

function readAuthAction(): AuthAction | null {
  const parameters = new URLSearchParams(window.location.search)
  const kind = parameters.get('authAction')
  const token = parameters.get('token')
  if ((kind !== 'verify-email' && kind !== 'reset-password') || !token) {
    return null
  }
  return { kind, token }
}

function App() {
  const [locale, setLocale] = useState<Locale>('vi')
  const sessionFlow = useSession({ locale, onLocaleChange: setLocale })
  const { session, checking: authChecking, notice: authNotice } = sessionFlow
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [authAction, setAuthAction] = useState<AuthAction | null>(() => readAuthAction())
  const [activeView, setActiveView] = useState<View>('today')
  const [replanOpen, setReplanOpen] = useState(false)
  const [replanApproved, setReplanApproved] = useState(false)
  const [replanBusy, setReplanBusy] = useState(false)
  const [replanFriction, setReplanFriction] = useState<'cannot_start' | 'too_tired' | 'schedule_changed' | 'lost_focus'>('cannot_start')
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusRunning, setFocusRunning] = useState(false)
  const [focusBusy, setFocusBusy] = useState(false)
  const [focusRecorded, setFocusRecorded] = useState(false)
  const [focusError, setFocusError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(45 * 60)
  const [extensionOpen, setExtensionOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [apiReplan, setApiReplan] = useState<ApiReplanProposal | null>(null)
  const [dashboard, setDashboard] = useState<ApiDashboard | null>(null)
  const [metrics, setMetrics] = useState<ApiMetrics>({})
  const [courses, setCourses] = useState<ApiCourse[]>([])
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [dashboardBusy, setDashboardBusy] = useState(true)
  const [manualTaskOpen, setManualTaskOpen] = useState(false)
  const [manualTaskBusy, setManualTaskBusy] = useState(false)
  const [manualTask, setManualTask] = useState({ courseId: '', courseCode: '', courseName: '', title: '', dueAt: '', gradeWeight: '', estimatedMinutes: '45' })
  const [consents, setConsents] = useState<ApiConsent[]>([])
  const [learnerProfile, setLearnerProfile] = useState<ApiLearnerProfile>({ version: 0, signals: [], sourceEventCount: 0 })
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const [deletionBusy, setDeletionBusy] = useState(false)
  const [verificationBusy, setVerificationBusy] = useState(false)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const calendarInputRef = useRef<HTMLInputElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const canvasHandoffHandledRef = useRef(false)
  const t = copy[locale]
  const recommendation = dashboard?.recommendation ?? null
  const rankedTasks = useMemo(() => dashboard?.rankedTasks ?? [], [dashboard?.rankedTasks])
  const hasConfirmedTasks = rankedTasks.length > 0
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const focusMinutes = recommendation ? Math.min(45, recommendation.estimatedMinutes) : 45
  const startFocusLabel = recommendation
    ? locale === 'vi' ? `Bắt đầu phiên ${focusMinutes} phút` : `Start a ${focusMinutes}-minute session`
    : t.start
  const focusCompleted = metrics.focus_completed ?? 0
  const confidenceLabel = recommendation?.assessment.uncertainty === 'low'
    ? (locale === 'vi' ? 'Cao' : 'High')
    : recommendation?.assessment.uncertainty === 'medium'
      ? (locale === 'vi' ? 'Trung bình' : 'Medium')
      : (locale === 'vi' ? 'Cần xem lại' : 'Needs review')
  const consentByPurpose = useMemo(() => consents.reduce<Partial<Record<ApiConsent['purpose'], ApiConsent>>>((latest, consent) => {
    const existing = latest[consent.purpose]
    if (!existing || new Date(consent.createdAt) > new Date(existing.createdAt)) latest[consent.purpose] = consent
    return latest
  }, {}), [consents])

  const refreshWorkspace = useCallback(async () => {
    const [nextDashboard, taskData, nextMetrics] = await Promise.all([prioriApi.dashboard(), prioriApi.tasks(), prioriApi.metrics()])
    setDashboard(nextDashboard)
    setCourses(taskData.courses)
    setTasks(taskData.tasks)
    setMetrics(nextMetrics)
    setManualTask((current) => current.courseId || taskData.courses.length === 0 ? current : { ...current, courseId: taskData.courses[0]?.id ?? '' })
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsBusy(true)
    try {
      const [nextConsents, nextLearnerProfile] = await Promise.all([
        prioriApi.consents(),
        prioriApi.learnerProfile(),
      ])
      setConsents(nextConsents)
      setLearnerProfile(nextLearnerProfile)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not load your data permissions.')
    } finally {
      setSettingsBusy(false)
    }
  }, [])

  const planFlow = usePlanFlow()
  const { plan: apiPlan, approved: planApproved, busy: planBusy, replacePlan } = planFlow
  const importFlow = useImportFlow({
    onConfirmed: async () => {
      await refreshWorkspace()
      setActiveView('today')
    },
  })
  const {
    status: importStatus,
    review: importReview,
    busy: importBusy,
    documentConfirmed: imported,
    calendarConfirmed: calendarImported,
    updateDocumentExtraction,
  } = importFlow
  const reviewOpen = Boolean(importReview)

  const handleAuthenticated = async (nextSession: ApiSession) => {
    sessionFlow.authenticate(nextSession)
  }

  const clearAuthAction = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('authAction')
    url.searchParams.delete('token')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setAuthAction(null)
  }

  const requestEmailVerification = async () => {
    if (verificationBusy) return
    setVerificationBusy(true)
    try {
      await prioriApi.requestEmailVerification()
      setToast(locale === 'vi'
        ? 'Đã gửi liên kết xác minh. Hãy kiểm tra hộp thư của bạn.'
        : 'Verification link sent. Check your inbox.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not send the verification email.')
    } finally {
      setVerificationBusy(false)
    }
  }

  const clearWorkspace = () => {
    setDashboard(null)
    setMetrics({})
    setCourses([])
    setTasks([])
    setConsents([])
    setDeletionConfirmation('')
    replacePlan(null)
    setApiReplan(null)
    setReplanApproved(false)
    setActiveView('today')
    setAccountMenuOpen(false)
  }

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    if (!manualTaskOpen && !focusOpen && !replanOpen) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
    if (!dialog) return
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    const frame = window.requestAnimationFrame(() => {
      const targets = focusable()
      ;(dialog.querySelector<HTMLElement>('[autofocus]') ?? targets[0])?.focus()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (manualTaskOpen) setManualTaskOpen(false)
        if (focusOpen) {
          setFocusOpen(false)
          setFocusRunning(false)
        }
        if (replanOpen) setReplanOpen(false)
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
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [focusOpen, manualTaskOpen, replanOpen])

  useEffect(() => {
    if (!session) {
      setDashboardBusy(false)
      return
    }
    let active = true
    setDashboardBusy(true)
    void Promise.all([
      refreshWorkspace(),
      prioriApi.currentPlan().then((current) => replacePlan(current.pending ?? current.active)),
    ])
      .catch(() => {
        if (!active) return
        setToast(session.user.locale === 'vi'
          ? 'Đã đăng nhập nhưng chưa thể tải dữ liệu học tập. Dữ liệu đã xác nhận vẫn an toàn.'
          : 'Signed in, but study data could not be loaded. Your confirmed data is still safe.')
      })
      .finally(() => {
        if (active) setDashboardBusy(false)
      })
    return () => {
      active = false
    }
  }, [refreshWorkspace, replacePlan, session])

  useEffect(() => {
    if (!session || activeView !== 'settings') return
    void loadSettings()
  }, [activeView, loadSettings, session])

  useEffect(() => {
    if (!session || canvasHandoffHandledRef.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('source') !== 'canvas') return

    canvasHandoffHandledRef.current = true
    const canvasContext = url.searchParams.get('context')?.trim().slice(0, 200)
    if (canvasContext) {
      setManualTask((current) => ({ ...current, title: current.title || canvasContext }))
      setManualTaskOpen(true)
      setToast(locale === 'vi'
        ? 'Ngữ cảnh Canvas đã sẵn sàng. Hãy kiểm tra các trường trước khi lưu.'
        : 'Canvas context is ready. Review the fields before saving.')
    }
    url.searchParams.delete('source')
    url.searchParams.delete('context')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [locale, session])

  const finishFocusSession = useCallback(async () => {
    if (!recommendation || focusBusy || focusRecorded) return
    setFocusBusy(true)
    setFocusRunning(false)
    setFocusError(null)
    const elapsedSeconds = Math.max(0, focusMinutes * 60 - secondsLeft)
    const elapsedMinutes = Math.ceil(elapsedSeconds / 60)
    try {
      await prioriApi.track('focus_completed', {
        taskId: recommendation.task.id,
        plannedMinutes: focusMinutes,
        elapsedSeconds,
      })
      setFocusRecorded(true)
      setMetrics((current) => ({ ...current, focus_completed: (current.focus_completed ?? 0) + 1 }))
      setFocusOpen(false)
      setToast(locale === 'vi'
        ? elapsedMinutes > 0
          ? `Đã lưu ${elapsedMinutes} phút tập trung. Task vẫn ở hàng đợi cho đến khi bạn hoàn tất.`
          : 'Đã lưu phiên tập trung. Task vẫn ở hàng đợi cho đến khi bạn hoàn tất.'
        : elapsedMinutes > 0
          ? `${elapsedMinutes} focused minutes saved. The task stays in your queue until you complete it.`
          : 'Focus session saved. The task stays in your queue until you complete it.')
    } catch (error) {
      setFocusError(error instanceof Error ? error.message : 'The focus session was not saved. Your task remains unchanged.')
    } finally {
      setFocusBusy(false)
    }
  }, [focusBusy, focusMinutes, focusRecorded, locale, recommendation, secondsLeft])

  const completeFocusTask = useCallback(async () => {
    if (!recommendation || focusBusy) return
    setFocusBusy(true)
    setFocusRunning(false)
    setFocusError(null)
    const elapsedSeconds = Math.max(0, focusMinutes * 60 - secondsLeft)
    try {
      await prioriApi.updateTask(recommendation.task.id, { status: 'completed' })
      await Promise.allSettled([
        ...(!focusRecorded ? [prioriApi.track('focus_completed', {
          taskId: recommendation.task.id,
          plannedMinutes: focusMinutes,
          elapsedSeconds,
        })] : []),
        prioriApi.track('top_task_completed', { taskId: recommendation.task.id }),
      ])
      setFocusRecorded(true)
      setFocusOpen(false)
      try {
        await refreshWorkspace()
      } catch {
        // Completion is authoritative even when the read model needs a later refresh.
      }
      setToast(locale === 'vi'
        ? `Đã hoàn tất ${recommendation.task.title}. Rủi ro trì hoãn ${recommendation.assessment.costOfDelay.delayHours} giờ đã được loại khỏi hàng đợi.`
        : `${recommendation.task.title} completed. Its ${recommendation.assessment.costOfDelay.delayHours}-hour delay risk is out of the active queue.`)
    } catch (error) {
      setFocusError(error instanceof Error ? error.message : 'The task was not completed. Your current task and plan remain safe.')
    } finally {
      setFocusBusy(false)
    }
  }, [focusBusy, focusMinutes, focusRecorded, locale, recommendation, refreshWorkspace, secondsLeft])

  useEffect(() => {
    if (!focusRunning || secondsLeft === 0) return
    const timer = window.setInterval(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => window.clearInterval(timer)
  }, [focusRunning, secondsLeft])

  useEffect(() => {
    if (!focusRunning || secondsLeft !== 0) return
    void finishFocusSession()
  }, [finishFocusSession, focusRunning, secondsLeft])

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
    if (!recommendation) return
    setSecondsLeft(focusMinutes * 60)
    setFocusRecorded(false)
    setFocusError(null)
    setFocusOpen(true)
    setFocusRunning(true)
    void prioriApi.track('focus_started', {
      taskId: recommendation.task.id,
      plannedMinutes: focusMinutes,
    }).catch(() => undefined)
  }

  const approvePlan = async () => {
    if (planBusy) return
    if (!apiPlan) {
      const proposal = await planFlow.generate()
      if (proposal) {
        setToast(locale === 'vi' ? 'Đề xuất đã sẵn sàng. Hãy xem lại trước khi duyệt.' : 'The proposal is ready. Review it before approval.')
      }
      return
    }
    const approved = await planFlow.approve()
    if (approved) {
      setToast(locale === 'vi' ? 'Kế hoạch đã được khóa theo lịch của bạn.' : 'Your plan is now locked to your schedule.')
      void prioriApi.track('plan_approved').catch(() => undefined)
    }
  }

  const saveManualTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (manualTaskBusy) return
    setManualTaskBusy(true)
    try {
      const courseId = manualTask.courseId || (await prioriApi.createCourse({
        code: manualTask.courseCode.trim(),
        name: manualTask.courseName.trim(),
      })).id
      if (!courseId) throw new Error('A course is required before saving a task.')
      await prioriApi.createTask({
        courseId,
        title: manualTask.title.trim(),
        dueAt: manualTask.dueAt ? new Date(manualTask.dueAt).toISOString() : null,
        gradeWeight: manualTask.gradeWeight ? Number(manualTask.gradeWeight) : null,
        estimatedMinutes: Number(manualTask.estimatedMinutes),
      })
      await refreshWorkspace()
      setManualTask((current) => ({ ...current, courseId, courseCode: '', courseName: '', title: '', dueAt: '', gradeWeight: '', estimatedMinutes: '45' }))
      setManualTaskOpen(false)
      setActiveView('today')
      setToast(locale === 'vi' ? 'Da them task vao danh sach uu tien.' : 'Task added to your priority list.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not save the task.')
    } finally {
      setManualTaskBusy(false)
    }
  }

  const openReplan = async (initialFriction: typeof replanFriction = 'cannot_start') => {
    if (!planApproved) {
      setActiveView('plan')
      setToast(locale === 'vi' ? 'Hãy duyệt kế hoạch hiện tại trước khi tạo phương án mới.' : 'Approve the current plan before creating a replacement.')
      return
    }
    setReplanOpen(true)
    setApiReplan(null)
    setReplanFriction(initialFriction)
    if (!apiPlan || apiPlan.status !== 'approved') return
    setReplanBusy(true)
    try {
      setApiReplan(await prioriApi.createReplan(apiPlan, initialFriction))
    } catch {
      setApiReplan(null)
    } finally {
      setReplanBusy(false)
    }
  }

  const selectReplanFriction = async (friction: typeof replanFriction) => {
    setReplanFriction(friction)
    if (!apiPlan || apiPlan.status !== 'approved') return
    setReplanBusy(true)
    try {
      setApiReplan(await prioriApi.createReplan(apiPlan, friction))
    } catch {
      setApiReplan(null)
      setToast(locale === 'vi' ? 'Chưa thể tạo phương án mới. Hãy thử lại.' : 'Could not create a new proposal. Please try again.')
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
      if (apiReplan) replacePlan(await prioriApi.approveReplan(apiReplan))
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
    await importFlow.selectDocument(file)
    if (documentInputRef.current) documentInputRef.current.value = ''
  }

  const handleCalendarSelected = async (file: File | undefined) => {
    if (!file) return
    await importFlow.selectCalendar(file)
    if (calendarInputRef.current) calendarInputRef.current.value = ''
  }

  const confirmImport = async () => {
    if (!importReview) return
    const confirmed = await importFlow.confirm()
    if (!confirmed) return
    importFlow.closeReview()
    setToast(locale === 'vi' ? 'Dữ liệu đã xác nhận và sẵn sàng để lập kế hoạch.' : 'Data confirmed and ready for planning.')
  }

  const updateConsent = async (purpose: ApiConsent['purpose'], granted: boolean) => {
    if (settingsBusy) return
    setSettingsBusy(true)
    try {
      const consent = await prioriApi.setConsent({ purpose, granted })
      setConsents((current) => [...current, consent])
      setToast(purpose === 'email_digest'
        ? granted
          ? (locale === 'vi' ? 'Đã bật email tổng hợp hằng ngày.' : 'Daily email digest enabled.')
          : (locale === 'vi' ? 'Đã tắt email tổng hợp.' : 'Email digest disabled.')
        : (locale === 'vi' ? 'Quyền dữ liệu đã được cập nhật.' : 'Data permission updated.'))
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setToast(locale === 'vi' ? 'Hãy xác minh email trước khi bật bản tổng hợp.' : 'Verify your email before enabling the digest.')
      } else if (error instanceof ApiClientError && error.code === 'EMAIL_DELIVERY_NOT_CONFIGURED') {
        setToast(locale === 'vi' ? 'Dịch vụ gửi email chưa được cấu hình.' : 'Email delivery is not configured yet.')
      } else {
        setToast(error instanceof Error ? error.message : 'Could not update this permission.')
      }
    } finally {
      setSettingsBusy(false)
    }
  }

  const saveLearnerProfile = async (signals: ApiLearnerSignal[]) => {
    if (settingsBusy) return
    setSettingsBusy(true)
    try {
      const profile = await prioriApi.updateLearnerProfile({ version: learnerProfile.version, signals })
      setLearnerProfile(profile)
      setToast(locale === 'vi' ? 'Ho so hoc tap da duoc luu. Coach chi dung khi ban yeu cau de xuat.' : 'Learner profile saved. Coach only uses it when you request a proposal.')
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'LEARNER_PROFILE_VERSION_CONFLICT') {
        const refreshed = await prioriApi.learnerProfile().catch(() => null)
        if (refreshed) setLearnerProfile(refreshed)
        setToast(locale === 'vi' ? 'Profile da thay doi o tab khac va da duoc tai lai.' : 'Your profile changed in another tab and was reloaded.')
      } else {
        setToast(error instanceof Error ? error.message : 'Could not save learner profile.')
      }
    } finally {
      setSettingsBusy(false)
    }
  }

  const downloadExport = async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      const payload = await prioriApi.exportData()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `priorilearn-export-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setToast(locale === 'vi' ? 'Tệp dữ liệu đã được tạo.' : 'Your data export is ready.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not create your data export.')
    } finally {
      setExportBusy(false)
    }
  }

  const requestAccountDeletion = async () => {
    if (deletionBusy) return
    setDeletionBusy(true)
    try {
      await prioriApi.requestAccountDeletion(deletionConfirmation)
      await sessionFlow.logout()
      clearWorkspace()
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not start account deletion.')
    } finally {
      setDeletionBusy(false)
    }
  }

  const logout = async () => {
    setAccountMenuOpen(false)
    await sessionFlow.logout()
    clearWorkspace()
  }

  const hour = new Date().getHours()
  const greeting = session
    ? locale === 'vi'
      ? `${hour < 12 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'}, ${session.user.name}.`
      : `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${session.user.name}.`
    : ''
  const todayLabel = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date())
  const userInitial = session?.user.name.trim().charAt(0).toUpperCase() || '?'

  if (authAction) {
    return (
      <AuthActionScreen
        action={authAction}
        locale={locale}
        onLocaleChange={setLocale}
        onCancel={clearAuthAction}
        onAuthenticated={async (nextSession) => {
          clearAuthAction()
          await handleAuthenticated(nextSession)
        }}
      />
    )
  }

  if (authChecking) {
    return (
      <main className="startup-screen" aria-live="polite">
        <div className="brand" aria-label="PrioriLearn">
          <span className="brand-mark"><Focus size={19} strokeWidth={2.6} /></span>
          <span>priori<span>learn</span></span>
        </div>
        <LoaderCircle className="startup-spinner" size={23} />
        <span>{locale === 'vi' ? 'Đang mở workspace...' : 'Opening your workspace...'}</span>
      </main>
    )
  }

  if (!session) {
    return (
      <AuthScreen
        locale={locale}
        notice={authNotice}
        onLocaleChange={setLocale}
        onAuthenticated={handleAuthenticated}
      />
    )
  }

  const navigation: { id: View; icon: typeof LayoutDashboard; label: string }[] = [
    { id: 'today', icon: LayoutDashboard, label: t.today },
    { id: 'plan', icon: ListChecks, label: t.plan },
    { id: 'imports', icon: Inbox, label: t.imports },
    { id: 'coach', icon: Sparkles, label: t.coach },
    { id: 'settings', icon: Settings2, label: t.settings },
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
              aria-current={activeView === id ? 'page' : undefined}
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
          <div className="account-menu-wrap" ref={accountMenuRef}>
            <button
              className="user-chip"
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="avatar">{userInitial}</span>
              <span className="user-copy"><strong>{session.user.name}</strong><small>{session.user.role === 'student' ? 'Student' : session.user.role}</small></span>
              <ChevronDown size={16} />
            </button>
            {accountMenuOpen && (
              <div className="account-menu" role="menu">
                <span>{session.user.email}</span>
                <button type="button" role="menuitem" onClick={() => void logout()}>
                  <LogOut size={16} />
                  {locale === 'vi' ? 'Đăng xuất' : 'Sign out'}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumb"><span>{todayLabel}</span><span className="dot" /> <span>{hasConfirmedTasks ? (planApproved ? t.approved : t.schedule) : (locale === 'vi' ? 'Thiết lập workspace' : 'Set up workspace')}</span></div>
          <div className="top-actions">
            <button className="icon-button" type="button" title="Open extension preview" aria-label="Open extension preview" onClick={() => setExtensionOpen(true)}><PanelTop size={18} /></button>
            <button className="icon-button notification" type="button" title="Notifications" aria-label="Notifications"><Bell size={18} /><i /></button>
            <button className="icon-button mobile-account-button" type="button" title={locale === 'vi' ? 'Đăng xuất' : 'Sign out'} aria-label={locale === 'vi' ? 'Đăng xuất' : 'Sign out'} onClick={() => void logout()}><LogOut size={18} /></button>
            <div className="language-switch" aria-label="Language">
              <button className={locale === 'vi' ? 'selected' : ''} onClick={() => setLocale('vi')} type="button">VI</button>
              <button className={locale === 'en' ? 'selected' : ''} onClick={() => setLocale('en')} type="button">EN</button>
            </div>
          </div>
        </header>

        {!session.user.emailVerified && (
          <div className="email-verification-band" role="status">
            <MailCheck size={19} />
            <div>
              <strong>{locale === 'vi' ? 'Xác minh email để bảo vệ tài khoản' : 'Verify your email to protect your account'}</strong>
              <span>{session.user.email}</span>
            </div>
            <button type="button" disabled={verificationBusy} aria-busy={verificationBusy} onClick={() => void requestEmailVerification()}>
              {verificationBusy
                ? (locale === 'vi' ? 'Đang gửi...' : 'Sending...')
                : (locale === 'vi' ? 'Gửi liên kết' : 'Send link')}
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        <div className="content-area">
          <section className="main-content">
            {activeView === 'today' && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow"><span className="status-dot" /> {hasConfirmedTasks ? (locale === 'vi' ? 'Kế hoạch thích nghi đang hoạt động' : 'Adaptive plan is active') : (locale === 'vi' ? 'Bắt đầu không gian học riêng' : 'Start your private workspace')}</p>
                    <h1>{greeting}</h1>
                    <p className="subhead">{hasConfirmedTasks ? t.ready : (locale === 'vi' ? 'Thêm dữ liệu trước, xem lại điều Priori đọc, rồi mới xây kế hoạch đầu tiên.' : 'Add data first, review what Priori reads, then build your first plan.')}</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setActiveView('imports')}><Plus size={17} /> {t.import}</button>
                </div>

                {!dashboardBusy && !hasConfirmedTasks ? <section className="first-run-path" aria-labelledby="first-run-title"><div className="section-label"><span>{locale === 'vi' ? 'Bắt đầu' : 'Get started'}</span><span className="line" /></div><div className="workspace-empty"><ListChecks size={25} /><div><h2 id="first-run-title">{locale === 'vi' ? 'Add data -> Review -> Build first plan' : 'Add data -> Review -> Build first plan'}</h2><p>{locale === 'vi' ? 'Chưa có deadline hay điểm nào để Priori xếp ưu tiên. Bạn có thể import file hoặc tạo task thủ công; không có mục nào được đưa vào kế hoạch trước khi bạn xác nhận.' : 'There are no confirmed deadlines or scores to rank yet. Import a file or add one task manually; nothing enters a plan before you confirm it.'}</p></div><div className="first-run-actions"><button type="button" className="primary-button" onClick={() => setActiveView('imports')}><Upload size={17} /> {locale === 'vi' ? 'Thêm dữ liệu' : 'Add data'}</button><button type="button" className="secondary-button" onClick={() => setManualTaskOpen(true)}><Plus size={17} /> {locale === 'vi' ? 'Thêm task thủ công' : 'Add task manually'}</button></div></div></section> : <><section className="now-section" aria-labelledby="now-title">
                  <div className="section-label"><span>{locale === 'vi' ? '01 / Ưu tiên số một' : '01 / Highest priority'}</span><span className="line" /></div>
                  <div className="now-layout">
                    <article className="task-hero">
                      <div className="task-hero-header">
                        <span className="course-tag programming">{recommendation?.course.name ?? (locale === 'vi' ? 'Chua co task' : 'No task yet')}</span>
                        <button className="icon-button quiet" type="button" title="Task options" aria-label="Task options"><MoreHorizontal size={20} /></button>
                      </div>
                      <h2 id="now-title">{recommendation?.task.title ?? (dashboardBusy ? (locale === 'vi' ? 'Dang tai du lieu...' : 'Loading your data...') : (locale === 'vi' ? 'Them task dau tien cua ban' : 'Add your first task'))}</h2>
                      <p className="task-summary">{recommendation?.firstStep ?? (locale === 'vi' ? 'Tai lieu, deadline va task ban xac nhan se xuat hien o day.' : 'Confirmed tasks, deadlines, and document imports will appear here.')}</p>
                      <div className="task-meta"><span><CalendarDays size={16} /> {recommendation ? formatDue(recommendation.task.dueAt, locale) : (locale === 'vi' ? 'Chua co han nop' : 'No due date')}</span><span><Clock3 size={16} /> {recommendation ? `${recommendation.estimatedMinutes} min` : '0 min'}</span></div>
                      <div className="task-actions">
                        <button className="primary-button" type="button" disabled={!recommendation} onClick={beginFocus}><Play size={17} fill="currentColor" /> {startFocusLabel}</button>
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
                          <p>{recommendation?.assessment.costOfDelay.message ?? (locale === 'vi' ? 'Cần xác nhận một task để ước lượng chi phí trì hoãn.' : 'Confirm a task to estimate its cost of delay.')}</p>
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
                  <button className="icon-button" type="button" title="Plan details" aria-label="Plan details" onClick={() => setActiveView('plan')}><ChevronRight size={18} /></button>
                </section>
                </>}
              </>
            )}

            {activeView === 'plan' && (
              <section className="plan-view">
                <div className="page-heading compact"><div><p className="eyebrow"><WandSparkles size={15} /> {apiPlan ? (locale === 'vi' ? `Đề xuất phiên bản ${apiPlan.version}` : `Proposal version ${apiPlan.version}`) : (locale === 'vi' ? 'Chưa tạo đề xuất' : 'No proposal yet')}</p><h1>{locale === 'vi' ? 'Kế hoạch của bạn' : 'Your plan'}</h1><p className="subhead">{locale === 'vi' ? 'Tạo đề xuất từ dữ liệu đã xác nhận, xem lại rồi mới duyệt.' : 'Build from confirmed data, review the proposal, then approve it.'}</p></div>{apiPlan && <span className={planApproved ? 'approval-badge approved' : 'approval-badge'}>{planApproved ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}{planApproved ? t.approved : t.schedule}</span>}</div>
                {planFlow.error && <div className="inline-alert" role="alert"><CircleAlert size={18} /><div><strong>{locale === 'vi' ? 'Kế hoạch chưa thay đổi' : 'The plan did not change'}</strong><p>{planFlow.error}</p></div><button type="button" className="secondary-button" onClick={() => void approvePlan()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}
                {!apiPlan ? <div className="workspace-empty"><ListChecks size={24} /><div><h2>{hasConfirmedTasks ? (locale === 'vi' ? 'Xây đề xuất đầu tiên' : 'Build your first proposal') : (locale === 'vi' ? 'Thêm dữ liệu trước' : 'Add data first')}</h2><p>{hasConfirmedTasks ? (locale === 'vi' ? 'Chỉ task đã xác nhận mới được đưa vào lịch. Bạn sẽ xem lại trước khi duyệt.' : 'Only confirmed tasks enter the schedule. You will review it before approval.') : (locale === 'vi' ? 'Kế hoạch chỉ dùng task bạn đã xác nhận.' : 'Plans only use tasks you have confirmed.')}</p></div><button type="button" className="primary-button" disabled={planBusy} aria-busy={planBusy} onClick={() => hasConfirmedTasks ? void approvePlan() : setActiveView('imports')}><WandSparkles size={18} /> {hasConfirmedTasks ? (locale === 'vi' ? 'Tạo đề xuất' : 'Build proposal') : (locale === 'vi' ? 'Thêm dữ liệu' : 'Add data')}</button></div> : <>
                  <div className="plan-summary"><div><span>Version</span><strong>{apiPlan.version}</strong></div><div><span>Blocks</span><strong>{apiPlan.items?.length ?? 0}</strong></div><div><span>Minutes</span><strong>{apiPlan.items?.reduce((total, item) => total + item.minutes, 0) ?? 0}</strong></div></div>
                  {!planApproved ? <PlanProposalEditor plan={apiPlan} taskName={(taskId) => taskById.get(taskId)?.title ?? (locale === 'vi' ? 'Task đã xác nhận' : 'Confirmed task')} onSaved={replacePlan} /> : <div className="timeline">
                    {apiPlan.items?.map((item) => {
                      const task = taskById.get(item.taskId)
                      const timeRange = `${new Date(item.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(item.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      const missed = isMissedPlanItem(item.endsAt, task?.status)
                      return <article className={missed ? 'time-block focus-block time-block-missed' : 'time-block focus-block'} key={item.id}><span className="block-time">{timeRange}</span><strong>{task?.title ?? (locale === 'vi' ? 'Task đã xác nhận' : 'Confirmed task')}</strong><small>{item.firstStep}</small><span className={missed ? 'block-status missed' : 'block-status'}>{missed ? <CircleAlert size={15} /> : <Clock3 size={15} />} {missed ? (locale === 'vi' ? 'Đã lỡ block' : 'Missed block') : `${item.minutes} min`}</span>{missed && <button className="block-recovery" type="button" onClick={() => void openReplan('schedule_changed')}><TimerReset size={15} /> {locale === 'vi' ? 'Sắp lịch lại' : 'Recover block'}</button>}</article>
                    })}
                  </div>}
                  <div className="approval-bar"><div><ShieldCheck size={19} /><p>{locale === 'vi' ? 'Priori sẽ không thay đổi lịch này nếu bạn chưa duyệt.' : 'Priori will not change this schedule without your approval.'}</p></div>{!planApproved && <button type="button" className="primary-button" disabled={planBusy} aria-busy={planBusy} onClick={() => void approvePlan()}><Check size={18} /> {t.approve}</button>}</div>
                </>}
              </section>
            )}

            {activeView === 'imports' && (
              <section className="imports-view">
                <div className="page-heading compact"><div><p className="eyebrow"><Link2 size={15} /> {locale === 'vi' ? 'Nguồn dữ liệu của bạn' : 'Your data sources'}</p><h1>{locale === 'vi' ? 'Kết nối bối cảnh học kỳ' : 'Connect your semester context'}</h1><p className="subhead">{locale === 'vi' ? 'Bạn chọn dữ liệu nào Priori được phép dùng.' : 'You decide exactly what Priori can use.'}</p></div></div>
                <input ref={documentInputRef} className="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.json,.jsonl,application/pdf,image/png,image/jpeg,text/plain,text/csv,application/csv,application/vnd.ms-excel,application/json,application/x-ndjson" onChange={(event) => void handleDocumentSelected(event.target.files?.[0])} />
                <input ref={calendarInputRef} className="visually-hidden" type="file" accept=".ics,text/calendar" onChange={(event) => void handleCalendarSelected(event.target.files?.[0])} />
                <div className="import-grid">
                  <article className="source-card source-card-primary"><div className="source-icon">{importStatus === 'processing' ? <LoaderCircle className="inline-spinner" size={21} /> : <FileText size={21} />}</div><div><span className="source-status">{imported ? 'Confirmed' : importStatus === 'processing' ? 'Processing' : 'Recommended'}</span><h2>Study files</h2><p>{imported ? 'Imported data reviewed and confirmed' : importStatus === 'processing' ? 'Queued safely; extracting in the background' : 'PDF, PNG/JPG, TXT, CSV, JSON or JSONL'}</p></div><button type="button" className="mini-action" title="Upload study data" aria-label="Upload study data" disabled={importBusy} aria-busy={importBusy} onClick={() => documentInputRef.current?.click()}>{imported ? <Check size={17} /> : <Upload size={17} />}</button></article>
                  <article className="source-card"><div className="source-icon calendar-icon"><CalendarDays size={21} /></div><div><span className={calendarImported ? 'source-status' : 'source-status neutral'}>{calendarImported ? 'Confirmed' : 'Optional'}</span><h2>Calendar file</h2><p>{calendarImported ? 'ICS events reviewed and imported' : 'Import an ICS file from your calendar.'}</p></div><button type="button" className="mini-action" title="Import ICS calendar" disabled={importBusy} aria-busy={importBusy} onClick={() => calendarInputRef.current?.click()}>{calendarImported ? <Check size={17} /> : <Plus size={17} />}</button></article>
                  <article className="source-card"><div className="source-icon manual-icon"><ListChecks size={21} /></div><div><span className="source-status neutral">Always available</span><h2>Manual task</h2><p>Add a deadline or one task you are carrying.</p></div><button type="button" className="mini-action" title="Add task" onClick={() => setManualTaskOpen(true)}><Plus size={17} /></button></article>
                </div>
                <div className="data-policy"><ShieldCheck size={20} /><div><strong>{locale === 'vi' ? 'Sự đồng ý không bao giờ là mặc định.' : 'Consent is never the default.'}</strong><p>{locale === 'vi' ? 'Priori chỉ đọc dữ liệu bạn kết nối. File gốc tự xóa sau 30 ngày.' : 'Priori reads only data you connect. Original files are deleted after 30 days.'}</p></div><button type="button" className="text-button">{locale === 'vi' ? 'Xem quyền' : 'Review permissions'} <ArrowRight size={16} /></button></div>
                {importFlow.error && <div className="inline-alert" role="alert"><CircleAlert size={18} /><div><strong>{locale === 'vi' ? 'Chưa có dữ liệu nào được xác nhận' : 'No data was confirmed'}</strong><p>{importFlow.error}</p></div><button type="button" className="secondary-button" disabled={importBusy} onClick={() => void importFlow.retry()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}
                {reviewOpen && importReview && <section className="extract-review"><div className="review-heading"><div><span className="ai-chip"><Sparkles size={14} /> {importReview.kind === 'document' ? (importReview.provider?.startsWith('structured-') ? 'Structured import' : 'AI extracted') : 'ICS parsed'}</span><h2>{locale === 'vi' ? 'Xem lại trước khi thêm vào kế hoạch' : 'Review before adding to your plan'}</h2></div><button className="icon-button" type="button" title="Close review" aria-label="Close review" onClick={importFlow.closeReview}><X size={18} /></button></div>{importReview.kind === 'document' ? <ExtractionReviewEditor extraction={importReview.extraction} busy={importBusy} onChange={updateDocumentExtraction} onConfirm={() => void confirmImport()} /> : <><div className="extracted-rows"><div><CalendarDays size={18} /><span>{importReview.busyBlockCount} busy blocks</span><strong>Your existing calendar remains read only</strong></div><div><ListChecks size={18} /><span>{importReview.taskCount} tasks found</span><strong>Nothing enters your plan before confirmation</strong></div></div><div className="review-actions"><p>{locale === 'vi' ? 'Sự kiện lịch chỉ được thêm sau khi bạn xác nhận.' : 'Calendar entries are added only after confirmation.'}</p><button className="primary-button" type="button" disabled={importBusy} aria-busy={importBusy} onClick={() => void confirmImport()}><Check size={17} /> Confirm</button></div></>}</section>}
              </section>
            )}

            {activeView === 'coach' && (
              <section className="coach-view">
                <div className="page-heading compact"><div><p className="eyebrow"><Sparkles size={15} /> {t.assistant}</p><h1>{locale === 'vi' ? 'Điều gì khiến việc này quan trọng?' : 'Why does this matter now?'}</h1><p className="subhead">{locale === 'vi' ? 'Một lời giải thích để hành động, không phải một lời nhắc chung chung.' : 'An explanation that moves you forward, not a generic reminder.'}</p></div></div>
                <article className="coach-answer">
                  <div className="coach-answer-top">
                    <span className="ai-avatar"><Sparkles size={18} /></span>
                    <div>
                      <strong>{recommendation?.task.title ?? 'No confirmed task yet'}</strong>
                      <span>{recommendation ? `${recommendation.course.name} · ${formatDue(recommendation.task.dueAt, locale)}` : 'Confirm a task to see its evidence.'}</span>
                    </div>
                    <span className="confidence">{recommendation ? `${Math.round(recommendation.task.confidence * 100)}% confidence` : 'No evidence yet'}</span>
                  </div>
                  {recommendation ? <>
                    <div className="reason-grid">
                      <div><span className="reason-number">01</span><h3>Academic impact</h3><p>{recommendation.assessment.evidence[0] ?? 'No grade evidence has been confirmed.'}</p></div>
                      <div><span className="reason-number">02</span><h3>Cost of delay</h3><p>{recommendation.assessment.costOfDelay.message}</p></div>
                      <div><span className="reason-number">03</span><h3>Smallest useful start</h3><p>{recommendation.firstStep}</p></div>
                    </div>
                    <div className="coach-foot"><div><TimerReset size={18} /><p><strong>{focusMinutes} minutes now</strong> is sized from the confirmed task estimate. Data confidence: {confidenceLabel}.</p></div><button className="primary-button" type="button" onClick={beginFocus}><Play size={17} fill="currentColor" /> Start first step</button></div>
                  </> : <div className="workspace-empty"><ListChecks size={22} /><div><h2>Add confirmed context first</h2><p>Priori will only explain a priority after you have confirmed the underlying course and task data.</p></div><button className="secondary-button" type="button" onClick={() => setActiveView('imports')}>Add data</button></div>}
                </article>
                <section className="checkin-panel"><div><span className="checkin-label">{t.checkin}</span><h2>{locale === 'vi' ? 'Bạn không cần phải ép mình qua mọi trở ngại.' : 'You do not have to push through every obstacle.'}</h2><p>{locale === 'vi' ? 'Khi thực tế thay đổi, Priori đưa ra một phương án khác để bạn duyệt.' : 'When reality changes, Priori gives you a different plan to approve.'}</p></div><button className="outline-button" type="button" onClick={() => void openReplan()}><CircleAlert size={18} /> {t.stuck}</button></section>
                {replanApproved && <div className="replan-success"><CheckCircle2 size={20} /><span>{locale === 'vi' ? 'Phương án thay thế đã được duyệt và phiên bản kế hoạch trước vẫn được lưu lại.' : 'The replacement proposal is approved and the previous plan version remains preserved.'}</span></div>}
              </section>
            )}

            {activeView === 'settings' && (
              <section className="settings-view" aria-labelledby="settings-title">
                <div className="page-heading compact"><div><p className="eyebrow"><ShieldCheck size={15} /> {locale === 'vi' ? 'Kiểm soát dữ liệu' : 'Data controls'}</p><h1 id="settings-title">{locale === 'vi' ? 'Quyền riêng tư và dữ liệu' : 'Privacy and data'}</h1><p className="subhead">{locale === 'vi' ? 'Mỗi quyền có mục đích riêng và có thể rút lại mà không làm thay đổi dữ liệu đã xác nhận.' : 'Each permission has a specific purpose and can be withdrawn without changing confirmed data.'}</p></div></div>
                <div className="settings-grid">
                  <LearnerProfilePanel locale={locale} profile={learnerProfile} busy={settingsBusy} onSave={saveLearnerProfile} />
                  <section className="settings-panel"><div className="settings-panel-heading"><div><h2>{locale === 'vi' ? 'Quyền dữ liệu' : 'Data permissions'}</h2><p>{locale === 'vi' ? 'Thay đổi được ghi vào lịch sử đồng ý của bạn.' : 'Every change is recorded in your consent history.'}</p></div>{settingsBusy && <LoaderCircle className="inline-spinner" size={18} />}</div><div className="permission-list">{([
                    { purpose: 'email_digest', title: locale === 'vi' ? 'Email tổng hợp hằng ngày' : 'Daily email digest', detail: session.user.emailVerified ? (locale === 'vi' ? 'Nhận tối đa một bản tổng hợp từ các task đã xác nhận mỗi ngày.' : 'Receive at most one digest from your confirmed tasks each day.') : (locale === 'vi' ? 'Xác minh email để bật tùy chọn này.' : 'Verify your email to enable this option.') },
                    { purpose: 'research_metrics', title: locale === 'vi' ? 'Nghiên cứu tổng hợp' : 'Aggregate research', detail: locale === 'vi' ? 'Cho phép dùng dữ liệu đã tổng hợp, không định danh.' : 'Allow anonymized aggregate research only.' },
                  ] as const).map(({ purpose, title, detail }) => {
                    const granted = consentByPurpose[purpose]?.granted ?? false
                    const verificationBlocksEnable = purpose === 'email_digest' && !session.user.emailVerified && !granted
                    return <label className="permission-row" key={purpose}><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" checked={granted} disabled={settingsBusy || verificationBlocksEnable} onChange={(event) => void updateConsent(purpose, event.target.checked)} /></label>
                  })}</div></section>
                  <section className="settings-panel"><div className="settings-panel-heading"><div><h2>{locale === 'vi' ? 'Xuất dữ liệu' : 'Export your data'}</h2><p>{locale === 'vi' ? 'Tải một tệp JSON gồm dữ liệu có cấu trúc, kế hoạch và lịch sử đồng ý. File gốc không được kèm theo.' : 'Download a JSON file with your structured data, plans, and consent history. Original files are not included.'}</p></div></div><button className="secondary-button" type="button" disabled={exportBusy} aria-busy={exportBusy} onClick={() => void downloadExport()}><Download size={17} /> {locale === 'vi' ? 'Tải bản xuất dữ liệu' : 'Download export'}</button></section>
                  <section className="settings-panel settings-danger"><div className="settings-panel-heading"><div><h2>{locale === 'vi' ? 'Xóa tài khoản' : 'Delete account'}</h2><p>{locale === 'vi' ? 'Nhập email để bắt đầu xóa. Phiên đăng nhập bị thu hồi ngay; file gốc và dữ liệu còn lại được dọn theo biên nhận.' : 'Enter your email to begin deletion. Sessions are revoked immediately; raw files and remaining data are cleaned through the deletion receipt.'}</p></div></div><label className="delete-confirmation">{locale === 'vi' ? `Nhập ${session.user.email} để xác nhận` : `Enter ${session.user.email} to confirm`}<input type="email" autoComplete="email" value={deletionConfirmation} onChange={(event) => setDeletionConfirmation(event.target.value)} /></label><button className="danger-button" type="button" disabled={deletionBusy || deletionConfirmation.trim().toLowerCase() !== session.user.email} aria-busy={deletionBusy} onClick={() => void requestAccountDeletion()}><Trash2 size={17} /> {locale === 'vi' ? 'Bắt đầu xóa tài khoản' : 'Start account deletion'}</button></section>
                </div>
              </section>
            )}
          </section>

          <aside className="right-rail">
            {hasConfirmedTasks && <><section className="coach-card"><div className="coach-card-head"><div><span className="assistant-dot"><Sparkles size={15} /></span><strong>Priori Agent</strong></div><button className="icon-button quiet" type="button" title="Open coaching evidence" aria-label="Open coaching evidence" onClick={() => setActiveView('coach')}><ChevronRight size={17} /></button></div><p>{recommendation?.assessment.evidence.slice(0, 2).join(' · ') ?? (locale === 'vi' ? 'Xác nhận dữ liệu để xem lý do ưu tiên.' : 'Confirm data to see the priority evidence.')}</p><div className="coach-mode"><span>{locale === 'vi' ? 'Độ chắc chắn dữ liệu' : 'Data certainty'}</span><strong>{confidenceLabel}</strong></div></section>
            <section className="progress-card"><div className="card-heading"><h2>{locale === 'vi' ? 'Hoạt động học tập' : 'Learning activity'}</h2></div><div className="streak"><span><Flame size={18} fill="currentColor" /> {focusCompleted}</span><p>{locale === 'vi' ? 'phiên tập trung đã hoàn thành' : 'completed focus sessions'}</p></div><p className="progress-context">{metrics.plan_approved ? (locale === 'vi' ? `${metrics.plan_approved} kế hoạch đã được duyệt` : `${metrics.plan_approved} approved plans`) : (locale === 'vi' ? 'Chưa có kế hoạch được duyệt.' : 'No approved plan yet.')}</p></section></>}
            <section className="privacy-card"><LockKeyhole size={17} /><div><strong>{locale === 'vi' ? 'Không chia sẻ với trường' : 'Not shared with your school'}</strong><p>{locale === 'vi' ? 'Kế hoạch và rủi ro học tập này chỉ dành cho bạn.' : 'This study plan and risk signal are private to you.'}</p></div></section>
          </aside>
        </div>
      </section>

      {manualTaskOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-task-title">
        <form className="manual-task-modal" onSubmit={(event) => void saveManualTask(event)}>
          <button className="icon-button modal-close" type="button" title="Close task editor" onClick={() => setManualTaskOpen(false)}><X size={20} /></button>
          <span className="ai-chip"><ListChecks size={14} /> Manual task</span>
          <h2 id="manual-task-title">{locale === 'vi' ? 'Them task cua ban' : 'Add a task'}</h2>
          {courses.length === 0 ? <div className="manual-task-grid"><label>Course code<input required maxLength={64} autoFocus value={manualTask.courseCode} onChange={(event) => setManualTask((current) => ({ ...current, courseCode: event.target.value }))} /></label><label>Course name<input required maxLength={240} value={manualTask.courseName} onChange={(event) => setManualTask((current) => ({ ...current, courseName: event.target.value }))} /></label></div> : <label>Course<select value={manualTask.courseId} onChange={(event) => setManualTask((current) => ({ ...current, courseId: event.target.value }))}>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</select></label>}
          <label>Task<input required maxLength={240} autoFocus={courses.length > 0} value={manualTask.title} onChange={(event) => setManualTask((current) => ({ ...current, title: event.target.value }))} /></label>
          <div className="manual-task-grid"><label>Due date<input type="datetime-local" value={manualTask.dueAt} onChange={(event) => setManualTask((current) => ({ ...current, dueAt: event.target.value }))} /></label><label>Weight (%)<input type="number" min="0" max="100" value={manualTask.gradeWeight} onChange={(event) => setManualTask((current) => ({ ...current, gradeWeight: event.target.value }))} /></label><label>Minutes<input required type="number" min="5" max="600" value={manualTask.estimatedMinutes} onChange={(event) => setManualTask((current) => ({ ...current, estimatedMinutes: event.target.value }))} /></label></div>
          <div className="replan-actions"><button type="button" className="secondary-button" onClick={() => setManualTaskOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={manualTaskBusy} aria-busy={manualTaskBusy}><Check size={18} /> Add task</button></div>
        </form>
      </div>}

      {focusOpen && recommendation && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="focus-title"><section className="focus-modal"><button className="icon-button modal-close" type="button" title="Close focus session" aria-label="Close focus session" disabled={focusBusy} onClick={() => { setFocusOpen(false); setFocusRunning(false) }}><X size={20} /></button><div className="focus-photo"><img src={focusImage} alt="Student reviewing a study plan at a desk" /></div><div className="focus-overlay"><span className="focus-kicker">{recommendation.course.name} · {focusMinutes} minute focus</span><h2 id="focus-title">{recommendation.task.title}</h2><p>{recommendation.firstStep}</p><div className="timer">{time}</div>{focusError && <div className="focus-error" role="alert"><CircleAlert size={17} /><span>{focusError}</span></div>}<div className="focus-controls"><button className={focusRunning ? 'pause-button' : 'primary-button'} type="button" disabled={focusBusy} onClick={() => setFocusRunning(!focusRunning)}>{focusRunning ? <><TimerReset size={17} /> {locale === 'vi' ? 'Tạm dừng' : 'Pause'}</> : <><Play size={17} fill="currentColor" /> {locale === 'vi' ? 'Tiếp tục' : 'Resume'}</>}</button><button className="pause-button" type="button" disabled={focusBusy} aria-busy={focusBusy} onClick={() => void finishFocusSession()}><CircleCheck size={17} /> {locale === 'vi' ? 'Kết thúc phiên' : 'Finish session'}</button><button className="focus-complete-button" type="button" disabled={focusBusy} aria-busy={focusBusy} onClick={() => void completeFocusTask()}><CheckCircle2 size={17} /> {locale === 'vi' ? 'Hoàn tất task' : 'Complete task'}</button></div></div></section></div>}

      {replanOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="replan-title"><section className="replan-modal"><button className="icon-button modal-close" type="button" title="Close replanning" aria-label="Close replanning" onClick={() => setReplanOpen(false)}><X size={20} /></button><span className="ai-chip"><Sparkles size={14} /> Priori Agent</span><h2 id="replan-title">{locale === 'vi' ? 'Điều gì đang cản bạn?' : 'What is getting in the way?'}</h2><div className="friction-options"><button type="button" className={replanFriction === 'cannot_start' ? 'friction-selected' : ''} aria-pressed={replanFriction === 'cannot_start'} onClick={() => void selectReplanFriction('cannot_start')}><span>01</span>{locale === 'vi' ? 'Không biết bắt đầu' : 'I do not know where to start'}</button><button type="button" className={replanFriction === 'too_tired' ? 'friction-selected' : ''} aria-pressed={replanFriction === 'too_tired'} onClick={() => void selectReplanFriction('too_tired')}><span>02</span>{locale === 'vi' ? 'Quá mệt' : 'I am too tired'}</button><button type="button" className={replanFriction === 'schedule_changed' ? 'friction-selected' : ''} aria-pressed={replanFriction === 'schedule_changed'} onClick={() => void selectReplanFriction('schedule_changed')}><span>03</span>{locale === 'vi' ? 'Lịch vừa thay đổi' : 'My schedule changed'}</button></div>{replanBusy && <p className="replan-loading"><LoaderCircle size={16} /> {locale === 'vi' ? 'Đang chuẩn bị phương án...' : 'Preparing a proposal...'}</p>}{apiReplan && <div className="proposal"><span>{apiReplan.title}</span><strong>{apiReplan.changes[0] ?? (locale === 'vi' ? 'Phương án mới đã sẵn sàng để xem lại.' : 'A new proposal is ready for review.')}</strong><p>{apiReplan.rationale}</p><div className="replan-comparison"><span>{locale === 'vi' ? `Trước: ${apiPlan?.items?.[0]?.minutes ?? 0} phút` : `Before: ${apiPlan?.items?.[0]?.minutes ?? 0} min`}</span><span>{locale === 'vi' ? `Sau: ${apiReplan.proposedItems[0]?.minutes ?? 0} phút` : `After: ${apiReplan.proposedItems[0]?.minutes ?? 0} min`}</span></div></div>}<div className="replan-actions"><button type="button" className="secondary-button" onClick={() => setReplanOpen(false)}>{locale === 'vi' ? 'Chưa phù hợp' : 'Not right yet'}</button><button type="button" className="primary-button" disabled={replanBusy || !apiReplan} aria-busy={replanBusy} onClick={() => void approveReplan()}><Check size={18} /> {locale === 'vi' ? 'Duyệt phương án này' : 'Approve this plan'}</button></div></section></div>}

      {extensionOpen && <div className="extension-popover"><div className="extension-top"><div className="brand"><span className="brand-mark"><Focus size={16} /></span><span>priorilearn</span></div><button className="icon-button quiet" type="button" title="Close extension preview" onClick={() => setExtensionOpen(false)}><X size={17} /></button></div><span className="extension-context"><GraduationCap size={15} /> Canvas · visible page heading</span><h3>Review Canvas context</h3><p>The visible heading is ready as an unconfirmed task draft.</p><button className="primary-button full-button" type="button" onClick={() => { setManualTask((current) => ({ ...current, title: current.title || 'Canvas page context' })); setManualTaskOpen(true); setExtensionOpen(false) }}><ListChecks size={16} /> Review task draft</button><div className="extension-note"><LockKeyhole size={14} /> Nothing is saved until you review and confirm it.</div></div>}

      {toast && <div className="toast"><CircleCheck size={18} /> {toast}</div>}
    </main>
  )
}

export default App
