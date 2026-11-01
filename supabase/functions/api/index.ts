// Função do app: IA, inscrição dos avisos, aviso de teste e configurações públicas.
// Publicada com --no-verify-jwt: a pessoa é conferida aqui, pelo token, em getUser().
import { cors, getUser, json, rest, vapid } from '../_shared/env.ts';
import { sendPush, type Subscription } from '../_shared/webpush.ts';

const AI_DAILY_LIMIT = 40;
const MODEL = Deno.env.get('FAIZ_AI_MODEL') || 'claude-sonnet-5-5';
const FALLBACK_MODEL = 'claude-haiku-5-5';

async function ai(userId: string, prompt: unknown, system: unknown): Promise<Response> {
  if (typeof prompt !== 'string' || !prompt.trim()) return json({ error: 'bad_request' }, 400);
  const key = Deno.env.get('FAIZ_ANTHROPIC_KEY');
  if (!key) return json({ error: 'ai_off' }, 503);
  const day = new Date().toISOString().slice(0, 10);
  const rows = await rest(`usage?user_id=eq.${userId}&day=eq.${day}&select=n`);
  const n = rows?.[0]?.n ?? 0;
  if (n >= AI_DAILY_LIMIT) return json({ error: 'limit' }, 429);
  await rest('usage?on_conflict=user_id,day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: userId, day, n: n + 1 }) });
  const call = (model: string) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      // A parte fixa (persona, formato e regras) vai em cache: a partir do 2º pedido em 5 min, sai ~90% mais barata.
      ...(typeof system === 'string' && system.trim() ? { system: [{ type: 'text', text: system.slice(0, 20000), cache_control: { type: 'ephemeral' } }] } : {}),
      messages: [{ role: 'user', content: prompt.slice(0, 16000) }],
    }),
  });
  let res = await call(MODEL);
  // Se o modelo principal falhar (fora do ar, sobrecarregado), tenta o rápido antes de desistir.
  if (!res.ok && res.status !== 400 && res.status !== 401) { console.error('anthropic main', res.status); res = await call(FALLBACK_MODEL); }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('anthropic', res.status, t.slice(0, 300));
    if (/credit balance|billing|insufficient/i.test(t)) { await creditEmpty(); return json({ error: 'no_credit' }, 402); }
    return json({ error: res.status === 429 ? 'busy' : 'ai_error', status: res.status }, 502);
  }
  await creditOk();
  const out = await res.json();
  const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  const u = out.usage || {};
  return json({ text, model: out.model || '', cache: { read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0, input: u.input_tokens || 0 } });
}

