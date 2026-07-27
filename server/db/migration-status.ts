import dotenv from 'dotenv'
import pg from 'pg'
import { databaseSslConfig } from './ssl.js'

dotenv.config()

const databaseUrl = process.env.DATABASE_MIGRATOR_URL
if (!databaseUrl) throw new Error('DATABASE_MIGRATOR_URL is required to check migration status.')

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: await databaseSslConfig(),
})
client.on('error', (error) => {
  console.error(`Database connection error: ${error.message}`)
})

await client.connect()
try {
  const migrations = await client.query<{ filename: string; applied_at: Date }>(
    'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
  )
  const roleName = 'priorilearn_lifecycle_owner'
  const role = await client.query<{ role_exists: boolean; is_member: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
       CASE
         WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
         THEN pg_has_role(current_user, $1, 'MEMBER')
         ELSE false
       END AS is_member`,
    [roleName],
  )
  console.log(JSON.stringify({
    currentUser: client.user,
    migrations: migrations.rows.map((row) => ({
      filename: row.filename,
      appliedAt: row.applied_at.toISOString(),
    })),
    lifecycleOwner: role.rows[0] ?? { role_exists: false, is_member: false },
  }, null, 2))
} finally {
  await client.end()
}
