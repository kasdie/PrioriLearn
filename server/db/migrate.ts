import dotenv from 'dotenv'
import { runMigrations } from './migrations-runner.js'
import { databaseSslConfig } from './ssl.js'

dotenv.config()

const databaseUrl = process.env.DATABASE_MIGRATOR_URL
if (!databaseUrl) throw new Error('DATABASE_MIGRATOR_URL is required to run migrations.')

await runMigrations({
  connectionString: databaseUrl,
  ssl: await databaseSslConfig(),
  target: process.env.MIGRATION_TARGET || undefined,
  log: console.log,
})
