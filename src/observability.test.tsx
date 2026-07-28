import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'
import { scrubBrowserEvent } from './lib/observability'

function BrokenScreen(): never {
  throw new Error('Render failed')
}

describe('browser observability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.lang = 'en'
  })

  it('shows a recoverable full-page fallback for a render error', () => {
    document.documentElement.lang = 'en'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <AppErrorBoundary>
        <BrokenScreen />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('We could not open your workspace.')
    expect(screen.getByRole('button', { name: 'Reload application' })).toBeVisible()
  })

  it('shows the full-page fallback in the active Vietnamese locale', () => {
    document.documentElement.lang = 'vi'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <AppErrorBoundary>
        <BrokenScreen />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Không thể mở không gian học của bạn.')
    expect(screen.getByRole('button', { name: 'Tải lại ứng dụng' })).toBeVisible()
  })

  it('removes browser request content and URL secrets before reporting', () => {
    const event = scrubBrowserEvent({
      user: { email: 'student@example.com' },
      extra: { draft: 'private work' },
      request: {
        url: 'https://example.com/reset-password?token=secret#fragment',
        data: { password: 'secret' },
        query_string: 'token=secret',
        cookies: { session: 'secret' },
        headers: { authorization: 'Bearer secret' },
      },
      breadcrumbs: [
        { category: 'console', message: 'secret' },
        { category: 'fetch', data: { url: 'https://api.example.com/tasks?student=private' } },
      ],
    })

    expect(event.user).toBeUndefined()
    expect(event.extra).toBeUndefined()
    expect(event.request).toEqual({
      url: 'https://example.com/reset-password',
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      env: undefined,
      headers: undefined,
    })
    expect(event.breadcrumbs).toEqual([
      { category: 'fetch', data: { url: 'https://api.example.com/tasks' } },
    ])
  })
})
