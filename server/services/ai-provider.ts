import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  CoachingProposalSchema,
  DocumentExtractionSchema,
  type CoachingProposal,
  type DocumentExtraction,
  type StudyPlan,
} from '../domain/contracts.js'

type DocumentInput = {
  filename: string
  mimeType: string
  content: Buffer
}

type CoachingInput = {
  friction: string
  note?: string
  plan: StudyPlan
}

export interface AiProvider {
  readonly name: string
  extractDocument(input: DocumentInput): Promise<DocumentExtraction>
  draftCoachingProposal(input: CoachingInput): Promise<CoachingProposal>
}

export class MockAiProvider implements AiProvider {
  readonly name = 'deterministic-demo'

  async extractDocument(_input: DocumentInput): Promise<DocumentExtraction> {
    const dueAt = new Date(Date.now() + 6 * 24 * 3_600_000).toISOString()
    return {
      courses: [{
        code: 'CS304',
        name: 'Programming',
        currentScore: 54,
        targetScore: 78,
        confidence: 0.96,
        evidence: ['Course header and grade summary'],
      }],
      tasks: [{
        courseCode: 'CS304',
        title: 'Assignment 4: Service integration',
        dueAt,
        gradeWeight: 20,
        estimatedMinutes: 60,
        confidence: 0.93,
        evidence: ['Assessment table: Assignment 4, 20%'],
      }],
      warnings: ['Demo extraction was used because OPENAI_API_KEY is not configured.'],
    }
  }

  async draftCoachingProposal(input: CoachingInput): Promise<CoachingProposal> {
    const firstItem = input.plan.items[0]
    return {
      title: 'Lower the activation energy, preserve the deadline',
      rationale: `The check-in reported ${input.friction}. The approved plan remains unchanged until this proposal is approved.`,
      changes: ['Shorten the first block to 20 minutes', 'Keep a 10-minute recovery buffer'],
      firstStep: firstItem?.firstStep ?? 'Open the task brief and read the first requirement.',
      estimatedMinutes: 20,
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
    const dataUrl = `data:${input.mimeType};base64,${input.content.toString('base64')}`
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [{
        role: 'user',
        content: [
          { type: 'input_file', filename: input.filename, file_data: dataUrl },
          {
            type: 'input_text',
            text: [
              'Extract courses and assessable tasks from this student document.',
              'Use ISO-8601 timestamps when a deadline is explicit; otherwise return null.',
              'Do not invent grades, deadlines, or weights. Put ambiguity in warnings.',
              'Evidence must be a short source-grounded phrase, not hidden reasoning.',
            ].join(' '),
          },
        ],
      }],
      text: { format: zodTextFormat(DocumentExtractionSchema, 'syllabus_extraction') },
    })
    if (!response.output_parsed) throw new Error('MODEL_RETURNED_NO_EXTRACTION')
    return response.output_parsed
  }

  async draftCoachingProposal(input: CoachingInput): Promise<CoachingProposal> {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: 'system',
          content: 'You draft small, realistic study-plan changes. Never claim a plan has changed; this output is only a proposal awaiting approval.',
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
      text: { format: zodTextFormat(CoachingProposalSchema, 'coaching_proposal') },
    })
    if (!response.output_parsed) throw new Error('MODEL_RETURNED_NO_PROPOSAL')
    return response.output_parsed
  }
}

export function createAiProvider(config: { openAiApiKey?: string; openAiModel: string }): AiProvider {
  return config.openAiApiKey
    ? new OpenAiProvider(config.openAiApiKey, config.openAiModel)
    : new MockAiProvider()
}
