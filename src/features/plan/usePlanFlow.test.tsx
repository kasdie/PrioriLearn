// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientError, type ApiPlan } from '../../lib/api'
import { usePlanFlow } from './usePlanFlow'

const proposal: ApiPlan = { id: 'plan-1', version: 1, status: 'proposed' }

describe('usePlanFlow', () => {
  it('does not show a proposal when generation fails', async () => {
    const api = {
      generatePlan: vi.fn().mockRejectedValue(new Error('Generation unavailable.')),
      approvePlan: vi.fn(),
    }
    const { result } = renderHook(() => usePlanFlow(api))

    await act(() => result.current.generate())

    expect(result.current.plan).toBeNull()
    expect(result.current.approved).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Generation unavailable.')
    expect(api.approvePlan).not.toHaveBeenCalled()
  })

  it('keeps the reviewable proposal when approval fails', async () => {
    const api = {
      generatePlan: vi.fn().mockResolvedValue(proposal),
      approvePlan: vi.fn().mockRejectedValue(new Error('Version conflict.')),
    }
    const { result } = renderHook(() => usePlanFlow(api))

    await act(() => result.current.generate())
    expect(result.current.status).toBe('proposed')
    await act(() => result.current.approve())

    expect(result.current.plan).toEqual(proposal)
    expect(result.current.approved).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Version conflict.')
  })

  it('exposes a recoverable schedule error code without dropping the proposal', async () => {
    const api = {
      generatePlan: vi.fn().mockResolvedValue(proposal),
      approvePlan: vi.fn().mockRejectedValue(new ApiClientError(409, 'INVALID_PLAN_SCHEDULE', 'Schedule changed.')),
    }
    const { result } = renderHook(() => usePlanFlow(api))

    await act(() => result.current.generate())
    await act(() => result.current.approve())

    expect(result.current.plan).toEqual(proposal)
    expect(result.current.errorCode).toBe('INVALID_PLAN_SCHEDULE')
  })
})
