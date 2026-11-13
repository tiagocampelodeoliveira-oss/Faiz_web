// Testes do servidor: criptografia real dos avisos e regra de quando avisar.
// Rodar: npx tsx --test tests/backend.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, generateVapidKeys, sendPush, unb64u, b64u, _test } from '../supabase/functions/_shared/webpush.ts';
import { dueNotices, localNow, missedStreak, trialInfo, voltaLer, voltaPrompt, type AppState } from '../supabase/functions/_shared/plan.ts';

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

test('tom da Íris: animada, firme depois de furar, bronca só a partir de 3 furos seguidos', () => {
  const na = (tasks: any[]) => dueNotices({ ...base, tasks: [...base.tasks!, ...tasks] }, at('2026-10-29', '18:30'), new Set())[0];
  const zero = na([]);
  assert.doesNotMatch(zero.title + zero.body, /sacanagem|enrolação|furando|furos|vezes/i);
  const um = na(furos.slice(0, 1));
  assert.doesNotMatch(um.title + um.body, /sacanagem|enrolação/i);
  assert.match(um.title, /vai, né|de novo|não fura/i);
  const dois = na(furos.slice(0, 2));
  assert.doesNotMatch(dois.title + dois.body, /sacanagem|enrolação/i);
  const tres = na(furos);
  assert.match(tres.title, /sacanagem|enrolação|furos/i);
  assert.match(tres.body, /Já são 3 vezes seguidas sem fazer\. Hoje não tem desculpa!$/);
});

test('furos contam as vezes que estava na agenda (rotina seg/qua/sex)', () => {
  const rot = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28'].map((date, i) => ({ id: `r${i}`, title: 'Academia', date, start: 420, status: i < 1 ? 'feito' : undefined }));
  assert.equal(missedStreak(rot, 'Academia', '2026-10-30'), 4);
});

test('lembrete e insistência: leve sem furos, dura só com muitos furos', () => {
  assert.match(dueNotices(base, at('2026-10-29', '15:00'), new Set())[0].body, /Toque para marcar como feito|marca aqui/);
  const leve = dueNotices(base, at('2026-10-29', '15:30'), new Set(['t:d:2026-10-29:900:r']))[0].title;
  assert.doesNotMatch(leve, /ignorar|Sério|De novo/);
  const agua = [1, 2, 3].map((d) => ({ id: `ag${d}`, title: 'Beber água', date: `2026-10-${29 - d}`, start: 900, tag: 'Lembrete' }));
  const dura = dueNotices({ ...base, tasks: [...base.tasks!, ...agua] }, at('2026-10-29', '15:30'), new Set(['t:d:2026-10-29:900:r']))[0].title;
  assert.match(dura, /ignorar|Sério|De novo/);
});

test('1 hora antes, para atividades de 1 hora ou mais', () => {
  const n = dueNotices(base, at('2026-10-29', '20:00'), new Set());
  assert.ok(keys(n).includes('t:c:2026-10-29:1260:60'), keys(n).join());
  assert.match(n.find((x) => x.key.endsWith(':60'))!.title, /1 hora|daqui a pouco/i);
  assert.ok(!keys(dueNotices(base, at('2026-10-29', '14:00'), new Set())).some((k) => k.startsWith('t:d')), 'lembrete não tem 1 hora antes');
});

test('no fim da atividade, confere se fez', () => {
  const n = dueNotices(base, at('2026-10-29', '19:30'), new Set());
  assert.deepEqual(keys(n), ['t:b:2026-10-29:1110:f']);
  assert.match(n[0].title, /✅$/);
  const feito: AppState = { ...base, tasks: base.tasks!.map((t) => (t.id === 'b' ? { ...t, status: 'feito' } : t)) };
  assert.ok(!keys(dueNotices(feito, at('2026-10-29', '19:30'), new Set())).includes('t:b:2026-10-29:1110:f'));
});

test('véspera às 20h: o que começa cedo amanhã; ou convite se amanhã está vazio', () => {
  const cedo: AppState = { ...base, tasks: [...base.tasks!, { id: 'g', title: 'Academia', date: '2026-10-30', start: 420, end: 480 }] };
  const v = dueNotices(cedo, at('2026-10-29', '20:05'), new Set()).find((n) => n.tag === 'vespera')!;
  assert.equal(v.key, 'v:2026-10-29');
  assert.match(v.title, /academia às 07:00/);
  assert.ok(!dueNotices(base, at('2026-10-29', '20:05'), new Set()).some((n) => n.tag === 'vespera'), 'corrida às 18:30 não é cedo');
  const vazio: AppState = { ...base, tasks: base.tasks!.filter((t) => t.id !== 'f') };
  assert.deepEqual(dueNotices(vazio, at('2026-10-29', '20:10'), new Set()).filter((n) => n.tag === 'amanha').map((n) => n.key), ['a:2026-10-29']);
});

