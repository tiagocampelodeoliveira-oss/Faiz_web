// Função do app: IA, inscrição dos avisos, aviso de teste e configurações públicas.
// Publicada com --no-verify-jwt: a pessoa é conferida aqui, pelo token, em getUser().
import { cors, getUser, json, rest, vapid } from '../_shared/env.ts';
import { sendPush, type Subscription } from '../_shared/webpush.ts';
import { falar, ttsLigado } from '../_shared/tts.ts';
import { GRATIS_POR_DIA, localNow, planoDe, type PlanoInfo } from '../_shared/plan.ts';
import { aplicarAcao, confere, segredoAcoes } from '../_shared/acoes.ts';
import { buildIcs } from '../_shared/ics.ts';

const AI_DAILY_LIMIT = 40;
const MODEL = Deno.env.get('FAIZ_AI_MODEL') || 'claude-sonnet-5-5';
const FALLBACK_MODEL = 'claude-haiku-5-5';

/** Dono do teste ou pessoa liberada pelo Tiago: sem limite de 7 dias nem de 40 pedidos por dia. */
async function semLimite(userId: string): Promise<boolean> {
  const [o, u] = await Promise.all([rest(`owners?user_id=eq.${userId}&select=user_id`), rest(`unlimited?user_id=eq.${userId}&select=user_id`)]);
  return !!(o?.length || u?.length);
}

/** Plano da pessoa (Grátis, Plus, teste de 7 dias ou liberada). */
async function planoUser(userId: string): Promise<PlanoInfo> {
  const [livre, row, esc] = await Promise.all([
    semLimite(userId),
    rest(`states?user_id=eq.${userId}&select=start:data->>startDate,tz:data->settings->>tz`).then((r: any) => r?.[0]),
    rest(`planos?user_id=eq.${userId}&select=escolha`).then((r: any) => r?.[0]?.escolha ?? null).catch(() => null),
  ]);
  return planoDe({ startDate: row?.start, escolha: esc, livre, now: new Date(), tz: row?.tz || 'America/Sao_Paulo' });
}

