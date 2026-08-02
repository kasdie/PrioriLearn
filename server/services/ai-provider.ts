import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  CoachingProposalSchema,
  DocumentExtractionSchema,
  PlanningAssistantReplySchema,
  type CoachingProposal,
  type DocumentExtraction,
  type LearnerProfileSignal,
  type Locale,
  type PlanningAssistantReply,
  type PlanningPreferenceDraft,
  type StudyPlan,
} from '../domain/contracts.js'

export type DocumentInput = {
  filename: string
  mimeType: string
  content: Buffer
  locale?: Locale
}

type CoachingInput = {
  friction: string
  note?: string
  plan: StudyPlan
  learnerSignals?: LearnerProfileSignal[]
  locale: Locale
}

export type PlanningConversationInput = {
  locale: Locale
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  draft: PlanningPreferenceDraft
  confirmedTasks: Array<{
    taskId: string
    title: string
    courseName: string
    dueAt: string | null
    estimatedMinutes: number
    priorityScore: number
    costOfDelay: string
  }>
  busyBlocks: Array<{ title: string; startsAt: string; endsAt: string }>
  currentPlanItems: Array<{ taskId: string; title: string; startsAt: string; endsAt: string; minutes: number }>
  now: string
}

export interface AiProvider {
  readonly name: string
  extractDocument(input: DocumentInput): Promise<DocumentExtraction>
  draftCoachingProposal(input: CoachingInput): Promise<CoachingProposal>
  draftPlanningPreferences(input: PlanningConversationInput): Promise<PlanningAssistantReply>
}

export class MockAiProvider implements AiProvider {
  readonly name = 'deterministic-demo'

  async extractDocument(input: DocumentInput): Promise<DocumentExtraction> {
    const dueAt = new Date(Date.now() + 6 * 24 * 3_600_000).toISOString()
    const vietnamese = input.locale === 'vi'
    return {
      courses: [{
        code: 'CS304',
        name: vietnamese ? 'Lập trình' : 'Programming',
        currentScore: 54,
        targetScore: 78,
        confidence: 0.96,
        evidence: [vietnamese ? 'Tiêu đề môn học và phần tổng kết điểm' : 'Course header and grade summary'],
      }],
      tasks: [{
        courseCode: 'CS304',
        title: vietnamese ? 'Bài tập 4: Tích hợp dịch vụ' : 'Assignment 4: Service integration',
        dueAt,
        gradeWeight: 20,
        estimatedMinutes: 60,
        confidence: 0.93,
        evidence: [vietnamese ? 'Bảng đánh giá: Bài tập 4, 20%' : 'Assessment table: Assignment 4, 20%'],
      }],
      warnings: [vietnamese
        ? 'Đang dùng dữ liệu trích xuất mẫu vì OPENAI_API_KEY chưa được cấu hình.'
        : 'Demo extraction was used because OPENAI_API_KEY is not configured.'],
    }
  }

  async draftCoachingProposal(input: CoachingInput): Promise<CoachingProposal> {
    const firstItem = input.plan.items[0]
    const preferredDuration = input.learnerSignals
      ?.find((signal) => signal.kind === 'focus_duration')?.value.match(/\d{1,3}/)?.[0]
    const estimatedMinutes = preferredDuration
      ? Math.max(10, Math.min(45, Number(preferredDuration)))
      : 20
    return input.locale === 'vi'
      ? {
        title: 'Giảm bước khởi động, vẫn giữ đúng hạn',
        rationale: `Bạn cho biết trở ngại là ${input.friction}. Kế hoạch đã duyệt vẫn giữ nguyên cho đến khi bạn duyệt đề xuất này.`,
        changes: [`Rút block đầu xuống ${estimatedMinutes} phút`, 'Giữ 10 phút đệm để hồi phục'],
        firstStep: firstItem?.firstStep ?? 'Mở yêu cầu bài tập và đọc yêu cầu đầu tiên.',
        estimatedMinutes,
      }
      : {
        title: 'Lower the activation energy, preserve the deadline',
        rationale: `The check-in reported ${input.friction}. The approved plan remains unchanged until this proposal is approved.`,
        changes: [`Shorten the first block to ${estimatedMinutes} minutes`, 'Keep a 10-minute recovery buffer'],
        firstStep: firstItem?.firstStep ?? 'Open the task brief and read the first requirement.',
        estimatedMinutes,
      }
  }

