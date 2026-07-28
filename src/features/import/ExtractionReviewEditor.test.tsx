// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExtractionReviewEditor } from './ExtractionReviewEditor'

const extraction = {
  courses: [{ code: 'CS101', name: 'Algorithms', currentScore: null, targetScore: 85, confidence: .73, evidence: ['Page 2'] }],
  tasks: [{ courseCode: 'CS101', title: 'Problem set', dueAt: null, gradeWeight: null, estimatedMinutes: 45, confidence: .61, evidence: ['Week 3 table'] }],
  warnings: ['Deadline was not found.'],
}

describe('ExtractionReviewEditor', () => {
  it('requires warnings to be acknowledged before confirming reviewed data', () => {
    const onConfirm = vi.fn()
    render(<ExtractionReviewEditor locale="en" extraction={extraction} busy={false} onChange={vi.fn()} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: /confirm reviewed data/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/acknowledge/i)

    fireEvent.click(screen.getByRole('checkbox', { name: /deadline was not found/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm reviewed data/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Page 2')).toBeInTheDocument()
  })
})