test('domingo às 19h: planejar a semana (sem o aviso de volta junto)', () => {
  const dom = dueNotices({ ...base, tasks: base.tasks, stats: { days: ['2026-10-30'] } }, at('2026-11-01', '19:10'), new Set());
  const w = dom.find((n) => n.tag === 'semana')!;
  assert.equal(w.key, 'w:2026-11-01');
  assert.equal(w.url, './?v=planejar');
  assert.equal(dom.filter((n) => n.tag === 'volta').length, 0);
});

test('volta: 3 dias sem abrir, às 12h e às 19h; depois de 2 em 2 dias', () => {
  const st: AppState = { ...base, name: 'Isabela Souza', stats: { days: ['2026-10-25', '2026-10-26'], requests: 1 } as any };
  const v = (hora: string, s: AppState = st, dia = '2026-10-29') => dueNotices(s, at(dia, hora), new Set()).filter((n) => n.tag === 'volta');
  const meio = v('12:00');
  assert.deepEqual(meio.map((n) => n.key), ['v:2026-10-29:12h']);
  assert.equal(meio[0].url, './?v=planejar');
  assert.equal(meio[0].ia!.nome, 'Isabela');
  assert.equal(meio[0].ia!.diasSemAbrir, 3);
  assert.equal(meio[0].ia!.pedidosAIris, 1);
  assert.ok(meio[0].ia!.hojeAberto.some((x) => /Corrida às 18:30/.test(x)), JSON.stringify(meio[0].ia));
  assert.match(meio[0].title, /^Isabela, ainda não te vi hoje/);
  assert.match(meio[0].body, /^Hoje tem beber água às 15:00/);
  assert.deepEqual(v('19:05').map((n) => n.key), ['v:2026-10-29:19h']);
  assert.deepEqual(v('15:00'), [], 'só às 12h e às 19h');
  const sem = (d: number) => ({ ...st, stats: { days: [new Date(Date.parse('2026-10-29T12:00:00Z') - d * 864e5).toISOString().slice(0, 10)] } });
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((d) => v('12:00', sem(d)).length), [0, 0, 0, 1, 0, 1, 0, 1], '3º, 5º, 7º dia sem abrir');
  assert.deepEqual(v('12:00', { ...st, stats: { days: [] } }), [], 'nunca abriu: nada');
  assert.deepEqual(v('19:00', { ...st, startDate: '2026-10-25' }), [], 'dia de aviso da pesquisa: sem o das 19h');
  assert.equal(v('12:00', { ...st, startDate: '2026-10-25' }).length, 1, 'mas o das 12h sai');
});

test('volta: lê a resposta da IA e recusa fora do formato', () => {
  assert.deepEqual(voltaLer('{"titulo":"Isa, bora? 👀","texto":"Me manda 3 coisas de amanhã."}'), { title: 'Isa, bora? 👀', body: 'Me manda 3 coisas de amanhã.' });
  assert.equal(voltaLer('oi'), null);
  assert.equal(voltaLer('{"titulo":"Abre o Faz","texto":"x"}'), null, 'nunca "Faz"');
  assert.equal(voltaLer(JSON.stringify({ titulo: 'a', texto: 'x'.repeat(300) })), null);
  const p = voltaPrompt({ nome: 'Leo' } as any);
  assert.match(p.system, /Responda só com JSON/);
  assert.match(p.user, /"nome":"Leo"/);
});

