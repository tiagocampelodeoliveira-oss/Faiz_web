// Roda a cada minuto (pg_cron). Lê a agenda de cada pessoa e manda os avisos devidos.
// Protegida por um segredo no cabeçalho x-tick-secret (publicada com --no-verify-jwt).
import { json, rest, vapid } from '../_shared/env.ts';
import { dueNotices, voltaLer, voltaPrompt, type AppState, type Notice } from '../_shared/plan.ts';
import { sendPush } from '../_shared/webpush.ts';

/** Resultado de cada aviso (sem o texto), para achar quem parou de receber e por quê. Nunca derruba o relógio. */
async function pushLog(userId: string, kind: string, endpoint: string, r: { ok: boolean; status: number; gone: boolean }): Promise<void> {
  try { await rest('push_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, kind, host: new URL(endpoint).host, status: r.status, ok: r.ok, gone: r.gone }) }); } catch (e) { console.error('push_log', e); }
}

/** Aviso de volta: a IA escreve com a situação da pessoa. Em até 12 s; se falhar, fica o texto pronto. Registra em ai_log (sem conteúdo). */
async function voltaIA(userId: string, n: Notice): Promise<void> {
  const key = Deno.env.get('FAIZ_ANTHROPIC_KEY');
  if (!key || !n.ia) return;
  const { system, user } = voltaPrompt(n.ia);
  const model = Deno.env.get('FAIZ_AI_MODEL') || 'claude-sonnet-5-5';
  const t0 = Date.now();
  let status = 0, err = '', stop = '', out_tokens = 0;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: 'user', content: user }] }),
    });
    status = res.status;
    if (!res.ok) err = (await res.text().catch(() => '')).slice(0, 200);
    else {
      const out = await res.json();
      stop = out.stop_reason || ''; out_tokens = out.usage?.output_tokens || 0;
      const txt = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
      const v = voltaLer(txt);
      if (v) { n.title = v.title; n.body = v.body; } else err = 'formato';
    }
  } catch (e) { err = String((e as Error)?.message || e).slice(0, 200); }
  try { await rest('ai_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, model: `volta:${model}`, status, stop, ms: Date.now() - t0, out_tokens, err: err || null }) }); } catch (e) { console.error('ai_log', e); }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('FAIZ_TICK_SECRET');
  if (!secret || req.headers.get('x-tick-secret') !== secret) return json({ error: 'forbidden' }, 403);
  const now = new Date();
  const { keys, subject } = vapid();
  const summary = { users: 0, due: 0, sent: 0, failed: 0, removed: 0, errors: [] as string[] };
  try {
    const subs: { endpoint: string; user_id: string; p256dh: string; auth: string }[] = await rest('subs?select=endpoint,user_id,p256dh,auth');
    if (!subs.length) return json(summary);
    const byUser = new Map<string, typeof subs>();
    for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]);
    const ids = [...byUser.keys()];
    const states: { user_id: string; data: AppState }[] = await rest(`states?select=user_id,data&user_id=in.(${ids.join(',')})`);
    const since = new Date(now.getTime() - 3 * 864e5).toISOString();
    const sentRows: { user_id: string; key: string }[] = await rest(`sent?select=user_id,key&created_at=gte.${since}&user_id=in.(${ids.join(',')})`);
    const sentBy = new Map<string, Set<string>>();
    for (const r of sentRows) { if (!sentBy.has(r.user_id)) sentBy.set(r.user_id, new Set()); sentBy.get(r.user_id)!.add(r.key); }

    for (const st of states) {
      summary.users++;
      const due = dueNotices(st.data || {}, now, sentBy.get(st.user_id) || new Set());
      if (!due.length) continue;
      summary.due += due.length;
      // Marca como enviado ANTES de mandar: se duas rodadas se cruzarem, só uma ganha a chave.
      const won: { key: string }[] = await rest('sent?on_conflict=user_id,key', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(due.map((n) => ({ user_id: st.user_id, key: n.key }))),
      });
      const mine = new Set((won || []).map((w) => w.key));
      for (const n of due.filter((d) => mine.has(d.key))) {
        if (n.ia) await voltaIA(st.user_id, n);
        for (const s of byUser.get(st.user_id) || []) {
          const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: n.title, body: n.body, url: n.url, tag: n.tag }, keys, subject);
          await pushLog(st.user_id, n.key.split(':')[0], s.endpoint, r);
          if (r.ok) summary.sent++;
          else {
            summary.failed++;
            summary.errors.push(`${r.status} ${(r.text || '').slice(0, 120)}`);
            if (r.gone) { await rest(`subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }); summary.removed++; }
          }
        }
      }
    }
    // Avisos pessoais agendados pelo dono (workflow "Mandar aviso"): cada um sai uma vez só.
    const manuais: { id: number; user_id: string; title: string; body: string; url: string }[] =
      await rest(`manual_push?select=id,user_id,title,body,url&sent_at=is.null&send_at=lte.${now.toISOString()}`).catch(() => []);
    for (const m of manuais) {
      const won = await rest(`manual_push?id=eq.${m.id}&sent_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ sent_at: now.toISOString() }) });
      if (!won?.length) continue;
      let ok = 0;
      for (const s of byUser.get(m.user_id) || []) {
        const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: m.title, body: m.body, url: m.url, tag: 'pessoal' }, keys, subject);
        await pushLog(m.user_id, 'manual', s.endpoint, r);
        if (r.ok) { ok++; summary.sent++; } else { summary.failed++; if (r.gone) { await rest(`subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }); summary.removed++; } }
      }
      await rest(`manual_push?id=eq.${m.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ entregues: ok }) });
    }
    if (now.getUTCMinutes() === 7) await rest(`sent?created_at=lt.${new Date(now.getTime() - 7 * 864e5).toISOString()}`, { method: 'DELETE' });
  } catch (e) {
    console.error('tick', e);
    summary.errors.push(String((e as Error)?.message || e).slice(0, 200));
    return json(summary, 500);
  }
  if (summary.due) console.log('tick', JSON.stringify(summary));
  return json(summary);
});
