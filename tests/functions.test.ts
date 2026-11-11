// Roda as funções do servidor (api e tick) no Node, com o Deno, o banco e os serviços simulados.
// Rodar: npx tsx --test tests/functions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, _test, generateVapidKeys } from '../supabase/functions/_shared/webpush.ts';
import { buildIcs as buildIcsT0 } from '../supabase/functions/_shared/ics.ts';
const buildIcsT = (st: any) => buildIcsT0(st, new Date().toISOString().slice(0, 10));

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const vapid = await generateVapidKeys();
const env: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.co', FAIZ_SERVICE_KEY: 'service-jwt', FAIZ_ANON_KEY: 'anon-jwt',
  FAIZ_TICK_SECRET: 's3cret', FAIZ_VAPID_PUBLIC: vapid.publicKey, FAIZ_VAPID_PRIVATE: vapid.privateKey,
  FAIZ_SITE_URL: 'https://x.github.io/Faiz_web/', FAIZ_ANTHROPIC_KEY: 'sk-test', FAIZ_WHATSAPP: '5561999998888',
};
let handler: (r: Request) => Promise<Response> = async () => new Response();
(globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } };

// Celular de mentira
const kp = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
const uaPub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
const authS = globalThis.crypto.getRandomValues(new Uint8Array(16));
async function open(body: Uint8Array) {
  const salt = body.slice(0, 16), asPub = body.slice(21, 86), ct = body.slice(86);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, kp.privateKey, 256));
  const ikm = await _test.hkdf(authS, shared, _test.concat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await _test.hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await _test.hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const p = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  return JSON.parse(new TextDecoder().decode(p.slice(0, -1)));
}

// Banco e serviços de mentira
const U = '11111111-1111-1111-1111-111111111111';
const db = {
  subs: [{ endpoint: 'https://web.push.apple.com/abc', user_id: U, p256dh: b64u(uaPub), auth: b64u(authS) }] as any[],
  states: [{ user_id: U, data: { name: 'Tiago', settings: { tz: 'America/Sao_Paulo' }, tasks: [{ id: 'b', title: 'Corrida', date: '2026-10-29', start: 1110, end: 1170 }] } }],
  sent: [] as any[],
  usage: [] as any[],
  owners: [] as any[],
  status: [] as any[],
  reports: [] as any[],
  unlimited: [] as any[],
  ai_log: [] as any[],
  push_log: [] as any[],
  google_tokens: [] as any[],
  cal_feeds: [] as any[],
  manual_push: [] as any[],
  push_actions: [] as any[],
  planos: [] as any[],
  assinaturas: [] as any[],
  pix_pagamentos: [] as any[],
  pagar_teste: [] as any[],
};
let mpPay: any = null;
const mpCalls: { method: string; path: string; body: any }[] = [];
let mpPre: any = null;
const pushed: any[] = [];
let pushStatus = 201;
let anthropicBody: any = null;
const models: string[] = [];
let sonnetDown = false;
let noCredit = false;
let overpassQuery = '';
let photonUrl = '';
let photonFeatures: any[] = [];
globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
  const url = new URL(input);
  const method = init.method || 'GET';
  if (url.host === 'web.push.apple.com') { pushed.push(await open(init.body as Uint8Array)); return new Response('', { status: pushStatus }); }
  if (url.host === 'api.anthropic.com') {
    anthropicBody = JSON.parse(String(init.body)); models.push(anthropicBody.model);
    if (typeof anthropicBody.system === 'string' && anthropicBody.system.includes('aviso de celular')) return Response.json({ content: [{ type: 'text', text: '{"titulo":"Tiago, a corrida te espera 🏃","texto":"18:30 tá chegando. Me fala \\"bora\\" que eu seguro teu horário."}' }], usage: { output_tokens: 40 }, stop_reason: 'end_turn' });
    if (noCredit) return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', { status: 400 });
    if (sonnetDown && anthropicBody.model === 'claude-sonnet-5-5') return new Response('{"error":"overloaded"}', { status: 529 });
    return Response.json({ content: [{ type: 'text', text: '{"acao":"conversa","resposta":"Oi"}' }] });
  }
  if (url.host === 'oauth2.googleapis.com') {
    const b = new URLSearchParams(String(init.body));
    if (b.get('refresh_token') === 'revogado') return Response.json({ error: 'invalid_grant' }, { status: 400 });
    if (b.get('grant_type') === 'authorization_code') {
      if (b.get('redirect_uri') !== 'https://faizapp.com.br/google' || b.get('client_secret') !== 'segredo') return Response.json({ error: 'redirect_uri_mismatch' }, { status: 400 });
      if (b.get('code') === 'codigo-ruim-123') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'ya29.novo', refresh_token: b.get('code') === 'sem-refresh-123' ? undefined : '1//novorefresh', scope: 'https://www.googleapis.com/auth/calendar.events.readonly' });
    }
    return Response.json({ access_token: 'ya29.temp', expires_in: 3599, scope: 'https://www.googleapis.com/auth/calendar.events' });
  }
  if (url.host === 'photon.komoot.io') { photonUrl = String(input); return Response.json({ features: photonFeatures }); }
  if (url.host === 'overpass-api.de') {
    overpassQuery = decodeURIComponent(String(init.body).slice(5));
    return Response.json({ elements: [
      { type: 'node', lat: -23.5600, lon: -46.6600, tags: { name: 'Padaria Longe', 'addr:street': 'Rua B' } },
      { type: 'way', center: { lat: -23.5506, lon: -46.6334 }, tags: { name: 'Padaria Perto', 'addr:street': 'Rua A', 'addr:housenumber': '10' } },
      { type: 'node', lat: -23.5520, lon: -46.6350, tags: {} },
    ] });
  }
  if (url.host === 'api.mercadopago.com') {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    mpCalls.push({ method, path: url.pathname + url.search, body });
    if ((init.headers as any).Authorization !== 'Bearer APP_USR-teste') return Response.json({ message: 'invalid_token' }, { status: 401 });
    if (method === 'POST' && url.pathname === '/preapproval') { mpPre = { id: 'pre1', status: 'pending', init_point: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre1', external_reference: body.external_reference, auto_recurring: body.auto_recurring, summarized: { charged_quantity: 0 } }; return Response.json(mpPre, { status: 201 }); }
    if (method === 'PUT' && url.pathname === '/preapproval/pre1') { mpPre = { ...mpPre, ...body, next_payment_date: null }; return Response.json(mpPre); }
    if (url.pathname === '/preapproval/pre1') return mpPre ? Response.json(mpPre) : Response.json({ message: 'not found' }, { status: 404 });
    if (method === 'POST' && url.pathname === '/v1/payments') { mpPay = { id: 987654321, status: 'pending', payment_method_id: body.payment_method_id, external_reference: body.external_reference, transaction_amount: body.transaction_amount, date_of_expiration: body.date_of_expiration, point_of_interaction: { transaction_data: { qr_code: '00020126580014br.gov.bcb.pix...6304ABCD', qr_code_base64: 'iVBORw0KGgo=' } } }; return Response.json(mpPay, { status: 201 }); }
    if (url.pathname === '/v1/payments/987654321') return Response.json(mpPay);
    if (url.pathname === '/preapproval/search') return Response.json({ results: mpPre ? [mpPre] : [] });
    if (url.pathname === '/authorized_payments/pay9') return Response.json({ id: 'pay9', preapproval_id: 'pre1', status: 'processed' });
    return Response.json({ message: 'not found' }, { status: 404 });
  }
  if (url.pathname === '/auth/v1/user') { const a = (init.headers as any).Authorization; return a === 'Bearer user-token' ? Response.json({ id: U }) : a === 'Bearer user-mail' ? Response.json({ id: U, email: 'kaua@gmail.com' }) : new Response('{}', { status: 401 }); }
  const table = url.pathname.replace('/rest/v1/', '') as keyof typeof db;
  assert.equal((init.headers as any).apikey, 'service-jwt', 'servidor usa a chave de serviço');
  if (method === 'GET' && table === 'manual_push') return Response.json(db.manual_push.filter((m: any) => !m.sent_at && m.send_at <= String(url.searchParams.get('send_at')).slice(4)));
  if (method === 'GET') return Response.json(db[table]);
  if (method === 'PATCH' && table === 'manual_push') {
    const id = Number(String(url.searchParams.get('id')).slice(3)), soNovo = url.searchParams.get('sent_at') === 'is.null';
    const hit = db.manual_push.filter((m: any) => m.id === id && (!soNovo || !m.sent_at));
    hit.forEach((m: any) => Object.assign(m, JSON.parse(String(init.body))));
    return Response.json(hit);
  }
  if (method === 'PATCH' && table === 'pix_pagamentos') {
    const q = (k: string) => String(url.searchParams.get(k) || '');
    const hit = db.pix_pagamentos.filter((r: any) => 'eq.' + r.mp_id === q('mp_id') && (!q('status') || (q('status').startsWith('neq.') ? r.status !== q('status').slice(4) : r.status === q('status').slice(3))));
    hit.forEach((r: any) => Object.assign(r, JSON.parse(String(init.body))));
    return Response.json(hit);
  }
  if (method === 'PATCH') { const v = JSON.parse(String(init.body)); (db as any)[table] = (db as any)[table].map((r: any) => ({ ...r, ...v })); return new Response(null, { status: 204 }); }
  if (method === 'DELETE') { if (table === 'subs') db.subs = []; if (table === 'cal_feeds') db.cal_feeds = []; return new Response(null, { status: 204 }); }
  const rows = [].concat(JSON.parse(String(init.body)));
  if (table === 'sent') {
    const fresh = rows.filter((r: any) => !db.sent.some((s) => s.key === r.key && s.user_id === r.user_id));
    db.sent.push(...fresh);
    return Response.json(fresh, { status: 201 });
  }
  (db as any)[table].push(...rows);
  return new Response('', { status: 201 });
}) as typeof fetch;

