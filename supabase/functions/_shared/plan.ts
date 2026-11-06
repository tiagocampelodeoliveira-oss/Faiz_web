// Decide quais avisos mandar agora para uma pessoa, a partir do estado salvo pelo app.
// Função pura: roda no servidor (Deno) e nos testes (Node). Sem dependências.

export type Task = {
  /** 'google' = compromisso que veio do Google Agenda (só leitura): avisa antes, nunca cobra. */
  source?: string;
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
  /** Dias em que a pessoa abriu o Faiz (AAAA-MM-DD). */
  stats?: { days?: string[] };
  /** Caderno de contas: contas fixas e quais já foram pagas (chave "id:AAAA-MM"). Valores em centavos. */
  fin?: { fixas?: Bill[]; pagas?: Record<string, unknown> };
};

export type Bill = { id: string; tipo: 'conta' | 'renda'; nome: string; valor: number; dia: number; desde?: string; ate?: string; freq?: 'mensal' | 'semanal' | 'anual'; mes?: number; dow?: number };

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
/** Compromisso do Google Agenda (não é tarefa do Faiz: não conta furo nem cobra). */
const isGoogle = (t: Task) => t?.source === 'google';
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/**
 * Quantas vezes seguidas (as últimas, antes de hoje) a pessoa deixou de fazer esta atividade.
 * Conta as vezes em que ela estava na agenda (rotina de seg/qua/sex conta 3 furos em uma semana), até 30 dias atrás.
 */
export function missedStreak(tasks: Task[], title: string, date: string): number {
  const n = norm(title);
  const byDay = new Map<string, boolean>();
  for (const t of tasks) if (t && !isGoogle(t) && t.date < date && t.date >= daysBefore(date, 30) && norm(t.title) === n) byDay.set(t.date, (byDay.get(t.date) ?? false) || t.status === 'feito');
  let k = 0;
  for (const d of [...byDay.keys()].sort().reverse()) { if (byDay.get(d)) break; k++; }
  return k;
}

