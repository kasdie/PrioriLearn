self.addEventListener('push', (event) => {
  let payload = {
    title: 'PrioriLearn',
    body: 'Your study priority is ready.',
    url: self.location.origin,
    tag: 'priorilearn-digest',
  }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Keep the privacy-safe generic fallback when a payload cannot be parsed.
  }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    renotify: false,
    data: { url: payload.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let target = new URL('/', self.location.origin)
  try {
    const requested = new URL(event.notification.data?.url ?? '/', self.location.origin)
    if (requested.origin === self.location.origin) target = requested
  } catch {
    // Ignore malformed or cross-origin notification targets.
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.navigate(target.href)
      return existing.focus()
    }
    return self.clients.openWindow(target.href)
  })())
})
