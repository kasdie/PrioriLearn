import { describe, expect, it } from 'vitest'
import { isMissedPlanItem } from './planStatus'

describe('plan item status', () => {
  const now = new Date('2027-01-10T12:00:00.000Z')

  it('marks only an unfinished block whose end time has passed as missed', () => {
    expect(isMissedPlanItem('2027-01-10T11:00:00.000Z', 'confirmed', now)).toBe(true)
    expect(isMissedPlanItem('2027-01-10T13:00:00.000Z', 'confirmed', now)).toBe(false)
    expect(isMissedPlanItem('2027-01-10T11:00:00.000Z', 'completed', now)).toBe(false)
    expect(isMissedPlanItem('not-a-date', 'confirmed', now)).toBe(false)
  })
})
