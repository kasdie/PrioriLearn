import { describe, expect, it } from 'vitest'
import { scrubServerEvent } from './error-reporter.js'

describe('server error reporting', () => {
  it('removes private request state before an event leaves the API', () => {
    const event = scrubServerEvent({
      user: { id: 'private-user', email: 'student@example.com' },
      extra: { sourceText: 'private course material' },
      request: {
        url: 'https://api.example.com/reset?token=secret#fragment',
        method: 'POST',
        data: { password: 'secret' },
        query_string: 'token=secret',
        cookies: { session: 'secret' },
        env: { DATABASE_URL: 'secret' },
        headers: {
          authorization: 'Bearer secret',
          cookie: 'session=secret',
          'x-maintenance-secret': 'secret',
          'content-type': 'application/json',
        },
      },
      breadcrumbs: [
        { category: 'console', message: 'secret' },
        { category: 'fetch', data: { url: 'https://api.example.com/tasks?student=private' } },
      ],
    })

    expect(event.user).toBeUndefined()
    expect(event.extra).toBeUndefined()
    expect(event.request).toEqual({
      url: 'https://api.example.com/reset',
      method: 'POST',
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      env: undefined,
      headers: { 'content-type': 'application/json' },
    })
    expect(event.breadcrumbs).toEqual([
      { category: 'fetch', data: { url: 'https://api.example.com/tasks' } },
    ])
  })
})
