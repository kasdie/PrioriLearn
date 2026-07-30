import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(serverDirectory, '..')

export type AppConfig = {
  port: number
  appOrigin: string
  authRateLimitMax: number
  authRateLimitWindowMs: number
  aiRateLimitMax: number
  aiRateLimitWindowMs: number
  sessionCookieName: string
  sessionCookieSecure: boolean
  enforceOriginCheck: boolean
  structuredLogging: boolean
  persistenceDriver: 'memory' | 'postgres'
  databaseUrl?: string
  storageDirectory: string
  supabaseUrl?: string
  supabaseServiceRoleKey?: string
  supabaseStorageBucket?: string
  openAiApiKey?: string
  openAiModel: string
  maintenanceSecret?: string
  maintenancePreviousSecret?: string
  googleClientId?: string
  resendApiKey?: string
  emailFrom?: string
  webPushPublicKey?: string
  webPushPrivateKey?: string
  webPushSubject?: string
  sentryDsn?: string
  sentryEnvironment: string
  sentryRelease?: string
  extractionWorkerIntervalMs: number
  extractionWorkerBatchSize: number
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const persistenceDriver = process.env.PERSISTENCE_DRIVER === 'postgres' ? 'postgres' : 'memory'
  const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10)
  const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000)
  const aiRateLimitMax = Number(process.env.AI_RATE_LIMIT_MAX ?? 30)
  const aiRateLimitWindowMs = Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? 60 * 60_000)
  const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:4173'
  const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : appOrigin.startsWith('https://')
  const enforceOriginCheck = process.env.ENFORCE_ORIGIN_CHECK
    ? process.env.ENFORCE_ORIGIN_CHECK === 'true'
    : process.env.NODE_ENV === 'production'
  const structuredLogging = process.env.STRUCTURED_LOGS
    ? process.env.STRUCTURED_LOGS === 'true'
    : process.env.NODE_ENV === 'production'
  const extractionWorkerIntervalMs = Number(process.env.EXTRACTION_WORKER_INTERVAL_MS ?? 3_000)
  const extractionWorkerBatchSize = Number(process.env.EXTRACTION_WORKER_BATCH_SIZE ?? 2)
  const webPushValues = [
    process.env.WEB_PUSH_PUBLIC_KEY,
    process.env.WEB_PUSH_PRIVATE_KEY,
    process.env.WEB_PUSH_SUBJECT,
  ]
  if (webPushValues.some(Boolean) && !webPushValues.every(Boolean)) {
    throw new Error('WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, and WEB_PUSH_SUBJECT must be set together.')
  }

  return {
    port: Number(process.env.PORT ?? 8787),
    appOrigin,
    authRateLimitMax: Number.isInteger(authRateLimitMax) && authRateLimitMax > 0 ? authRateLimitMax : 10,
    authRateLimitWindowMs: Number.isInteger(authRateLimitWindowMs) && authRateLimitWindowMs > 0 ? authRateLimitWindowMs : 15 * 60_000,
    aiRateLimitMax: Number.isInteger(aiRateLimitMax) && aiRateLimitMax > 0 ? aiRateLimitMax : 30,
    aiRateLimitWindowMs: Number.isInteger(aiRateLimitWindowMs) && aiRateLimitWindowMs > 0 ? aiRateLimitWindowMs : 60 * 60_000,
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'priorilearn_session',
    sessionCookieSecure,
    enforceOriginCheck,
    structuredLogging,
    persistenceDriver,
    databaseUrl: process.env.DATABASE_URL || undefined,
    storageDirectory: path.resolve(workspaceRoot, process.env.STORAGE_DIR ?? 'var/uploads'),
    supabaseUrl: process.env.SUPABASE_URL || undefined,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || undefined,
    openAiApiKey: process.env.OPENAI_API_KEY || undefined,
    openAiModel: process.env.OPENAI_MODEL ?? 'gpt-5.6',
    maintenanceSecret: process.env.MAINTENANCE_SECRET || undefined,
    maintenancePreviousSecret: process.env.MAINTENANCE_SECRET_PREVIOUS || undefined,
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    emailFrom: process.env.EMAIL_FROM || undefined,
    webPushPublicKey: process.env.WEB_PUSH_PUBLIC_KEY || undefined,
    webPushPrivateKey: process.env.WEB_PUSH_PRIVATE_KEY || undefined,
    webPushSubject: process.env.WEB_PUSH_SUBJECT || undefined,
    sentryDsn: process.env.SENTRY_DSN || undefined,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    sentryRelease: process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT || undefined,
    extractionWorkerIntervalMs: Number.isInteger(extractionWorkerIntervalMs) && extractionWorkerIntervalMs >= 1_000
      ? extractionWorkerIntervalMs
      : 3_000,
    extractionWorkerBatchSize: Number.isInteger(extractionWorkerBatchSize) && extractionWorkerBatchSize > 0
      ? Math.min(extractionWorkerBatchSize, 10)
      : 2,
    ...overrides,
  }
}
