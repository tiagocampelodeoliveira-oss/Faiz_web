// Service worker do Faiz: recebe os avisos do servidor e abre o app no lugar certo ao tocar.
// Os avisos ficam no celular até a pessoa tocar e abrir o Faiz (o app limpa os avisos ao abrir).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Faiz', body: e.data ? e.data.text() : '' }; }
  // Todo aviso precisa aparecer (o iPhone corta quem não mostra).
  e.waitUntil(self.registration.showNotification(d.title || 'Faiz', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true, // no Android e no computador, só some quando a pessoa toca
    silent: false,
    vibrate: [200, 100, 200, 100, 400],
    icon: 'iris/aviso-192.png',
    badge: 'badge-96.png',
    timestamp: Date.now(),
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
