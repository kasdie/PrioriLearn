import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface ObjectStore {
  put(key: string, content: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

type SupabaseObjectStoreOptions = {
  url: string
  serviceRoleKey: string
  bucket: string
}

function encodeObjectKey(key: string): string {
  const segments = key.split('/')
  if (!key || key.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('INVALID_STORAGE_KEY')
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/')
}

export class SupabaseObjectStore implements ObjectStore {
  private readonly storageUrl: string

  constructor(private readonly options: SupabaseObjectStoreOptions) {
    const projectUrl = options.url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
    this.storageUrl = `${projectUrl}/storage/v1`
  }

  private objectUrl(key: string, authenticated = false): string {
    const prefix = authenticated ? 'object/authenticated' : 'object'
    return `${this.storageUrl}/${prefix}/${encodeURIComponent(this.options.bucket)}/${encodeObjectKey(key)}`
  }

  private headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers(extra)
    headers.set('Authorization', `Bearer ${this.options.serviceRoleKey}`)
    headers.set('apikey', this.options.serviceRoleKey)
    return headers
  }

  private async assertSuccess(response: Response, operation: string): Promise<void> {
    if (response.ok) return
    const details = (await response.text()).trim().replace(/\s+/g, ' ')
    const suffix = details ? `: ${details.slice(0, 300)}` : ''
    throw new Error(`SUPABASE_STORAGE_${operation}_FAILED (${response.status})${suffix}`)
  }

  async put(key: string, content: Buffer): Promise<void> {
    const response = await fetch(this.objectUrl(key), {
      method: 'POST',
      headers: this.headers({
        'Content-Type': 'application/octet-stream',
        // A retry of the same idempotency key must be able to resume the same object key.
        'x-upsert': 'true',
      }),
      body: content,
    })
    await this.assertSuccess(response, 'UPLOAD')
  }

  async get(key: string): Promise<Buffer> {
    const response = await fetch(this.objectUrl(key, true), { headers: this.headers() })
    await this.assertSuccess(response, 'DOWNLOAD')
    return Buffer.from(await response.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(this.objectUrl(key), { method: 'DELETE', headers: this.headers() })
    if (response.status === 404) return
    await this.assertSuccess(response, 'DELETE')
  }
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly rootDirectory: string) {}

  private resolveKey(key: string): string {
    const resolved = path.resolve(this.rootDirectory, key)
    const root = path.resolve(this.rootDirectory)
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_STORAGE_KEY')
    return resolved
  }

  async put(key: string, content: Buffer): Promise<void> {
    const filename = this.resolveKey(key)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true })
  }
}

export class MemoryObjectStore implements ObjectStore {
  private objects = new Map<string, Buffer>()

  async put(key: string, content: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(content))
  }

  async get(key: string): Promise<Buffer> {
    const content = this.objects.get(key)
    if (!content) throw new Error('OBJECT_NOT_FOUND')
    return Buffer.from(content)
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }
}
