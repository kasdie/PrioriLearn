export type PriorityFactors = {
  academicImpact: number
  failureRisk: number
  costOfDelay: number
  goalAlignment: number
  actionability: number
}

export type PriorityAssessment = PriorityFactors & {
  score: number
  confidence: 'low' | 'medium' | 'high'
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))

export function calculatePriority(factors: PriorityFactors): number {
  const weightedScore =
    clamp(factors.academicImpact) * 0.3 +
    clamp(factors.failureRisk) * 0.25 +
    clamp(factors.costOfDelay) * 0.2 +
    clamp(factors.goalAlignment) * 0.15 +
    clamp(factors.actionability) * 0.1

  return Math.round(weightedScore)
}

export function assessPriority(factors: PriorityFactors, confidence: PriorityAssessment['confidence']): PriorityAssessment {
  return { ...factors, score: calculatePriority(factors), confidence }
}

export type PlanStatus = 'draft' | 'approved'

export function canApplyReplan(planStatus: PlanStatus, proposalApproved: boolean): boolean {
  return planStatus === 'approved' && proposalApproved
}
