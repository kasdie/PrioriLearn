import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'

describe('production configuration guards', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('keeps shared demo and unverifiable password registration disabled by default', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_DEMO_ACCESS', '')
    vi.stubEnv('ENABLE_PASSWORD_REGISTRATION', '')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')

    const config = loadConfig()
    expect(config.demoAccessEnabled).toBe(false)
    expect(config.passwordRegistrationEnabled).toBe(false)
  })

  it('allows production password registration only with working verification email', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_PASSWORD_REGISTRATION', 'true')
    vi.stubEnv('RESEND_API_KEY', 'resend-test-key')
    vi.stubEnv('EMAIL_FROM', 'PrioriLearn <verified@example.test>')

    expect(loadConfig().passwordRegistrationEnabled).toBe(true)

    vi.stubEnv('EMAIL_FROM', '')
    expect(loadConfig().passwordRegistrationEnabled).toBe(false)
  })

  it('rejects partial VAPID configuration before the API starts', () => {
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', 'public-only')
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', '')
    vi.stubEnv('WEB_PUSH_SUBJECT', '')

    expect(() => loadConfig()).toThrow(
      'WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, and WEB_PUSH_SUBJECT must be set together.',
    )
  })
})
