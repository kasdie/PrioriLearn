import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthActionScreen } from './AuthActionScreen'
import { prioriApi, type ApiSession } from './lib/api'

const session: ApiSession = {
  user: {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'student@example.test',
    name: 'Student',
    locale: 'en',
    role: 'student',
    emailVerified: true,
    onboardingGuideSeenVersion: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
  },
  tenant: {
    id: 'tenant-1',
    kind: 'personal',
    name: 'Student',
    createdAt: '2026-07-24T00:00:00.000Z',
  },
}

describe('AuthActionScreen', () => {
  afterEach(() => vi.restoreAllMocks())

  it('confirms an email only after the user explicitly submits the link', async () => {
    const confirm = vi.spyOn(prioriApi, 'confirmEmailVerification').mockResolvedValue(session)
    const authenticated = vi.fn()
    render(
      <AuthActionScreen
        action={{ kind: 'verify-email', token: 'verification-token-that-is-long-enough' }}
        locale="en"
        onLocaleChange={vi.fn()}
        onCancel={vi.fn()}
        onAuthenticated={authenticated}
      />,
    )

    expect(confirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    expect(confirm).toHaveBeenCalledWith('verification-token-that-is-long-enough')
    expect(authenticated).toHaveBeenCalledWith(session)
  })

  it('does not submit a password reset when the confirmation differs', async () => {
    const confirm = vi.spyOn(prioriApi, 'confirmPasswordReset').mockResolvedValue(session)
    render(
      <AuthActionScreen
        action={{ kind: 'reset-password', token: 'password-reset-token-that-is-long-enough' }}
        locale="en"
        onLocaleChange={vi.fn()}
        onCancel={vi.fn()}
        onAuthenticated={vi.fn()}
      />,
    )

    await userEvent.type(screen.getByLabelText('New password'), 'new-password')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(screen.getByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(confirm).not.toHaveBeenCalled()
  })
})
