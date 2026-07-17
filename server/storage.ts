import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface ObjectStore {
  put(key: string, content: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
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