  async draftPlanningPreferences(input: PlanningConversationInput): Promise<PlanningAssistantReply> {
    const missingInformation: PlanningAssistantReply['missingInformation'] = []
    if (input.draft.windows.length === 0) missingInformation.push('availability')
    const nextBlocks = input.currentPlanItems
      .filter((item) => Date.parse(item.endsAt) >= Date.parse(input.now))
      .slice(0, 3)
    const agenda = nextBlocks.map((item) => `${item.title} (${item.startsAt}, ${item.minutes} min)`).join('; ')
    return {
      message: agenda
        ? input.locale === 'vi'
          ? `Lịch sắp tới của bạn: ${agenda}. Đây là kế hoạch hiện đang được lưu; mình chỉ thay đổi khi bạn lưu lịch rảnh và duyệt đề xuất mới.`
          : `Your upcoming agenda: ${agenda}. This is the currently saved plan; it only changes after you save availability and approve a new proposal.`
        : input.locale === 'vi'
        ? input.draft.windows.length === 0
          ? 'Mình đã ghi nhận mục tiêu của bạn. Hãy chọn ít nhất một khung giờ rảnh bên dưới; mình sẽ chỉ dùng những khung bạn xác nhận để xếp lịch tuần.'
          : 'Mình đã đối chiếu khối lượng công việc với các khung giờ đang chọn. Bạn có thể chỉnh cường độ hoặc thời lượng mỗi ngày trước khi lưu.'
        : input.draft.windows.length === 0
          ? 'I have noted your goal. Choose at least one free window below; only confirmed windows will be used for the weekly plan.'
          : 'I compared the workload with your selected windows. You can adjust the intensity or daily limit before saving.',
      suggestion: {
        coachMode: input.draft.coachMode,
        dailyMinutes: input.draft.dailyMinutes,
        windows: input.draft.windows,
      },
      missingInformation,
    }
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name: string
  private readonly client: OpenAI

  constructor(apiKey: string, private readonly model: string) {
    this.client = new OpenAI({ apiKey })
    this.name = `openai:${model}`
  }

  async extractDocument(input: DocumentInput): Promise<DocumentExtraction> {
    const content = buildDocumentExtractionContent(input)
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [{
        role: 'user',
        content,
      }],
      text: { format: zodTextFormat(DocumentExtractionSchema, 'syllabus_extraction') },
    })
    if (!response.output_parsed) throw new Error('MODEL_RETURNED_NO_EXTRACTION')
    return response.output_parsed
  }

  async draftCoachingProposal(input: CoachingInput): Promise<CoachingProposal> {
    const responseLanguage = input.locale === 'vi' ? 'Vietnamese' : 'English'
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: 'system',
          content: `You draft small, realistic study-plan changes. Respond entirely in ${responseLanguage}, except for user-provided task titles. Never claim a plan has changed; this output is only a proposal awaiting approval. Learner signals are self-reported preferences. Use them only when relevant, do not infer new personal information, and never treat them as facts about academic ability.`,
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
      text: { format: zodTextFormat(CoachingProposalSchema, 'coaching_proposal') },
    })
    if (!response.output_parsed) throw new Error('MODEL_RETURNED_NO_PROPOSAL')
    return response.output_parsed
  }

  async draftPlanningPreferences(input: PlanningConversationInput): Promise<PlanningAssistantReply> {
    const responseLanguage = input.locale === 'vi' ? 'Vietnamese' : 'English'
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: 'system',
          content: [
            `You are a study-planning intake assistant. Respond entirely in ${responseLanguage}, except for user-provided task titles.`,
            'Ask concise questions about free time, preferred intensity, and realistic daily study capacity.',
            'You may answer agenda questions using currentPlanItems and busyBlocks. Clearly distinguish an approved/current plan from a draft suggestion.',
            'Use priorityScore, costOfDelay, courseName, and deadlines when explaining why a task should happen sooner.',
            'Return a complete suggestion every turn. Preserve existing draft values unless the user explicitly changes them.',
            'A study window uses dayOfWeek 0=Sunday through 6=Saturday and local minutes after midnight.',
            'Never invent free time. If availability is not explicit, keep windows unchanged and include availability in missingInformation.',
            'Never claim a plan was created or changed. This is only a draft that the student must review and save.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
      text: { format: zodTextFormat(PlanningAssistantReplySchema, 'planning_intake_reply') },
    })
    if (!response.output_parsed) throw new Error('MODEL_RETURNED_NO_PLANNING_REPLY')
    return response.output_parsed
  }
}

export function buildDocumentExtractionContent(input: DocumentInput) {
  const responseLanguage = input.locale === 'vi' ? 'Vietnamese' : 'English'
  const instructions = [
    'Extract courses and assessable tasks from this student document.',
    'Use ISO-8601 timestamps when a deadline is explicit; otherwise return null.',
    'Do not invent grades, deadlines, or weights. Put ambiguity in warnings.',
    'Evidence must be a short source-grounded phrase, not hidden reasoning.',
    `Write warnings and evidence entirely in ${responseLanguage}, except for names or titles copied from the source.`,
  ].join(' ')
  const isPdf = input.mimeType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf')
  const isImage = input.mimeType === 'image/png' || input.mimeType === 'image/jpeg'
  const sourceText = input.content.toString('utf8')
  const textLimit = 1_000_000
  if (isPdf) {
    return [
      {
        type: 'input_file' as const,
        filename: input.filename,
        file_data: `data:${input.mimeType};base64,${input.content.toString('base64')}`,
      },
      { type: 'input_text' as const, text: instructions },
    ]
  }
  if (isImage) {
    return [
      {
        type: 'input_image' as const,
        detail: 'high' as const,
        image_url: `data:${input.mimeType};base64,${input.content.toString('base64')}`,
      },
      {
        type: 'input_text' as const,
        text: `${instructions} The source is an uploaded screenshot or scan named ${input.filename}. Read only visible content and do not infer anything outside the image.`,
      },
    ]
  }
  return [{
    type: 'input_text' as const,
    text: [
      instructions,
      `Source filename: ${input.filename}`,
      sourceText.length > textLimit
        ? 'The source text was truncated for extraction. Include that limitation in warnings.'
        : '',
      'Source content:',
      sourceText.slice(0, textLimit),
    ].filter(Boolean).join('\n\n'),
  }]
}

export function createAiProvider(config: { openAiApiKey?: string; openAiModel: string }): AiProvider {
  return config.openAiApiKey
    ? new OpenAiProvider(config.openAiApiKey, config.openAiModel)
    : new MockAiProvider()
}
