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
  /** Dia em que a pessoa começou a usar (AAAA-MM-DD): conta os dias do teste. */
  startDate?: string;
  /** Respostas da pesquisa do teste (dia 3 e dia 7). */
  survey?: { d3?: unknown; d7?: unknown };
  tasks?: Task[];
  settings?: { tz?: string; notify?: NotifySettings };
  /** Caderno de contas: contas fixas e quais já foram pagas (chave "id:AAAA-MM"). Valores em centavos. */
  fin?: { fixas?: Bill[]; pagas?: Record<string, unknown> };
};

export type Bill = { id: string; tipo: 'conta' | 'renda'; nome: string; valor: number; dia: number; desde?: string; ate?: string };

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

/** Dia anterior (AAAA-MM-DD) n dias antes. */
const daysBefore = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** Quantos dias seguidos (antes de hoje) a pessoa deixou de fazer uma atividade com o mesmo nome. */
export function missedStreak(tasks: Task[], title: string, date: string): number {
  const n = norm(title);
  let streak = 0;
  for (let i = 1; i <= 7; i++) {
    const d = daysBefore(date, i);
    const same = tasks.filter((t) => t.date === d && norm(t.title) === n);
    if (!same.length || same.some((t) => t.status === 'feito')) break;
    streak++;
  }
  return streak;
}

/** Vezes seguidas que a pessoa cumpriu esta atividade (dias sem ela não contam; hoje ainda não feito não quebra). */
export function doneStreak(tasks: Task[], title: string, date: string): number {
  const n = norm(title);
  const byDay = new Map<string, boolean>();
  for (const t of tasks) if (t && t.date <= date && norm(t.title) === n) byDay.set(t.date, (byDay.get(t.date) ?? false) || t.status === 'feito');
  let k = 0, last = date;
  for (const d of [...byDay.keys()].sort().reverse()) {
    if ((Date.parse(last) - Date.parse(d)) / 864e5 > 8) break;
    if (byDay.get(d)) k++;
    else if (d !== date) break;
    last = d;
  }
  return k;
}

const brl = (c: number) => `R$ ${Math.floor(Math.abs(c) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(Math.abs(Math.round(c)) % 100).padStart(2, '0')}`;
const monthAdd = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const dueOf = (dia: number, m: string) => { const [y, mo] = m.split('-').map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return `${m}-${pad(Math.min(Math.max(1, Math.round(dia)), last))}`; };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

/** As falas da Íris nos avisos: amiga direta que cobra com humor. Variações escolhidas por tarefa (pick). */
const IRIS = {
  antes: ['Já vai se mexendo, que eu tô de olho 👀', 'Nem pensa em furar, hein.', 'Levanta daí que tá chegando a hora!'],
  naHora: (t: string) => [`Tá de sacanagem? ${t} era agora 🙄`, `Deixa de enrolação: ${t} começou!`, `Ô, cadê você? ${t} já começou 😤`],
  furando: (k: number) => ` ${k} dias furando. Hoje não tem desculpa!`,
  lembrete: 'Agora, não amanhã. Toque para marcar como feito.',
  insiste: ['Vai me ignorar mesmo? 🙄', 'Ainda não fez? Sério? 😤', 'Tô esperando, viu? 😤'],
  bomDia: ' Levanta que o dia não espera!',
  sequencia: (k: number) => ` 🔥 ${k} seguidas. Não vai quebrar agora, né?`,
};