const realNow = Date.now;
const setNow = (iso: string) => { const t = new Date(iso).getTime(); Date.now = () => t; (globalThis as any).Date = class extends Date { constructor(...a: any[]) { super(...(a.length ? a : [t])); } static now() { return t; } } as any; };

import { planoDe } from '../supabase/functions/_shared/plan.ts';
import { lerAssinatura, somaPix } from '../supabase/functions/_shared/mp.ts';
await import('../supabase/functions/tick/index.ts');
const tick = handler;
await import('../supabase/functions/api/index.ts');
const api = handler;
const post = (h: typeof handler, body: unknown, headers: Record<string, string> = {}) => h(new Request('https://proj.supabase.co/functions/v1/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));

test('relógio recusa sem o segredo', async () => {
  assert.equal((await post(tick, {}, { 'x-tick-secret': 'errado' })).status, 403);
});

test('relógio manda o aviso da corrida às 18:20, e só uma vez', async () => {
  setNow('2026-10-29T21:20:00Z'); // 18:20 em Brasília
  const r = await (await post(tick, {}, { 'x-tick-secret': 's3cret' })).json();
  assert.equal(r.sent, 1, JSON.stringify(r));
  assert.equal(pushed[0].title, 'Corrida em 10 min ⏰');
  assert.match(pushed[0].body, /^18:30–19:30\. /);
  assert.equal(pushed[0].url, './?t=b');
  const r2 = await (await post(tick, {}, { 'x-tick-secret': 's3cret' })).json();
  assert.equal(r2.sent, 0);
  assert.equal(pushed.length, 1);
  assert.deepEqual(db.push_log.map((x) => [x.kind, x.host, x.status, x.ok]), [['t', 'web.push.apple.com', 201, true]], 'resultado do aviso registrado, sem o texto');
  assert.ok(!('title' in db.push_log[0]) && !('body' in db.push_log[0]));
});

test('aviso da atividade traz Feito e Adiar; o botão funciona sem abrir o app (assinado)', async () => {
  const p = pushed[0];
  assert.deepEqual(p.actions.map((a: any) => a.action), ['feito', 'adiar']);
  assert.equal(p.act.u, U); assert.equal(p.act.t, 'b'); assert.equal(p.act.api, 'https://proj.supabase.co/functions/v1/api');
  // assinatura errada: recusa
  assert.equal((await post(api, { action: 'pushact', a: 'feito', ...p.act, sig: 'x'.repeat(64) })).status, 403);
  // outra atividade com a mesma assinatura: recusa
  assert.equal((await post(api, { action: 'pushact', a: 'feito', ...p.act, t: 'outra' })).status, 403);
  // adiar às 18:20 (começa 18:30): vai para 18:45–19:45
  const ad = await (await post(api, { action: 'pushact', a: 'adiar', ...p.act })).json();
  assert.equal(ad.ok, true, JSON.stringify(ad));
  let t = db.states[0].data.tasks.find((x: any) => x.id === 'b');
  assert.deepEqual([t.start, t.end], [1125, 1185]);
  // feito
  const fe = await (await post(api, { action: 'pushact', a: 'feito', ...p.act })).json();
  assert.equal(fe.ok, true);
  t = db.states[0].data.tasks.find((x: any) => x.id === 'b');
  assert.equal(t.status, 'feito');
  assert.deepEqual(db.push_actions.map((x: any) => [x.task_id, x.action, x.start_min]), [['b', 'adiar', 1125], ['b', 'feito', 1125]]);
  // o app pega a fila quando abrir
  const q = await (await post(api, { action: 'acoes' }, { Authorization: 'Bearer user-token' })).json();
  assert.deepEqual(q.acoes.map((x: any) => x.action), ['adiar', 'feito']);
  assert.ok(db.push_actions.every((x: any) => x.applied_at));
  // volta como era para os próximos testes
  Object.assign(t, { status: undefined, start: 1110, end: 1170 }); delete t.status;
});

test('aviso pessoal do dono sai na hora marcada, uma vez só', async () => {
  setNow('2026-10-29T15:00:00Z');
  db.sent = db.states[0].data.tasks.map((t: any) => ({ user_id: U, key: `t:${t.id}:x` }));
  db.manual_push = [{ id: 1, user_id: U, title: 'Isa, sumiu! 😅', body: 'Me manda 3 coisas', url: './?v=planejar', send_at: '2026-10-29T15:30:00.000Z', sent_at: null }];
  const antes = pushed.length;
  await post(tick, {}, { 'x-tick-secret': 's3cret' });
  assert.equal(pushed.filter((p) => p.title === 'Isa, sumiu! 😅').length, 0, 'antes da hora, nada');
  setNow('2026-10-29T15:31:00Z');
  await post(tick, {}, { 'x-tick-secret': 's3cret' });
  await post(tick, {}, { 'x-tick-secret': 's3cret' });
  const meus = pushed.slice(antes).filter((p) => p.title === 'Isa, sumiu! 😅');
  assert.equal(meus.length, 1, 'sai uma vez só');
  assert.equal(meus[0].url, './?v=planejar');
  assert.equal(db.manual_push[0].entregues, 1);
  assert.equal(db.push_log.at(-1).kind, 'manual');
});

test('aviso de volta: a IA escreve com a situação da pessoa', async () => {
  setNow('2026-10-29T15:00:00Z'); // 12:00 em Brasília
  db.sent = []; db.manual_push = [];
  const st = db.states[0].data as any; const antesStats = st.stats;
  st.stats = { days: ['2026-10-26'], requests: 3 };
  const antes = pushed.length;
  await post(tick, {}, { 'x-tick-secret': 's3cret' });
  const v = pushed.slice(antes).find((p) => p.tag === 'volta');
  assert.ok(v, JSON.stringify(pushed.slice(antes)));
  assert.equal(v.title, 'Tiago, a corrida te espera 🏃');
  assert.equal(v.url, './?v=planejar');
  assert.ok(!('ia' in v), 'a situação não vai no aviso');
  assert.match(anthropicBody.messages[0].content, /"diasSemAbrir":3/);
  assert.ok(!/valor|R\$/.test(anthropicBody.messages[0].content));
  assert.equal(db.ai_log.at(-1).model, 'volta:claude-sonnet-5-5');
  await post(tick, {}, { 'x-tick-secret': 's3cret' });
  assert.equal(pushed.slice(antes).filter((p) => p.tag === 'volta').length, 1, 'uma vez só');
  st.stats = antesStats;
});

test('celular que saiu (410) é apagado', async () => {
  setNow('2026-10-29T10:31:00Z'); // 07:31: resumo da manhã
  db.sent = [];
  pushStatus = 410;
  const r = await (await post(tick, {}, { 'x-tick-secret': 's3cret' })).json();
  assert.equal(r.removed, 1, JSON.stringify(r));
  assert.equal(db.subs.length, 0);
  assert.equal(db.push_log.at(-1).gone, true, 'inscrição apagada fica registrada');
  pushStatus = 201;
});

test('api: config é pública e traz a chave de aviso e o WhatsApp', async () => {
  const r = await (await post(api, { action: 'config' })).json();
  assert.equal(r.vapidPublicKey, vapid.publicKey);
  assert.equal(r.whatsapp, '5561999998888');
});

test('api: sem login, recusa', async () => {
  assert.equal((await post(api, { action: 'ai', prompt: 'oi' })).status, 401);
});

test('api: inscreve o celular e o aviso de teste chega', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  const s = await post(api, { action: 'subscribe', subscription: { endpoint: 'https://web.push.apple.com/novo', keys: { p256dh: b64u(uaPub), auth: b64u(authS) } } }, auth);
  assert.equal(s.status, 200);
  assert.equal(db.subs.length, 1);
  db.subs[0].user_id = U;
  pushed.length = 0;
  const t = await (await post(api, { action: 'test' }, auth)).json();
  assert.equal(t.sent, 1, JSON.stringify(t));
  assert.equal(pushed[0].title, 'Teste do Faiz');
});

test('api: IA chama o modelo e devolve o texto; respeita o limite diário', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  const r = await (await post(api, { action: 'ai', prompt: 'quero correr amanhã' }, auth)).json();
  assert.equal(r.text, '{"acao":"conversa","resposta":"Oi"}');
  assert.equal(anthropicBody.model, 'claude-sonnet-5-5');
  db.usage = [{ n: 40 }];
  assert.equal((await post(api, { action: 'ai', prompt: 'de novo' }, auth)).status, 429);
  Date.now = realNow;
});

