// Decide quais avisos mandar agora para uma pessoa, a partir do estado salvo pelo app.
// Função pura: roda no servidor (Deno) e nos testes (Node). Sem dependências.

export type Task = {
  id: string;
  title: string;
  date: string; // AAAA-MM-DD, horário local da pessoa
  start?: number; // minutos desde 00:00
  end?: number;
  status?: string; // 'pendente' | 'andamento' | 'feito'
  tag?: string; // 'Lembrete' = avisar na hora exata
};

export type NotifySettings = {
  enabled?: boolean; // avisos ligados no app
  lead?: number; // minutos antes de cada atividade (padrão 10)
  morning?: string | null; // 'HH:MM' ou null (desligado)
  night?: string | null; // 'HH:MM' ou null (desligado)
};

export type AppState = {
  name?: string;
  tasks?: Task[];
  settings?: { tz?: string; notify?: NotifySettings };
};

export type Notice = { key: string; title: string; body: string; url: string; tag: string };

const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const hhmm = (s: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? +m[1] * 60 + +m[2] : null;
};

/** Data (AAAA-MM-DD) e minuto do dia no fuso da pessoa. */
export function localNow(now: Date, tz: string): { date: string; min: number } {
  let parts: Record<string, string> = {};
  try {
    for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)) parts[p.type] = p.value;
  } catch {
    return localNow(now, 'America/Sao_Paulo');
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: (+parts.hour % 24) * 60 + +parts.minute };
}

function joinPt(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' e ' + xs[xs.length - 1];
}
const lcFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const range = (t: Task) => (t.start == null ? '' : t.end != null && t.end > t.start ? `${fmt(t.start)}–${fmt(t.end)}` : fmt(t.start));
const byTime = (a: Task, b: Task) => (a.start ?? 9999) - (b.start ?? 9999);
/** Escolhe sempre a mesma variação de texto para a mesma tarefa (0, 1 ou 2). */
const pick = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 3; };

/** Avisos devidos agora. `sent` = chaves já enviadas (para nunca repetir). */
export function dueNotices(state: AppState, now: Date, sent: Set<string>): Notice[] {
  const ns = state.settings?.notify ?? {};
  if (ns.enabled === false) return [];
  const tz = state.settings?.tz || 'America/Sao_Paulo';
  const { date, min } = localNow(now, tz);
  const lead = Math.max(0, Math.min(120, Number.isFinite(ns.lead as number) ? (ns.lead as number) : 10));
  const today = (state.tasks ?? []).filter((t) => t && t.date === date).sort(byTime);
  const open = today.filter((t) => t.status !== 'feito');
  const out: Notice[] = [];
  const add = (n: Notice) => { if (!sent.has(n.key)) out.push(n); };

  // 1. Cada atividade com horário. Como uma governanta: avisa antes, cobra na hora e, se for lembrete, insiste.
  for (const t of open) {
    if (t.start == null) continue;
    const isReminder = t.tag === 'Lembrete';
    const name = lcFirst(t.title);
    const v = pick(t.id);
    const next = open.find((o) => o.start != null && o.start > t.start! && o.id !== t.id);
    const url = `./?t=${encodeURIComponent(t.id)}`, tag = `t-${t.id}`;
    const base = `t:${t.id}:${t.date}:${t.start}`;
    if (isReminder) {
      // na hora exata
      if (min >= t.start && min < t.start + 30)
        add({ key: `${base}:r`, title: `Lembrete: ${t.title}`, body: ['Agora é a hora! Toque para marcar como feito ou adiar.', 'Não deixa pra depois 😉 Toque para marcar como feito.', 'Bora resolver isso agora? Toque para marcar como feito.'].at(v)!, url, tag });
      // ainda não fez? insiste uma vez
      else if (min >= t.start + 30 && min < t.start + 60)
        add({ key: `${base}:r2`, title: ['Ainda não deu? 👀', 'Psiu, esqueceu de mim? 🙃', 'Só passando pra lembrar de novo 🙏'].at(v)!, body: `${t.title}. Toque para marcar como feito ou adiar.`, url, tag });
      continue;
    }
    // antes de começar
    if (min >= t.start - lead && min < t.start) {
      const left = t.start - min;
      add({
        key: `${base}:${lead}`,
        title: `${t.title} em ${left} min ⏰`,
        body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''} ${['Já vai se preparando!', 'Te aviso de novo na hora.', 'Separa o que precisa e bora!'].at(v)}`,
        url, tag,
      });
    }
    // na hora: se ainda não marcou como feito
    else if (min >= t.start && min < t.start + 20 && t.status !== 'andamento') {
      add({ key: `${base}:s`, title: [`Hora de ${name}! 💪`, `Começou: ${name} 🚀`, `${t.title} agora! Bora?`].at(v)!, body: `${range(t)}. Toque para marcar como feito ou adiar 15 min.`, url, tag });
    }
  }

  // 2. Resumo da manhã (padrão 07:30), com até 1 hora de tolerância.
  const morning = ns.morning === null ? null : hhmm(ns.morning ?? '07:30');
  if (morning != null && min >= morning && min < morning + 60) {
    const first = (state.name || '').trim().split(/\s+/)[0];
    const items = open.map((t) => (t.start != null ? `${lcFirst(t.title)} às ${fmt(t.start)}` : lcFirst(t.title)));
    const shown = items.slice(0, 4);
    const body = items.length
      ? `Hoje: ${joinPt(shown)}${items.length > 4 ? ` e mais ${items.length - 4}` : ''}.`
      : 'Seu dia está livre. Me conte o que você precisa fazer e eu organizo.';
    add({ key: `m:${date}`, title: `Bom dia${first ? ', ' + first : ''} ☀️`, body: items.length ? body + ' Vamos nessa?' : body, url: './', tag: 'manha' });
  }

  // 3. Revisão da noite (padrão 21:00): só se houve algo no dia.
  const night = ns.night === null ? null : hhmm(ns.night ?? '21:00');
  if (night != null && min >= night && min < night + 60 && today.length) {
    const done = today.length - open.length;
    const pend = open.map((t) => lcFirst(t.title));
    const body = pend.length
      ? `Você fez ${done} de ${today.length}. Ficou pendente: ${joinPt(pend.slice(0, 3))}${pend.length > 3 ? ` e mais ${pend.length - 3}` : ''}. Toque para remarcar.`
      : `Você fez tudo o que planejou hoje 🎉`;
    add({ key: `n:${date}`, title: pend.length ? 'Como foi seu dia?' : 'Dia concluído', body, url: './?v=noite', tag: 'noite' });
  }
  return out;
}
