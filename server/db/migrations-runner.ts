import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg, { type ConnectionConfig } from 'pg'

export type MigrationOptions = {
  connectionString: string
  target?: string
  cwd?: string
  ssl?: ConnectionConfig['ssl']
  log?: (message: string) => void
}

async function resolveMigrationsDirectory(cwd: string): Promise<string> {
  const compiledDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
  try {
    await access(compiledDirectory)
    return compiledDirectory
  } catch {
    return path.resolve(cwd, 'server', 'db', 'migrations')
  }
}

export async function runMigrations(options: MigrationOptions): Promise<string[]> {
  const client = new pg.Client({
    connectionString: options.connectionString,
    ssl: options.ssl,
  })
  client.on('error', (error) => {
    options.log?.(`Database connection error: ${error.message}`)
  })
  const migrationsDirectory = await resolveMigrationsDirectory(options.cwd ?? process.cwd())
  const appliedFiles: string[] = []

  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => !options.target || file <= options.target)
      .sort()

    if (options.target && !files.includes(options.target)) {
      throw new Error(`MIGRATION_TARGET ${options.target} was not found.`)
    }

    for (const filename of files) {
      const applied = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations WHERE filename = $1', [filename])
      if (applied.rowCount) continue

      const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
        appliedFiles.push(filename)
        options.log?.(`Applied ${filename}`)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }
  } finally {
    await client.end()
  }

  return appliedFiles
}
