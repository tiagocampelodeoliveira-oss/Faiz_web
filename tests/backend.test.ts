// Testes do servidor: criptografia real dos avisos e regra de quando avisar.
// Rodar: npx tsx --test tests/backend.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, generateVapidKeys, sendPush, unb64u, b64u, _test } from '../supabase/functions/_shared/webpush.ts';
import { dueNotices, localNow, missedStreak, type AppState } from '../supabase/functions/_shared/plan.ts';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();

async function fakeBrowser() {
  const kp = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { kp, sub: { endpoint: 'https://web.push.apple.com/QAbc123', keys: { p256dh: b64u(pub), auth: b64u(auth) } }, pub, auth };
}

// Lado do navegador (RFC 8291), escrito à parte para conferir a criptografia.
async function browserDecrypt(body: Uint8Array, b: Awaited<ReturnType<typeof fakeBrowser>>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, b.kp.privateKey, 256));
  const ikm = await _test.hkdf(b.auth, shared, _test.concat(te.encode('WebPush: info\0'), b.pub, asPub), 32);
  const cek = await _test.hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await _test.hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(plain[plain.length - 1], 2, 'delimitador do último registro');
  return new TextDecoder().decode(plain.slice(0, -1));
}

test('o navegador consegue abrir o aviso criptografado', async () => {
  const b = await fakeBrowser();
  const msg = JSON.stringify({ title: 'Corrida em 10 min', body: '18:30–19:30. Depois, jantar às 21:00.' });
  const body = await encrypt(te.encode(msg), b.sub);
  assert.equal(await browserDecrypt(body, b), msg);
});

test('assinatura VAPID válida, com aud do serviço de push', async () => {
  const keys = await generateVapidKeys();
  assert.equal(unb64u(keys.publicKey).length, 65);
  const h = await _test.vapidAuth('https://web.push.apple.com/QAbc', keys, 'https://exemplo.github.io/faiz');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  assert.ok(m);
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://exemplo.github.io/faiz');
  const pub = await subtle.importKey('raw', unb64u(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), te.encode(`${m[1]}.${m[2]}`));
  assert.ok(ok, 'assinatura confere com a chave pública');
});

test('sendPush manda os cabeçalhos certos e marca inscrição apagada (410)', async () => {
  const b = await fakeBrowser();
  const keys = await generateVapidKeys();
  const calls: { url: string; init: RequestInit }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('', { status: calls.length === 1 ? 201 : 410 }); }) as typeof fetch;
  try {
    const r1 = await sendPush(b.sub, { title: 'Oi' }, keys, 'https://x.github.io/f');
    const r2 = await sendPush(b.sub, { title: 'Oi' }, keys, 'https://x.github.io/f');
    assert.deepEqual([r1.ok, r1.gone, r2.ok, r2.gone], [true, false, false, true]);
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h['Content-Encoding'], 'aes128gcm');
    assert.ok(h.Authorization.startsWith('vapid t='));
    assert.equal(await browserDecrypt(calls[0].init.body as Uint8Array, b), JSON.stringify({ title: 'Oi' }));
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------- Quando avisar ----------
const SP = 'America/Sao_Paulo';
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);
const base: AppState = {
  name: 'Tiago Campelo',
  settings: { tz: SP },
  tasks: [
    { id: 'a', title: 'Reunião', date: '2026-10-29', start: 600, end: 660, status: 'feito' },
    { id: 'b', title: 'Corrida', date: '2026-10-29', start: 1110, end: 1170 },
    { id: 'c', title: 'Jantar com a Ana', date: '2026-10-29', start: 1260, end: 1350 },
    { id: 'd', title: 'Beber água', date: '2026-10-29', start: 900, tag: 'Lembrete' },
    { id: 'e', title: 'Estudar inglês', date: '2026-10-29' },
    { id: 'f', title: 'Corrida', date: '2026-10-30', start: 1110 },
  ],
};
const keys = (ns: { key: string }[]) => ns.map((n) => n.key);

