import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupabaseObjectStore } from './storage.js'

describe('SupabaseObjectStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses authenticated private-object endpoints with server-only credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ Key: 'tenant/a file.pdf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('document bytes', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Successfully deleted' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = new SupabaseObjectStore({
      url: 'https://example.supabase.co/rest/v1/',
      serviceRoleKey: 'service-role-secret',
      bucket: 'priorilearn-documents',
    })

    await store.put('tenant/a file.pdf', Buffer.from('document bytes'))
    await expect(store.get('tenant/a file.pdf')).resolves.toEqual(Buffer.from('document bytes'))
    await store.delete('tenant/a file.pdf')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co/storage/v1/object/priorilearn-documents/tenant/a%20file.pdf',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/storage/v1/object/authenticated/priorilearn-documents/tenant/a%20file.pdf',
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    const downloadHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers
    expect(downloadHeaders.get('Authorization')).toBe('Bearer service-role-secret')
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.supabase.co/storage/v1/object/priorilearn-documents/tenant/a%20file.pdf',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('rejects unsafe object keys before making a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = new SupabaseObjectStore({ url: 'https://example.supabase.co', serviceRoleKey: 'secret', bucket: 'documents' })

    await expect(store.put('../outside', Buffer.from('x'))).rejects.toThrow('INVALID_STORAGE_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
