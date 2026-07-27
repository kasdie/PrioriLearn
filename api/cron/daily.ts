type CronDependencies = {
  cronSecret?: string
  maintenanceSecret?: string
  renderApiOrigin?: string
  fetchImpl?: typeof fetch
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function runDailyCron(request: Request, dependencies: CronDependencies = {}): Promise<Response> {
  const cronSecret = dependencies.cronSecret ?? process.env.CRON_SECRET
  const maintenanceSecret = dependencies.maintenanceSecret ?? process.env.MAINTENANCE_SECRET
  const renderApiOrigin = dependencies.renderApiOrigin ?? process.env.RENDER_API_ORIGIN
  if (!cronSecret || !maintenanceSecret || !renderApiOrigin) {
    return json(503, { error: { code: 'CRON_CONFIGURATION_REQUIRED', message: 'Cron dispatch is not configured.' } })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return json(401, { error: { code: 'CRON_UNAUTHORIZED', message: 'A valid cron secret is required.' } })
  }

  let destination: URL
  try {
    destination = new URL('/api/internal/maintenance/daily', renderApiOrigin)
  } catch {
    return json(503, { error: { code: 'CRON_CONFIGURATION_REQUIRED', message: 'RENDER_API_ORIGIN is invalid.' } })
  }

  try {
    const upstream = await (dependencies.fetchImpl ?? fetch)(destination, {
      method: 'POST',
      headers: { 'x-maintenance-secret': maintenanceSecret },
      cache: 'no-store',
    })
    const payload = await upstream.text()
    return new Response(payload, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return json(502, { error: { code: 'CRON_DISPATCH_FAILED', message: 'The API maintenance worker could not be reached.' } })
  }
}

export function GET(request: Request): Promise<Response> {
  return runDailyCron(request)
}