test('fuso horário de São Paulo', () => {
  assert.deepEqual(localNow(new Date('2026-10-29T21:20:00Z'), SP), { date: '2026-10-29', min: 18 * 60 + 20 });
  assert.deepEqual(localNow(new Date('2026-10-30T02:30:00Z'), SP), { date: '2026-10-29', min: 23 * 60 + 30 });
});

test('10 minutos antes da atividade, com o que vem depois', () => {
  const n = dueNotices(base, at('2026-10-29', '18:20'), new Set());
  assert.deepEqual(keys(n), ['t:b:2026-10-29:1110:10']);
  assert.equal(n[0].title, 'Corrida em 10 min ⏰');
  assert.match(n[0].body, /18:30–19:30\. Depois, jantar com a Ana às 21:00\. /);
  assert.equal(n[0].url, './?t=b');
});

test('não repete o que já foi enviado; antes da hora, nada', () => {
  assert.deepEqual(dueNotices(base, at('2026-10-29', '18:21'), new Set(['t:b:2026-10-29:1110:10'])), []);
  assert.deepEqual(dueNotices(base, at('2026-10-29', '18:19'), new Set()), []);
});

test('servidor atrasado ainda avisa antes do início', () => {
  assert.equal(dueNotices(base, at('2026-10-29', '18:29'), new Set())[0].title, 'Corrida em 1 min ⏰');
});

test('na hora, se não marcou como feito, cobra de novo (uma vez); depois de 20 min, para', () => {
  const n = dueNotices(base, at('2026-10-29', '18:30'), new Set(['t:b:2026-10-29:1110:10']));
  assert.deepEqual(keys(n), ['t:b:2026-10-29:1110:s']);
  assert.ok(n[0].title.length > 5);
  assert.match(n[0].body, /^18:30–19:30\. Toque para marcar como feito ou adiar 15 min\.$/);
  assert.deepEqual(dueNotices(base, at('2026-10-29', '18:35'), new Set(['t:b:2026-10-29:1110:s'])), []);
  assert.deepEqual(dueNotices(base, at('2026-10-29', '18:50'), new Set()), []);
});

test('lembrete toca na hora exata e insiste 30 min depois se não foi feito', () => {
  const n = dueNotices(base, at('2026-10-29', '15:00'), new Set());
  assert.equal(n[0].title, 'Lembrete: Beber água');
  assert.deepEqual(dueNotices(base, at('2026-10-29', '14:55'), new Set()), []);
  const again = dueNotices(base, at('2026-10-29', '15:30'), new Set(['t:d:2026-10-29:900:r']));
  assert.deepEqual(keys(again), ['t:d:2026-10-29:900:r2']);
  assert.match(again[0].body, /Beber água\. Toque/);
  const done: AppState = { ...base, tasks: base.tasks!.map((t) => (t.id === 'd' ? { ...t, status: 'feito' } : t)) };
  assert.deepEqual(dueNotices(done, at('2026-10-29', '15:30'), new Set()), []);
});

test('adiar (novo horário) gera um aviso novo; concluído não avisa', () => {
  const s: AppState = { ...base, tasks: base.tasks!.map((t) => (t.id === 'b' ? { ...t, start: 1125, end: 1185 } : t)) };
  assert.deepEqual(keys(dueNotices(s, at('2026-10-29', '18:35'), new Set(['t:b:2026-10-29:1110:10', 't:b:2026-10-29:1110:s']))), ['t:b:2026-10-29:1125:10']);
  const done: AppState = { ...base, tasks: base.tasks!.map((t) => (t.id === 'b' ? { ...t, status: 'feito' } : t)) };
  assert.deepEqual(dueNotices(done, at('2026-10-29', '18:20'), new Set()), []);
});

test('antecedência escolhida pela pessoa', () => {
  const s: AppState = { ...base, settings: { tz: SP, notify: { lead: 30 } } };
  assert.equal(dueNotices(s, at('2026-10-29', '18:00'), new Set())[0].title, 'Corrida em 30 min ⏰');
});

