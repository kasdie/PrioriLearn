import * as Sentry from '@sentry/react'
import { RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'

type ErrorBoundaryState = {
  failed: boolean
}

export class AppErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.withScope((scope) => {
      scope.setTag('surface', 'react')
      if (info.componentStack) {
        scope.setContext('react', { componentStack: info.componentStack.slice(0, 4_000) })
      }
      Sentry.captureException(error)
    })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal-error" role="alert">
        <p className="fatal-error__eyebrow">PrioriLearn</p>
        <h1>We could not open your workspace.</h1>
        <p>Your saved account data is still intact. Reload the application to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden="true" size={18} />
          Reload application
        </button>
      </main>
    )
  }
}