/** A pessoa escolhe o plano. Plus = reserva do preço (a cobrança ainda não existe) e avisa o dono. */
async function escolher(userId: string, plano: unknown, nome: unknown): Promise<Response> {
  if (plano !== 'plus' && plano !== 'gratis') return json({ error: 'bad_request' }, 400);
  const antes = await planoUser(userId);
  if (antes.plano === 'livre') return json({ plano: antes });
  await rest('planos?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: userId, escolha: plano, preco: antes.preco, fundador: antes.fundador, nome: String(nome || '').slice(0, 40), escolhido_em: new Date().toISOString() }) });
  if (plano === 'plus' && antes.escolha !== 'plus') {
    const n = String(nome || 'Alguém').split(' ')[0].slice(0, 30);
    await notifyOwners(`owner:plus:${userId}`, { title: `${n} reservou o Plus 🎉`, body: `R$ ${(antes.preco / 100).toFixed(2).replace('.', ',')} por mês${antes.fundador ? ' (preço de fundador)' : ''}. A cobrança começa quando o Mercado Pago for ligado.`, url: './', tag: 'plus' }).catch(() => {});
  }
  return json({ plano: await planoUser(userId) });
}

async function ai(userId: string, prompt: unknown, system: unknown, modelo?: unknown): Promise<Response> {
  if (typeof prompt !== 'string' || !prompt.trim()) return json({ error: 'bad_request' }, 400);
  const pl = await planoUser(userId);
  const livre = pl.plano === 'livre';
  // Grátis: só a Íris rápida, 5 mensagens por dia
  const gratis = pl.plano === 'gratis';
  if (gratis) modelo = 'rapida';
  const key = Deno.env.get('FAIZ_ANTHROPIC_KEY');
  if (!key) return json({ error: 'ai_off' }, 503);
  const day = new Date().toISOString().slice(0, 10);
  const rows = await rest(`usage?user_id=eq.${userId}&day=eq.${day}&select=n`);
  const n = rows?.[0]?.n ?? 0;
  if (gratis && n >= GRATIS_POR_DIA) return json({ error: 'free_limit', limite: GRATIS_POR_DIA }, 429);
  if (n >= AI_DAILY_LIMIT && !livre) return json({ error: 'limit' }, 429);
  await rest('usage?on_conflict=user_id,day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: userId, day, n: n + 1 }) });
  const call = (model: string) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      // 3000: planos grandes (várias rotinas, contas e tarefas numa frase) passavam de 1500 e chegavam cortados.
      max_tokens: 3000,
      // A parte fixa (persona, formato e regras) vai em cache: a partir do 2º pedido em 5 min, sai ~90% mais barata.
      ...(typeof system === 'string' && system.trim() ? { system: [{ type: 'text', text: system.slice(0, 20000), cache_control: { type: 'ephemeral' } }] } : {}),
      messages: [{ role: 'user', content: prompt.slice(0, 16000) }],
    }),
  });
  const t0 = Date.now();
  // "rapida" (pedidos simples, escolhido pelo app): Haiku primeiro, ~16x mais barato; se falhar, a completa.
  const [primeiro, reserva] = modelo === 'rapida' ? [FALLBACK_MODEL, gratis ? FALLBACK_MODEL : MODEL] : [MODEL, FALLBACK_MODEL];
  let usado = primeiro;
  let res = await call(primeiro);
  // Se o modelo escolhido falhar (fora do ar, sobrecarregado), tenta o outro antes de desistir.
  if (!res.ok && res.status !== 400 && res.status !== 401) { console.error('anthropic main', res.status); usado = reserva; res = await call(reserva); }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    await aiLog(userId, { model: usado, status: res.status, ms: Date.now() - t0, err: t.slice(0, 200) });
    console.error('anthropic', res.status, t.slice(0, 300));
    if (/credit balance|billing|insufficient/i.test(t)) { await creditEmpty(); return json({ error: 'no_credit' }, 402); }
    return json({ error: res.status === 429 ? 'busy' : 'ai_error', status: res.status }, 502);
  }
  await creditOk();
  const out = await res.json();
  const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  const u = out.usage || {};
  // stop = "max_tokens" quer dizer que a resposta foi cortada; o app usa isso para contar o motivo da falha.
  if (out.stop_reason === 'max_tokens') console.error('anthropic cortada', u.output_tokens || 0);
  await aiLog(userId, { model: out.model || usado, status: 200, stop: out.stop_reason || '', ms: Date.now() - t0, out_tokens: u.output_tokens || 0 });
  return json({ text, stop: out.stop_reason || '', model: out.model || '', cache: { read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0, input: u.input_tokens || 0 } });
}

/** Google (Agenda, Contatos, Gmail): guarda a chave de renovação e devolve chaves temporárias ao app.
    O conteúdo (eventos, contatos, e-mails) vai direto do Google para o celular; o servidor nunca vê. */
const GOOGLE_ID = () => Deno.env.get('FAIZ_GOOGLE_ID') || '';
const GOOGLE_SECRET = () => Deno.env.get('FAIZ_GOOGLE_SECRET') || '';
async function googleSave(userId: string, refresh: unknown, scopes: unknown): Promise<Response> {
  if (typeof refresh !== 'string' || refresh.length < 10) return json({ error: 'bad_request' }, 400);
  await rest('google_tokens?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: userId, refresh_token: refresh, scopes: String(scopes || '').slice(0, 500), updated_at: new Date().toISOString() }) });
  return json({ ok: true });
}
async function googleToken(userId: string): Promise<Response> {
  if (!GOOGLE_ID() || !GOOGLE_SECRET()) return json({ error: 'google_off' }, 503);
  const row = (await rest(`google_tokens?user_id=eq.${userId}&select=refresh_token,scopes`))?.[0];
  if (!row) return json({ error: 'google_none' }, 404);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_ID(), client_secret: GOOGLE_SECRET(), refresh_token: row.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // a pessoa tirou a permissão no Google: apaga e o app pede para ligar de novo
    if (j.error === 'invalid_grant') { await rest(`google_tokens?user_id=eq.${userId}`, { method: 'DELETE' }); return json({ error: 'google_revoked' }, 401); }
    return json({ error: 'google_error', status: r.status }, 502);
  }
  return json({ access_token: j.access_token, expires_in: j.expires_in || 3600, scopes: j.scope || row.scopes || '' });
}

