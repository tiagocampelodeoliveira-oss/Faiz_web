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

/** `task`: aviso de uma atividade (não do Google): leva os botões Feito e Adiar 15 min. */
export type Notice = { key: string; title: string; body: string; url: string; tag: string; ia?: VoltaCtx; task?: string };

/** Situação da pessoa para a IA escrever o aviso de volta (sem conversas e sem valores de dinheiro). */
export type VoltaCtx = {
  nome: string; hora: '12h' | '19h'; diaDaSemana: string; diasSemAbrir: number; diasQueUsou: number; pedidosAIris: number; planosConfirmados: number;
  hojeAberto: string[]; feitasHoje: number; amanha: number; rotinas: number; usaContas: boolean; usaVoz: boolean; googleAgenda: boolean;
};

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
        add({ key: `${base}:r`, title: `Lembrete: ${t.title}`, body: IRIS.lembrete.at(v)!, url, tag, task: t.id });
      else if (min >= t.start + 30 && min < t.start + 60)
        add({ key: `${base}:r2`, title: IRIS.insiste(k).at(v)!, body: `${t.title}. Toque para marcar como feito ou adiar.`, url, tag, task: t.id });
      continue;
    }
    // 1 hora antes (atividades de 1 hora ou mais, quando a antecedência é menor que 1 hora)
    if (on('umaHora') && dur >= 60 && lead < 50 && min >= t.start - 60 && min < t.start - 50)
      add({ key: `${base}:60`, title: IRIS.umaHora(t.title).at(v)!, body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''}`, url, tag, task: t.id });
    // antes de começar
    if (min >= t.start - lead && min < t.start) {
      const left = t.start - min;
      const seq = doneStreak(all, t.title, t.date);
      add({
        key: `${base}:${lead}`,
        title: `${t.title} em ${left} min ⏰`,
        body: `${range(t)}.${next ? ` Depois, ${lcFirst(next.title)} às ${fmt(next.start!)}.` : ''} ${seq >= 2 ? IRIS.sequencia(seq).trim() : IRIS.antes[tom(k)].at(v)}`,
        url, tag, task: t.id,
      });
    }
    // na hora: se ainda não marcou como feito
    else if (min >= t.start && min < t.start + 20 && t.status !== 'andamento') {
      add({ key: `${base}:s`, title: IRIS.naHora(t.title, k).at(v)!, body: `${range(t)}. Toque para marcar como feito ou adiar 15 min.${k >= BRONCA ? IRIS.furando(k) : ''}`, url, tag, task: t.id });
    }
    // no fim: confere se fez (atividades de 20 min ou mais)
    if (on('conferir') && dur >= 20 && min >= t.start + dur && min < t.start + dur + 30)
      add({ key: `${base}:f`, title: IRIS.conferir(t.title).at(v)!, body: IRIS.conferirCorpo.at(v)!, url, tag, task: t.id });
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
  let pesquisaHoje = false; // dia de aviso de pesquisa: o aviso de volta das 19h fica de fora para não chegar junto
  if (state.startDate && /^\d{4}-\d{2}-\d{2}$/.test(state.startDate) && min >= 19 * 60 && min < 22 * 60) {
    const dias = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(state.startDate + 'T12:00:00Z')) / 864e5);
    // Lembrete uma vez só, nos 2 dias seguintes, para quem ainda não respondeu (q:d3r / q:d7r).
    const IMPORTANTE = 'Sua opinião é muito importante pro grupo Faiz entender o que já tá bom e o que dá pra melhorar.';
    if (dias >= 6 && !state.survey?.d7) {
      pesquisaHoje = dias <= 8;
      if (dias >= 7 && dias <= 8) add({ key: 'q:d7r', title: 'Ainda dá tempo! 🙏', body: `${IMPORTANTE} São 2 minutinhos.`, url: './?v=pesquisa', tag: 'pesquisa' });
      else add({ key: 'q:d7', title: 'Fechamos a semana! 🎉', body: 'Me dá sua nota final? Leva 2 minutos e muda o Faiz de verdade.', url: './?v=pesquisa', tag: 'pesquisa' });
    } else if (dias >= 2 && dias < 6 && !state.survey?.d3) {
      pesquisaHoje = dias <= 4;
      if (dias >= 3 && dias <= 4) add({ key: 'q:d3r', title: 'Ainda dá tempo! 🙏', body: `${IMPORTANTE} São 4 perguntas rápidas.`, url: './?v=pesquisa', tag: 'pesquisa' });
      else if (dias === 2) add({ key: 'q:d3', title: 'Me ajuda com 1 minutinho? 🙏', body: 'Me conta como tá sendo comigo até agora. São 4 perguntas rápidas.', url: './?v=pesquisa', tag: 'pesquisa' });
    }
  }
  // 4b. Domingo às 19:00: planejar a semana.
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  if (on('semana') && dow === 0 && min >= 19 * 60 && min < 20 * 60 && all.length) {
    const fim = daysBefore(date, -7);
    const n = all.filter((t) => t && t.date > date && t.date <= fim && t.status !== 'feito').length;
    add({ key: `w:${date}`, title: IRIS.semana.at(pick(date))!, body: IRIS.semanaCorpo(n), url: './?v=planejar', tag: 'semana' });
  }
  // 4c. Volta (8/11, pedido do Tiago; substitui o "sumiu" de 2 e 5 dias): 3 dias ou mais sem abrir o Faiz,
  // um aviso às 12:00 e outro às 19:00. O relógio (tick) pede o texto à IA com a situação dela; sem IA, usa o texto pronto.
  const dias = state.stats?.days ?? [];
  const slot = min >= 12 * 60 && min < 13 * 60 ? '12h' : min >= 19 * 60 && min < 20 * 60 ? '19h' : null;
  const domingoPlanejar = dow === 0 && all.length > 0;
  // Só para quem está há 3 dias ou mais sem abrir; se continuar sem abrir, de 2 em 2 dias (3º, 5º, 7º... dia), às 12h e às 19h.
  const ultimoUso = dias.length ? [...dias].sort().at(-1)! : '';
  const semAbrir = ultimoUso ? Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(ultimoUso + 'T12:00:00Z')) / 864e5) : 0;
  if (on('sumiu') && dias.length && semAbrir >= 3 && (semAbrir - 3) % 2 === 0 && slot && !(slot === '19h' && (pesquisaHoje || domingoPlanejar))) {
    const ultimo = ultimoUso;
    const st = state as any;
    const minhasHoje = open.filter((t) => !isGoogle(t));
    const ctx: VoltaCtx = {
      nome: (state.name || '').trim().split(/\s+/)[0] || '', hora: slot,
      diaDaSemana: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][dow],
      diasSemAbrir: Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(ultimo + 'T12:00:00Z')) / 864e5),
      diasQueUsou: dias.length, pedidosAIris: Number(st.stats?.requests) || 0, planosConfirmados: Number(st.stats?.confirmed) || 0,
      hojeAberto: minhasHoje.filter((t) => t.start == null || t.start >= min).slice(0, 4).map((t) => {
        const k = missedStreak(all, t.title, date);
        return `${t.title}${t.start != null ? ` às ${fmt(t.start)}` : ''}${k ? ` (furou ${k}x seguidas)` : ''}`;
      }),
      feitasHoje: today.filter((t) => !isGoogle(t) && t.status === 'feito').length,
      amanha: all.filter((t) => t && t.date === daysBefore(date, -1)).length,
      rotinas: Array.isArray(st.routines) ? st.routines.length : 0,
      usaContas: !!(st.fin?.fixas?.length || st.fin?.mov?.length), usaVoz: (Number(st.stats?.voice) || 0) > 0, googleAgenda: !!st.integ?.agenda,
    };
    add({ key: `v:${date}:${slot}`, ...voltaPronto(ctx), url: './?v=planejar', tag: 'volta', ia: ctx });
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

/* ---------- Planos (decisão do Tiago, 11/11) ----------
   Grátis: sem IA (a Íris responde no modo simples), Contas, avisos, agenda, tarefas e rotinas.
   Plus: Íris completa, voz da Thalita e Google. Preço: R$ 9,90 para todo mundo (decisão do Tiago, 10/11; pode subir depois). "Fundador" = quem entrou até 10/11 e escolhe agora.
   Gente nova tem 7 dias de Plus grátis (o teste). Enquanto a cobrança não existe, quem escolhe o Plus "reserva" o preço
   e continua no Plus de graça até a cobrança começar (dezembro). */
export const FUNDADOR_ATE = '2026-11-10';
export const PRECO = { fundador: 990, plus: 990 };
/** Dia em que a cobrança foi ligada (AAAA-MM-DD), ou null = desligada (só o dono pode testar o pagamento).
 *  Quem reservou o Plus e ainda não pagou fica no Plus por mais PAGAR_DIAS depois de ligar. Cada pessoa paga a partir do dia
 *  em que confirma o pagamento (decisão do Tiago, 10/11). */
export const COBRANCA_DESDE: string | null = null;
export const PAGAR_DIAS = 7;
/** Assinatura no Mercado Pago (tabela assinaturas): status do MP e até quando já está pago (se cancelou). */
export type Assinatura = { status: string; ate?: string | null; proximo?: string | null };
export type PlanoInfo = {
  plano: 'livre' | 'plus' | 'teste' | 'gratis';
  fundador: boolean;
  preco: number;
  escolha: 'plus' | 'gratis' | null;
  testeDia: number;
  fimTeste: string | null;
  precisaEscolher: boolean;
  /** pagou de verdade (assinatura ativa no Mercado Pago, ou cancelada mas ainda dentro do mês pago) */
  pago: boolean;
  /** status no Mercado Pago (pending, authorized, paused, cancelled) ou null */
  assinatura: string | null;
  proximo: string | null;
  ate: string | null;
  /** o app pode mostrar o botão de pagar (cobrança ligada, ou dono testando) */
  cobranca: boolean;
  /** reservou o Plus e precisa pagar até esta data para continuar (só com a cobrança ligada) */
  pagarAte: string | null;
};
export function planoDe(o: { startDate?: string; escolha?: string | null; livre: boolean; now: Date; tz?: string; assinatura?: Assinatura | null; cobrancaDesde?: string | null; dono?: boolean }): PlanoInfo {
  const t = trialInfo(o.startDate, o.now, o.tz || 'America/Sao_Paulo');
  const hoje = localNow(o.now, o.tz || 'America/Sao_Paulo').date;
  const ok = !!o.startDate && /^\d{4}-\d{2}-\d{2}$/.test(o.startDate);
  const fundador = ok && o.startDate! <= FUNDADOR_ATE;
  const escolha = o.escolha === 'plus' || o.escolha === 'gratis' ? o.escolha : null;
  const fimTeste = ok ? new Date(Date.parse(o.startDate + 'T12:00:00Z') + (TRIAL_DAYS - 1) * 864e5).toISOString().slice(0, 10) : null;
  const a = o.assinatura || null;
  const desde = o.cobrancaDesde === undefined ? COBRANCA_DESDE : o.cobrancaDesde;
  const ligada = !!desde && desde <= hoje;
  const pago = !!a && (a.status === 'authorized' || (!!a.ate && a.ate >= hoje));
  const pagarAte = ligada && escolha === 'plus' && !pago ? new Date(Date.parse(desde + 'T12:00:00Z') + PAGAR_DIAS * 864e5).toISOString().slice(0, 10) : null;
  const reservaVale = escolha === 'plus' && (!ligada || (pagarAte !== null && hoje <= pagarAte));
  const plano = o.livre ? 'livre' : pago || reservaVale ? 'plus' : !t.acabou ? 'teste' : 'gratis';
  return {
    plano, fundador, preco: fundador ? PRECO.fundador : PRECO.plus, escolha, testeDia: t.dia, fimTeste,
    precisaEscolher: !o.livre && ok && !escolha && !pago && (fundador || t.acabou),
    pago, assinatura: a?.status ?? null, proximo: a?.proximo ?? null, ate: a?.ate ?? null,
    cobranca: ligada || !!o.dono, pagarAte,
  };
}

/** Texto pronto do aviso de volta (quando a IA não responde a tempo). */
export function voltaPronto(c: VoltaCtx): { title: string; body: string } {
  const n = c.nome ? `${c.nome}, ` : '';
  const prox = c.hojeAberto[0];
  if (c.hora === '12h') return {
    title: `${n}ainda não te vi hoje 👀`,
    body: prox ? `Hoje tem ${lcFirst(prox.replace(/ \(furou.*\)$/, ''))}. Abre aqui 1 minutinho que eu te ajudo a dar conta.` : 'Me conta o que tem pra hoje que eu organizo pra você em 10 segundos.',
  };
  return {
    title: `${n}cadê você? 👀`,
    body: prox ? `Ainda tá aberto: ${joinPt(c.hojeAberto.slice(0, 2).map((x) => lcFirst(x.replace(/ \(furou.*\)$/, ''))))}. Bora conferir comigo?` : 'Me conta o que vem amanhã que eu deixo tudo pronto antes de você dormir.',
  };
}

/** Pedido à IA para escrever o aviso de volta. */
export function voltaPrompt(c: VoltaCtx): { system: string; user: string } {
  return {
    system: `Você é a Íris, a governanta do Faiz (app de rotina): amiga de uns 23 anos, animada, direta, fala na lata e cobra com humor; público de 16 a 30 anos. Português do Brasil informal.
Tarefa: escrever UM aviso de celular para a pessoa abrir o Faiz hoje, porque ela ainda não abriu. Use a situação dela (o que tem hoje, o que já usa, o que nunca experimentou, há quantos dias não abre) e termine com um convite concreto e fácil, algo que ela me manda ou faz em 10 segundos.
Regras: use o primeiro nome como está (sem apelido) e só uma vez no aviso todo; título com no máximo 45 caracteres e no máximo um emoji; texto com no máximo 140 caracteres, sem emoji ou com um. Não invente compromisso que não está na lista. Nunca cite dinheiro. O app se chama Faiz (nunca "Faz"). Bronca bem-humorada só se algo de hoje "furou 3x seguidas" ou mais; senão, animada. Nada de culpa pesada, nada sobre corpo ou família. Às 19h, foque em fechar o dia ou preparar amanhã. Varie o começo (não comece sempre com "Sumiu").
Responda só com JSON: {"titulo":"...","texto":"..."}`,
    user: JSON.stringify(c),
  };
}

/** Lê a resposta da IA; devolve null se veio fora do formato ou grande demais. */
export function voltaLer(text: string): { title: string; body: string } | null {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const title = String(j.titulo || '').trim(), body = String(j.texto || '').trim();
    if (!title || !body || title.length > 60 || body.length > 180 || /\bFaz\b/.test(title + ' ' + body)) return null;
    return { title, body };
  } catch { return null; }
}
