self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch (e) {}

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'reload' }));
    return;
  }
});

self.addEventListener('push', event => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {
      title: 'Медси Бот',
      body: event.data ? event.data.text() : 'Новое уведомление'
    };
  }

  const title = payload.title || 'Медси Бот';
  const options = {
    body: payload.body || 'Новое сообщение',
    icon: payload.icon || '/apple-touch-icon.png',
    badge: payload.badge || '/apple-touch-icon.png',
    tag: payload.tag || 'medsi-message',
    renotify: true,
    silent: false,
    timestamp: Date.now(),
    data: {
      url: payload.url || '/'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const targetUrl = new URL(
    notificationData && notificationData.url
      ? notificationData.url
      : '/',
    self.location.origin
  ).href;
  function normalizePanelPath(path) {
    const value = String(path || '/');
    if (value === '/educators.html') return '/educators';
    return value;
  }

  const targetPath = normalizePanelPath(new URL(targetUrl).pathname);

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of clientsList) {
      const clientPath = normalizePanelPath(new URL(client.url || '/', self.location.origin).pathname);
      if (clientPath === targetPath && 'focus' in client) {
        await client.focus();
        return;
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});
