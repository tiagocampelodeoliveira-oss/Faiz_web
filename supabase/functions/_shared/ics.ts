// Calendário do celular (iPhone, Android, Outlook): o Faiz vira um calendário "assinado" (link .ics).
// A pessoa assina uma vez e as tarefas e contas aparecem sozinhas no Calendário; o app do celular busca de tempos em tempos.
// Sem alarmes aqui: quem avisa é o Faiz (senão o aviso vem duplicado).

type T = { id: string; title: string; date: string; start?: number | null; end?: number | null; status?: string; source?: string; tag?: string };
type B = { id: string; tipo: string; nome: string; valor: number; dia: number; desde?: string; ate?: string; freq?: string; mes?: number; dow?: number };

const pad = (n: number) => String(n).padStart(2, '0');
const esc = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Linhas de no máximo 75 bytes (regra do formato). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = []; let cur = '';
  for (const ch of line) { if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch; }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = (d: string) => d.replace(/-/g, '');
const hm = (m: number) => `${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
const addDay = (d: string, n: number) => { const x = new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5); return x.toISOString().slice(0, 10); };
const monthAdd = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const brl = (c: number) => `R$ ${Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${pad(c % 100)}`;
function dues(b: B, m: string): { due: string; occ: string }[] {
  if ((b.desde && m < b.desde) || (b.ate && m > b.ate)) return [];
  const [y, mo] = m.split('-').map(Number), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const at = (d: number) => `${m}-${pad(Math.min(Math.max(1, Math.round(d)), last))}`;
  if (b.freq === 'anual') return mo === (b.mes || Number((b.desde || m).slice(5, 7))) ? [{ due: at(b.dia), occ: m }] : [];
  if (b.freq === 'semanal') { const out = []; for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === (b.dow ?? 1)) out.push({ due: `${m}-${pad(d)}`, occ: `${m}-${pad(d)}` }); return out; }
  return [{ due: at(b.dia), occ: m }];
}

/** Monta o .ics com as tarefas (14 dias para trás até 60 para frente) e os vencimentos de contas (2 meses). */
export function buildIcs(state: any, today: string, stamp = new Date()): string {
  const dt = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ev: string[][] = [];
  const de = addDay(today, -14), ate = addDay(today, 60);
  for (const t of (state?.tasks ?? []) as T[]) {
    if (!t || !t.id || !t.title || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || t.date < de || t.date > ate) continue;
    if (t.source === 'google') continue; // já está no Google Agenda da pessoa; não duplica
    const feito = t.status === 'feito';
    const lines = [`UID:${t.id}@faiz`, `DTSTAMP:${dt}`, `SUMMARY:${esc((feito ? '✓ ' : '') + t.title)}`];
    if (t.start != null && t.start >= 0 && t.start < 1440) {
      const end = t.end != null && t.end > t.start ? Math.min(t.end, 1439) : Math.min(t.start + (t.tag === 'Lembrete' ? 15 : 60), 1439);
      lines.push(`DTSTART:${ymd(t.date)}T${hm(t.start)}`, `DTEND:${ymd(t.date)}T${hm(end)}`); // hora local do celular
    } else lines.push(`DTSTART;VALUE=DATE:${ymd(t.date)}`, `DTEND;VALUE=DATE:${ymd(addDay(t.date, 1))}`);
    lines.push('DESCRIPTION:Do Faiz', 'TRANSP:OPAQUE');
    ev.push(lines);
  }
  const pagas = state?.fin?.pagas ?? {}, cur = today.slice(0, 7);
  for (const b of (state?.fin?.fixas ?? []) as B[]) {
    if (!b || b.tipo !== 'conta' || !b.id || !(b.valor > 0)) continue;
    for (const m of [cur, monthAdd(cur, 1)]) for (const { due, occ } of dues(b, m)) {
      if (due < today && pagas[`${b.id}:${occ}`]) continue;
      const pg = !!pagas[`${b.id}:${occ}`];
      ev.push([`UID:conta-${b.id}-${occ}@faiz`, `DTSTAMP:${dt}`, `SUMMARY:${esc(`${pg ? '✓ Paga' : '🧾 Vence'}: ${b.nome} (${brl(b.valor)})`)}`, `DTSTART;VALUE=DATE:${ymd(due)}`, `DTEND;VALUE=DATE:${ymd(addDay(due, 1))}`, 'DESCRIPTION:Conta anotada no Faiz', 'TRANSP:TRANSPARENT']);
    }
  }
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Faiz//Agenda//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Faiz', 'X-WR-CALDESC:Suas tarefas e contas do Faiz', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
  const body = ev.flatMap((l) => ['BEGIN:VEVENT', ...l, 'END:VEVENT']);
  return [...head, ...body, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