/** Registro da chamada à IA (sem conteúdo), para achar falhas, cortes e lentidão. Nunca derruba o pedido. */
async function aiLog(userId: string, v: { model: string; status: number; stop?: string; ms: number; out_tokens?: number; err?: string }): Promise<void> {
  try { await rest('ai_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, ...v }) }); } catch (e) { console.error('ai_log', e); }
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
    try { await rest('push_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, kind: 'teste', host: new URL(s.endpoint).host, status: r.status, ok: r.ok, gone: r.gone }) }); } catch { /* registro não derruba o teste */ }
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

/** Botão do aviso: marca como feita ou adia 15 min, na agenda do servidor (os próximos avisos já saem certos)
    e numa fila que o app aplica quando abrir (push_actions). */
async function pushAct(b: Record<string, any>): Promise<Response> {
  const u = String(b.u || ''), t = String(b.t || ''), a = String(b.a || ''), exp = Number(b.exp);
  if (!/^[0-9a-f-]{36}$/.test(u) || !t || t.length > 120 || !['feito', 'adiar'].includes(a)) return json({ error: 'bad_request' }, 400);
  if (!(await confere(segredoAcoes(), u, t, exp, String(b.sig || '')))) return json({ error: 'forbidden' }, 403);
  const [st] = await rest(`states?user_id=eq.${u}&select=data`);
  const r = st?.data ? aplicarAcao(st.data, t, a, new Date()) : null;
  if (!r) return json({ error: 'not_found' }, 404);
  // só a lista de tarefas muda no servidor; o resto do estado continua como o app mandou
  await rest(`states?user_id=eq.${u}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: r.data }) });
  await rest('push_actions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u, task_id: t, action: a, date: r.mudou?.date ?? null, start_min: r.mudou?.start ?? null, end_min: r.mudou?.end ?? null }) });
  return json({ ok: true, title: r.title, body: r.body });
}

/** O que a pessoa fez pelos botões do aviso e o app ainda não aplicou (entrega uma vez só). */
async function acoesPendentes(userId: string): Promise<Response> {
  const rows: { id: number; task_id: string; action: string; date: string | null; start_min: number | null; end_min: number | null }[] =
    await rest(`push_actions?user_id=eq.${userId}&applied_at=is.null&select=id,task_id,action,date,start_min,end_min&order=id.asc&limit=50`);
  if (!rows?.length) return json({ acoes: [] });
  await rest(`push_actions?id=in.(${rows.map((r) => r.id).join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ applied_at: new Date().toISOString() }) });
  return json({ acoes: rows.map((r) => ({ task_id: r.task_id, action: r.action, date: r.date, start: r.start_min, end: r.end_min })) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    // Calendário assinado: o app do Calendário busca aqui, sem login, pelo link secreto.
    const tk = new URL(req.url).searchParams.get('cal') || '';
    if (!/^[a-f0-9]{40}$/.test(tk)) return new Response('not found', { status: 404 });
    try {
      const [f] = await rest(`cal_feeds?token=eq.${tk}&select=user_id`);
      if (!f) return new Response('not found', { status: 404 });
      const [st] = await rest(`states?user_id=eq.${f.user_id}&select=data`);
      const data = st?.data || {};
      const { date } = localNow(new Date(), data.settings?.tz || 'America/Sao_Paulo');
      rest(`cal_feeds?user_id=eq.${f.user_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_fetch: new Date().toISOString() }) }).catch(() => {});
      // desde 5/11 o Faiz não manda mais nada para o calendário (decisão do Tiago): quem assinou recebe o calendário vazio
      return new Response(buildIcs({}, date), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="faiz.ics"' } });
    } catch (e) { console.error('cal', e); return new Response('erro', { status: 500 }); }
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const action = String(body.action || '');
  try {
    if (action === 'config') {
      return json({ vapidPublicKey: vapid().keys.publicKey, whatsapp: Deno.env.get('FAIZ_WHATSAPP') || '', ai: !!Deno.env.get('FAIZ_ANTHROPIC_KEY'), tts: ttsLigado(), google: !!(GOOGLE_ID() && GOOGLE_SECRET()), aiCredit: !(await aiCreditEmpty()) });
    }
    // botões do aviso (Feito / Adiar): sem login, vale a assinatura que foi junto no aviso
    if (action === 'pushact') return await pushAct(body);
    const user = await getUser(req);
    if (!user) return json({ error: 'auth' }, 401);
    if (action === 'acoes') return await acoesPendentes(user.id);
    if (action === 'plano') return json({ plano: await planoUser(user.id) });
    if (action === 'escolher') return await escolher(user.id, body.plano, body.nome);
    if (action === 'ai') return await ai(user.id, body.prompt, body.system, body.modelo);
    if (action === 'subscribe') return await subscribe(user.id, body.subscription, req.headers.get('user-agent') || '');
    if (action === 'test') return await testPush(user.id);
    if (action === 'nearby') return await nearby(body);
    if (action === 'owner') return await becomeOwner(user.id, body.whatsapp);
    if (action === 'report') return await report(user.id, body.text, body.ctx, body.name);
    if (action === 'calfeed') {
      // link secreto do calendário (cria na primeira vez); "novo": troca o link (o antigo para de funcionar)
      return json({ error: 'removido' }, 410); // o Faiz não manda mais nada para o calendário do celular
      if (body.novo) await rest(`cal_feeds?user_id=eq.${user.id}`, { method: 'DELETE' });
      let [f] = await rest(`cal_feeds?user_id=eq.${user.id}&select=token`);
      if (!f) {
        const token = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
        await rest('cal_feeds', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: user.id, token }) });
        f = { token };
      }
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/api?cal=${f.token}`;
      return json({ url, webcal: url.replace(/^https:/, 'webcal:') });
    }
    if (action === 'calstop') { await rest(`cal_feeds?user_id=eq.${user.id}`, { method: 'DELETE' }); return json({ ok: true }); }
    if (action === 'gsave') return await googleSave(user.id, body.refresh_token, body.scopes);
    if (action === 'gtoken') { if ((await planoUser(user.id)).plano === 'gratis') return json({ error: 'plus_only' }, 403); return await googleToken(user.id); }
    if (action === 'gforget') { await rest(`google_tokens?user_id=eq.${user.id}`, { method: 'DELETE' }); return json({ ok: true }); }
    if (action === 'tts' && (await planoUser(user.id)).plano === 'gratis') return json({ error: 'plus_only' }, 403);
    if (action === 'tts') {
      // Voz da Íris no chat de voz: devolve o MP3 (o app cai na voz do celular se der erro)
      try {
        const mp3 = await falar(String(body.text || ''));
        return new Response(mp3, { headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
      } catch (e) {
        console.error('tts', e);
        return json({ error: 'tts', message: String((e as Error)?.message || e).slice(0, 100) }, 502);
      }
    }
    if (action === 'me') {
      const plano = await planoUser(user.id);
      // trialOver fica para versões antigas do app (elas pausam a IA); a nova usa o plano
      return json({ owner: !!(await rest(`owners?user_id=eq.${user.id}&select=user_id`))?.length, aiCredit: !(await aiCreditEmpty()), trialOver: plano.plano === 'gratis', plano });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error(action, e);
    return json({ error: 'server', message: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