test('api: se o Sonnet falhar, usa o modelo rápido', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  db.usage = [];
  sonnetDown = true; models.length = 0;
  const r = await (await post(api, { action: 'ai', prompt: 'oi' }, auth)).json();
  sonnetDown = false;
  assert.deepEqual(models, ['claude-sonnet-5-5', 'claude-haiku-5-5']);
  assert.equal(r.text, '{"acao":"conversa","resposta":"Oi"}');
});

test('api: pedido simples vai para a Íris rápida (Haiku) primeiro; se ela falhar, a completa', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  db.usage = []; models.length = 0;
  await (await post(api, { action: 'ai', prompt: 'gastei 30 no uber', modelo: 'rapida' }, auth)).json();
  assert.deepEqual(models, ['claude-haiku-5-5']);
  assert.equal(db.ai_log.at(-1).model, 'claude-haiku-5-5');
  models.length = 0;
  await (await post(api, { action: 'ai', prompt: 'monta meu treino', modelo: 'completa' }, auth)).json();
  assert.deepEqual(models, ['claude-sonnet-5-5']);
});

test('api: padaria mais próxima, ordenada por distância', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  const r = await (await post(api, { action: 'nearby', lat: -23.5505, lon: -46.6333, termo: 'padaria', osm: ['shop=bakery', 'x"];out;'] }, auth)).json();
  assert.match(overpassQuery, /nwr\["shop"="bakery"\]\(around:2500,-23.5505,-46.6333\)/);
  assert.doesNotMatch(overpassQuery, /out;"/);
  assert.deepEqual(r.places.map((p: any) => p.nome), ['Padaria Perto', 'Padaria', 'Padaria Longe']);
  assert.equal(r.places[0].endereco, 'Rua A, 10');
  assert.ok(r.places[0].dist < 50, String(r.places[0].dist));
  assert.equal((await post(api, { action: 'nearby', lat: 'x', lon: 1 }, auth)).status, 400);
});

