import { readFile } from 'node:fs/promises'
import type { ConnectionConfig } from 'pg'

export async function databaseSslConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ConnectionConfig['ssl']> {
  const sslCaPath = environment.DATABASE_SSL_CA_PATH
  const sslMode = environment.DATABASE_SSL_MODE
  if (sslMode && !['require', 'verify-full'].includes(sslMode)) {
    throw new Error('DATABASE_SSL_MODE must be require or verify-full.')
  }
  if (sslMode === 'verify-full' && !sslCaPath) {
    throw new Error('DATABASE_SSL_CA_PATH is required when DATABASE_SSL_MODE=verify-full.')
  }
  if (sslCaPath) {
    return {
      rejectUnauthorized: true,
      ca: await readFile(sslCaPath, 'utf8'),
    }
  }
  return sslMode === 'require' ? { rejectUnauthorized: false } : undefined
}