test('resumo da manhã às 07:30 com o primeiro nome', () => {
  const n = dueNotices(base, at('2026-10-29', '07:30'), new Set());
  assert.deepEqual(keys(n), ['m:2026-10-29']);
  assert.equal(n[0].title, 'Bom dia, Tiago! ☀️');
  assert.equal(n[0].body, 'Hoje: beber água às 15:00, corrida às 18:30, jantar com a Ana às 21:00 e estudar inglês. Levanta que o dia não espera!');
  assert.deepEqual(dueNotices(base, at('2026-10-29', '07:29'), new Set()), []);
});

test('revisão da noite às 21:00 com pendências', () => {
  const s: AppState = { ...base, tasks: base.tasks!.filter((t) => t.id !== 'c') };
  const n = dueNotices(s, at('2026-10-29', '21:00'), new Set());
  assert.deepEqual(keys(n), ['n:2026-10-29']);
  assert.equal(n[0].url, './?v=noite');
  assert.equal(n[0].title, 'Hora da verdade 😤');
  assert.match(n[0].body, /^1 de 4\. Ficou pra trás: beber água, corrida e estudar inglês\. Amanhã sem desculpa, combinado\?/);
});

test('avisos desligados, ou manhã e noite desligadas', () => {
  assert.deepEqual(dueNotices({ ...base, settings: { tz: SP, notify: { enabled: false } } }, at('2026-10-29', '18:20'), new Set()), []);
  const s: AppState = { ...base, settings: { tz: SP, notify: { morning: null, night: null } } };
  assert.deepEqual(dueNotices(s, at('2026-10-29', '07:30'), new Set()), []);
});

test('dia livre: resumo da manhã convida a planejar; noite não manda nada', () => {
  const s: AppState = { name: '', settings: { tz: SP }, tasks: [] };
  assert.equal(dueNotices(s, at('2026-10-29', '07:45'), new Set())[0].title, 'Bom dia! ☀️');
  assert.deepEqual(dueNotices(s, at('2026-10-29', '21:10'), new Set()), []);
});

// ---------- A voz da Íris (um jeito só: direto) ----------
const furos = [1, 2, 3].map((d) => ({ id: `old${d}`, title: 'Corrida', date: `2026-10-${29 - d}`, start: 1110 }));

test('contador de furos: dias seguidos sem fazer a mesma atividade', () => {
  assert.equal(missedStreak(furos, 'corrida', '2026-10-29'), 3);
  assert.equal(missedStreak([...furos.slice(1), { id: 'ok', title: 'Corrida', date: '2026-10-28', status: 'feito' }], 'Corrida', '2026-10-29'), 0);
  assert.equal(missedStreak(furos, 'Jantar', '2026-10-29'), 0);
});

test('na hora ela cobra direto; furando há dias, sobe o tom', () => {
  const comFuros: AppState = { ...base, tasks: [...base.tasks!, ...furos] };
  const n = dueNotices(comFuros, at('2026-10-29', '18:30'), new Set())[0];
  assert.match(n.title, /sacanagem|enrolação|cadê/i);
  assert.match(n.body, /3 dias furando\. Hoje não tem desculpa!/);
  assert.doesNotMatch(dueNotices(base, at('2026-10-29', '18:30'), new Set())[0].body, /furando/);
});

test('lembrete e insistência no jeito dela', () => {
  assert.equal(dueNotices(base, at('2026-10-29', '15:00'), new Set())[0].body, 'Agora, não amanhã. Toque para marcar como feito.');
  assert.match(dueNotices(base, at('2026-10-29', '15:30'), new Set(['t:d:2026-10-29:900:r']))[0].title, /ignorar|Sério|esperando/);
});

test('revisão da noite: cobra o que ficou; comemora quando fez tudo', () => {
  const tudo: AppState = { ...base, tasks: base.tasks!.map((t) => ({ ...t, status: 'feito' })) };
  assert.equal(dueNotices(tudo, at('2026-10-29', '21:25'), new Set())[0].title, 'Arrasou! 🎉');
  const nada: AppState = { ...base, tasks: base.tasks!.map((t) => ({ ...t, status: 'pendente' })) };
  assert.match(dueNotices(nada, at('2026-10-29', '21:25'), new Set())[0].body, /^Zero de 5 hoje\?/);
});

