import * as Sentry from '@sentry/react'

function stripUrlDetails(value: string | undefined): string | undefined {
  if (!value) return value
  const queryIndex = value.indexOf('?')
  const fragmentIndex = value.indexOf('#')
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0)
  return indexes.length > 0 ? value.slice(0, Math.min(...indexes)) : value
}

export function scrubBrowserEvent<T extends Sentry.Event>(event: T): T {
  event.user = undefined
  event.extra = undefined
  if (event.request) {
    event.request.url = stripUrlDetails(event.request.url)
    event.request.data = undefined
    event.request.query_string = undefined
    event.request.cookies = undefined
    event.request.env = undefined
    event.request.headers = undefined
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

let browserObservabilityInitialized = false

export function initializeBrowserObservability(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!dsn) return false
  if (browserObservabilityInitialized) return true

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubBrowserEvent,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null
      if (typeof breadcrumb.data?.url === 'string') {
        breadcrumb.data.url = stripUrlDetails(breadcrumb.data.url)
      }
      return breadcrumb
    },
  })
  browserObservabilityInitialized = true
  return true
}
