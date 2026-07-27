import pg from 'pg'

export async function provisionRuntimeRole(connectionString: string, password: string): Promise<void> {
  if (password.length < 16) throw new Error('Runtime database password is too short.')

  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const passwordLiteral = client.escapeLiteral(password)
    await client.query(`ALTER ROLE priorilearn_api LOGIN NOINHERIT NOBYPASSRLS PASSWORD ${passwordLiteral}`)
  } finally {
    await client.end()
  }
}