test('api: lugares pelo Photon primeiro, num raio pequeno e pelo tipo', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  overpassQuery = '';
  photonFeatures = [
    { geometry: { coordinates: [-46.6560, -23.5630] }, properties: { name: 'Padaria Xodó', street: 'Rua Augusta', housenumber: '5' } },
    { geometry: { coordinates: [-46.6545, -23.5610] }, properties: { name: 'Benjamin Padaria' } },
    { geometry: { coordinates: [-46.6600, -23.5650] }, properties: { name: 'Pão de Ló' } },
  ];
  const r = await (await post(api, { action: 'nearby', lat: -23.5614, lon: -46.6559, termo: 'padaria', osm: ['shop=bakery'] }, auth)).json();
  assert.match(photonUrl, /osm_tag=shop%3Abakery/);
  assert.match(photonUrl, /bbox=-46\.68090,-23\.58640,-46\.63090,-23\.53640/);
  assert.equal(overpassQuery, '', 'com 3 resultados, não chama o Overpass');
  assert.deepEqual(r.places.map((p: any) => p.nome), ['Benjamin Padaria', 'Padaria Xodó', 'Pão de Ló']);
  photonFeatures = [];
});

test('api: parte fixa vai em system com cache; sem system, continua funcionando', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  db.usage = [];
  await post(api, { action: 'ai', system: 'Você é a Íris. Regras fixas.', prompt: 'Pedido: oi' }, auth);
  assert.deepEqual(anthropicBody.system, [{ type: 'text', text: 'Você é a Íris. Regras fixas.', cache_control: { type: 'ephemeral' } }]);
  assert.equal(anthropicBody.messages[0].content, 'Pedido: oi');
  await post(api, { action: 'ai', prompt: 'só o texto' }, auth);
  assert.equal(anthropicBody.system, undefined);
  assert.equal(anthropicBody.messages[0].content, 'só o texto');
});

test('api: só o dono (o WhatsApp cadastrado) vira dono do teste', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  assert.equal((await post(api, { action: 'owner', whatsapp: '11 99999-0000' }, auth)).status, 403);
  assert.equal(db.owners.length, 0);
  assert.equal((await post(api, { action: 'owner', whatsapp: '+55 (61) 99999-8888' }, auth)).status, 200);
  assert.deepEqual(db.owners.map((o) => o.user_id), [U]);
  assert.equal((await (await post(api, { action: 'me' }, auth)).json()).owner, true);
});

test('api: crédito acabou → avisa a Íris (no_credit), marca a situação e manda alerta ao dono uma vez', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  db.usage = []; db.subs = [{ endpoint: 'https://web.push.apple.com/dono', user_id: U, p256dh: b64u(uaPub), auth: b64u(authS) }];
  pushed.length = 0; noCredit = true;
  const r = await post(api, { action: 'ai', system: 'fixo', prompt: 'oi' }, auth);
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error, 'no_credit');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].title, 'Crédito da IA acabou ⚠️');
  assert.equal((await (await post(api, { action: 'config' })).json()).aiCredit, false);
  await post(api, { action: 'ai', system: 'fixo', prompt: 'oi de novo' }, auth);
  assert.equal(pushed.length, 1, 'não repete o alerta na mesma janela de 6 horas');
  // voltou o crédito
  noCredit = false;
  const ok = await post(api, { action: 'ai', system: 'fixo', prompt: 'oi' }, auth);
  assert.equal(ok.status, 200);
  assert.equal((await (await post(api, { action: 'config' })).json()).aiCredit, true);
});

test('api: Algo deu errado guarda o relato e avisa o dono', async () => {
  const auth = { Authorization: 'Bearer user-token' };
  db.owners = [{ user_id: U }];
  db.subs = [{ endpoint: 'https://web.push.apple.com/dono', user_id: U, p256dh: b64u(uaPub), auth: b64u(authS) }];
  db.reports = []; pushed.length = 0;
  assert.equal((await post(api, { action: 'report', text: '   ' }, auth)).status, 400);
  const r = await post(api, { action: 'report', text: 'O microfone não abriu', ctx: { aparelho: 'iPhone', erro: 'not-allowed' }, name: 'Ana Souza' }, auth);
  assert.equal(r.status, 200);
  assert.equal(db.reports[0].text, 'O microfone não abriu');
  assert.deepEqual(db.reports[0].ctx, { aparelho: 'iPhone', erro: 'not-allowed' });
  assert.equal(pushed.at(-1).title, 'Problema relatado por Ana 🛠️');
  assert.equal(pushed.at(-1).body, 'O microfone não abriu');
});

test('voz da Íris: limpa emoji e monta o SSML com a Thalita', async () => {
  const { limpar, ssml, falar } = await import('../supabase/functions/_shared/tts.ts');
  assert.equal(limpar('Bora! 💪  Agora  •  já'), 'Bora! Agora , já');
  assert.match(ssml('Tom & Jerry <3'), /ThalitaMultilingualNeural.*Tom &amp; Jerry &lt;3/);
  await assert.rejects(falar('oi'), /tts_off/, 'sem chave do Azure, não tenta');
});

