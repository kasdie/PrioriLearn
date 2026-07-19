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
  persistenceDriver: 'memory' | 'postgres'
  databaseUrl?: string
  storageDirectory: string
  supabaseUrl?: string
  supabaseServiceRoleKey?: string
  supabaseStorageBucket?: string
  openAiApiKey?: string
  openAiModel: string
  maintenanceSecret?: string
  canvasClientId?: string
  canvasBaseUrl?: string
  googleClientId?: string
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const persistenceDriver = process.env.PERSISTENCE_DRIVER === 'postgres' ? 'postgres' : 'memory'
  const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10)
  const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000)

  return {
    port: Number(process.env.PORT ?? 8787),
    appOrigin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:4173',
    authRateLimitMax: Number.isInteger(authRateLimitMax) && authRateLimitMax > 0 ? authRateLimitMax : 10,
    authRateLimitWindowMs: Number.isInteger(authRateLimitWindowMs) && authRateLimitWindowMs > 0 ? authRateLimitWindowMs : 15 * 60_000,
    persistenceDriver,
    databaseUrl: process.env.DATABASE_URL || undefined,
    storageDirectory: path.resolve(workspaceRoot, process.env.STORAGE_DIR ?? 'var/uploads'),
    supabaseUrl: process.env.SUPABASE_URL || undefined,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || undefined,
    openAiApiKey: process.env.OPENAI_API_KEY || undefined,
    openAiModel: process.env.OPENAI_MODEL ?? 'gpt-5.6',
    maintenanceSecret: process.env.MAINTENANCE_SECRET || undefined,
    canvasClientId: process.env.CANVAS_CLIENT_ID || undefined,
    canvasBaseUrl: process.env.CANVAS_BASE_URL || undefined,
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    ...overrides,
  }
}
