import { useRef, useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingGuide } from './OnboardingGuide'

function GuideHarness({
  initialLocale = 'vi',
  onDismiss = vi.fn(),
  onStart = vi.fn(),
}: {
  initialLocale?: 'vi' | 'en'
  onDismiss?: () => void
  onStart?: () => void
}) {
  const [locale, setLocale] = useState<'vi' | 'en'>(initialLocale)
  const [open, setOpen] = useState(true)
  const helpRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    onDismiss()
  }
  const start = () => {
    setOpen(false)
    onStart()
  }
  return <>
    <button ref={helpRef} type="button">Usage help</button>
    {open && <OnboardingGuide
      locale={locale}
      returnFocusRef={helpRef}
      onLocaleChange={setLocale}
      onDismiss={close}
      onStart={start}
    />}
  </>
}

describe('OnboardingGuide', () => {
  it('shows the five-step Vietnamese workflow and switches fully to English', async () => {
    const user = userEvent.setup()
    render(<GuideHarness />)

    expect(screen.getByRole('dialog', { name: 'Bắt đầu với PrioriLearn' })).toBeVisible()
    expect(screen.getAllByRole('row')).toHaveLength(6)
    expect(screen.getByText(/PDF, PNG, JPG, TXT, CSV, JSON, JSONL, ICS/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('dialog', { name: 'Get started with PrioriLearn' })).toBeVisible()
    expect(screen.queryByText('Bắt đầu với PrioriLearn')).not.toBeInTheDocument()
    expect(screen.getByText('AI proposes, you decide')).toBeVisible()
  })

  it('closes with Escape and restores focus to the help button', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<GuideHarness onDismiss={onDismiss} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Đóng hướng dẫn' })).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Usage help' })).toHaveFocus())
  })

  it('starts the data workflow from the primary action', async () => {
    const onStart = vi.fn()
    const user = userEvent.setup()
    render(<GuideHarness onStart={onStart} />)

    await user.click(screen.getByRole('button', { name: /Bắt đầu thêm dữ liệu/ }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
