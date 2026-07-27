import dotenv from 'dotenv'
import { provisionRuntimeRole } from './runtime-role.js'

dotenv.config()

const databaseUrl = process.env.DATABASE_MIGRATOR_URL
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD

if (!databaseUrl) throw new Error('DATABASE_MIGRATOR_URL is required to provision the runtime role.')
if (!runtimePassword || runtimePassword.length < 16) {
  throw new Error('DATABASE_RUNTIME_PASSWORD must contain at least 16 characters.')
}

await provisionRuntimeRole(databaseUrl, runtimePassword)
console.log('Provisioned priorilearn_api runtime role.')
