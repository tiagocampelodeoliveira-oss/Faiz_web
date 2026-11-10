// Botões do aviso ("Feito" e "Adiar 15 min"): o celular manda direto ao servidor, sem abrir o app.
// Cada aviso leva uma assinatura (HMAC) da pessoa + atividade, que vale por 2 dias: sem login no service worker.
import { localNow, type AppState } from './plan.ts';

const enc = new TextEncoder();

/** Chave das assinaturas: derivada da chave VAPID (nasce uma vez e não muda a cada publicação, ao contrário do segredo do relógio). */
export const segredoAcoes = () => { const v = Deno.env.get('FAIZ_VAPID_PRIVATE') || ''; return v ? 'acoes:' + v : ''; };
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function assinar(secret: string, u: string, t: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${u}|${t}|${exp}`)));
}

export async function confere(secret: string, u: string, t: string, exp: number, sig: string, now = Date.now()): Promise<boolean> {
  if (!secret || !u || !t || !Number.isFinite(exp) || exp < now || typeof sig !== 'string') return false;
  const ok = await assinar(secret, u, t, exp);
  if (ok.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < ok.length; i++) d |= ok.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Aplica o botão na agenda guardada no servidor (para os próximos avisos já saírem certos).
 * "feito": marca como feita. "adiar": 15 min depois de agora (ou do começo, se ainda não começou), mesma duração.
 * Devolve o que mudou (o app aplica igual quando abrir) e o texto da confirmação.
 */
export function aplicarAcao(data: AppState, taskId: string, acao: string, now: Date): { data: AppState; mudou: { date: string; start?: number; end?: number } | null; title: string; body: string } | null {
  const tasks = (data.tasks ?? []).slice();
  const i = tasks.findIndex((t) => t && t.id === taskId);
  if (i < 0) return null;
  const t = { ...tasks[i] };
  if (acao === 'feito') {
    if (t.status !== 'feito') t.status = 'feito';
    tasks[i] = t;
    return { data: { ...data, tasks }, mudou: { date: t.date, start: t.start, end: t.end }, title: 'Feito! ✅', body: `${t.title} riscada da lista. Orgulho 💜` };
  }
  if (acao === 'adiar') {
    if (t.start == null) return null;
    const { date, min } = localNow(now, data.settings?.tz || 'America/Sao_Paulo');
    const base = t.date === date ? Math.max(t.start, min) : t.start;
    const start = Math.min(base + 15, 23 * 60 + 45);
    const dur = t.end != null && t.end > t.start ? t.end - t.start : 30;
    t.start = start; t.end = Math.min(start + dur, 23 * 60 + 59);
    tasks[i] = t;
    return { data: { ...data, tasks }, mudou: { date: t.date, start: t.start, end: t.end }, title: 'Adiado ⏰', body: `${t.title} agora às ${fmt(start)}. Te aviso de novo antes, hein!` };
  }
  return null;
}