test('pesquisa do teste: dia 3 e dia 7 às 19h, só se não respondeu', () => {
  const q = (startDate: string, hora: string, survey: any = undefined) =>
    dueNotices({ name: 'Ana', startDate, survey, settings: { tz: SP }, tasks: [] }, at('2026-11-05', hora), new Set()).filter((n) => n.tag === 'pesquisa');
  assert.deepEqual(q('2026-11-03', '19:00').map((n) => n.key), ['q:d3']);
  assert.equal(q('2026-11-03', '19:00')[0].url, './?v=pesquisa');
  assert.deepEqual(q('2026-11-04', '19:00'), [], 'só no 3º dia');
  assert.deepEqual(q('2026-11-03', '18:59'), [], 'só depois das 19h');
  assert.deepEqual(q('2026-11-03', '19:30', { d3: { nota: 4 } }), [], 'já respondeu');
  assert.deepEqual(q('2026-10-30', '20:00', { d3: {} }).map((n) => n.key), ['q:d7']);
  assert.deepEqual(q('2026-10-30', '20:00', { d3: {}, d7: {} }), []);
  assert.deepEqual(dueNotices({ settings: { tz: SP }, tasks: [] }, at('2026-11-05', '19:00'), new Set()), [], 'sem data de início, nada');
});

test('sequência: o aviso antes comemora as vezes seguidas', () => {
  const st = { ...base, tasks: [
    ...base.tasks!,
    { id: 'g1', title: 'Corrida', date: '2026-10-27', start: 1110, status: 'feito' },
    { id: 'g2', title: 'Corrida', date: '2026-10-28', start: 1110, status: 'feito' },
  ] };
  const n = dueNotices(st, at('2026-10-29', '18:20'), new Set());
  assert.match(n[0].body, /🔥 2 seguidas\. Não vai quebrar agora, né\?$/);
});

test('contas da casa: avisa antes, no dia e atrasada; paga não avisa', () => {
  const st = { ...base, tasks: [], fin: { fixas: [
    { id: 'luz', tipo: 'conta' as const, nome: 'Luz', valor: 18050, dia: 31, desde: '2026-10' },
    { id: 'alu', tipo: 'conta' as const, nome: 'Aluguel', valor: 150000, dia: 29, desde: '2026-10' },
    { id: 'net', tipo: 'conta' as const, nome: 'Internet', valor: 9990, dia: 27, desde: '2026-10' },
    { id: 'sal', tipo: 'renda' as const, nome: 'Salário', valor: 300000, dia: 30, desde: '2026-10' },
    { id: 'tv', tipo: 'conta' as const, nome: 'TV', valor: 5000, dia: 29, desde: '2026-10' },
    { id: 'old', tipo: 'conta' as const, nome: 'Geladeira', valor: 30000, dia: 29, desde: '2026-08', ate: '2026-09' },
  ], pagas: { 'tv:2026-10': { data: '2026-10-28', valor: 5000 } } } };
  const n = dueNotices(st, at('2026-10-29', '09:30'), new Set());
  assert.deepEqual(keys(n), ['c:luz:2026-10:pre', 'c:alu:2026-10:dia', 'c:net:2026-10:atraso']);
  assert.equal(n[0].title, 'Conta chegando: Luz 🧾');
  assert.match(n[0].body, /^R\$ 180,50 vence em 2 dias \(dia 31\)/);
  assert.match(n[1].body, /^R\$ 1\.500,00\. Pagou\?/);
  assert.equal(n[2].url, './?v=contas');
  assert.deepEqual(dueNotices(st, at('2026-10-29', '08:59'), new Set()), [], 'só de manhã, a partir das 9h');
  assert.deepEqual(dueNotices(st, at('2026-10-29', '10:00'), new Set(keys(n))), [], 'não repete');
});
