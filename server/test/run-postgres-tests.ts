import { spawn } from 'node:child_process'
import path from 'node:path'
import dotenv from 'dotenv'
import { assertSafeTestDatabaseUrl } from './postgres.js'

dotenv.config()

const databaseUrl = process.env.DATABASE_URL_TEST
if (!databaseUrl) {
  throw new Error('DATABASE_URL_TEST is required. Start docker-compose.test.yml and use the URL from .env.example.')
}

assertSafeTestDatabaseUrl(databaseUrl)

const vitestEntry = path.resolve('node_modules', 'vitest', 'vitest.mjs')
const child = spawn(process.execPath, [vitestEntry, 'run', 'server/postgres-repository.integration.test.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PRIORILEARN_POSTGRES_TESTS: 'true',
  },
  stdio: 'inherit',
})

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolve(code ?? 1))
})

process.exitCode = exitCode
