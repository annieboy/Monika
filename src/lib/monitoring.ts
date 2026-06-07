/**
 * Error monitoring abstraction.
 *
 * Wraps Sentry (when SENTRY_DSN is set) so the rest of the app never imports
 * Sentry directly. In development / when DSN is absent, calls are no-ops.
 *
 * Usage:
 *   import { captureException, captureMessage, setUserContext } from './lib/monitoring.js'
 *   captureException(err, { userId, intent })
 */

export interface MonitoringContext {
  userId?: string
  [key: string]: unknown
}

type CaptureExceptionFn = (err: unknown, context?: MonitoringContext) => void
type CaptureMessageFn = (message: string, context?: MonitoringContext) => void
type SetUserContextFn = (userId: string) => void
type FlushFn = (timeoutMs?: number) => Promise<void>

interface Monitor {
  captureException: CaptureExceptionFn
  captureMessage: CaptureMessageFn
  setUserContext: SetUserContextFn
  flush: FlushFn
}

function buildNoopMonitor(): Monitor {
  return {
    captureException: () => undefined,
    captureMessage: () => undefined,
    setUserContext: () => undefined,
    flush: async () => undefined,
  }
}

async function buildSentryMonitor(dsn: string): Promise<Monitor> {
  try {
    // Dynamic import so Sentry is optional — the package is not in dependencies.
    // Install with: npm install @sentry/node
    const Sentry = await import('@sentry/node' as string)

    Sentry.init({
      dsn,
      environment: process.env['NODE_ENV'] ?? 'development',
      tracesSampleRate: 0.1,
    })

    return {
      captureException: (err, context) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Sentry.withScope((scope: any) => {
          if (context) scope.setExtras(context as Record<string, unknown>)
          Sentry.captureException(err)
        })
      },
      captureMessage: (message, context) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Sentry.withScope((scope: any) => {
          if (context) scope.setExtras(context as Record<string, unknown>)
          Sentry.captureMessage(message)
        })
      },
      setUserContext: (userId) => Sentry.setUser({ id: userId }),
      flush: async (timeoutMs = 2000) => {
        await Sentry.flush(timeoutMs)
      },
    }
  } catch {
    // @sentry/node not installed — fall back to noop silently
    return buildNoopMonitor()
  }
}

let _monitor: Monitor | null = null

export async function initMonitoring(): Promise<void> {
  const dsn = process.env['SENTRY_DSN']
  _monitor = dsn ? await buildSentryMonitor(dsn) : buildNoopMonitor()
}

function getMonitor(): Monitor {
  return _monitor ?? buildNoopMonitor()
}

export function captureException(err: unknown, context?: MonitoringContext): void {
  getMonitor().captureException(err, context)
}

export function captureMessage(message: string, context?: MonitoringContext): void {
  getMonitor().captureMessage(message, context)
}

export function setUserContext(userId: string): void {
  getMonitor().setUserContext(userId)
}

export async function flushMonitoring(timeoutMs?: number): Promise<void> {
  await getMonitor().flush(timeoutMs)
}
