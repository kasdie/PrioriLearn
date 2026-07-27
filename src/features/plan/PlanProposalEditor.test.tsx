// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiPlan } from '../../lib/api'
import { PlanProposalEditor } from './PlanProposalEditor'

const plan: ApiPlan = {
  id: 'plan-1',
  version: 1,
  status: 'proposed',
  items: [{
    id: 'item-1',
    taskId: 'task-1',
    startsAt: '2026-07-21T09:00:00.000Z',
    endsAt: '2026-07-21T09:45:00.000Z',
    minutes: 45,
    firstStep: 'Open the assignment.',
    rationale: 'Highest impact task.',
  }],
}

describe('PlanProposalEditor', () => {
  it('retains an edited draft when the versioned save fails', async () => {
    const api = { editPlan: vi.fn().mockRejectedValue(new Error('Version conflict.')) }
    render(<PlanProposalEditor plan={plan} taskName={() => 'Assignment'} onSaved={vi.fn()} api={api} />)

    fireEvent.change(screen.getByLabelText('Minutes Assignment'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Version conflict.'))
    expect(screen.getByLabelText('Minutes Assignment')).toHaveValue(30)
    expect(api.editPlan).toHaveBeenCalledWith(plan, [expect.objectContaining({ minutes: 30 })])
  })
})
