import * as Sentry from '@sentry/node'
import type { AppConfig } from '../config.js'

export type ErrorReportContext = {
  requestId?: string
  method?: string
  path?: string
  status?: number
  code?: string
  source?: string
}

export type CapturedError = {
  error: unknown
  context: ErrorReportContext
}

export interface ErrorReporter {
  readonly name: string
  readonly configured: boolean
  captureException(error: unknown, context?: ErrorReportContext): void
}

const sensitiveHeaders = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-maintenance-secret',
])

function stripUrlDetails(value: string | undefined): string | undefined {
  if (!value) return value
  const queryIndex = value.indexOf('?')
  const fragmentIndex = value.indexOf('#')
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0)
  return indexes.length > 0 ? value.slice(0, Math.min(...indexes)) : value
}

function scrubHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !sensitiveHeaders.has(name.toLowerCase())),
  )
}

export function scrubServerEvent<T extends Sentry.Event>(event: T): T {
  event.user = undefined
  event.extra = undefined
  if (event.request) {
    event.request.url = stripUrlDetails(event.request.url)
    event.request.data = undefined
    event.request.query_string = undefined
    event.request.cookies = undefined
    event.request.env = undefined
    event.request.headers = scrubHeaders(event.request.headers)
  }
  event.breadcrumbs = event.breadcrumbs
    ?.filter((breadcrumb) => breadcrumb.category !== 'console')
    .map((breadcrumb) => {
      if (typeof breadcrumb.data?.url !== 'string') return breadcrumb
      return {
        ...breadcrumb,
        data: {
          ...breadcrumb.data,
          url: stripUrlDetails(breadcrumb.data.url),
        },
      }
    })
  return event
}

class NoopErrorReporter implements ErrorReporter {
  readonly name = 'disabled'
  readonly configured = false

  captureException(): void {}
}

class SentryErrorReporter implements ErrorReporter {
  readonly name = 'sentry'
  readonly configured = true

  captureException(error: unknown, context: ErrorReportContext = {}): void {
    Sentry.withScope((scope) => {
      for (const [name, value] of Object.entries(context)) {
        if (value !== undefined) scope.setTag(name, String(value))
      }
      Sentry.captureException(error)
    })
  }
}

export class MemoryErrorReporter implements ErrorReporter {
  readonly name = 'memory'
  readonly configured = true
  readonly events: CapturedError[] = []

  captureException(error: unknown, context: ErrorReportContext = {}): void {
    this.events.push({ error, context })
  }
}

let initializedKey: string | undefined

export function createErrorReporter(config: AppConfig): ErrorReporter {
  if (!config.sentryDsn) return new NoopErrorReporter()

  const initializationKey = [
    config.sentryDsn,
    config.sentryEnvironment,
    config.sentryRelease ?? '',
  ].join('|')

  if (initializedKey !== initializationKey) {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
      release: config.sentryRelease,
      sendDefaultPii: false,
      includeLocalVariables: false,
      tracesSampleRate: 0,
      integrations: (defaults) => defaults.filter((integration) =>
        !['Http', 'LocalVariables', 'RequestData'].includes(integration.name)),
      beforeSend: scrubServerEvent,
    })
    initializedKey = initializationKey
  }

  return new SentryErrorReporter()
}
