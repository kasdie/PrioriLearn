import { describe, expect, it, vi } from 'vitest'
import { runDailyCron } from './daily.js'

describe('Vercel daily maintenance cron', () => {
  const dependencies = {
    cronSecret: 'cron-secret',
    maintenanceSecret: 'maintenance-secret',
    renderApiOrigin: 'https://api.example.test',
  }

  it('rejects a request without the Vercel cron secret', async () => {
    const response = await runDailyCron(new Request('https://app.example.test/api/cron/daily'), dependencies)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CRON_UNAUTHORIZED' } })
  })

  it('forwards only the separate maintenance secret to Render', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ claimed: 2 }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    const response = await runDailyCron(new Request('https://app.example.test/api/cron/daily', {
      headers: { Authorization: 'Bearer cron-secret' },
    }), { ...dependencies, fetchImpl })

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledWith(new URL('https://api.example.test/api/internal/maintenance/daily'), expect.objectContaining({
      method: 'POST', headers: { 'x-maintenance-secret': 'maintenance-secret' },
    }))
    await expect(response.json()).resolves.toEqual({ claimed: 2 })
  })
})