/** Avisos devidos agora. `sent` = chaves já enviadas (para nunca repetir). */
export function dueNotices(state: AppState, now: Date, sent: Set<string>): Notice[] {
  const ns = state.settings?.notify ?? {};
  if (ns.enabled === false) return [];
  const tz = state.settings?.tz || 'America/Sao_Paulo';
  const { date, min } = localNow(now, tz);
  const lead = Math.max(0, Math.min(120, Number.isFinite(ns.lead as number) ? (ns.lead as number) : 10));
  const today = (state.tasks ?? []).filter((t) => t && t.date === date).sort(byTime);
  const open = today.filter((t) => t.status !== 'feito');
  const all = state.tasks ?? [];
  const out: Notice[] = [];
  const add = (n: Notice) => { if (!sent.has(n.key)) out.push(n); };

  // 1. Cada atividade com horário. Como uma governanta: avisa antes, cobra na hora e, se for lembrete, insiste.
  for (const t of open) {
    if (t.start == null) continue;
    const isReminder = t.tag === 'Lembrete';
    const v = pick(t.id);
    const next = open.find((o) => o.start != null && o.start > t.start! && o.id !== t.id);
    const url = `./?t=${encodeURIComponent(t.id)}`, tag = `t-${t.id}`;
    const base = `t:${t.id}:${t.date}:${t.start}`;
    if (isReminder) {
      // na hora exata
      if (min >= t.start && min < t.start + 30)
        add({ key: `${base}:r`, title: `Lembrete: ${t.title}`, body: IRIS.lembrete, url, tag });
      // ainda não fez? insiste uma vez
      else if (min >= t.start + 30 && min < t.start + 60)
        add({ key: `${base}:r2`, title: IRIS.insiste.at(v)!, body: `${t.title}. Toque para marcar como feito ou adiar.`, url, tag });
      continue;
    }
    // antes de começar
    if (min >= t.start - lead && min < t.start) {
      const left = t.start - min;
      add({
        key: `${base}:${lead}`,
        title: `${t.title} em ${left} min ⏰`,
        body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''} ${(() => { const k = doneStreak(all, t.title, t.date); return k >= 2 ? IRIS.sequencia(k).trim() : IRIS.antes.at(v); })()}`,
        url, tag,
      });
    }
    // na hora: se ainda não marcou como feito
    else if (min >= t.start && min < t.start + 20 && t.status !== 'andamento') {
      const k = missedStreak(all, t.title, t.date);
      add({ key: `${base}:s`, title: IRIS.naHora(t.title).at(v)!, body: `${range(t)}. Toque para marcar como feito ou adiar 15 min.${k >= 2 ? IRIS.furando(k) : ''}`, url, tag });
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
      : 'Seu dia está livre. Me conta o que você precisa e eu organizo.';
    add({ key: `m:${date}`, title: `Bom dia${first ? ', ' + first : ''}! ☀️`, body: items.length ? body + IRIS.bomDia : body, url: './', tag: 'manha' });
  }

  // 3. Revisão da noite (padrão 21:00): só se houve algo no dia.
  const night = ns.night === null ? null : hhmm(ns.night ?? '21:00');
  if (night != null && min >= night && min < night + 60 && today.length) {
    const done = today.length - open.length;
    const pend = open.map((t) => lcFirst(t.title));
    const lista = `${joinPt(pend.slice(0, 3))}${pend.length > 3 ? ` e mais ${pend.length - 3}` : ''}`;
    let title: string, body: string;
    if (!pend.length) { title = 'Arrasou! 🎉'; body = `Você fez tudo hoje (${done} de ${today.length}). Orgulho!`; }
    else { title = 'Hora da verdade 😤'; body = done ? `${done} de ${today.length}. Ficou pra trás: ${lista}. Amanhã sem desculpa, combinado?` : `Zero de ${today.length} hoje? Ficou tudo pra trás: ${lista}. Amanhã a gente recupera, sem desculpa!`; }
    add({ key: `n:${date}`, title, body, url: './?v=noite', tag: 'noite' });
  }
  // 4. Pesquisa do teste: no 3º e no 7º dia de uso, às 19:00, se ainda não respondeu.
  if (state.startDate && /^\d{4}-\d{2}-\d{2}$/.test(state.startDate) && min >= 19 * 60 && min < 22 * 60) {
    const dias = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(state.startDate + 'T12:00:00Z')) / 864e5);
    if (dias >= 6 && !state.survey?.d7) add({ key: 'q:d7', title: 'Fechamos a semana! 🎉', body: 'Me dá sua nota final? Leva 2 minutos e muda o Faiz de verdade.', url: './?v=pesquisa', tag: 'pesquisa' });
    else if (dias >= 2 && dias < 6 && !state.survey?.d3) add({ key: 'q:d3', title: 'Me ajuda com 1 minutinho? 🙏', body: 'Me conta como tá sendo comigo até agora. São 4 perguntas rápidas.', url: './?v=pesquisa', tag: 'pesquisa' });
  }
  // 5. Contas da casa (caderno): 1 a 3 dias antes, no dia e no dia seguinte se ficou atrasada. Entre 09:00 e 12:00.
  if (min >= 9 * 60 && min < 12 * 60) {
    const pagas = state.fin?.pagas ?? {};
    const cur = date.slice(0, 7);
    for (const b of state.fin?.fixas ?? []) {
      if (!b || b.tipo !== 'conta' || !b.id || !(b.valor > 0) || !(b.dia >= 1)) continue;
      for (const m of [monthAdd(cur, -1), cur, monthAdd(cur, 1)]) {
        if ((b.desde && m < b.desde) || (b.ate && m > b.ate) || pagas[`${b.id}:${m}`]) continue;
        const due = dueOf(b.dia, m), d = dayDiff(date, due);
        const url = './?v=contas', tag = `c-${b.id}`, key = `c:${b.id}:${m}`;
        if (d >= 1 && d <= 3) add({ key: `${key}:pre`, title: `Conta chegando: ${b.nome} 🧾`, body: `${brl(b.valor)} vence ${d === 1 ? 'amanhã' : `em ${d} dias`} (dia ${+due.slice(8)}). Já separa o dinheiro, hein!`, url, tag });
        else if (d === 0) add({ key: `${key}:dia`, title: `Hoje vence: ${b.nome} ⚠️`, body: `${brl(b.valor)}. Pagou? Toque e marque "Paguei" pra eu parar de cobrar.`, url, tag });
        else if (d >= -2 && d <= -1) add({ key: `${key}:atraso`, title: `${b.nome} atrasada 😤`, body: `Venceu dia ${+due.slice(8)} (${brl(b.valor)}). Paga logo, antes dos juros! Já pagou? Marca no Faiz.`, url, tag });
      }
    }
  }
  return out;
}
