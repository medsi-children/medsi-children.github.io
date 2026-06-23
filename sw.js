self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function sendClickDebug(payload) {
  try {
    fetch('https://medsi-push-worker.medsi-children.workers.dev/debug/client', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        role: 'sw-click',
        title: 'notificationclick',
        tag: payload && payload.tag || '',
        ok: payload && payload.ok,
        code: payload && payload.code || '',
        debug: payload || {}
      })
    }).catch(() => {});
  } catch (e) {}
}

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

  const notification = payload.notification || payload;
  const data = notification.data || payload.data || {};
  const url = notification.navigate || payload.url || data.url || '/';
  const title = notification.title || payload.title || 'Медси Бот';
  const options = {
    body: notification.body || payload.body || 'Новое сообщение',
    icon: notification.icon || payload.icon || '/apple-touch-icon.png',
    badge: notification.badge || payload.badge || '/apple-touch-icon.png',
    tag: notification.tag || payload.tag || 'medsi-message',
    renotify: true,
    silent: false,
    timestamp: Date.now(),
    data: {
      url
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

  event.waitUntil((async () => {
    const debug = {
      tag: event.notification.tag || '',
      dataUrl: notificationData && notificationData.url || '',
      targetUrl,
      action: event.action || '',
      clients: 0,
      clientUrls: [],
      mode: ''
    };

    const clientsList = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    debug.clients = clientsList.length;
    debug.clientUrls = clientsList.slice(0, 5).map(client => client.url || '');

    for (const client of clientsList) {
      if ('focus' in client) {
        debug.mode = 'focus+navigate';
        await client.focus();
        if ('navigate' in client) {
          await client.navigate(targetUrl);
          debug.navigated = true;
        } else {
          debug.navigated = false;
        }
        sendClickDebug({ ...debug, ok: true, code: 'focused' });
        return;
      }
    }

    if (clients.openWindow) {
      debug.mode = 'openWindow';
      await clients.openWindow(targetUrl);
      sendClickDebug({ ...debug, ok: true, code: 'opened' });
      return;
    }

    debug.mode = 'no-openWindow';
    sendClickDebug({ ...debug, ok: false, code: 'no-client-api' });
  })());
});
