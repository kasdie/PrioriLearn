import { describe, expect, it } from 'vitest'
import { assessPriority, calculatePriority, canApplyReplan } from './priority'

describe('priority scoring', () => {
  it('uses the documented transparent weighting', () => {
    const score = calculatePriority({
      academicImpact: 100,
      failureRisk: 94,
      costOfDelay: 96,
      goalAlignment: 86,
      actionability: 91,
    })

    expect(score).toBe(95)
  })

  it('clamps invalid factor input before calculation', () => {
    const score = calculatePriority({
      academicImpact: 200,
      failureRisk: -20,
      costOfDelay: 0,
      goalAlignment: 0,
      actionability: 0,
    })

    expect(score).toBe(30)
  })

  it('preserves evidence confidence beside the score', () => {
    const assessment = assessPriority({ academicImpact: 50, failureRisk: 50, costOfDelay: 50, goalAlignment: 50, actionability: 50 }, 'medium')
    expect(assessment).toMatchObject({ score: 50, confidence: 'medium' })
  })
})

describe('replan approval guard', () => {
  it('never applies a replan without proposal approval', () => {
    expect(canApplyReplan('approved', false)).toBe(false)
  })

  it('never applies a proposal to a draft plan', () => {
    expect(canApplyReplan('draft', true)).toBe(false)
  })

  it('allows an approved proposal to update an approved plan', () => {
    expect(canApplyReplan('approved', true)).toBe(true)
  })
})
