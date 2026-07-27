import pg from 'pg'

const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])

function comparableDatabaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.password = ''
  url.search = ''
  return url.toString()
}

export function assertSafeTestDatabaseUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('DATABASE_URL_TEST must be a valid PostgreSQL URL.')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL_TEST must use postgres:// or postgresql://.')
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase()
  if (!databaseName.includes('test')) {
    throw new Error('DATABASE_URL_TEST must point to a database whose name contains "test".')
  }

  const allowRemote = process.env.ALLOW_REMOTE_TEST_DATABASE === 'true'
  if (!localHosts.has(url.hostname) && !allowRemote) {
    throw new Error('Remote PostgreSQL tests require ALLOW_REMOTE_TEST_DATABASE=true and an isolated test project.')
  }

  if (process.env.DATABASE_URL && comparableDatabaseUrl(rawUrl) === comparableDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error('DATABASE_URL_TEST must not match DATABASE_URL.')
  }

  return url
}

export function runtimeDatabaseUrl(migratorUrl: URL, password: string): string {
  const runtimeUrl = new URL(migratorUrl)
  runtimeUrl.username = 'priorilearn_api'
  runtimeUrl.password = password
  return runtimeUrl.toString()
}

export async function resetTestSchema(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')
    await client.query('GRANT ALL ON SCHEMA public TO public')
  } finally {
    await client.end()
  }
}