test('api: liberados pelo Tiago passam do limite de 40 por dia e do teste de 7 dias; cada chamada fica registrada', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' };
  const antes = { usage: db.usage, owners: db.owners, states: db.states, unlimited: db.unlimited };
  db.owners = []; noCredit = false; sonnetDown = false;
  db.usage = [{ n: 40 }];
  db.states = [{ start: '2026-10-01', tz: 'America/Sao_Paulo' }] as any; // o banco de mentira devolve a linha como o select pede
  db.unlimited = [];
  const fl = await post(api, { action: 'ai', prompt: 'oi' }, auth);
  assert.equal(fl.status, 403, 'sem liberação, teste acabou: plano Grátis, sem IA');
  assert.equal((await fl.json()).error, 'free_plan');
  db.unlimited = [{ user_id: U }];
  db.ai_log = [];
  const r = await post(api, { action: 'ai', prompt: 'oi' }, auth);
  assert.equal(r.status, 200, 'liberado: passa do teste e do limite diário');
  assert.equal(db.ai_log.length, 1);
  assert.equal(db.ai_log[0].status, 200);
  assert.ok(db.ai_log[0].ms >= 0 && !('text' in db.ai_log[0]), 'registra tempo, nunca o conteúdo');
  Object.assign(db, antes);
});

test('api: planos — Grátis não tem IA, voz nem Google; escolher o Plus reserva e libera', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' };
  const antes = { usage: db.usage, states: db.states, unlimited: db.unlimited, planos: db.planos, owners: db.owners };
  db.unlimited = []; db.planos = []; db.owners = [];
  db.states = [{ start: '2026-11-01', tz: 'America/Sao_Paulo' }] as any; // fundador, teste acabou
  setNow('2026-11-11T15:00:00Z');
  try {
    let me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'gratis'); assert.equal(me.plano.fundador, true); assert.equal(me.plano.preco, 990); assert.equal(me.plano.precisaEscolher, true);
    db.usage = [{ n: 0 }]; models.length = 0;
    const g = await post(api, { action: 'ai', prompt: 'monta meu treino', modelo: 'completa' }, auth);
    assert.equal(g.status, 403); assert.equal((await g.json()).error, 'free_plan');
    assert.deepEqual(models, [], 'Grátis não chama a IA');
    assert.equal((await post(api, { action: 'tts', text: 'oi' }, auth)).status, 403);
    assert.equal((await post(api, { action: 'gtoken' }, auth)).status, 403);
    // escolhe o Plus: reserva o preço de fundador e volta a ter a Íris completa
    const r = await (await post(api, { action: 'escolher', plano: 'plus', nome: 'Kauã Silva' }, auth)).json();
    assert.equal(db.planos.length, 1); assert.equal(db.planos[0].escolha, 'plus'); assert.equal(db.planos[0].preco, 990);
    db.planos = [{ escolha: 'plus' }];
    me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'plus'); assert.equal(me.plano.precisaEscolher, true, 'cobrança ligada: reservou e ainda não pagou, a tela de planos continua aparecendo'); assert.equal(me.plano.cobranca, true);
    db.usage = [{ n: 5 }]; models.length = 0;
    assert.equal((await post(api, { action: 'ai', prompt: 'monta meu treino', modelo: 'completa' }, auth)).status, 200);
    assert.deepEqual(models, ['claude-sonnet-5-5']);
    assert.ok(r.plano);
    // gente nova (depois de 10/11) no 3º dia: teste do Plus, ainda sem escolher
    db.planos = []; db.states = [{ start: '2026-11-09', tz: 'America/Sao_Paulo' }] as any;
    me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'teste'); assert.equal(me.plano.fundador, true);
    db.states = [{ start: '2026-11-11', tz: 'America/Sao_Paulo' }] as any;
    me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.fundador, false); assert.equal(me.plano.preco, 990); assert.equal(me.plano.precisaEscolher, false); assert.equal(me.plano.fimTeste, '2026-11-17');
  } finally { Object.assign(db, antes); }
});

test('api: Google — guarda a chave de renovação e devolve uma chave temporária; permissão tirada apaga', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' };
  env.FAIZ_GOOGLE_ID = 'id.apps.googleusercontent.com'; env.FAIZ_GOOGLE_SECRET = 'segredo';
  db.google_tokens = [];
  assert.equal((await post(api, { action: 'gsave', refresh_token: '1//abcdefghijk', scopes: 'calendar.events' }, auth)).status, 200);
  assert.equal(db.google_tokens.length, 1);
  db.google_tokens = [{ refresh_token: '1//abcdefghijk', scopes: 'calendar.events' }];
  const t = await (await post(api, { action: 'gtoken' }, auth)).json();
  assert.equal(t.access_token, 'ya29.temp');
  db.google_tokens = [{ refresh_token: 'revogado' }];
  assert.equal((await post(api, { action: 'gtoken' }, auth)).status, 401);
  const cfg = await (await post(api, { action: 'config' })).json();
  assert.equal(cfg.google, true);
});

test('api: calendário assinado foi retirado — quem assinou recebe um calendário vazio; não cria link novo', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' };
  assert.equal((await post(api, { action: 'calfeed' }, auth)).status, 410);
  db.cal_feeds = [{ user_id: U, token: 'a'.repeat(40) }];
  const ics = await api(new Request('https://proj.supabase.co/functions/v1/api?cal=' + 'a'.repeat(40)));
  assert.equal(ics.status, 200);
  const t = await ics.text();
  assert.match(t, /BEGIN:VCALENDAR/);
  assert.doesNotMatch(t, /BEGIN:VEVENT/, 'sem nenhuma tarefa');
  assert.equal((await api(new Request('https://proj.supabase.co/functions/v1/api?cal=../states'))).status, 404);
  assert.equal((await post(api, { action: 'calstop' }, auth)).status, 200);
  assert.equal(db.cal_feeds.length, 0);
  assert.match(buildIcsT({ tasks: [{ id: 'x', title: 'a;b', date: new Date().toISOString().slice(0, 10) }] }), /SUMMARY:a\\;b/);
});