/** Vezes seguidas que a pessoa cumpriu esta atividade (dias sem ela não contam; hoje ainda não feito não quebra). */
export function doneStreak(tasks: Task[], title: string, date: string): number {
  const n = norm(title);
  const byDay = new Map<string, boolean>();
  for (const t of tasks) if (t && !isGoogle(t) && t.date <= date && norm(t.title) === n) byDay.set(t.date, (byDay.get(t.date) ?? false) || t.status === 'feito');
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
/** Vencimentos da conta num mês, igual ao app (src/logic/finance.ts occurrences): mensal, anual (só no mês dela) ou semanal (cada dia da semana). */
export function billOccurrences(b: Bill, m: string): { due: string; occ: string }[] {
  if ((b.desde && m < b.desde) || (b.ate && m > b.ate)) return [];
  if (b.freq === 'anual') return Number(m.slice(5, 7)) === (b.mes || Number((b.desde || m).slice(5, 7))) ? [{ due: dueOf(b.dia, m), occ: m }] : [];
  if (b.freq === 'semanal') {
    const [y, mo] = m.split('-').map(Number), last = new Date(Date.UTC(y, mo, 0)).getUTCDate(), dow = Number.isInteger(b.dow) ? b.dow! : 1, out = [];
    for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === dow) { const due = `${m}-${pad(d)}`; out.push({ due, occ: due }); }
    return out;
  }
  return [{ due: dueOf(b.dia, m), occ: m }];
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

/**
 * As falas da Íris nos avisos. O tom depende de quantas vezes seguidas a pessoa furou a atividade:
 * 0 = animada; 1 ou 2 = firme; 3 ou mais = bronca ("tá de sacanagem?"), como combinado com o Tiago em 3/11.
 * Cada aviso tem 3 textos; a escolha é fixa por tarefa (pick), para variar sem ficar aleatório.
 */
const BRONCA = 3;
const tom = (k: number) => (k >= BRONCA ? 2 : k >= 1 ? 1 : 0);
const IRIS = {
  vespera: (lista: string) => [`Amanhã cedo: ${lista} 🌙`, `Lembrete de amanhã: ${lista} 🌙`, `Amanhã começa cedo: ${lista} 🌙`],
  vesperaCorpo: ['Já deixa tudo separado hoje e dorme cedo, hein.', 'Prepara tudo hoje que amanhã é só ir.', 'Separa o que precisa agora e amanhã não tem desculpa 😉'],
  umaHora: (t: string) => [`Daqui 1 hora: ${t} 🕐`, `Em 1 hora: ${t}. Já vai se organizando`, `${t} daqui a pouco 🕐`],
  antes: [
    ['Já vai se mexendo, que eu tô de olho 👀', 'Bora que tá chegando a hora!', 'Separa o que precisa e vai 💪'],
    ['Da última vez ficou pra trás. Hoje não, hein?', 'Hoje vai, né? Tô contando com você.', 'Nem pensa em furar dessa vez.'],
    ['Já são várias vezes furando. Hoje vai de qualquer jeito 😤', 'Hoje não aceito desculpa, viu?', 'Chega de furar: levanta e vai!'],
  ],
  naHora: (t: string, k: number) => [
    [`Começou: ${t} 🚀`, `Hora de ${lcFirst(t)}! Bora 💪`, `${t} agora. Vai lá que eu tô torcendo!`],
    [`${t} agora. Dessa vez vai, né?`, `Hora de ${lcFirst(t)}. Sem deixar pra depois de novo!`, `${t} começou. Hoje não fura, hein?`],
    [`Tá de sacanagem? ${k} vezes furando ${lcFirst(t)} 🙄`, `Deixa de enrolação: ${lcFirst(t)} é agora 😤`, `${k} furos seguidos de ${lcFirst(t)}. Hoje vai!`],
  ][tom(k)],
  furando: (k: number) => ` Já são ${k} vezes seguidas sem fazer. Hoje não tem desculpa!`,
  conferir: (t: string) => [`Terminou ${lcFirst(t)}? ✅`, `E aí, ${lcFirst(t)} foi? ✅`, `Fez ${lcFirst(t)}? ✅`],
  conferirCorpo: ['Toque para marcar como feito e manter a sequência 🔥', 'Marca como feito pra eu não te cobrar à toa 😉', 'Toque e marque: cada vez conta 🔥'],
  lembrete: ['Agora, não amanhã. Toque para marcar como feito.', 'É agora! Toque para marcar como feito.', 'Faz agora e marca aqui que eu paro de lembrar 😉'],
  insiste: (k: number) => [
    ['Ainda dá tempo! ⏳', 'Só passando pra lembrar ⏳', 'Esqueceu de mim? ⏳'],
    ['Ainda não fez? ⏳', 'Tô esperando, viu? ⏳', 'Lembra disso aqui? ⏳'],
    ['Vai me ignorar mesmo? 🙄', 'Sério que ainda não fez? 😤', 'De novo isso? 🙄'],
  ][tom(k)],
  bomDia: ' Levanta que o dia não espera!',
  sequencia: (k: number) => ` 🔥 ${k} seguidas. Não vai quebrar agora, né?`,
  amanhaVazio: ['Amanhã tá livre 🗓️', 'Nada marcado pra amanhã 🗓️', 'Amanhã em branco? 🗓️'],
  amanhaCorpo: ['Quer planejar comigo? Me fala o que precisa fazer.', 'Me conta o que você quer fazer amanhã que eu organizo.', 'Bora deixar o dia pronto? Leva 1 minuto comigo.'],
  semana: ['Bora planejar a semana? 📅', 'Semana nova chegando 📅', 'Domingo de planejar 📅'],
  semanaCorpo: (n: number) => n ? `Você já tem ${n === 1 ? '1 coisa marcada' : `${n} coisas marcadas`}. Me conta o resto que eu encaixo.` : 'Sua semana tá vazia. Me conta o que vem por aí que eu organizo.',
  sumiu: ['Sumiu, hein? 👀', 'Ei, cadê você? 👀', 'Tô com saudade 👀'],
  sumiuCorpo: ['Abre aqui 1 minutinho que eu te ajudo a organizar o resto da semana.', 'Bora voltar? Me conta o que tem pra fazer.', 'Sem você eu não sei o que lembrar. Me conta o que vem aí!'],
};

/** Avisos novos de 3/11 (véspera, 1 hora antes, conferir no fim, amanhã vazio, semana, sumiu): sempre ligados, por decisão do Tiago. */
type Extras = 'vespera' | 'umaHora' | 'conferir' | 'amanha' | 'semana' | 'sumiu';

/** Avisos devidos agora. `sent` = chaves já enviadas (para nunca repetir). */
/** Anúncio de novidade para quem já usa o Faiz (manda 1 vez por pessoa). Para anunciar outra, troque o id e o texto. */
export const NOVIDADE = {
  id: 'google', de: '2026-11-05', ate: '2026-11-12',
  title: 'Novidade: o Faiz agora conversa com o seu Google 🎉',
  body: 'Usa Google Agenda? Eu trago seus compromissos de lá pra cá e monto seu dia sem bater horário. Toque pra ligar em 1 minuto.',
};

export function dueNotices(state: AppState, now: Date, sent: Set<string>): Notice[] {
  const ns = state.settings?.notify ?? {};
  if (ns.enabled === false) return [];
  const on = (_k: Extras) => true;
  const tz = state.settings?.tz || 'America/Sao_Paulo';
  const { date, min } = localNow(now, tz);
  const lead = Math.max(0, Math.min(120, Number.isFinite(ns.lead as number) ? (ns.lead as number) : 10));
  const today = (state.tasks ?? []).filter((t) => t && t.date === date).sort(byTime);
  const open = today.filter((t) => t.status !== 'feito');
  const all = state.tasks ?? [];
  const out: Notice[] = [];
  const add = (n: Notice) => { if (!sent.has(n.key)) out.push(n); };

  // 1. Cada atividade com horário. Como uma governanta: avisa antes, cobra na hora, confere no fim; lembrete insiste.
  for (const t of open) {
    if (t.start == null) continue;
    const isReminder = t.tag === 'Lembrete';
    const v = pick(t.id);
    const k = missedStreak(all, t.title, t.date);
    const next = open.find((o) => o.start != null && o.start > t.start! && o.id !== t.id);
    const url = `./?t=${encodeURIComponent(t.id)}`, tag = `t-${t.id}`;
    const base = `t:${t.id}:${t.date}:${t.start}`;
    const dur = t.end != null && t.end > t.start ? t.end - t.start : 0;
    if (isGoogle(t)) { // compromisso do Google Agenda: só um aviso antes, sem cobrar
      if (min >= t.start - lead && min < t.start)
        add({ key: `${base}:${lead}`, title: `${t.title} em ${t.start - min} min 📅`, body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''}`, url, tag });
      continue;
    }
    if (isReminder) {
      if (min >= t.start && min < t.start + 30)
        add({ key: `${base}:r`, title: `Lembrete: ${t.title}`, body: IRIS.lembrete.at(v)!, url, tag });
      else if (min >= t.start + 30 && min < t.start + 60)
        add({ key: `${base}:r2`, title: IRIS.insiste(k).at(v)!, body: `${t.title}. Toque para marcar como feito ou adiar.`, url, tag });
      continue;
    }
    // 1 hora antes (atividades de 1 hora ou mais, quando a antecedência é menor que 1 hora)
    if (on('umaHora') && dur >= 60 && lead < 50 && min >= t.start - 60 && min < t.start - 50)
      add({ key: `${base}:60`, title: IRIS.umaHora(t.title).at(v)!, body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''}`, url, tag });
    // antes de começar
    if (min >= t.start - lead && min < t.start) {
      const left = t.start - min;
      const seq = doneStreak(all, t.title, t.date);
      add({
        key: `${base}:${lead}`,
        title: `${t.title} em ${left} min ⏰`,
        body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''} ${seq >= 2 ? IRIS.sequencia(seq).trim() : IRIS.antes[tom(k)].at(v)}`,
        url, tag,
      });
    }
    // na hora: se ainda não marcou como feito
    else if (min >= t.start && min < t.start + 20 && t.status !== 'andamento') {
      add({ key: `${base}:s`, title: IRIS.naHora(t.title, k).at(v)!, body: `${range(t)}. Toque para marcar como feito ou adiar 15 min.${k >= BRONCA ? IRIS.furando(k) : ''}`, url, tag });
    }
    // no fim: confere se fez (atividades de 20 min ou mais)
    if (on('conferir') && dur >= 20 && min >= t.start + dur && min < t.start + dur + 30)
      add({ key: `${base}:f`, title: IRIS.conferir(t.title).at(v)!, body: IRIS.conferirCorpo.at(v)!, url, tag });
  }

  // 1b. Véspera, às 20:00: o que começa cedo amanhã (antes das 10h).
  const tomorrow = daysBefore(date, -1);
  if (on('vespera') && min >= 20 * 60 && min < 21 * 60) {
    const cedo = all.filter((t) => t && !isGoogle(t) && t.date === tomorrow && t.status !== 'feito' && t.start != null && t.start < 600 && t.tag !== 'Lembrete').sort(byTime);
    if (cedo.length) {
      const v = pick(tomorrow);
      const lista = joinPt(cedo.slice(0, 3).map((t) => `${lcFirst(t.title)} às ${fmt(t.start!)}`));
      add({ key: `v:${date}`, title: IRIS.vespera(lista).at(v)!, body: IRIS.vesperaCorpo.at(v)!, url: './', tag: 'vespera' });
    } else if (on('amanha') && all.length && !all.some((t) => t && t.date === tomorrow)) {
      // 1c. Amanhã sem nada planejado: convida a planejar.
      const v = pick(date);
      add({ key: `a:${date}`, title: IRIS.amanhaVazio.at(v)!, body: IRIS.amanhaCorpo.at(v)!, url: './', tag: 'amanha' });
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
  const minhas = today.filter((t) => !isGoogle(t)), minhasAbertas = open.filter((t) => !isGoogle(t));
  if (night != null && min >= night && min < night + 60 && minhas.length) {
    const done = minhas.length - minhasAbertas.length;
    const pend = minhasAbertas.map((t) => lcFirst(t.title));
    const lista = `${joinPt(pend.slice(0, 3))}${pend.length > 3 ? ` e mais ${pend.length - 3}` : ''}`;
    let title: string, body: string;
    if (!pend.length) { title = 'Arrasou! 🎉'; body = `Você fez tudo hoje (${done} de ${minhas.length}). Orgulho!`; }
    else { title = 'Hora da verdade 😤'; body = done ? `${done} de ${minhas.length}. Ficou pra trás: ${lista}. Amanhã sem desculpa, combinado?` : `Zero de ${minhas.length} hoje? Ficou tudo pra trás: ${lista}. Amanhã a gente recupera, sem desculpa!`; }
    add({ key: `n:${date}`, title, body, url: './?v=noite', tag: 'noite' });
  }
  // 4. Pesquisa do teste: no 3º e no 7º dia de uso, às 19:00, se ainda não respondeu.
  if (state.startDate && /^\d{4}-\d{2}-\d{2}$/.test(state.startDate) && min >= 19 * 60 && min < 22 * 60) {
    const dias = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(state.startDate + 'T12:00:00Z')) / 864e5);
    if (dias >= 6 && !state.survey?.d7) add({ key: 'q:d7', title: 'Fechamos a semana! 🎉', body: 'Me dá sua nota final? Leva 2 minutos e muda o Faiz de verdade.', url: './?v=pesquisa', tag: 'pesquisa' });
    else if (dias >= 2 && dias < 6 && !state.survey?.d3) add({ key: 'q:d3', title: 'Me ajuda com 1 minutinho? 🙏', body: 'Me conta como tá sendo comigo até agora. São 4 perguntas rápidas.', url: './?v=pesquisa', tag: 'pesquisa' });
  }
  // 4b. Domingo às 19:00: planejar a semana.
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  if (on('semana') && dow === 0 && min >= 19 * 60 && min < 20 * 60 && all.length) {
    const fim = daysBefore(date, -7);
    const n = all.filter((t) => t && t.date > date && t.date <= fim && t.status !== 'feito').length;
    add({ key: `w:${date}`, title: IRIS.semana.at(pick(date))!, body: IRIS.semanaCorpo(n), url: './?v=planejar', tag: 'semana' });
  }
  // 4c. Sumiu: 2 ou 5 dias sem abrir o Faiz, às 19:00.
  const dias = state.stats?.days ?? [];
  if (on('sumiu') && dias.length && min >= 19 * 60 && min < 20 * 60) {
    const ultimo = [...dias].sort().at(-1)!;
    const sem = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(ultimo + 'T12:00:00Z')) / 864e5);
    if (sem === 2 || sem === 5) add({ key: `z:${date}`, title: IRIS.sumiu.at(pick(date))!, body: IRIS.sumiuCorpo.at(pick(date))!, url: './', tag: 'sumiu' });
  }
  // 4d. Novidade (uma vez só, entre 10:00 e 21:00, até o fim da semana do anúncio): integrações com o Google.
  const novidade = NOVIDADE;
  const st = state as any;
  if (date >= novidade.de && date <= novidade.ate && min >= 10 * 60 && min < 21 * 60 && (st.onboarded || all.length) && !st.news?.[novidade.id] && !st.integ?.agenda)
    add({ key: `nv:${novidade.id}`, title: novidade.title, body: novidade.body, url: './?v=novidade', tag: 'novidade' });
  // 5. Contas da casa (caderno): 1 a 3 dias antes, no dia e no dia seguinte se ficou atrasada. Entre 09:00 e 12:00.
  if (min >= 9 * 60 && min < 12 * 60) {
    const pagas = state.fin?.pagas ?? {};
    const cur = date.slice(0, 7);
    for (const b of state.fin?.fixas ?? []) {
      if (!b || b.tipo !== 'conta' || !b.id || !(b.valor > 0) || !(b.dia >= 1)) continue;
      const semanal = b.freq === 'semanal';
      for (const m of [monthAdd(cur, -1), cur, monthAdd(cur, 1)]) for (const { due, occ } of billOccurrences(b, m)) {
        if (pagas[`${b.id}:${occ}`]) continue;
        const d = dayDiff(date, due);
        const url = './?v=contas', tag = `c-${b.id}`, key = `c:${b.id}:${occ}`;
        // conta semanal (diarista, feira): só avisa no dia, para não encher de aviso toda semana
        if (!semanal && d >= 1 && d <= 3) add({ key: `${key}:pre`, title: `Conta chegando: ${b.nome} 🧾`, body: `${brl(b.valor)} vence ${d === 1 ? 'amanhã' : `em ${d} dias`} (dia ${+due.slice(8)}). Já separa o dinheiro, hein!`, url, tag });
        else if (d === 0) add({ key: `${key}:dia`, title: `Hoje vence: ${b.nome} ⚠️`, body: `${brl(b.valor)}. Pagou? Toque e marque "Paguei" pra eu parar de cobrar.`, url, tag });
        else if (!semanal && d >= -2 && d <= -1) add({ key: `${key}:atraso`, title: `${b.nome} atrasada 😤`, body: `Venceu dia ${+due.slice(8)} (${brl(b.valor)}). Paga logo, antes dos juros! Já pagou? Marca no Faiz.`, url, tag });
      }
    }
  }
  return out;
}

/** Dias de teste com a IA por pessoa (decisão do Tiago em 3/11: 7 dias; depois a Íris fica no modo simples). */
export const TRIAL_DAYS = 7;
/** Dias desde o início (0 = primeiro dia) e se o teste da IA já acabou para esta pessoa. */
export function trialInfo(startDate: string | undefined, now: Date, tz = 'America/Sao_Paulo', days = TRIAL_DAYS): { dia: number; acabou: boolean } {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { dia: 0, acabou: false };
  const { date } = localNow(now, tz);
  const dia = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(startDate + 'T12:00:00Z')) / 864e5);
  return { dia, acabou: dia >= days };
}
