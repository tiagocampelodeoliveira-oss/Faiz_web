// Função do app: IA, inscrição dos avisos, aviso de teste e configurações públicas.
// Publicada com --no-verify-jwt: a pessoa é conferida aqui, pelo token, em getUser().
import { cors, getUser, json, rest, vapid } from '../_shared/env.ts';
import { sendPush, type Subscription } from '../_shared/webpush.ts';

const AI_DAILY_LIMIT = 40;
const MODEL = Deno.env.get('FAIZ_AI_MODEL') || 'claude-sonnet-5-5';
const FALLBACK_MODEL = 'claude-haiku-5-5';

async function ai(userId: string, prompt: unknown): Promise<Response> {
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
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt.slice(0, 16000) }] }),
  });
  let res = await call(MODEL);
  // Se o modelo principal falhar (fora do ar, sobrecarregado), tenta o rápido antes de desistir.
  if (!res.ok && res.status !== 400 && res.status !== 401) { console.error('anthropic main', res.status); res = await call(FALLBACK_MODEL); }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('anthropic', res.status, t.slice(0, 300));
    return json({ error: res.status === 429 ? 'busy' : 'ai_error', status: res.status }, 502);
  }
  const out = await res.json();
  const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  return json({ text, model: out.model || '' });
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
  const ua = { 'User-Agent': 'Faiz/1.0 (assistente pessoal; https://github.com/tiagocampelodeoliveira-oss/Faiz_web)' };
  if (osm.length) {
    for (const radius of [2500, 8000]) {
      const sel = osm.map((t) => { const [k, v] = t.split('='); return `nwr["${k}"="${v}"](around:${radius},${lat},${lon});`; }).join('');
      const q = `[out:json][timeout:15];(${sel});out center 40;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { ...ua, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (!r.ok) { console.error('overpass', r.status); break; }
      const j = await r.json();
      places = (j.elements || []).map((e: any) => {
        const p = { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon };
        const t = e.tags || {};
        const end = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
        return { nome: t.name || t.brand || cap(termo) || 'Sem nome', lat: p.lat, lon: p.lon, dist: distM(here, p), endereco: end };
      }).filter((p: any) => Number.isFinite(p.lat));
      if (places.length >= 3) break;
    }
  }
  if (!places.length && termo) {
    const d = 0.06;
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&accept-language=pt-BR&bounded=1&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}&q=${encodeURIComponent(termo)}`;
    const r = await fetch(u, { headers: ua });
    if (r.ok) places = ((await r.json()) as any[]).map((e) => ({ nome: e.name || e.display_name.split(',')[0], lat: +e.lat, lon: +e.lon, dist: distM(here, { lat: +e.lat, lon: +e.lon }), endereco: e.display_name.split(',').slice(1, 3).join(',').trim() }));
  }
  places.sort((a, b) => a.dist - b.dist);
  return json({ places: places.slice(0, 5) });
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
      return json({ vapidPublicKey: vapid().keys.publicKey, whatsapp: Deno.env.get('FAIZ_WHATSAPP') || '', ai: !!Deno.env.get('FAIZ_ANTHROPIC_KEY') });
    }
    const user = await getUser(req);
    if (!user) return json({ error: 'auth' }, 401);
    if (action === 'ai') return await ai(user.id, body.prompt);
    if (action === 'subscribe') return await subscribe(user.id, body.subscription, req.headers.get('user-agent') || '');
    if (action === 'test') return await testPush(user.id);
    if (action === 'nearby') return await nearby(body);
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error(action, e);
    return json({ error: 'server', message: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