test('avisos novos são obrigatórios: chegam mesmo que o estado peça para desligar', () => {
  const off: any = { ...base, settings: { tz: SP, notify: { extra: { umaHora: false, conferir: false } } } };
  assert.ok(keys(dueNotices(off, at('2026-10-29', '20:00'), new Set())).includes('t:c:2026-10-29:1260:60'));
  assert.ok(keys(dueNotices(off, at('2026-10-29', '19:30'), new Set())).includes('t:b:2026-10-29:1110:f'));
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
  assert.deepEqual(q('2026-11-02', '19:00').map((n) => n.key), ['q:d3r'], 'lembrete no dia seguinte');
  assert.match(q('2026-11-02', '19:00')[0].body, /muito importante pro grupo Faiz/);
  assert.deepEqual(q('2026-11-01', '19:00').map((n) => n.key), ['q:d3r'], 'lembrete vale por 2 dias (sai uma vez só)');
  assert.deepEqual(q('2026-10-31', '19:00'), [], 'depois disso, nada até o dia 7');
  assert.deepEqual(q('2026-10-29', '19:00', { d3: {} }).map((n) => n.key), ['q:d7r'], 'lembrete do dia 7');
  assert.deepEqual(q('2026-10-27', '19:00', { d3: {} }).map((n) => n.key), ['q:d7']);
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

test('teste de 7 dias: IA pausa a partir do 8º dia (contando o dia em que começou)', () => {
  assert.deepEqual(trialInfo('2026-11-03', at('2026-11-03', '10:00')), { dia: 0, acabou: false });
  assert.deepEqual(trialInfo('2026-11-03', at('2026-11-09', '23:59')), { dia: 6, acabou: false }, '7º dia (pesquisa final) ainda tem IA');
  assert.deepEqual(trialInfo('2026-11-03', at('2026-11-10', '00:01')), { dia: 7, acabou: true });
  assert.deepEqual(trialInfo(undefined, at('2026-11-10', '10:00')), { dia: 0, acabou: false }, 'sem data de início, não bloqueia');
});

test('novidade do Google: avisa 1 vez quem ainda não ligou a agenda, de dia, na semana do anúncio', () => {
  const nv = (st: any, dia: string, hora: string, sent = new Set<string>()) =>
    dueNotices({ name: 'Ana', settings: { tz: SP }, tasks: [], onboarded: true, ...st } as any, at(dia, hora), sent).filter((n) => n.tag === 'novidade');
  assert.deepEqual(nv({}, '2026-11-05', '10:30').map((n) => [n.key, n.url]), [['nv:google', './?v=novidade']]);
  assert.equal(nv({}, '2026-11-05', '09:30').length, 0, 'cedo demais');
  assert.equal(nv({}, '2026-11-05', '21:30').length, 0, 'tarde demais');
  assert.equal(nv({}, '2026-11-13', '12:00').length, 0, 'passou da semana');
  assert.equal(nv({ integ: { agenda: true } }, '2026-11-05', '12:00').length, 0, 'já ligou');
  assert.equal(nv({ news: { google: true } }, '2026-11-05', '12:00').length, 0, 'já viu no app');
  assert.equal(nv({}, '2026-11-05', '12:00', new Set(['nv:google'])).length, 0, 'já recebeu');
});

test('avisos de conta: semanal só no dia; anual só no mês dela; não repete o mês', () => {
  const st = (fixas: any[], pagas: any = {}) => ({ name: 'Ana', settings: { tz: SP }, tasks: [], fin: { fixas, pagas } } as any);
  const dia = { id: 'd', tipo: 'conta', nome: 'Diarista', valor: 15000, dia: 1, desde: '2026-11', freq: 'semanal', dow: 5 };
  // 2026-11-06 é sexta
  const sexta = dueNotices(st([dia]), at('2026-11-06', '10:00'), new Set()).filter((n) => n.tag === 'c-d');
  assert.deepEqual(sexta.map((n) => n.key), ['c:d:2026-11-06:dia']);
  assert.equal(dueNotices(st([dia]), at('2026-11-04', '10:00'), new Set()).filter((n) => n.tag === 'c-d').length, 0, 'semanal não avisa antes');
  assert.equal(dueNotices(st([dia], { 'd:2026-11-06': { valor: 15000 } }), at('2026-11-06', '10:00'), new Set()).filter((n) => n.tag === 'c-d').length, 0, 'paga não avisa');
  const ipva = { id: 'i', tipo: 'conta', nome: 'IPVA', valor: 90000, dia: 15, desde: '2026-01', freq: 'anual', mes: 3 };
  assert.equal(dueNotices(st([ipva]), at('2026-11-13', '10:00'), new Set()).filter((n) => n.tag === 'c-i').length, 0, 'anual fora do mês');
  assert.deepEqual(dueNotices(st([ipva]), at('2027-03-13', '10:00'), new Set()).filter((n) => n.tag === 'c-i').map((n) => n.key), ['c:i:2027-03:pre']);
  const luz = { id: 'l', tipo: 'conta', nome: 'Luz', valor: 18000, dia: 20, desde: '2026-10' };
  assert.deepEqual(dueNotices(st([luz]), at('2026-11-18', '10:00'), new Set()).filter((n) => n.tag === 'c-l').map((n) => n.key), ['c:l:2026-11:pre'], 'mensal continua igual');
});

test('compromisso do Google Agenda: só um aviso antes; nunca cobra, nunca conta furo, fora da revisão da noite', () => {
  const g = (id: string, date: string, start: number, extra: any = {}) => ({ id, title: 'Aula 3º ano', date, start, end: start + 50, source: 'google', status: 'pendente', ...extra });
  // 5 dias de aula do Google sem "feito" + uma tarefa do Faiz
  const tasks: any[] = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d, i) => g('g' + i, d, 8 * 60));
  tasks.push(g('ghoje', '2026-11-06', 8 * 60), { id: 'f1', title: 'Corrigir provas', date: '2026-11-06', start: 19 * 60, end: 20 * 60, status: 'feito' });
  const st = { name: 'Leo', settings: { tz: SP }, tasks } as any;
  const em = (h: string) => dueNotices(st, at('2026-11-06', h), new Set()).filter((n) => n.tag === 't-ghoje');
  const antes = em('07:52');
  assert.equal(antes.length, 1);
  assert.match(antes[0].title, /^Aula 3º ano em 8 min 📅$/);
  assert.equal(antes[0].task, undefined, 'aviso do Google não tem os botões Feito/Adiar');
  assert.doesNotMatch(antes[0].body, /furando|sacanagem|sequência/i);
  assert.equal(em('08:05').length, 0, 'na hora não cobra');
  assert.equal(em('08:52').length, 0, 'no fim não pergunta');
  assert.equal(em('07:05').length, 0, 'sem aviso de 1 hora antes');
  assert.equal(missedStreak(tasks, 'Aula 3º ano', '2026-11-06'), 0, 'não conta furo');
  const noite = dueNotices(st, at('2026-11-06', '21:10'), new Set()).filter((n) => n.tag === 'noite');
  assert.equal(noite.length, 1);
  assert.match(noite[0].body, /fez tudo hoje \(1 de 1\)/, 'revisão só olha as tarefas do Faiz');
  const vesp = dueNotices({ ...st, tasks: [g('gam', '2026-11-07', 7 * 60)] }, at('2026-11-06', '20:10'), new Set()).filter((n) => n.tag === 'vespera');
  assert.equal(vesp.length, 0, 'véspera não repete a aula do Google');
});

