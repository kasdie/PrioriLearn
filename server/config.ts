import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(serverDirectory, '..')

export type AppConfig = {
  port: number
  appOrigin: string
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

  return {
    port: Number(process.env.PORT ?? 8787),
    appOrigin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:4173',
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
