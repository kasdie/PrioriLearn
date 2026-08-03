// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../lib/api'
import { useSession } from './useSession'

const restoredSession: ApiSession = {
  user: {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'student@example.test',
    name: 'Student',
    locale: 'en',
    role: 'student',
    emailVerified: true,
    onboardingGuideSeenVersion: 1,
    createdAt: '2026-07-20T00:00:00.000Z',
  },
  tenant: {
    id: 'tenant-1',
    kind: 'personal',
    name: 'Student',
    createdAt: '2026-07-20T00:00:00.000Z',
  },
}

describe('useSession', () => {
  it('retains the current-tab draft through expiry and in-place re-authentication', async () => {
    const api = { bootstrap: vi.fn().mockResolvedValue(restoredSession), logout: vi.fn() }

    function Harness() {
      const [locale, setLocale] = useState<'vi' | 'en'>('en')
      const [draft, setDraft] = useState('')
      const session = useSession({ locale, onLocaleChange: setLocale, api })
      if (session.checking) return <span>Checking</span>
      if (!session.session) {
        return <button type="button" onClick={() => session.authenticate(restoredSession)}>Sign in again</button>
      }
      return <label>Draft<input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    }

    render(<Harness />)
    const input = await screen.findByLabelText('Draft')
    fireEvent.change(input, { target: { value: 'Keep this unsaved edit' } })

    act(() => window.dispatchEvent(new Event('priorilearn:session-expired')))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }))

    await waitFor(() => expect(screen.getByLabelText('Draft')).toHaveValue('Keep this unsaved edit'))
  })
})
