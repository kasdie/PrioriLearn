import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
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
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  LogOut,
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
import { WebPushSettings } from './features/notifications/WebPushSettings'
import { LearnerProfilePanel } from './features/profile/LearnerProfilePanel'
import { PlanProposalEditor } from './features/plan/PlanProposalEditor'
import { usePlanFlow } from './features/plan/usePlanFlow'
import { PlanningAssistant } from './features/planning/PlanningAssistant'
import { WeeklyPlanBoard } from './features/planning/WeeklyPlanBoard'
import { useSession } from './features/session/useSession'
import { ApiClientError, prioriApi, userFacingError, type ApiAvailabilityBlock, type ApiConsent, type ApiCourse, type ApiDashboard, type ApiLearnerProfile, type ApiLearnerSignal, type ApiMetrics, type ApiPlanningPreferences, type ApiReplanProposal, type ApiSession, type ApiSourceDocument, type ApiTask } from './lib/api'
import './App.css'

type Locale = 'vi' | 'en'
type View = 'today' | 'plan' | 'imports' | 'coach' | 'settings'
const copy = {
  vi: {
    today: 'Hôm nay',
    plan: 'Kế hoạch',
    imports: 'Dữ liệu',
    coach: 'Cố vấn',
    ready: 'Các nhiệm vụ đã xác nhận đang được xếp theo dữ liệu học tập của bạn.',
    now: 'Làm việc này ngay',
    why: 'Tại sao là việc này?',
    start: 'Bắt đầu phiên 45 phút',
    priority: 'Ưu tiên hôm nay',
    schedule: 'Kế hoạch đang chờ duyệt',
    approve: 'Duyệt kế hoạch',
    approved: 'Đã duyệt',
    stuck: 'Mình đang bị kẹt',
    checkin: 'Trao đổi với Priori',
    import: 'Thêm dữ liệu',
    focus: 'Phiên tập trung',
    assistant: 'Trợ lý Priori',
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

function ScoreRing({ score, locale }: { score: number; locale: Locale }) {
  return (
    <div className="score-ring" style={{ '--score': `${score * 3.6}deg` } as React.CSSProperties} aria-label={locale === 'vi' ? `Điểm ưu tiên ${score}` : `Priority score ${score}`}>
      <strong>{score}</strong>
      <span>{locale === 'vi' ? 'điểm' : 'score'}</span>
    </div>
  )
}

function formatDue(dueAt: string | null, locale: Locale): string {
  if (!dueAt) return locale === 'vi' ? 'Chưa có hạn nộp' : 'No due date'
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(dueAt))
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function importStatusLabel(status: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    queued: ['Đang chờ', 'Queued'],
    processing: ['Đang trích xuất', 'Extracting'],
    review: ['Cần xem lại', 'Review required'],
    confirming: ['Đang xác nhận', 'Confirming'],
    confirmed: ['Đã xác nhận', 'Confirmed'],
    error: ['Cần thử lại', 'Needs retry'],
    uploading: ['Đang tải lên', 'Uploading'],
    upload_failed: ['Tải lên thất bại', 'Upload failed'],
    uploaded: ['Đã tải lên', 'Uploaded'],
    extracting: ['Đang trích xuất', 'Extracting'],
    extraction_failed: ['Trích xuất thất bại', 'Extraction failed'],
  }
  return labels[status]?.[locale === 'vi' ? 0 : 1] ?? status
}

function canResumeDocument(document: ApiSourceDocument): boolean {
  if (document.status === 'review') return Boolean(document.extraction)
  return !document.rawDeletedAt && ['uploaded', 'extracting', 'extraction_failed'].includes(document.status)
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
  const [toast, setToast] = useState<string | null>(null)
  const [apiReplan, setApiReplan] = useState<ApiReplanProposal | null>(null)
  const [dashboard, setDashboard] = useState<ApiDashboard | null>(null)
  const [metrics, setMetrics] = useState<ApiMetrics>({})
  const [courses, setCourses] = useState<ApiCourse[]>([])
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [dashboardBusy, setDashboardBusy] = useState(true)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [manualTaskOpen, setManualTaskOpen] = useState(false)
  const [manualTaskBusy, setManualTaskBusy] = useState(false)
  const [manualTask, setManualTask] = useState({ courseId: '', courseCode: '', courseName: '', title: '', dueAt: '', gradeWeight: '', estimatedMinutes: '45' })
  const [consents, setConsents] = useState<ApiConsent[]>([])
  const [learnerProfile, setLearnerProfile] = useState<ApiLearnerProfile>({ version: 0, signals: [], sourceEventCount: 0 })
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const [deletionBusy, setDeletionBusy] = useState(false)
  const [sourceDocuments, setSourceDocuments] = useState<ApiSourceDocument[]>([])
  const [sourceDocumentsNextCursor, setSourceDocumentsNextCursor] = useState<string | undefined>()
  const [sourceDocumentsBusy, setSourceDocumentsBusy] = useState(false)
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
  const [planningPreferences, setPlanningPreferences] = useState<ApiPlanningPreferences | null>(null)
  const [availabilityBlocks, setAvailabilityBlocks] = useState<ApiAvailabilityBlock[]>([])
  const documentInputRef = useRef<HTMLInputElement>(null)
  const calendarInputRef = useRef<HTMLInputElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const refreshWorkspace = useCallback(async () => {
    const [nextDashboard, taskData, nextMetrics, nextPlanningPreferences] = await Promise.all([
      prioriApi.dashboard(locale),
      prioriApi.tasks(),
      prioriApi.metrics(),
      prioriApi.planningPreferences(),
    ])
    setDashboard(nextDashboard)
    setCourses(taskData.courses)
    setTasks(taskData.tasks)
    setAvailabilityBlocks(taskData.availabilityBlocks)
    setMetrics(nextMetrics)
    setPlanningPreferences(nextPlanningPreferences)
    setWorkspaceError(null)
    setManualTask((current) => current.courseId || taskData.courses.length === 0 ? current : { ...current, courseId: taskData.courses[0]?.id ?? '' })
  }, [locale])

  const loadSourceDocuments = useCallback(async () => {
    setSourceDocumentsBusy(true)
    try {
      const response = await prioriApi.documents(undefined, 50)
      setSourceDocuments(response.documents)
      setSourceDocumentsNextCursor(response.nextCursor)
    } catch (error) {
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Chưa thể tải danh sách tệp.' : 'Could not load your files.'))
    } finally {
      setSourceDocumentsBusy(false)
    }
  }, [locale])

  const loadMoreSourceDocuments = async () => {
    if (!sourceDocumentsNextCursor || sourceDocumentsBusy) return
    setSourceDocumentsBusy(true)
    try {
      const response = await prioriApi.documents(sourceDocumentsNextCursor, 50)
      setSourceDocuments((current) => [...current, ...response.documents.filter((document) => !current.some((item) => item.id === document.id))])
      setSourceDocumentsNextCursor(response.nextCursor)
    } catch {
      setToast(locale === 'vi' ? 'Chưa thể tải thêm tệp.' : 'Could not load more files.')
    } finally {
      setSourceDocumentsBusy(false)
    }
  }

  const retryWorkspace = async () => {
    setDashboardBusy(true)
    try {
      await refreshWorkspace()
    } catch {
      setWorkspaceError(locale === 'vi'
        ? 'Vẫn chưa thể tải dữ liệu học tập. Dữ liệu đã xác nhận vẫn an toàn.'
        : 'Study data still could not be loaded. Your confirmed data is still safe.')
    } finally {
      setDashboardBusy(false)
    }
  }

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
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Không thể tải các quyền dữ liệu.' : 'Could not load your data permissions.'))
    } finally {
      setSettingsBusy(false)
    }
  }, [locale])

  const planFlow = usePlanFlow(prioriApi, locale)
  const { plan: apiPlan, approved: planApproved, busy: planBusy, replacePlan } = planFlow
  const planWarnings = apiPlan?.schedulingWarnings ?? []
  const newlyConfirmedTasks = useMemo(() => {
    if (!apiPlan?.createdAt) return []
    const planCreatedAt = Date.parse(apiPlan.createdAt)
    return tasks.filter((task) => task.status === 'confirmed' && task.createdAt && Date.parse(task.createdAt) > planCreatedAt)
  }, [apiPlan?.createdAt, tasks])
  const importFlow = useImportFlow({
    locale,
    onConfirmed: async () => {
      await Promise.all([refreshWorkspace(), loadSourceDocuments()])
    },
  })
  const {
    status: importStatus,
    review: importReview,
    busy: importBusy,
    documentConfirmed: imported,
    calendarConfirmed: calendarImported,
    queue: importQueue,
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

  const clearWorkspace = () => {
    setDashboard(null)
    setMetrics({})
    setCourses([])
    setTasks([])
    setAvailabilityBlocks([])
    setSourceDocuments([])
    setSourceDocumentsNextCursor(undefined)
    setPlanningPreferences(null)
    setWorkspaceError(null)
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
        const message = locale === 'vi'
          ? 'Đã đăng nhập nhưng chưa thể tải dữ liệu học tập. Dữ liệu đã xác nhận vẫn an toàn.'
          : 'Signed in, but study data could not be loaded. Your confirmed data is still safe.'
        setWorkspaceError(message)
        setToast(message)
      })
      .finally(() => {
        if (active) setDashboardBusy(false)
      })
    return () => {
      active = false
    }
  }, [locale, refreshWorkspace, replacePlan, session])

  useEffect(() => {
    if (!session || activeView !== 'imports') return
    void loadSourceDocuments()
  }, [activeView, loadSourceDocuments, session])

  useEffect(() => {
    if (!session || activeView !== 'settings') return
    void loadSettings()
  }, [activeView, loadSettings, session])

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
          ? `Đã lưu ${elapsedMinutes} phút tập trung. Nhiệm vụ vẫn ở hàng đợi cho đến khi bạn hoàn tất.`
          : 'Đã lưu phiên tập trung. Nhiệm vụ vẫn ở hàng đợi cho đến khi bạn hoàn tất.'
        : elapsedMinutes > 0
          ? `${elapsedMinutes} focused minutes saved. The task stays in your queue until you complete it.`
          : 'Focus session saved. The task stays in your queue until you complete it.')
    } catch (error) {
      setFocusError(userFacingError(error, locale, locale === 'vi' ? 'Chưa lưu được phiên tập trung. Nhiệm vụ vẫn giữ nguyên.' : 'The focus session was not saved. Your task remains unchanged.'))
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
      setFocusError(userFacingError(error, locale, locale === 'vi' ? 'Chưa thể hoàn tất nhiệm vụ. Kế hoạch hiện tại vẫn giữ nguyên.' : 'The task was not completed. Your current task and plan remain safe.'))
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

  const rebuildPlan = async () => {
    if (planBusy) return
    const proposal = await planFlow.generate(Boolean(apiPlan))
    if (proposal) {
      setToast(locale === 'vi'
        ? 'Đề xuất mới đã dùng dữ liệu và lịch rảnh mới nhất. Hãy xem lại trước khi duyệt.'
        : 'The new proposal uses your latest data and availability. Review it before approval.')
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
      if (!courseId) throw new Error(locale === 'vi' ? 'Cần có môn học trước khi lưu nhiệm vụ.' : 'A course is required before saving a task.')
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
      setToast(locale === 'vi' ? 'Đã thêm nhiệm vụ vào danh sách ưu tiên.' : 'Task added to your priority list.')
    } catch (error) {
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Không thể lưu nhiệm vụ.' : 'Could not save the task.'))
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
      setApiReplan(await prioriApi.createReplan(apiPlan, initialFriction, locale))
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
      setApiReplan(await prioriApi.createReplan(apiPlan, friction, locale))
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

  const handleDocumentsSelected = async (files: File[]) => {
    if (files.length === 0) return
    await importFlow.selectDocuments(files)
    if (documentInputRef.current) documentInputRef.current.value = ''
  }

  const handleCalendarSelected = async (file: File | undefined) => {
    if (!file) return
    await importFlow.selectCalendar(file)
    if (calendarInputRef.current) calendarInputRef.current.value = ''
  }

  const confirmImport = async () => {
    if (!importReview) return
    const reviewCount = importQueue.filter((item) => item.status === 'review' || item.status === 'confirming').length
    const confirmed = await importFlow.confirm()
    if (!confirmed) return
    setToast(locale === 'vi' ? 'Tệp đã được xác nhận và sẵn sàng để lập kế hoạch.' : 'File confirmed and ready for planning.')
    if (reviewCount <= 1 && !importQueue.some((item) => item.status === 'processing' || item.status === 'queued')) {
      setActiveView('plan')
    }
  }

  const deleteSourceDocument = async (document: ApiSourceDocument) => {
    const confirmed = window.confirm(locale === 'vi'
      ? `Xóa tệp nguồn “${document.filename}”? Các nhiệm vụ đã xác nhận vẫn được giữ, nhưng tệp gốc và bản nháp trích xuất sẽ bị xóa.`
      : `Delete source file “${document.filename}”? Confirmed tasks stay, but the raw file and extraction draft will be removed.`)
    if (!confirmed) return
    setDeletingDocumentId(document.id)
    try {
      await prioriApi.deleteDocument(document.id)
      setSourceDocuments((current) => current.filter((item) => item.id !== document.id))
      setToast(locale === 'vi' ? 'Đã xóa tệp nguồn.' : 'Source file deleted.')
    } catch (error) {
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Chưa thể xóa tệp nguồn.' : 'Could not delete the source file.'))
    } finally {
      setDeletingDocumentId(null)
    }
  }

  const updateConsent = async (purpose: ApiConsent['purpose'], granted: boolean) => {
    if (settingsBusy) return
    setSettingsBusy(true)
    try {
      const consent = await prioriApi.setConsent({ purpose, granted })
      setConsents((current) => [...current, consent])
      setToast(locale === 'vi' ? 'Quyền dữ liệu đã được cập nhật.' : 'Data permission updated.')
    } catch (error) {
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Không thể cập nhật quyền này.' : 'Could not update this permission.'))
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
      setToast(locale === 'vi' ? 'Hồ sơ học tập đã được lưu. Cố vấn chỉ dùng khi bạn yêu cầu đề xuất.' : 'Learner profile saved. Coach only uses it when you request a proposal.')
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'LEARNER_PROFILE_VERSION_CONFLICT') {
        const refreshed = await prioriApi.learnerProfile().catch(() => null)
        if (refreshed) setLearnerProfile(refreshed)
        setToast(locale === 'vi' ? 'Hồ sơ đã thay đổi ở thẻ khác và được tải lại.' : 'Your profile changed in another tab and was reloaded.')
      } else {
        setToast(userFacingError(error, locale, locale === 'vi' ? 'Không thể lưu hồ sơ học tập.' : 'Could not save learner profile.'))
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
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Chưa thể tạo tệp xuất dữ liệu.' : 'Could not create your data export.'))
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
      setToast(userFacingError(error, locale, locale === 'vi' ? 'Chưa thể bắt đầu xóa tài khoản.' : 'Could not start account deletion.'))
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
        <span>{locale === 'vi' ? 'Đang mở không gian học...' : 'Opening your workspace...'}</span>
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
              <span className="user-copy"><strong>{session.user.name}</strong><small>{session.user.role === 'student' ? (locale === 'vi' ? 'Sinh viên' : 'Student') : session.user.role}</small></span>
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
          <div className="crumb"><span>{todayLabel}</span><span className="dot" /> <span>{hasConfirmedTasks ? (planApproved ? t.approved : t.schedule) : (locale === 'vi' ? 'Thiết lập không gian học' : 'Set up workspace')}</span></div>
          <div className="top-actions">
            <button className="icon-button mobile-account-button" type="button" title={locale === 'vi' ? 'Đăng xuất' : 'Sign out'} aria-label={locale === 'vi' ? 'Đăng xuất' : 'Sign out'} onClick={() => void logout()}><LogOut size={18} /></button>
            <div className="language-switch" aria-label={locale === 'vi' ? 'Ngôn ngữ' : 'Language'}>
              <button className={locale === 'vi' ? 'selected' : ''} onClick={() => void sessionFlow.changeLocale('vi')} type="button">VI</button>
              <button className={locale === 'en' ? 'selected' : ''} onClick={() => void sessionFlow.changeLocale('en')} type="button">EN</button>
            </div>
          </div>
        </header>

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
                  {workspaceError && <div className="inline-alert page-heading-error" role="alert"><CircleAlert size={18} /><div><strong>{locale === 'vi' ? 'Không gian học chưa tải đủ dữ liệu' : 'Workspace data is incomplete'}</strong><p>{workspaceError}</p></div><button type="button" className="secondary-button" disabled={dashboardBusy} onClick={() => void retryWorkspace()}>{locale === 'vi' ? 'Tải lại' : 'Retry'}</button></div>}
                </div>

                {!dashboardBusy && !hasConfirmedTasks ? <section className="first-run-path" aria-labelledby="first-run-title"><div className="section-label"><span>{locale === 'vi' ? 'Bắt đầu' : 'Get started'}</span><span className="line" /></div><div className="workspace-empty"><ListChecks size={25} /><div><h2 id="first-run-title">{locale === 'vi' ? 'Thêm dữ liệu -> Xem lại -> Tạo kế hoạch đầu tiên' : 'Add data -> Review -> Build first plan'}</h2><p>{locale === 'vi' ? 'Chưa có hạn nộp hay điểm nào để Priori xếp ưu tiên. Bạn có thể nhập tệp hoặc tạo nhiệm vụ thủ công; không có mục nào được đưa vào kế hoạch trước khi bạn xác nhận.' : 'There are no confirmed deadlines or scores to rank yet. Import a file or add one task manually; nothing enters a plan before you confirm it.'}</p></div><div className="first-run-actions"><button type="button" className="primary-button" onClick={() => setActiveView('imports')}><Upload size={17} /> {locale === 'vi' ? 'Thêm dữ liệu' : 'Add data'}</button><button type="button" className="secondary-button" onClick={() => setManualTaskOpen(true)}><Plus size={17} /> {locale === 'vi' ? 'Thêm nhiệm vụ thủ công' : 'Add task manually'}</button></div></div></section> : <><section className="now-section" aria-labelledby="now-title">
                  <div className="section-label"><span>{locale === 'vi' ? '01 / Ưu tiên số một' : '01 / Highest priority'}</span><span className="line" /></div>
                  <div className="now-layout">
                    <article className="task-hero">
                      <div className="task-hero-header">
                        <span className="course-tag programming">{recommendation?.course.name ?? (locale === 'vi' ? 'Chưa có nhiệm vụ' : 'No task yet')}</span>
                      </div>
                      <h2 id="now-title">{recommendation?.task.title ?? (dashboardBusy ? (locale === 'vi' ? 'Đang tải dữ liệu...' : 'Loading your data...') : (locale === 'vi' ? 'Thêm nhiệm vụ đầu tiên của bạn' : 'Add your first task'))}</h2>
                      <p className="task-summary">{recommendation?.firstStep ?? (locale === 'vi' ? 'Tài liệu, hạn nộp và nhiệm vụ bạn xác nhận sẽ xuất hiện ở đây.' : 'Confirmed tasks, deadlines, and document imports will appear here.')}</p>
                      <div className="task-meta"><span><CalendarDays size={16} /> {recommendation ? formatDue(recommendation.task.dueAt, locale) : (locale === 'vi' ? 'Chưa có hạn nộp' : 'No due date')}</span><span><Clock3 size={16} /> {recommendation ? `${recommendation.estimatedMinutes} ${locale === 'vi' ? 'phút' : 'min'}` : `0 ${locale === 'vi' ? 'phút' : 'min'}`}</span></div>
                      <div className="task-actions">
                        <button className="primary-button" type="button" disabled={!recommendation} onClick={beginFocus}><Play size={17} fill="currentColor" /> {startFocusLabel}</button>
                        <button className="link-button" type="button" disabled={!recommendation} onClick={() => setActiveView('coach')}><Sparkles size={16} /> {t.why}</button>
                      </div>
                    </article>
                    <aside className="priority-panel">
                      <ScoreRing score={recommendation?.assessment.score ?? 0} locale={locale} />
                      <div className="priority-caption">
                        <span>{locale === 'vi' ? 'Tại sao ngay bây giờ?' : 'Why now?'}</span>
                        <strong>{recommendation?.task.gradeWeight ? `${recommendation.task.gradeWeight}% ${locale === 'vi' ? 'điểm môn học' : 'of course grade'}` : (locale === 'vi' ? 'Cần thêm dữ liệu điểm' : 'Add grade context')}</strong>
                        <div className="delay-warning">
                          <CircleAlert size={18} />
                          <p>{recommendation?.assessment.costOfDelay.message ?? (locale === 'vi' ? 'Cần xác nhận một nhiệm vụ để ước lượng chi phí trì hoãn.' : 'Confirm a task to estimate its cost of delay.')}</p>
                        </div>
                      </div>
                    </aside>
                  </div>
                </section>

                <section className="priority-list-section">
                  <div className="section-heading"><div><h2>{t.priority}</h2><p>{locale === 'vi' ? 'Được xếp theo tác động thực, không chỉ hạn nộp.' : 'Ranked by real consequence, not only deadlines.'}</p></div><button className="text-button" type="button" onClick={() => setActiveView('plan')}>{locale === 'vi' ? 'Xem kế hoạch' : 'View plan'} <ArrowRight size={16} /></button></div>
                  <div className="task-list">
                    {rankedTasks.map((item, index) => (
                      <button className={index === 0 ? 'task-row task-row-active' : 'task-row'} type="button" key={item.task.id} onClick={() => index === 0 ? setActiveView('coach') : setToast(locale === 'vi' ? `Đã chọn ${item.task.title}` : `${item.task.title} selected`)}>
                        <span className="rank">0{index + 1}</span>
                        <span className="task-dot programming" />
                        <span className="task-row-main"><small>{item.course.name}</small><strong>{item.task.title}</strong></span>
                        <span className="task-row-impact"><small>{formatDue(item.task.dueAt, locale)}</small><span>{item.task.gradeWeight ? `${item.task.gradeWeight}%` : (locale === 'vi' ? 'Chưa rõ tỷ trọng' : 'No weight')}</span></span>
                        <span className="score-pill">{item.assessment.score}</span>
                        <ChevronRight className="row-arrow" size={18} />
                      </button>
                    ))}
                    {!dashboardBusy && rankedTasks.length === 0 && <p className="empty-task-list">{locale === 'vi' ? 'Chưa có nhiệm vụ đã xác nhận. Hãy thêm thủ công hoặc nhập tài liệu.' : 'No confirmed tasks yet. Add one manually or import a document.'}</p>}
                  </div>
                </section>

                <section className="day-strip">
                  <div><span className="strip-icon"><Clock3 size={19} /></span><div><strong>{locale === 'vi' ? 'Một lịch vừa sức' : 'A plan with room to breathe'}</strong><p>{planningPreferences ? (locale === 'vi' ? `Tối đa ${planningPreferences.dailyMinutes} phút mỗi ngày, có nghỉ giữa các phiên và không chồng lên lịch bận.` : `Up to ${planningPreferences.dailyMinutes} minutes per day, with breaks and no conflicts with busy time.`) : (locale === 'vi' ? 'Chọn thời gian rảnh để Priori tạo một lịch tuần vừa sức.' : 'Choose your free time so Priori can build a realistic weekly plan.')}</p></div></div>
                  <button className="icon-button" type="button" title={locale === 'vi' ? 'Chi tiết kế hoạch' : 'Plan details'} aria-label={locale === 'vi' ? 'Chi tiết kế hoạch' : 'Plan details'} onClick={() => setActiveView('plan')}><ChevronRight size={18} /></button>
                </section>
                </>}
              </>
            )}

            {activeView === 'plan' && (
              <section className="plan-view">
                <div className="page-heading compact"><div><p className="eyebrow"><WandSparkles size={15} /> {apiPlan ? (locale === 'vi' ? `Đề xuất phiên bản ${apiPlan.version}` : `Proposal version ${apiPlan.version}`) : (locale === 'vi' ? 'Chưa tạo đề xuất' : 'No proposal yet')}</p><h1>{locale === 'vi' ? 'Kế hoạch của bạn' : 'Your plan'}</h1><p className="subhead">{locale === 'vi' ? 'Tạo đề xuất từ dữ liệu đã xác nhận, xem lại rồi mới duyệt.' : 'Build from confirmed data, review the proposal, then approve it.'}</p></div>{apiPlan && <span className={planApproved ? 'approval-badge approved' : 'approval-badge'}>{planApproved ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}{planApproved ? t.approved : t.schedule}</span>}</div>
                {planFlow.error && <div className="inline-alert" role="alert"><CircleAlert size={18} /><div><strong>{locale === 'vi' ? 'Kế hoạch chưa thay đổi' : 'The plan did not change'}</strong><p>{planFlow.error}</p></div><button type="button" className="secondary-button" onClick={() => void (planFlow.errorCode === 'INVALID_PLAN_SCHEDULE' || planFlow.errorCode === 'PLAN_HAS_UNSCHEDULED_WORK' ? rebuildPlan() : approvePlan())}>{planFlow.errorCode === 'INVALID_PLAN_SCHEDULE' || planFlow.errorCode === 'PLAN_HAS_UNSCHEDULED_WORK' ? (locale === 'vi' ? 'Tạo lại' : 'Rebuild') : (locale === 'vi' ? 'Thử lại' : 'Retry')}</button></div>}
                {!apiPlan && hasConfirmedTasks && <PlanningAssistant locale={locale} onSaved={(saved) => { setPlanningPreferences(saved); setToast(locale === 'vi' ? 'Đã lưu lịch rảnh. Bạn có thể tạo đề xuất tuần.' : 'Availability saved. You can build the weekly proposal.') }} />}
                {!apiPlan ? <div className="workspace-empty"><ListChecks size={24} /><div><h2>{hasConfirmedTasks ? planningPreferences ? (locale === 'vi' ? 'Xây đề xuất đầu tiên' : 'Build your first proposal') : (locale === 'vi' ? 'Lưu lịch rảnh trước' : 'Save availability first') : (locale === 'vi' ? 'Thêm dữ liệu trước' : 'Add data first')}</h2><p>{hasConfirmedTasks ? (locale === 'vi' ? 'Chỉ nhiệm vụ và khung giờ đã xác nhận mới được đưa vào lịch tuần. Bạn sẽ xem lại trước khi duyệt.' : 'Only confirmed tasks and free windows enter the weekly plan. You will review it before approval.') : (locale === 'vi' ? 'Kế hoạch chỉ dùng nhiệm vụ bạn đã xác nhận.' : 'Plans only use tasks you have confirmed.')}</p></div><button type="button" className="primary-button" disabled={planBusy || (hasConfirmedTasks && !planningPreferences)} aria-busy={planBusy} onClick={() => hasConfirmedTasks ? void approvePlan() : setActiveView('imports')}><WandSparkles size={18} /> {hasConfirmedTasks ? (planningPreferences ? (locale === 'vi' ? 'Tạo kế hoạch tuần' : 'Build weekly plan') : (locale === 'vi' ? 'Chọn lịch rảnh ở trên' : 'Choose availability above')) : (locale === 'vi' ? 'Thêm dữ liệu' : 'Add data')}</button></div> : <>
                  <div className="plan-summary"><div><span>{locale === 'vi' ? 'Phiên bản' : 'Version'}</span><strong>{apiPlan.version}</strong></div><div><span>{locale === 'vi' ? 'Số phiên' : 'Blocks'}</span><strong>{apiPlan.items?.length ?? 0}</strong></div><div><span>{locale === 'vi' ? 'Tổng số phút' : 'Minutes'}</span><strong>{apiPlan.items?.reduce((total, item) => total + item.minutes, 0) ?? 0}</strong></div></div>
                  {planWarnings.length > 0 && <div className="plan-capacity-alert" role="alert"><CircleAlert size={19} /><div><strong>{locale === 'vi' ? 'Một số việc chưa thể xếp đủ trong tuần' : 'Some work does not fit this week yet'}</strong><p>{locale === 'vi' ? 'Tăng lịch rảnh hoặc giới hạn mỗi ngày, sau đó tạo lại đề xuất. Priori không âm thầm bỏ phần việc này.' : 'Add availability or increase the daily limit, then rebuild. Priori will not silently omit this work.'}</p><ul>{planWarnings.map((warning) => <li key={warning.taskId}>{taskById.get(warning.taskId)?.title ?? (locale === 'vi' ? 'Nhiệm vụ đã xác nhận' : 'Confirmed task')}: {warning.remainingMinutes} {locale === 'vi' ? 'phút chưa xếp' : 'minutes unscheduled'}</li>)}</ul></div><button type="button" className="secondary-button" disabled={planBusy} onClick={() => void rebuildPlan()}><WandSparkles size={16} /> {locale === 'vi' ? 'Tạo lại' : 'Rebuild'}</button></div>}
                  {planApproved && newlyConfirmedTasks.length > 0 && <div className="plan-update-alert"><Sparkles size={19} /><div><strong>{locale === 'vi' ? `${newlyConfirmedTasks.length} nhiệm vụ mới chưa có trong kế hoạch` : `${newlyConfirmedTasks.length} new task${newlyConfirmedTasks.length > 1 ? 's are' : ' is'} not in this plan`}</strong><p>{locale === 'vi' ? 'Kế hoạch đã duyệt vẫn giữ nguyên cho tới khi bạn xem và duyệt phiên bản thay thế.' : 'Your approved plan stays unchanged until you review and approve a replacement.'}</p></div><button type="button" className="primary-button" disabled={planBusy} onClick={() => void rebuildPlan()}><WandSparkles size={16} /> {locale === 'vi' ? 'Tạo đề xuất cập nhật' : 'Build updated proposal'}</button></div>}
                  <WeeklyPlanBoard plan={apiPlan} locale={locale} tasks={tasks} availabilityBlocks={availabilityBlocks} preferences={planningPreferences} onRecoverMissed={() => void openReplan('schedule_changed')} />
                  {!planApproved && <PlanProposalEditor locale={locale} plan={apiPlan} taskName={(taskId) => taskById.get(taskId)?.title ?? (locale === 'vi' ? 'Nhiệm vụ đã xác nhận' : 'Confirmed task')} onSaved={replacePlan} />}
                  {planApproved && <details className="planning-revisit"><summary>{locale === 'vi' ? 'Cập nhật lịch rảnh cho đề xuất tiếp theo' : 'Update availability for the next proposal'}</summary><PlanningAssistant locale={locale} onSaved={(saved) => { setPlanningPreferences(saved); setToast(locale === 'vi' ? 'Đã lưu lịch rảnh mới. Kế hoạch đang duyệt không bị thay đổi.' : 'New availability saved. The approved plan was not changed.') }} /></details>}
                  <div className="approval-bar"><div><ShieldCheck size={19} /><p>{locale === 'vi' ? 'Priori sẽ không thay đổi lịch này nếu bạn chưa duyệt.' : 'Priori will not change this schedule without your approval.'}</p></div>{!planApproved && <button type="button" className="primary-button" disabled={planBusy || planWarnings.length > 0} aria-busy={planBusy} onClick={() => void approvePlan()}><Check size={18} /> {t.approve}</button>}</div>
                </>}
              </section>
            )}

            {activeView === 'imports' && (
              <section className="imports-view">
                <div className="page-heading compact"><div><p className="eyebrow"><Link2 size={15} /> {locale === 'vi' ? 'Nguồn dữ liệu của bạn' : 'Your data sources'}</p><h1>{locale === 'vi' ? 'Kết nối bối cảnh học kỳ' : 'Connect your semester context'}</h1><p className="subhead">{locale === 'vi' ? 'Bạn chọn dữ liệu nào Priori được phép dùng.' : 'You decide exactly what Priori can use.'}</p></div></div>
                <input ref={documentInputRef} className="visually-hidden" tabIndex={-1} aria-label={locale === 'vi' ? 'Chọn các tệp học tập' : 'Choose study files'} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.json,.jsonl,application/pdf,image/png,image/jpeg,text/plain,text/csv,application/csv,application/vnd.ms-excel,application/json,application/x-ndjson" onChange={(event) => void handleDocumentsSelected(Array.from(event.target.files ?? []))} />
                <input ref={calendarInputRef} className="visually-hidden" tabIndex={-1} aria-label={locale === 'vi' ? 'Chọn tệp lịch ICS' : 'Choose an ICS calendar file'} type="file" accept=".ics,text/calendar" onChange={(event) => void handleCalendarSelected(event.target.files?.[0])} />
                <div className="import-grid">
                  <article className="source-card source-card-primary"><div className="source-icon">{importStatus === 'processing' ? <LoaderCircle className="inline-spinner" size={21} /> : <FileText size={21} />}</div><div><span className="source-status">{imported ? (locale === 'vi' ? 'Đã xác nhận' : 'Confirmed') : importStatus === 'processing' ? (locale === 'vi' ? 'Đang xử lý' : 'Processing') : (locale === 'vi' ? 'Nên dùng' : 'Recommended')}</span><h2>{locale === 'vi' ? 'Tệp học tập' : 'Study files'}</h2><p>{locale === 'vi' ? 'Chọn cùng lúc tối đa 10 tệp PDF, ảnh, TXT, CSV, JSON hoặc JSONL.' : 'Select up to 10 PDF, image, TXT, CSV, JSON, or JSONL files at once.'}</p></div><button type="button" className="mini-action" title={locale === 'vi' ? 'Tải nhiều tệp học tập' : 'Upload study files'} aria-label={locale === 'vi' ? 'Tải nhiều tệp học tập' : 'Upload study files'} disabled={importBusy} aria-busy={importBusy} onClick={() => documentInputRef.current?.click()}><Upload size={17} /></button></article>
                  <article className="source-card"><div className="source-icon calendar-icon"><CalendarDays size={21} /></div><div><span className={calendarImported ? 'source-status' : 'source-status neutral'}>{calendarImported ? (locale === 'vi' ? 'Đã xác nhận' : 'Confirmed') : (locale === 'vi' ? 'Không bắt buộc' : 'Optional')}</span><h2>{locale === 'vi' ? 'Tệp lịch' : 'Calendar file'}</h2><p>{calendarImported ? (locale === 'vi' ? 'Sự kiện ICS đã được xem lại và nhập.' : 'ICS events reviewed and imported.') : (locale === 'vi' ? 'Nhập một tệp ICS nếu bạn muốn tránh lịch bận.' : 'Import an ICS file to avoid busy calendar times.')}</p></div><button type="button" className="mini-action" title={locale === 'vi' ? 'Nhập lịch ICS' : 'Import ICS calendar'} aria-label={locale === 'vi' ? 'Nhập lịch ICS' : 'Import ICS calendar'} disabled={importBusy} aria-busy={importBusy} onClick={() => calendarInputRef.current?.click()}>{calendarImported ? <Check size={17} /> : <Plus size={17} />}</button></article>
                  <article className="source-card"><div className="source-icon manual-icon"><ListChecks size={21} /></div><div><span className="source-status neutral">{locale === 'vi' ? 'Luôn sẵn sàng' : 'Always available'}</span><h2>{locale === 'vi' ? 'Nhiệm vụ thủ công' : 'Manual task'}</h2><p>{locale === 'vi' ? 'Thêm một nhiệm vụ hoặc hạn nộp chưa có trong tệp.' : 'Add a task or deadline that is not in a file.'}</p></div><button type="button" className="mini-action" title={locale === 'vi' ? 'Thêm nhiệm vụ' : 'Add task'} aria-label={locale === 'vi' ? 'Thêm nhiệm vụ' : 'Add task'} onClick={() => setManualTaskOpen(true)}><Plus size={17} /></button></article>
                </div>
                <div className="data-policy"><ShieldCheck size={20} /><div><strong>{locale === 'vi' ? 'Sự đồng ý không bao giờ là mặc định.' : 'Consent is never the default.'}</strong><p>{locale === 'vi' ? 'Priori chỉ đọc dữ liệu bạn kết nối. Tệp gốc tự xóa sau 30 ngày.' : 'Priori reads only data you connect. Original files are deleted after 30 days.'}</p></div><button type="button" className="text-button" onClick={() => setActiveView('settings')}>{locale === 'vi' ? 'Xem quyền' : 'Review permissions'} <ArrowRight size={16} /></button></div>
                {importQueue.length > 0 && <section className="import-queue" aria-labelledby="import-queue-title"><div className="section-heading"><div><h2 id="import-queue-title">{locale === 'vi' ? 'Hàng đợi tệp' : 'File queue'}</h2><p>{locale === 'vi' ? 'Mỗi tệp được xử lý riêng; một tệp lỗi không làm mất các tệp khác.' : 'Each file is handled independently; one failure does not discard the others.'}</p></div><span>{importQueue.filter((item) => item.status === 'confirmed').length}/{importQueue.length}</span></div><div className="import-queue-list">{importQueue.map((item) => <div className={`import-queue-row ${item.status}`} key={item.id}><span className="import-queue-icon">{item.status === 'processing' || item.status === 'confirming' ? <LoaderCircle className="inline-spinner" size={16} /> : item.status === 'confirmed' ? <CircleCheck size={16} /> : item.status === 'error' ? <CircleAlert size={16} /> : <FileText size={16} />}</span><div><strong>{item.filename}</strong>{item.error && <small>{item.error}</small>}</div><span className="queue-status">{importStatusLabel(item.status, locale)}</span>{item.status === 'review' && <button type="button" className="secondary-button compact-button" onClick={() => importFlow.openReview(item.id)}>{locale === 'vi' ? 'Xem lại' : 'Review'}</button>}{item.status === 'error' && <button type="button" className="secondary-button compact-button" disabled={importBusy} onClick={() => void importFlow.retry(item.id)}><TimerReset size={14} /> {locale === 'vi' ? 'Thử lại' : 'Retry'}</button>}</div>)}</div></section>}
                {importFlow.error && !reviewOpen && <div className="inline-alert" role="alert"><CircleAlert size={18} /><div><strong>{locale === 'vi' ? 'Một số tệp cần được xử lý lại' : 'Some files need attention'}</strong><p>{importFlow.error}</p></div></div>}
                {reviewOpen && importReview && <section className="extract-review"><div className="review-heading"><div><span className="ai-chip"><Sparkles size={14} /> {importReview.kind === 'document' ? (importReview.provider?.startsWith('structured-') ? (locale === 'vi' ? 'Nhập dữ liệu có cấu trúc' : 'Structured import') : (locale === 'vi' ? 'AI đã trích xuất' : 'AI extracted')) : (locale === 'vi' ? 'Đã đọc ICS' : 'ICS parsed')}</span><h2>{locale === 'vi' ? `Xem lại ${importReview.filename}` : `Review ${importReview.filename}`}</h2></div><button className="icon-button" type="button" title={locale === 'vi' ? 'Đóng phần xem lại' : 'Close review'} aria-label={locale === 'vi' ? 'Đóng phần xem lại' : 'Close review'} onClick={importFlow.closeReview}><X size={18} /></button></div>{importReview.kind === 'document' ? <ExtractionReviewEditor locale={locale} extraction={importReview.extraction} busy={importBusy} onChange={updateDocumentExtraction} onConfirm={() => void confirmImport()} /> : <><div className="extracted-rows"><div><CalendarDays size={18} /><span>{importReview.busyBlockCount} {locale === 'vi' ? 'khung bận' : 'busy blocks'}</span><strong>{locale === 'vi' ? 'Lịch hiện tại của bạn vẫn chỉ đọc' : 'Your existing calendar remains read only'}</strong></div><div><ListChecks size={18} /><span>{importReview.taskCount} {locale === 'vi' ? 'nhiệm vụ được tìm thấy' : 'tasks found'}</span><strong>{locale === 'vi' ? 'Không nhiệm vụ nào vào kế hoạch trước khi xác nhận' : 'Nothing enters your plan before confirmation'}</strong></div></div><div className="review-actions"><p>{locale === 'vi' ? 'Sự kiện lịch chỉ được thêm sau khi bạn xác nhận.' : 'Calendar entries are added only after confirmation.'}</p><button className="primary-button" type="button" disabled={importBusy} aria-busy={importBusy} onClick={() => void confirmImport()}><Check size={17} /> {locale === 'vi' ? 'Xác nhận lịch' : 'Confirm calendar'}</button></div></>}</section>}
                <section className="source-library" aria-labelledby="source-library-title">
                  <div className="section-heading"><div><h2 id="source-library-title">{locale === 'vi' ? 'Tệp đã tải lên' : 'Uploaded files'}</h2><p>{locale === 'vi' ? 'Quản lý trạng thái, thời hạn lưu tệp gốc và xóa từng nguồn.' : 'Review status, raw-file retention, and delete individual sources.'}</p></div>{sourceDocumentsBusy && <LoaderCircle className="inline-spinner" size={17} />}</div>
                  {!sourceDocumentsBusy && sourceDocuments.length === 0 ? <p className="empty-task-list">{locale === 'vi' ? 'Chưa có tệp nào được tải lên.' : 'No files uploaded yet.'}</p> : <div className="source-library-list">{sourceDocuments.map((document) => <div className="source-library-row" key={document.id}><FileText size={17} /><div><strong>{document.filename}</strong><span>{formatFileSize(document.sizeBytes)} · {importStatusLabel(document.status, locale)}</span></div><span>{document.rawDeletedAt ? (locale === 'vi' ? 'Tệp gốc đã hết hạn' : 'Raw file expired') : `${locale === 'vi' ? 'Tệp gốc đến' : 'Raw until'} ${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium' }).format(new Date(document.expiresAt))}`}</span><div className="source-library-actions">{canResumeDocument(document) && <button className="secondary-button compact-button" type="button" disabled={importBusy} onClick={() => void importFlow.resumeDocument(document)}>{document.status === 'review' ? (locale === 'vi' ? 'Xem lại' : 'Review') : (locale === 'vi' ? 'Tiếp tục' : 'Resume')}</button>}<button className="icon-button danger-icon" type="button" title={locale === 'vi' ? 'Xóa tệp nguồn' : 'Delete source file'} aria-label={locale === 'vi' ? `Xóa ${document.filename}` : `Delete ${document.filename}`} disabled={deletingDocumentId === document.id} onClick={() => void deleteSourceDocument(document)}>{deletingDocumentId === document.id ? <LoaderCircle className="inline-spinner" size={16} /> : <Trash2 size={16} />}</button></div></div>)}</div>}
                  {sourceDocumentsNextCursor && <button className="secondary-button source-load-more" type="button" disabled={sourceDocumentsBusy} onClick={() => void loadMoreSourceDocuments()}>{locale === 'vi' ? 'Tải thêm tệp' : 'Load more files'}</button>}
                </section>
              </section>
            )}

            {activeView === 'coach' && (
              <section className="coach-view">
                <div className="page-heading compact"><div><p className="eyebrow"><Sparkles size={15} /> {t.assistant}</p><h1>{locale === 'vi' ? 'Điều gì khiến việc này quan trọng?' : 'Why does this matter now?'}</h1><p className="subhead">{locale === 'vi' ? 'Một lời giải thích để hành động, không phải một lời nhắc chung chung.' : 'An explanation that moves you forward, not a generic reminder.'}</p></div></div>
                <article className="coach-answer">
                  <div className="coach-answer-top">
                    <span className="ai-avatar"><Sparkles size={18} /></span>
                    <div>
                      <strong>{recommendation?.task.title ?? (locale === 'vi' ? 'Chưa có nhiệm vụ đã xác nhận' : 'No confirmed task yet')}</strong>
                      <span>{recommendation ? `${recommendation.course.name} · ${formatDue(recommendation.task.dueAt, locale)}` : (locale === 'vi' ? 'Xác nhận một nhiệm vụ để xem bằng chứng.' : 'Confirm a task to see its evidence.')}</span>
                    </div>
                    <span className="confidence">{recommendation ? `${Math.round(recommendation.task.confidence * 100)}% ${locale === 'vi' ? 'độ tin cậy' : 'confidence'}` : (locale === 'vi' ? 'Chưa có bằng chứng' : 'No evidence yet')}</span>
                  </div>
                  {recommendation ? <>
                    <div className="reason-grid">
                      <div><span className="reason-number">01</span><h3>{locale === 'vi' ? 'Tác động học tập' : 'Academic impact'}</h3><p>{recommendation.assessment.evidence[0] ?? (locale === 'vi' ? 'Chưa có dữ liệu điểm nào được xác nhận.' : 'No grade evidence has been confirmed.')}</p></div>
                      <div><span className="reason-number">02</span><h3>{locale === 'vi' ? 'Chi phí trì hoãn' : 'Cost of delay'}</h3><p>{recommendation.assessment.costOfDelay.message}</p></div>
                      <div><span className="reason-number">03</span><h3>{locale === 'vi' ? 'Bước khởi đầu nhỏ nhất' : 'Smallest useful start'}</h3><p>{recommendation.firstStep}</p></div>
                    </div>
                    <div className="coach-foot"><div><TimerReset size={18} /><p>{locale === 'vi' ? <><strong>{focusMinutes} phút ngay bây giờ</strong> được tính từ thời lượng nhiệm vụ đã xác nhận. Độ chắc chắn dữ liệu: {confidenceLabel}.</> : <><strong>{focusMinutes} minutes now</strong> is sized from the confirmed task estimate. Data confidence: {confidenceLabel}.</>}</p></div><button className="primary-button" type="button" onClick={beginFocus}><Play size={17} fill="currentColor" /> {locale === 'vi' ? 'Bắt đầu bước đầu tiên' : 'Start first step'}</button></div>
                  </> : <div className="workspace-empty"><ListChecks size={22} /><div><h2>{locale === 'vi' ? 'Hãy thêm bối cảnh đã xác nhận trước' : 'Add confirmed context first'}</h2><p>{locale === 'vi' ? 'Priori chỉ giải thích mức ưu tiên sau khi bạn xác nhận dữ liệu môn học và nhiệm vụ liên quan.' : 'Priori will only explain a priority after you have confirmed the underlying course and task data.'}</p></div><button className="secondary-button" type="button" onClick={() => setActiveView('imports')}>{locale === 'vi' ? 'Thêm dữ liệu' : 'Add data'}</button></div>}
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
                    { purpose: 'research_metrics', title: locale === 'vi' ? 'Nghiên cứu tổng hợp' : 'Aggregate research', detail: locale === 'vi' ? 'Cho phép dùng dữ liệu đã tổng hợp, không định danh.' : 'Allow anonymized aggregate research only.' },
                  ] as const).map(({ purpose, title, detail }) => {
                    const granted = consentByPurpose[purpose]?.granted ?? false
                    return <label className="permission-row" key={purpose}><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" checked={granted} disabled={settingsBusy} onChange={(event) => void updateConsent(purpose, event.target.checked)} /></label>
                  })}</div></section>
                  <WebPushSettings locale={locale} />
                  <section className="settings-panel"><div className="settings-panel-heading"><div><h2>{locale === 'vi' ? 'Xuất dữ liệu' : 'Export your data'}</h2><p>{locale === 'vi' ? 'Tải một tệp JSON gồm dữ liệu có cấu trúc, kế hoạch và lịch sử đồng ý. Tệp gốc không được kèm theo.' : 'Download a JSON file with your structured data, plans, and consent history. Original files are not included.'}</p></div></div><button className="secondary-button" type="button" disabled={exportBusy} aria-busy={exportBusy} onClick={() => void downloadExport()}><Download size={17} /> {locale === 'vi' ? 'Tải bản xuất dữ liệu' : 'Download export'}</button></section>
                  <section className="settings-panel settings-danger"><div className="settings-panel-heading"><div><h2>{locale === 'vi' ? 'Xóa tài khoản' : 'Delete account'}</h2><p>{locale === 'vi' ? 'Nhập email để bắt đầu xóa. Phiên đăng nhập bị thu hồi ngay; tệp gốc và dữ liệu còn lại được dọn theo biên nhận.' : 'Enter your email to begin deletion. Sessions are revoked immediately; raw files and remaining data are cleaned through the deletion receipt.'}</p></div></div><label className="delete-confirmation">{locale === 'vi' ? `Nhập ${session.user.email} để xác nhận` : `Enter ${session.user.email} to confirm`}<input type="email" autoComplete="email" value={deletionConfirmation} onChange={(event) => setDeletionConfirmation(event.target.value)} /></label><button className="danger-button" type="button" disabled={deletionBusy || deletionConfirmation.trim().toLowerCase() !== session.user.email} aria-busy={deletionBusy} onClick={() => void requestAccountDeletion()}><Trash2 size={17} /> {locale === 'vi' ? 'Bắt đầu xóa tài khoản' : 'Start account deletion'}</button></section>
                </div>
              </section>
            )}
          </section>

          <aside className="right-rail">
            {hasConfirmedTasks && <><section className="coach-card"><div className="coach-card-head"><div><span className="assistant-dot"><Sparkles size={15} /></span><strong>{t.assistant}</strong></div><button className="icon-button quiet" type="button" title={locale === 'vi' ? 'Mở bằng chứng ưu tiên' : 'Open coaching evidence'} aria-label={locale === 'vi' ? 'Mở bằng chứng ưu tiên' : 'Open coaching evidence'} onClick={() => setActiveView('coach')}><ChevronRight size={17} /></button></div><p>{recommendation?.assessment.evidence.slice(0, 2).join(' · ') ?? (locale === 'vi' ? 'Xác nhận dữ liệu để xem lý do ưu tiên.' : 'Confirm data to see the priority evidence.')}</p><div className="coach-mode"><span>{locale === 'vi' ? 'Độ chắc chắn dữ liệu' : 'Data certainty'}</span><strong>{confidenceLabel}</strong></div></section>
            <section className="progress-card"><div className="card-heading"><h2>{locale === 'vi' ? 'Hoạt động học tập' : 'Learning activity'}</h2></div><div className="streak"><span><Flame size={18} fill="currentColor" /> {focusCompleted}</span><p>{locale === 'vi' ? 'phiên tập trung đã hoàn thành' : 'completed focus sessions'}</p></div><p className="progress-context">{metrics.plan_approved ? (locale === 'vi' ? `${metrics.plan_approved} kế hoạch đã được duyệt` : `${metrics.plan_approved} approved plans`) : (locale === 'vi' ? 'Chưa có kế hoạch được duyệt.' : 'No approved plan yet.')}</p></section></>}
            <section className="privacy-card"><LockKeyhole size={17} /><div><strong>{locale === 'vi' ? 'Không chia sẻ với trường' : 'Not shared with your school'}</strong><p>{locale === 'vi' ? 'Kế hoạch và rủi ro học tập này chỉ dành cho bạn.' : 'This study plan and risk signal are private to you.'}</p></div></section>
          </aside>
        </div>
      </section>

      {manualTaskOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-task-title">
        <form className="manual-task-modal" onSubmit={(event) => void saveManualTask(event)}>
          <button className="icon-button modal-close" type="button" title={locale === 'vi' ? 'Đóng trình sửa nhiệm vụ' : 'Close task editor'} aria-label={locale === 'vi' ? 'Đóng trình sửa nhiệm vụ' : 'Close task editor'} onClick={() => setManualTaskOpen(false)}><X size={20} /></button>
          <span className="ai-chip"><ListChecks size={14} /> {locale === 'vi' ? 'Nhiệm vụ thủ công' : 'Manual task'}</span>
          <h2 id="manual-task-title">{locale === 'vi' ? 'Thêm nhiệm vụ của bạn' : 'Add a task'}</h2>
          {courses.length === 0 ? <div className="manual-task-grid"><label>{locale === 'vi' ? 'Mã môn học' : 'Course code'}<input required maxLength={64} autoFocus value={manualTask.courseCode} onChange={(event) => setManualTask((current) => ({ ...current, courseCode: event.target.value }))} /></label><label>{locale === 'vi' ? 'Tên môn học' : 'Course name'}<input required maxLength={240} value={manualTask.courseName} onChange={(event) => setManualTask((current) => ({ ...current, courseName: event.target.value }))} /></label></div> : <label>{locale === 'vi' ? 'Môn học' : 'Course'}<select value={manualTask.courseId} onChange={(event) => setManualTask((current) => ({ ...current, courseId: event.target.value }))}>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</select></label>}
          <label>{locale === 'vi' ? 'Nhiệm vụ' : 'Task'}<input required maxLength={240} autoFocus={courses.length > 0} value={manualTask.title} onChange={(event) => setManualTask((current) => ({ ...current, title: event.target.value }))} /></label>
          <div className="manual-task-grid"><label>{locale === 'vi' ? 'Hạn nộp' : 'Due date'}<input type="datetime-local" value={manualTask.dueAt} onChange={(event) => setManualTask((current) => ({ ...current, dueAt: event.target.value }))} /></label><label>{locale === 'vi' ? 'Tỷ trọng (%)' : 'Weight (%)'}<input type="number" min="0" max="100" value={manualTask.gradeWeight} onChange={(event) => setManualTask((current) => ({ ...current, gradeWeight: event.target.value }))} /></label><label>{locale === 'vi' ? 'Số phút' : 'Minutes'}<input required type="number" min="5" max="600" value={manualTask.estimatedMinutes} onChange={(event) => setManualTask((current) => ({ ...current, estimatedMinutes: event.target.value }))} /></label></div>
          <div className="replan-actions"><button type="button" className="secondary-button" onClick={() => setManualTaskOpen(false)}>{locale === 'vi' ? 'Hủy' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={manualTaskBusy} aria-busy={manualTaskBusy}><Check size={18} /> {locale === 'vi' ? 'Thêm nhiệm vụ' : 'Add task'}</button></div>
        </form>
      </div>}

      {focusOpen && recommendation && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="focus-title"><section className="focus-modal"><button className="icon-button modal-close" type="button" title={locale === 'vi' ? 'Đóng phiên tập trung' : 'Close focus session'} aria-label={locale === 'vi' ? 'Đóng phiên tập trung' : 'Close focus session'} disabled={focusBusy} onClick={() => { setFocusOpen(false); setFocusRunning(false) }}><X size={20} /></button><div className="focus-photo"><img src={focusImage} alt={locale === 'vi' ? 'Sinh viên xem lại kế hoạch học tập tại bàn' : 'Student reviewing a study plan at a desk'} /></div><div className="focus-overlay"><span className="focus-kicker">{recommendation.course.name} · {focusMinutes} {locale === 'vi' ? 'phút tập trung' : 'minute focus'}</span><h2 id="focus-title">{recommendation.task.title}</h2><p>{recommendation.firstStep}</p><div className="timer">{time}</div>{focusError && <div className="focus-error" role="alert"><CircleAlert size={17} /><span>{focusError}</span></div>}<div className="focus-controls"><button className={focusRunning ? 'pause-button' : 'primary-button'} type="button" disabled={focusBusy} onClick={() => setFocusRunning(!focusRunning)}>{focusRunning ? <><TimerReset size={17} /> {locale === 'vi' ? 'Tạm dừng' : 'Pause'}</> : <><Play size={17} fill="currentColor" /> {locale === 'vi' ? 'Tiếp tục' : 'Resume'}</>}</button><button className="pause-button" type="button" disabled={focusBusy} aria-busy={focusBusy} onClick={() => void finishFocusSession()}><CircleCheck size={17} /> {locale === 'vi' ? 'Kết thúc phiên' : 'Finish session'}</button><button className="focus-complete-button" type="button" disabled={focusBusy} aria-busy={focusBusy} onClick={() => void completeFocusTask()}><CheckCircle2 size={17} /> {locale === 'vi' ? 'Hoàn tất nhiệm vụ' : 'Complete task'}</button></div></div></section></div>}

      {replanOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="replan-title"><section className="replan-modal"><button className="icon-button modal-close" type="button" title={locale === 'vi' ? 'Đóng phần lập lại kế hoạch' : 'Close replanning'} aria-label={locale === 'vi' ? 'Đóng phần lập lại kế hoạch' : 'Close replanning'} onClick={() => setReplanOpen(false)}><X size={20} /></button><span className="ai-chip"><Sparkles size={14} /> {t.assistant}</span><h2 id="replan-title">{locale === 'vi' ? 'Điều gì đang cản bạn?' : 'What is getting in the way?'}</h2><div className="friction-options"><button type="button" className={replanFriction === 'cannot_start' ? 'friction-selected' : ''} aria-pressed={replanFriction === 'cannot_start'} onClick={() => void selectReplanFriction('cannot_start')}><span>01</span>{locale === 'vi' ? 'Không biết bắt đầu' : 'I do not know where to start'}</button><button type="button" className={replanFriction === 'too_tired' ? 'friction-selected' : ''} aria-pressed={replanFriction === 'too_tired'} onClick={() => void selectReplanFriction('too_tired')}><span>02</span>{locale === 'vi' ? 'Quá mệt' : 'I am too tired'}</button><button type="button" className={replanFriction === 'schedule_changed' ? 'friction-selected' : ''} aria-pressed={replanFriction === 'schedule_changed'} onClick={() => void selectReplanFriction('schedule_changed')}><span>03</span>{locale === 'vi' ? 'Lịch vừa thay đổi' : 'My schedule changed'}</button></div>{replanBusy && <p className="replan-loading"><LoaderCircle size={16} /> {locale === 'vi' ? 'Đang chuẩn bị phương án...' : 'Preparing a proposal...'}</p>}{apiReplan && <div className="proposal"><span>{apiReplan.title}</span><strong>{apiReplan.changes[0] ?? (locale === 'vi' ? 'Phương án mới đã sẵn sàng để xem lại.' : 'A new proposal is ready for review.')}</strong><p>{apiReplan.rationale}</p><div className="replan-comparison"><span>{locale === 'vi' ? `Trước: ${apiPlan?.items?.[0]?.minutes ?? 0} phút` : `Before: ${apiPlan?.items?.[0]?.minutes ?? 0} min`}</span><span>{locale === 'vi' ? `Sau: ${apiReplan.proposedItems[0]?.minutes ?? 0} phút` : `After: ${apiReplan.proposedItems[0]?.minutes ?? 0} min`}</span></div></div>}<div className="replan-actions"><button type="button" className="secondary-button" onClick={() => setReplanOpen(false)}>{locale === 'vi' ? 'Chưa phù hợp' : 'Not right yet'}</button><button type="button" className="primary-button" disabled={replanBusy || !apiReplan} aria-busy={replanBusy} onClick={() => void approveReplan()}><Check size={18} /> {locale === 'vi' ? 'Duyệt phương án này' : 'Approve this plan'}</button></div></section></div>}


      {toast && <div className="toast"><CircleCheck size={18} /> {toast}</div>}
    </main>
  )
}

export default App
