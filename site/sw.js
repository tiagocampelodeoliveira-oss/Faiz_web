// Service worker do Faiz: recebe os avisos do servidor e abre o app no lugar certo ao tocar.
// Os avisos ficam no celular até a pessoa tocar e abrir o Faiz (o app limpa os avisos ao abrir).
// Aviso de atividade traz os botões "Feito" e "Adiar 15 min" (Android e computador; o iPhone não mostra botões):
// o toque no botão fala direto com o servidor, sem abrir o app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Faiz', body: e.data ? e.data.text() : '' }; }
  const acts = d.act && Array.isArray(d.actions) ? d.actions.filter((a) => a && (a.action === 'feito' || a.action === 'adiar')).slice(0, 2) : [];
  // Todo aviso precisa aparecer (o iPhone corta quem não mostra).
  e.waitUntil(self.registration.showNotification(d.title || 'Faiz', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true, // no Android e no computador, só some quando a pessoa toca
    silent: false,
    vibrate: [200, 100, 200, 100, 400],
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    timestamp: Date.now(),
    ...(acts.length ? { actions: acts } : {}),
    data: { url: d.url || './', act: d.act || null },
  }));
});

/** Abre (ou traz para a frente) o app neste endereço. */
async function abrir(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const w of wins) {
    if (w.url.startsWith(self.registration.scope)) {
      await w.focus();
      w.postMessage({ type: 'open', url });
      return;
    }
  }
  await self.clients.openWindow(url);
}

/** Botão do aviso: manda "feito" ou "adiar" ao servidor. Se não conseguir, abre o app, que faz por lá. */
async function botao(n, acao) {
  const act = n.data?.act || {};
  const base = new URL(n.data?.url || './', self.registration.scope);
  try {
    const r = await fetch(act.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(act.k ? { apikey: act.k } : {}) },
      body: JSON.stringify({ action: 'pushact', a: acao, u: act.u, t: act.t, exp: act.exp, sig: act.sig }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'http ' + r.status);
    // conta para o app aberto em segundo plano aplicar na hora
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) w.postMessage({ type: 'acao' });
    await self.registration.showNotification(j.title || (acao === 'feito' ? 'Feito! ✅' : 'Adiado ⏰'), {
      body: j.body || '', tag: n.tag || 'faiz-ok', renotify: false, silent: true, icon: 'icon-192.png', badge: 'badge-96.png', data: { url: './' },
    });
    // a confirmação some sozinha depois de uns segundos
    await new Promise((ok) => setTimeout(ok, 4000));
    const ns = await self.registration.getNotifications({ tag: n.tag || 'faiz-ok' });
    ns.forEach((x) => x.close());
  } catch (err) {
    base.searchParams.set('a', acao);
    await abrir(base.href);
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if ((e.action === 'feito' || e.action === 'adiar') && e.notification.data?.act?.api) {
    e.waitUntil(botao(e.notification, e.action));
    return;
  }
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(abrir(url));
});
