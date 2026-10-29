// Roda a cada minuto (pg_cron). Lê a agenda de cada pessoa e manda os avisos devidos.
// Protegida por um segredo no cabeçalho x-tick-secret (publicada com --no-verify-jwt).
import { json, rest, vapid } from '../_shared/env.ts';
import { dueNotices, type AppState } from '../_shared/plan.ts';
import { sendPush } from '../_shared/webpush.ts';

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
        for (const s of byUser.get(st.user_id) || []) {
          const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: n.title, body: n.body, url: n.url, tag: n.tag }, keys, subject);
          if (r.ok) summary.sent++;
          else {
            summary.failed++;
            summary.errors.push(`${r.status} ${(r.text || '').slice(0, 120)}`);
            if (r.gone) { await rest(`subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }); summary.removed++; }
          }
        }
      }
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