test('avisos de atividade do Faiz levam a atividade (botões Feito e Adiar)', () => {
  const st = { settings: { tz: SP }, tasks: [{ id: 'c1', title: 'Corrida', date: '2026-11-10', start: 18 * 60 + 30, end: 19 * 60 + 30, status: 'pendente' }, { id: 'l1', title: 'Pagar a luz', date: '2026-11-10', start: 9 * 60, tag: 'Lembrete', status: 'pendente' }] } as any;
  const antes = dueNotices(st, at('2026-11-10', '18:20'), new Set()).filter((n) => n.tag === 't-c1');
  const hora = dueNotices(st, at('2026-11-10', '18:35'), new Set()).filter((n) => n.tag === 't-c1');
  const lemb = dueNotices(st, at('2026-11-10', '09:00'), new Set()).filter((n) => n.tag === 't-l1');
  assert.ok(antes.length && antes.every((n) => n.task === 'c1'));
  assert.ok(hora.length && hora.every((n) => n.task === 'c1'));
  assert.ok(lemb.length && lemb.every((n) => n.task === 'l1'));
  const manha = dueNotices(st, at('2026-11-10', '07:31'), new Set()).filter((n) => n.tag === 'manha');
  assert.ok(manha.every((n) => !n.task), 'resumo da manhã não tem botões');
});

test('"não fiz": não cobra mais e a sequência recomeça', async () => {
  const { doneStreak } = await import('../supabase/functions/_shared/plan.ts');
  const tasks = [
    { id: 'a1', title: 'Academia', date: '2026-11-08', start: 18 * 60, end: 19 * 60, status: 'feito' },
    { id: 'a2', title: 'Academia', date: '2026-11-09', start: 18 * 60, end: 19 * 60, status: 'feito' },
    { id: 'a3', title: 'Academia', date: '2026-11-10', start: 18 * 60, end: 19 * 60, status: 'pendente' },
  ];
  const st = { settings: { tz: SP }, tasks } as any;
  assert.equal(doneStreak(tasks as any, 'Academia', '2026-11-10'), 2);
  assert.ok(dueNotices(st, at('2026-11-10', '18:05'), new Set()).some((n) => n.tag === 't-a3'), 'aberta: cobra na hora');
  tasks[2].status = 'naofeito';
  assert.equal(doneStreak(tasks as any, 'Academia', '2026-11-10'), 0);
  for (const h of ['17:55', '18:05', '19:05']) assert.equal(dueNotices(st, at('2026-11-10', h), new Set()).filter((n) => n.tag === 't-a3').length, 0, `sem aviso às ${h}`);
  assert.equal(missedStreak([...tasks, { id: 'a4', title: 'Academia', date: '2026-11-11', status: 'pendente' }] as any, 'Academia', '2026-11-11'), 1, 'conta como furo');
});