/** Crédito da IA: marca a situação e avisa o dono do teste no celular (no máximo uma vez a cada 6 horas). */
async function creditEmpty(): Promise<void> {
  creditWasEmpty = true;
  try {
    await rest('status?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: 'ai_credit', value: { empty: true }, updated_at: new Date().toISOString() }) });
    await notifyOwners(`owner:credit:${new Date().toISOString().slice(0, 10)}:${Math.floor(new Date().getUTCHours() / 6)}`, { title: 'Crédito da IA acabou ⚠️', body: 'A Íris está no modo simples. Recarregue em console.anthropic.com › Billing.', url: './', tag: 'credito' });
  } catch (e) { console.error('creditEmpty', e); }
}

/** Manda um aviso ao(s) dono(s) do teste; `slot` impede repetir o mesmo aviso. */
async function notifyOwners(slot: string, msg: { title: string; body: string; url: string; tag: string }): Promise<void> {
  const owners: { user_id: string }[] = await rest('owners?select=user_id');
  const { keys, subject } = vapid();
  for (const o of owners) {
    const won = await rest('sent?on_conflict=user_id,key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ user_id: o.user_id, key: slot }]) });
    if (!won?.length) continue;
    const subs = await rest(`subs?user_id=eq.${o.user_id}&select=endpoint,p256dh,auth`);
    for (const sb of subs) await sendPush({ endpoint: sb.endpoint, keys: { p256dh: sb.p256dh, auth: sb.auth } }, msg, keys, subject, 6 * 3600);
  }
}

/** "Algo deu errado": guarda o relato com os dados técnicos e avisa o dono do teste. */
async function report(userId: string, text: unknown, ctx: unknown, name: unknown): Promise<Response> {
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return json({ error: 'bad_request' }, 400);
  const since = new Date(Date.now() - 864e5).toISOString();
  const recent = await rest(`reports?user_id=eq.${userId}&created_at=gte.${since}&select=id`);
  if (recent.length >= 10) return json({ error: 'limit' }, 429);
  const c = ctx && typeof ctx === 'object' && !Array.isArray(ctx) && JSON.stringify(ctx).length <= 4000 ? ctx : {};
  const rows = await rest('reports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: userId, text: t, ctx: c }) });
  const quem = String(name || '').trim().split(/\s+/)[0].slice(0, 30) || 'Um testador';
  try { await notifyOwners(`owner:report:${rows?.[0]?.id ?? Date.now()}`, { title: `Problema relatado por ${quem} 🛠️`, body: t.slice(0, 140), url: './', tag: 'relato' }); } catch (e) { console.error('report notify', e); }
  return json({ ok: true });
}
let creditWasEmpty: boolean | null = null;
async function creditOk(): Promise<void> {
  try {
    if (creditWasEmpty === false) return;
    const row = (await rest('status?key=eq.ai_credit&select=value'))?.[0];
    if (row?.value?.empty) await rest('status?key=eq.ai_credit', { method: 'PATCH', body: JSON.stringify({ value: { empty: false }, updated_at: new Date().toISOString() }) });
    creditWasEmpty = false;
  } catch (e) { console.error('creditOk', e); }
}
async function aiCreditEmpty(): Promise<boolean> {
  try { return !!(await rest('status?key=eq.ai_credit&select=value'))?.[0]?.value?.empty; } catch { return false; }
}

/** O Tiago se registra como dono do teste digitando o WhatsApp dele (o mesmo do segredo OWNER_WHATSAPP). */
async function becomeOwner(userId: string, whatsapp: unknown): Promise<Response> {
  const mine = (Deno.env.get('FAIZ_WHATSAPP') || '').replace(/\D/g, '');
  const typed = String(whatsapp || '').replace(/\D/g, '');
  const same = mine.length >= 10 && (typed === mine || (typed.length >= 10 && mine.endsWith(typed)));
  if (!same) return json({ error: 'not_owner' }, 403);
  await rest('owners?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ user_id: userId }) });
  return json({ ok: true });
}

async function subscribe(userId: string, sub: Subscription, ua: string): Promise<Response> {
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'bad_request' }, 400);
  await rest('subs?on_conflict=endpoint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ endpoint: sub.endpoint, user_id: userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, ua: ua.slice(0, 200) }),
  });
  return json({ ok: true });
}

async function testPush(userId: string): Promise<Response> {
  const subs = await rest(`subs?user_id=eq.${userId}&select=endpoint,p256dh,auth`);
  if (!subs.length) return json({ sent: 0, failed: 0, reason: 'no_subscription' });
  const { keys, subject } = vapid();
  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const s of subs) {
    const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: 'Teste do Faiz', body: 'Funcionou! É assim que eu vou te avisar.', url: './', tag: 'teste' }, keys, subject, 600);
    if (r.ok) sent++;
    else {
      failed++;
      errors.push(`${r.status} ${r.text ?? ''}`.trim());
      if (r.gone) await rest(`subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
    }
  }
  return json({ sent, failed, errors });
}

const toRad = (d: number) => (d * Math.PI) / 180;
export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Lugares perto (OpenStreetMap: Overpass pelas etiquetas; se não houver etiqueta, busca pelo nome). */
async function nearby(body: Record<string, any>): Promise<Response> {
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad_request' }, 400);
  const osm = (Array.isArray(body.osm) ? body.osm : []).filter((t: unknown) => typeof t === 'string' && /^[a-z_:]+=[a-z0-9_;:-]+$/i.test(t)).slice(0, 3) as string[];
  const termo = String(body.termo || '').slice(0, 40);
  const here = { lat, lon };
  let places: { nome: string; lat: number; lon: number; dist: number; endereco: string }[] = [];
  const diag: string[] = [];
  const ua = { 'User-Agent': 'Faiz/1.0 (assistente pessoal; https://github.com/tiagocampelodeoliveira-oss/Faiz_web)' };
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  async function overpass(q: string): Promise<any | null> {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { ...ua, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(6000) });
        if (r.ok) return await r.json();
        diag.push(`${new URL(url).host} ${r.status}`);
      } catch (e) { diag.push(`${new URL(url).host} ${String((e as Error).name)}`); }
    }
    return null;
  }
  if (termo || osm.length) {
    // Reserva: Photon (OpenStreetMap), num quadrado em volta da pessoa, filtrando pelo tipo de lugar.
    const tags = osm.map((t) => 'osm_tag=' + encodeURIComponent(t.replace('=', ':'))).join('&');
    for (const d of [0.025, 0.07]) {
      try {
        const bbox = [lon - d, lat - d, lon + d, lat + d].map((x) => x.toFixed(5)).join(',');
        const q = encodeURIComponent(termo || osm[0].split('=')[1]);
        const r = await fetch(`https://photon.komoot.io/api/?q=${q}&lat=${lat}&lon=${lon}&bbox=${bbox}&limit=30${tags ? '&' + tags : ''}`, { headers: { ...ua, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) { diag.push(`photon ${r.status}`); break; }
        const j = await r.json();
        places = (j.features || []).map((f: any) => {
          const [plon, plat] = f.geometry?.coordinates || [];
          const pr = f.properties || {};
          return { nome: pr.name || cap(termo), lat: plat, lon: plon, dist: distM(here, { lat: plat, lon: plon }), endereco: [pr.street, pr.housenumber].filter(Boolean).join(', ') };
        }).filter((p: any) => Number.isFinite(p.lat));
        diag.push(`photon ${d} ${places.length}`);
        if (places.length >= 3) break;
      } catch (e) { diag.push(`photon ${String((e as Error).name)}`); break; }
    }
  }
  if (places.length < 3 && osm.length) {
    const prev = places;
    for (const radius of [2500, 8000]) {
      const sel = osm.map((t) => { const [k, v] = t.split('='); return `nwr["${k}"="${v}"](around:${radius},${lat},${lon});`; }).join('');
      const j = await overpass(`[out:json][timeout:15];(${sel});out center 40;`);
      if (!j) { places = prev; break; }
      places = (j.elements || []).map((e: any) => {
        const p = { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon };
        const t = e.tags || {};
        const end = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
        return { nome: t.name || t.brand || cap(termo) || 'Sem nome', lat: p.lat, lon: p.lon, dist: distM(here, p), endereco: end };
      }).filter((p: any) => Number.isFinite(p.lat));
      if (places.length >= 3) break;
    }
    if (places.length < prev.length) places = prev;
  }
  places.sort((a, b) => a.dist - b.dist);
  return json({ places: places.slice(0, 5), diag });
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const action = String(body.action || '');
  try {
    if (action === 'config') {
      return json({ vapidPublicKey: vapid().keys.publicKey, whatsapp: Deno.env.get('FAIZ_WHATSAPP') || '', ai: !!Deno.env.get('FAIZ_ANTHROPIC_KEY'), aiCredit: !(await aiCreditEmpty()) });
    }
    const user = await getUser(req);
    if (!user) return json({ error: 'auth' }, 401);
    if (action === 'ai') return await ai(user.id, body.prompt, body.system);
    if (action === 'subscribe') return await subscribe(user.id, body.subscription, req.headers.get('user-agent') || '');
    if (action === 'test') return await testPush(user.id);
    if (action === 'nearby') return await nearby(body);
    if (action === 'owner') return await becomeOwner(user.id, body.whatsapp);
    if (action === 'report') return await report(user.id, body.text, body.ctx, body.name);
    if (action === 'me') return json({ owner: !!(await rest(`owners?user_id=eq.${user.id}&select=user_id`))?.length, aiCredit: !(await aiCreditEmpty()) });
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error(action, e);
    return json({ error: 'server', message: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