test('planos com cobrança: reserva vale até 7 dias depois de ligar; quem paga fica no Plus; cancelado vale até o fim do mês pago', () => {
  const n = new Date('2026-12-03T15:00:00Z');
  const base = { startDate: '2026-11-01', livre: false, now: n, tz: 'America/Sao_Paulo' };
  // cobrança desligada: reserva = Plus, sem botão de pagar (só o dono)
  let p = planoDe({ ...base, escolha: 'plus', cobrancaDesde: null });
  assert.equal(p.plano, 'plus'); assert.equal(p.cobranca, false); assert.equal(p.pagarAte, null);
  assert.equal(planoDe({ ...base, escolha: 'plus', cobrancaDesde: null, dono: true }).cobranca, true);
  // ligada em 1/12: reservou e não pagou → Plus até 8/12, depois Grátis
  p = planoDe({ ...base, escolha: 'plus', cobrancaDesde: '2026-12-01' });
  assert.equal(p.plano, 'plus'); assert.equal(p.cobranca, true); assert.equal(p.pagarAte, '2026-12-08');
  p = planoDe({ ...base, now: new Date('2026-12-09T15:00:00Z'), escolha: 'plus', cobrancaDesde: '2026-12-01' });
  assert.equal(p.plano, 'gratis'); assert.equal(p.precisaEscolher, true, 'reservou e não pagou: vê a tela até pagar ou escolher o Grátis');
  // pagou: Plus, sem prazo
  p = planoDe({ ...base, now: new Date('2026-12-20T15:00:00Z'), escolha: 'plus', cobrancaDesde: '2026-12-01', assinatura: { status: 'authorized', proximo: '2027-01-05' } });
  assert.equal(p.plano, 'plus'); assert.equal(p.pago, true); assert.equal(p.pagarAte, null); assert.equal(p.proximo, '2027-01-05');
  // cancelou depois de pagar: Plus até a data paga
  const a = { status: 'cancelled', ate: '2027-01-05' };
  assert.equal(planoDe({ ...base, now: new Date('2027-01-05T15:00:00Z'), escolha: 'plus', cobrancaDesde: '2026-12-01', assinatura: a }).plano, 'plus');
  assert.equal(planoDe({ ...base, now: new Date('2027-01-06T15:00:00Z'), escolha: 'plus', cobrancaDesde: '2026-12-01', assinatura: a }).plano, 'gratis');
  // pagou sem ter escolhido antes (gente nova): não pede para escolher
  assert.equal(planoDe({ ...base, escolha: null, cobrancaDesde: '2026-12-01', assinatura: { status: 'authorized' } }).precisaEscolher, false);
  // leitura do Mercado Pago
  const l = lerAssinatura({ id: 'x', status: 'cancelled', next_payment_date: '2027-01-05T10:00:00.000-03:00', summarized: { charged_quantity: 1, last_charged_date: '2026-12-05T10:00:00.000-03:00' }, auto_recurring: { transaction_amount: 9.9 } });
  assert.equal(l.ate, '2027-01-05'); assert.equal(l.valor, 990); assert.equal(l.proximo, null);
  assert.equal(lerAssinatura({ id: 'y', status: 'cancelled', summarized: { charged_quantity: 0 } }).ate, null, 'cancelou sem pagar: nada a valer');
});

test('api: assinatura no Mercado Pago — cria, confere pelo aviso, cancela; nunca confia no corpo do aviso', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' }, authMail = { Authorization: 'Bearer user-mail', apikey: 'anon' };
  const antes = { states: db.states, unlimited: db.unlimited, planos: db.planos, owners: db.owners, assinaturas: db.assinaturas, subs: db.subs, sent: db.sent };
  db.unlimited = []; db.planos = []; db.owners = []; db.assinaturas = []; mpCalls.length = 0; mpPre = null;
  db.states = [{ start: '2026-11-01', tz: 'America/Sao_Paulo' }] as any;
  setNow('2026-11-11T15:00:00Z');
  try {
    assert.equal((await (await post(api, { action: 'assinar' }, authMail)).json()).error, 'mp_off');
    env.FAIZ_MP_TOKEN = 'APP_USR-teste';
    const off = await post(api, { action: 'assinar' }, authMail);
    assert.equal(off.status, 200, 'cobrança ligada: qualquer pessoa pode assinar'); mpCalls.length = 0; db.assinaturas = [];
    db.owners = [{ user_id: U }];
    const sem = await post(api, { action: 'assinar' }, auth);
    assert.equal(sem.status, 409); assert.equal((await sem.json()).error, 'precisa_google');
    const r = await (await post(api, { action: 'assinar', nome: 'Kauã Silva' }, authMail)).json();
    assert.match(r.url, /mercadopago\.com\.br\/subscriptions\/checkout/);
    const cria = mpCalls.find((c) => c.method === 'POST')!;
    assert.equal(cria.body.payer_email, 'kaua@gmail.com'); assert.equal(cria.body.external_reference, U);
    assert.equal(cria.body.auto_recurring.transaction_amount, 9.9); assert.equal(cria.body.auto_recurring.currency_id, 'BRL');
    assert.equal(cria.body.back_url, 'https://x.github.io/Faiz_web/?v=assinatura');
    assert.ok(!('start_date' in cria.body.auto_recurring), 'cobra a partir do dia em que a pessoa paga');
    assert.equal(db.assinaturas.at(-1).status, 'pending'); assert.equal(db.assinaturas.at(-1).mp_id, 'pre1');
    // a pessoa paga: chega o aviso do Mercado Pago (só o id); o servidor busca a assinatura lá
    db.assinaturas = [{ mp_id: 'pre1', status: 'pending', nome: 'Kauã Silva' }];
    mpPre = { ...mpPre, status: 'authorized', next_payment_date: '2026-12-11T10:00:00.000-03:00', summarized: { charged_quantity: 1, last_charged_date: '2026-11-11T10:00:00.000-03:00' } };
    const wh = await api(new Request('https://proj.supabase.co/functions/v1/api?mp=aviso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'subscription_authorized_payment', data: { id: 'pay9' } }) }));
    assert.equal(wh.status, 200);
    const pago = db.assinaturas.at(-1);
    assert.equal(pago.status, 'authorized'); assert.equal(pago.proximo, '2026-12-11'); assert.equal(pago.pagas, 1);
    assert.ok(db.planos.some((x: any) => x.escolha === 'plus'), 'quem pagou fica com o Plus escolhido');
    // aviso falso (outra pessoa no external_reference): ignorado
    mpPre = { ...mpPre, external_reference: '22222222-2222-2222-2222-222222222222' };
    const n0 = db.assinaturas.length;
    await api(new Request('https://proj.supabase.co/functions/v1/api?mp=aviso', { method: 'POST', body: JSON.stringify({ type: 'subscription_preapproval', data: { id: 'pre1' } }) }));
    assert.ok(db.assinaturas.slice(n0).every((x: any) => x.user_id === '22222222-2222-2222-2222-222222222222'), 'grava só para a pessoa que o Mercado Pago diz, nunca para outra');
    mpPre = { ...mpPre, external_reference: U };
    // sem dono: quem pagou está no Plus pago
    db.owners = []; db.planos = [{ escolha: 'plus' }]; db.assinaturas = [{ mp_id: 'pre1', status: 'authorized', proximo: '2026-12-11', conferido_em: new Date().toISOString() }];
    let me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'plus'); assert.equal(me.plano.pago, true); assert.equal(me.plano.proximo, '2026-12-11');
    // cancela: o Mercado Pago recebe o pedido; continua pago até 11/12
    mpCalls.length = 0;
    const c = await post(api, { action: 'cancelar' }, auth);
    assert.equal(c.status, 200);
    assert.deepEqual(mpCalls.filter((x) => x.method === 'PUT').map((x) => [x.path, x.body.status]), [['/preapproval/pre1', 'cancelled']]);
    assert.equal(db.assinaturas.at(-1).status, 'cancelled'); assert.equal(db.assinaturas.at(-1).ate, '2026-12-11');
  } finally { delete env.FAIZ_MP_TOKEN; Object.assign(db, antes); mpPre = null; }
});

