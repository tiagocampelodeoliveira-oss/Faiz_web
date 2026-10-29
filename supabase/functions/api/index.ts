// Função do app: IA, inscrição dos avisos, aviso de teste e configurações públicas.
// Publicada com --no-verify-jwt: a pessoa é conferida aqui, pelo token, em getUser().
import { cors, getUser, json, rest, vapid } from '../_shared/env.ts';
import { sendPush, type Subscription } from '../_shared/webpush.ts';

const AI_DAILY_LIMIT = 40;
const MODEL = Deno.env.get('FAIZ_AI_MODEL') || 'claude-haiku-5-5';

async function ai(userId: string, prompt: unknown): Promise<Response> {
  if (typeof prompt !== 'string' || !prompt.trim()) return json({ error: 'bad_request' }, 400);
  const key = Deno.env.get('FAIZ_ANTHROPIC_KEY');
  if (!key) return json({ error: 'ai_off' }, 503);
  const day = new Date().toISOString().slice(0, 10);
  const rows = await rest(`usage?user_id=eq.${userId}&day=eq.${day}&select=n`);
  const n = rows?.[0]?.n ?? 0;
  if (n >= AI_DAILY_LIMIT) return json({ error: 'limit' }, 429);
  await rest('usage?on_conflict=user_id,day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: userId, day, n: n + 1 }) });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt.slice(0, 12000) }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('anthropic', res.status, t.slice(0, 300));
    return json({ error: res.status === 429 ? 'busy' : 'ai_error', status: res.status }, 502);
  }
  const out = await res.json();
  const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  return json({ text });
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
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error(action, e);
    return json({ error: 'server', message: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
