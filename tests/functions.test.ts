// Roda as funções do servidor (api e tick) no Node, com o Deno, o banco e os serviços simulados.
// Rodar: npx tsx --test tests/functions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, _test, generateVapidKeys } from '../supabase/functions/_shared/webpush.ts';

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
};
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
    if (noCredit) return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', { status: 400 });
    if (sonnetDown && anthropicBody.model === 'claude-sonnet-5-5') return new Response('{"error":"overloaded"}', { status: 529 });
    return Response.json({ content: [{ type: 'text', text: '{"acao":"conversa","resposta":"Oi"}' }] });
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
  if (url.pathname === '/auth/v1/user') return (init.headers as any).Authorization === 'Bearer user-token' ? Response.json({ id: U }) : new Response('{}', { status: 401 });
  const table = url.pathname.replace('/rest/v1/', '') as keyof typeof db;
  assert.equal((init.headers as any).apikey, 'service-jwt', 'servidor usa a chave de serviço');
  if (method === 'GET') return Response.json(db[table]);
  if (method === 'PATCH') { const v = JSON.parse(String(init.body)); (db as any)[table] = (db as any)[table].map((r: any) => ({ ...r, ...v })); return new Response(null, { status: 204 }); }
  if (method === 'DELETE') { if (table === 'subs') db.subs = []; return new Response(null, { status: 204 }); }
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
});

test('celular que saiu (410) é apagado', async () => {
  setNow('2026-10-29T10:31:00Z'); // 07:31: resumo da manhã
  db.sent = [];
  pushStatus = 410;
  const r = await (await post(tick, {}, { 'x-tick-secret': 's3cret' })).json();
  assert.equal(r.removed, 1, JSON.stringify(r));
  assert.equal(db.subs.length, 0);
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