test('Pix de 1 mês: soma 30 dias a partir de hoje ou do fim do que já estava pago; vencido volta ao Grátis', () => {
  assert.equal(somaPix('2026-12-03', [null, undefined], 30), '2027-01-02');
  assert.equal(somaPix('2026-12-03', ['2026-12-20', '2026-12-10'], 30), '2027-01-19', 'renovar antes de vencer não perde dias');
  assert.equal(somaPix('2026-12-03', ['2026-11-20'], 30), '2027-01-02', 'já vencido: conta de hoje');
  const base = { startDate: '2026-11-01', livre: false, tz: 'America/Sao_Paulo', escolha: 'plus', cobrancaDesde: '2026-11-15' };
  let p = planoDe({ ...base, now: new Date('2026-12-20T15:00:00Z'), assinatura: { status: 'pix', pix_ate: '2027-01-02' } });
  assert.equal(p.plano, 'plus'); assert.equal(p.pago, true); assert.equal(p.forma, 'pix'); assert.equal(p.ate, '2027-01-02'); assert.equal(p.proximo, null);
  p = planoDe({ ...base, now: new Date('2027-01-03T15:00:00Z'), assinatura: { status: 'pix', pix_ate: '2027-01-02' } });
  assert.equal(p.plano, 'gratis'); assert.equal(p.pago, false); assert.equal(p.forma, null);
  assert.equal(planoDe({ ...base, now: new Date('2026-12-20T15:00:00Z'), assinatura: { status: 'authorized', proximo: '2027-01-05' } }).forma, 'cartao');
});

test('api: Pix de 1 mês — cria o código, confere no Mercado Pago, libera 30 dias uma vez só e agenda os lembretes', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' }, authMail = { Authorization: 'Bearer user-mail', apikey: 'anon' };
  const antes = { states: db.states, unlimited: db.unlimited, planos: db.planos, owners: db.owners, assinaturas: db.assinaturas, pix_pagamentos: db.pix_pagamentos, manual_push: db.manual_push };
  db.unlimited = []; db.planos = []; db.assinaturas = []; db.pix_pagamentos = []; db.manual_push = []; mpCalls.length = 0; mpPay = null;
  db.states = [{ start: '2026-11-01', tz: 'America/Sao_Paulo' }] as any;
  db.owners = [{ user_id: U }];
  setNow('2026-11-11T15:00:00Z');
  env.FAIZ_MP_TOKEN = 'APP_USR-teste';
  try {
    assert.equal((await (await post(api, { action: 'pix' }, auth)).json()).error, 'precisa_google');
    const r = await (await post(api, { action: 'pix', nome: 'Kauã Silva' }, authMail)).json();
    assert.equal(r.id, '987654321'); assert.match(r.codigo, /^000201/); assert.equal(r.qr, 'iVBORw0KGgo='); assert.equal(r.valor, 990);
    const cria = mpCalls.find((c) => c.method === 'POST' && c.path === '/v1/payments')!;
    assert.equal(cria.body.transaction_amount, 9.9); assert.equal(cria.body.payment_method_id, 'pix'); assert.equal(cria.body.external_reference, U);
    assert.equal(cria.body.payer.email, 'kaua@gmail.com'); assert.match(cria.body.notification_url, /functions\/v1\/api\?mp=aviso$/);
    assert.equal(cria.body.date_of_expiration, '2026-11-11T15:30:00.000+00:00');
    assert.equal(db.pix_pagamentos[0].status, 'pending');
    // pedir de novo logo depois devolve o mesmo código (não cria outro)
    const n0 = mpCalls.filter((c) => c.method === 'POST').length;
    assert.equal((await (await post(api, { action: 'pix' }, authMail)).json()).id, '987654321');
    assert.equal(mpCalls.filter((c) => c.method === 'POST').length, n0);
    // ainda não pagou
    let st = await (await post(api, { action: 'pixstatus', id: '987654321' }, auth)).json();
    assert.equal(st.status, 'pending'); assert.equal(db.assinaturas.length, 0);
    // pagou: o aviso do Mercado Pago chega (só o id) e a conferência do app também; soma 30 dias uma vez só
    mpPay = { ...mpPay, status: 'approved' };
    await api(new Request('https://proj.supabase.co/functions/v1/api?mp=aviso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: '987654321' } }) }));
    assert.equal(db.pix_pagamentos[0].status, 'approved');
    assert.equal(db.assinaturas.length, 1); assert.equal(db.assinaturas[0].pix_ate, '2026-12-11');
    st = await (await post(api, { action: 'pixstatus', id: '987654321' }, auth)).json();
    assert.equal(st.status, 'approved'); assert.equal(db.assinaturas.length, 1, 'não soma duas vezes');
    assert.deepEqual(db.manual_push.map((m: any) => [m.title, m.send_at, m.url]), [['Seu Plus vence em 3 dias ⭐', '2026-12-08T13:00:00.000Z', './?v=planos'], ['Seu Plus vence hoje ⏰', '2026-12-11T13:00:00.000Z', './?v=planos']]);
    // o plano mostra Plus por Pix até 11/12
    db.owners = []; db.planos = [{ escolha: 'plus' }]; db.assinaturas = [{ status: 'pix', pix_ate: '2026-12-11', conferido_em: new Date().toISOString() }];
    const me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'plus'); assert.equal(me.plano.forma, 'pix'); assert.equal(me.plano.ate, '2026-12-11');
    // pagamento que não é desta pessoa (o banco não devolve a linha): 404
    db.pix_pagamentos = [];
    assert.equal((await post(api, { action: 'pixstatus', id: '111' }, auth)).status, 404);
  } finally { delete env.FAIZ_MP_TOKEN; Object.assign(db, antes); mpPay = null; }
});

