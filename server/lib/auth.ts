import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${derivedKey.toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(':')
  if (!salt || !keyHex) return false

  const storedKey = Buffer.from(keyHex, 'hex')
  const candidateKey = (await scrypt(password, salt, storedKey.length)) as Buffer
  return storedKey.length === candidateKey.length && timingSafeEqual(storedKey, candidateKey)
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createAuthActionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashAuthActionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