test('api: pessoa escolhida para testar o pagamento vê o botão de pagar mesmo liberada e com a cobrança desligada', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' };
  const antes = { states: db.states, unlimited: db.unlimited, planos: db.planos, owners: db.owners, assinaturas: db.assinaturas, pagar_teste: db.pagar_teste };
  db.planos = []; db.owners = []; db.assinaturas = []; db.pagar_teste = [];
  db.unlimited = [{ user_id: U }];
  db.states = [{ start: '2026-10-29', tz: 'America/Sao_Paulo' }] as any;
  setNow('2026-11-11T15:00:00Z');
  try {
    let me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'livre'); assert.equal(me.plano.precisaEscolher, false, 'liberada nunca é obrigada a escolher');
    db.pagar_teste = [{ user_id: U }];
    me = await (await post(api, { action: 'me' }, auth)).json();
    assert.equal(me.plano.plano, 'livre', 'continua liberada (não perde a IA)'); assert.equal(me.plano.cobranca, true); assert.equal(me.plano.pago, false);
  } finally { Object.assign(db, antes); }
});

test('cobrança ligada: a tela de planos é obrigatória para quem já testava até pagar ou escolher o Grátis; gente nova tem 7 dias antes', () => {
  const n = new Date('2026-11-12T15:00:00Z'), d = '2026-11-10';
  const velho = { startDate: '2026-11-01', livre: false, now: n, tz: 'America/Sao_Paulo', cobrancaDesde: d };
  assert.equal(planoDe({ ...velho, escolha: null }).precisaEscolher, true, 'nunca escolheu');
  assert.equal(planoDe({ ...velho, escolha: 'plus', escolhidoEm: '2026-11-10T02:00:00Z' }).precisaEscolher, true, 'reservou o Plus mas não pagou');
  assert.equal(planoDe({ ...velho, escolha: 'gratis', escolhidoEm: '2026-11-09T20:00:00Z' }).precisaEscolher, true, 'escolheu o Grátis antes de a cobrança ligar: vê mais uma vez');
  assert.equal(planoDe({ ...velho, escolha: 'gratis', escolhidoEm: '2026-11-11T20:00:00Z' }).precisaEscolher, false, 'escolheu o Grátis depois: não incomoda mais');
  assert.equal(planoDe({ ...velho, escolha: 'plus', assinatura: { status: 'authorized' } }).precisaEscolher, false, 'pagou no cartão');
  assert.equal(planoDe({ ...velho, escolha: 'plus', assinatura: { status: 'pix', pix_ate: '2026-12-10' } }).precisaEscolher, false, 'pagou no Pix');
  assert.equal(planoDe({ ...velho, escolha: 'plus', assinatura: { status: 'pix', pix_ate: '2026-11-11' } }).precisaEscolher, true, 'Pix venceu e não renovou: escolhe de novo');
  assert.equal(planoDe({ ...velho, livre: true, escolha: null }).precisaEscolher, false, 'liberada pelo time');
  // testador que ainda está dentro dos 7 dias (entrou em 8/11): segue no Plus de teste, sem tela, até completar
  let q = planoDe({ startDate: '2026-11-08', livre: false, tz: 'America/Sao_Paulo', cobrancaDesde: d, escolha: null, now: new Date('2026-11-12T15:00:00Z') });
  assert.equal(q.plano, 'teste'); assert.equal(q.precisaEscolher, false);
  q = planoDe({ startDate: '2026-11-08', livre: false, tz: 'America/Sao_Paulo', cobrancaDesde: d, escolha: null, now: new Date('2026-11-15T15:00:00Z') });
  assert.equal(q.plano, 'gratis'); assert.equal(q.precisaEscolher, true, 'completou os 7 dias: a tela aparece');
  // gente nova (entrou depois de 10/11): 7 dias de Plus sem escolher; no 8º dia a tela vira obrigatória
  const novo = { startDate: '2026-11-11', livre: false, tz: 'America/Sao_Paulo', cobrancaDesde: d, escolha: null };
  let p = planoDe({ ...novo, now: new Date('2026-11-12T15:00:00Z') });
  assert.equal(p.plano, 'teste'); assert.equal(p.precisaEscolher, false); assert.equal(p.cobranca, true); assert.equal(p.fimTeste, '2026-11-17');
  p = planoDe({ ...novo, now: new Date('2026-11-18T15:00:00Z') });
  assert.equal(p.plano, 'gratis'); assert.equal(p.precisaEscolher, true);
});

test('api: integrações do Google pelo caminho próprio (código → chave de renovação no servidor)', async () => {
  const auth = { Authorization: 'Bearer user-token', apikey: 'anon' };
  const antes = { google_tokens: db.google_tokens, unlimited: db.unlimited };
  env.FAIZ_GOOGLE_ID = 'id.apps.googleusercontent.com'; env.FAIZ_GOOGLE_SECRET = 'segredo';
  db.unlimited = [{ user_id: U }]; db.google_tokens = [];
  try {
    let cfg = await (await post(api, { action: 'config' })).json();
    assert.equal(cfg.googleRedirect, '', 'sem o endereço de volta configurado, o app usa o caminho antigo'); assert.equal(cfg.googleId, '');
    assert.equal((await post(api, { action: 'gcode', code: 'abcdefghijkl' }, auth)).status, 503);
    env.FAIZ_GOOGLE_REDIRECT = 'https://faizapp.com.br/google';
    cfg = await (await post(api, { action: 'config' })).json();
    assert.equal(cfg.googleRedirect, 'https://faizapp.com.br/google'); assert.equal(cfg.googleId, 'id.apps.googleusercontent.com');
    const ok = await (await post(api, { action: 'gcode', code: 'codigo-bom-123' }, auth)).json();
    assert.equal(ok.ok, true);
    assert.equal(db.google_tokens.at(-1).refresh_token, '1//novorefresh');
    const ruim = await post(api, { action: 'gcode', code: 'codigo-ruim-123' }, auth);
    assert.equal(ruim.status, 400);
    db.google_tokens = [{ refresh_token: '1//antigo' }];
    const sem = await (await post(api, { action: 'gcode', code: 'sem-refresh-123' }, auth)).json();
    assert.equal(sem.ok, true, 'sem chave nova: continua valendo a antiga');
  } finally { delete env.FAIZ_GOOGLE_REDIRECT; Object.assign(db, antes); }
});
