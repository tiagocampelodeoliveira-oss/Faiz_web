// Prévia da Íris: manda frases reais para a IA no ar (agenda, rotinas e contas), usando a lógica
// do site deste ramo (site/index.html). Não publica nada. Roda no GitHub Actions (ramo "previa").
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const anon = keys.find((k) => k.name === 'anon' || k.type === 'publishable')!.api_key;
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const URL_ = `https://${REF}.supabase.co`;
const su = await (await fetch(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: '{"data":{}}' })).json();
const auth = { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${su.access_token}` };

const html = readFileSync('site/index.html', 'utf8');
const logicSrc = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes('FazLogic'))!;
const box: any = {}; vm.runInNewContext(logicSrc + ';this.L = FazLogic;', box);
const L = box.L;
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const hoje = L.dateKey(now), amanha = L.addDays(hoje, 1);
// A pessoa furou a corrida nos últimos 3 dias e tem academia amanhã.
const tasks = [
  ...[1, 2, 3].map((d) => ({ id: `furo${d}`, title: 'Corrida', date: L.addDays(hoje, -d), start: 1110, end: 1170, category: 'pessoal', color: 'green', status: 'pendente', createdAt: 0 })),
  { id: 'ing1', title: 'Estudar inglês', date: L.addDays(hoje, -1), start: 1200, end: 1260, category: 'pessoal', color: 'lilac', status: 'pendente', createdAt: 0 },
  { id: 'acad1', title: 'Academia', date: amanha, start: 420, end: 480, category: 'pessoal', color: 'green', status: 'pendente', createdAt: 0 },
];
// Caderno de contas: luz e aluguel fixos, salário, um mercado e limite de 1.200 no dia a dia.
const fin = L.applyFin(L.emptyFin(), [
  { type: 'fixa', fixa: { tipo: 'conta', nome: 'Luz', valor: 18000, dia: 10, cat: 'casa', desde: L.monthOf(hoje) } },
  { type: 'fixa', fixa: { tipo: 'conta', nome: 'Aluguel', valor: 150000, dia: 5, cat: 'casa', desde: L.monthOf(hoje) } },
  { type: 'fixa', fixa: { tipo: 'renda', nome: 'Salário', valor: 400000, dia: 5, cat: 'outros', desde: L.monthOf(hoje) } },
  { type: 'mov', mov: { tipo: 'saida', valor: 98000, cat: 'mercado', desc: 'Mercado do mês', data: hoje } },
  { type: 'limite', valor: 120000 },
]).fin;
// Rotinas: cada lista é uma conversa. "ent" = a Íris está na entrevista da rotina (assunto e a pergunta que ela fez).
type Passo = { frase: string; ent?: { topico: string; pergunta: string } };
const trabTodoDia = { id: 'rtk', title: 'Trabalho', dias: [0, 1, 2, 3, 4, 5, 6], start: 480, end: 1020, category: 'trabalho', color: 'blue', since: L.addDays(hoje, -3), createdAt: 0 };
const trabSemana = { ...trabTodoDia, id: 'rts', dias: [1, 2, 3, 4, 5] };
const P = (frase: string, ent?: Passo['ent']): Passo => ({ frase, ent });
const acadTodo = { id: 'rta', title: 'Academia', dias: [0, 1, 2, 3, 4, 5, 6], start: 1140, end: 1200, category: 'saude', color: 'green', since: L.addDays(hoje, -3), createdAt: 0 };
const qui = (() => { for (let i = 1; i <= 7; i++) { const d = L.addDays(hoje, i); if (L.parseKey(d).getDay() === 4) return d; } return hoje; })();
const casamento = { id: 'cas1', title: 'Casamento', date: qui, start: 960, end: 1080, status: 'pendente', category: 'social', color: 'pink', createdAt: 0 };
const corrida = { id: 'cor1', title: 'Corrida', date: hoje, start: 1110, end: 1170, status: 'pendente', category: 'pessoal', color: 'green', createdAt: 0 };
const conversas: { rot: any[]; extra?: any[]; passos: Passo[] }[] = [
  { rot: [], extra: [corrida], passos: [P('reajusta a corrida pra 19h')] },
  { rot: [], extra: [corrida], passos: [P('remarca a corrida pra amanhã às 7')] },
  { rot: [], extra: [corrida], passos: [P('adia a corrida em 1 hora')] },
  { rot: [], extra: [corrida], passos: [P('passa a corrida pra depois do almoço')] },
  { rot: [], extra: [corrida], passos: [P('marca outra corrida às 21h')] },
  { rot: [], extra: [corrida], passos: [P('troca o nome da corrida pra treino de corrida')] },
  { rot: [acadTodo], extra: [casamento], passos: [P('ajusta o casamento pra começar 17h')] },
  { rot: [], extra: [corrida], passos: [P('quero correr amanhã às 6 também')] },
];
for (const conv of conversas) {
  const linhas: string[] = [];
  const recent: { who: 'me' | 'bot'; text: string }[] = [];
  let routines = conv.rot.map((r: any) => ({ ...r, skip: [...(r.skip || [])] }));
  let ts = [...L.materialize([], routines, hoje).tasks, ...((conv as any).extra || [])];
  for (const { frase, ent } of conv.passos) {
    if (ent) recent.push({ who: 'bot', text: ent.pergunta });
    const ctx = { now: new Date(), tasks: ts, fin, routines, entrevista: ent, recentUser: recent.filter((m) => m.who === 'me').map((m) => m.text).join(' ') };
    const r = await fetch(`${URL_}/functions/v1/api`, { method: 'POST', headers: auth, body: JSON.stringify((() => { const p = L.buildPromptParts(frase, ctx, recent, { nome: 'Kauã' }); return { action: 'ai', system: p.system, prompt: p.user }; })()) });
    const body: any = await r.json().catch(() => ({}));
    let texto = '';
    try {
      const t = String(body.text || '');
      const cmd = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      const rep = L.aiToReply(cmd, frase, ctx);
      // confirma tudo, como se a pessoa tocasse em Confirmar
      for (const sp of rep.routines || []) { const nr = { id: L.newId('r'), ...sp, since: hoje, createdAt: 0 }; routines = [...routines, nr]; ts = L.materialize(ts, [nr], hoje).tasks; }
      for (const e of rep.routineEdits || []) { if (e.remove) { const x = L.removeRoutine(ts, routines, e.id, hoje); ts = x.tasks; routines = x.routines; } else { const x = L.updateRoutine(ts, routines, e.id, e, hoje); ts = x.tasks; routines = x.routines; } }
      if (rep.ops?.length) { for (const o of rep.ops) { if (o.type === 'remove') { const t = ts.find((x: any) => x.id === o.id); const r = t?.routine && routines.find((x: any) => x.id === t.routine); if (r) r.skip = [...(r.skip || []), t.date]; } } ts = L.applyOps(ts, rep.ops).tasks; ts = L.materialize(ts, routines, hoje).tasks; }
      const depois = ts.filter((x: any) => !x.routine && (x.date === qui || x.date === hoje || x.date === amanha)).sort((a: any, b: any) => a.start - b.start).map((x: any) => `${x.title} ${x.date.slice(5)} ${L.timeRange(x.start, x.end)}`).join(', ');
      const tipos = (cmd.acao === 'varios' ? (cmd.comandos || []) : [cmd]).map((c: any) => c.acao).join('+');
      texto = `[${tipos}] ${rep.text} ${rep.sugs ? `[botões: ${rep.sugs.join(' | ')}]` : ''} ${rep.plan ? `[plano: ${rep.plan.filter((x: any) => x.isNew).map((x: any) => `${x.title} ${L.fmtTime(x.start)}`).join(', ')}]` : ''} ${rep.entrevista ? `[entrevista: ${rep.entrevista}]` : ''} {agenda depois: ${depois}} {rotinas: ${routines.map((x: any) => `${x.title} ${L.diasLabel(x.dias)} ${L.timeRange(x.start, x.end)}`).join('; ') || '-'}}`;
      recent.push({ who: 'me', text: frase }, { who: 'bot', text: rep.text });
    } catch (e) { texto = `(resposta fora do formato) ${String(e)} ${String(body.text || JSON.stringify(body)).slice(0, 160)}`; }
    linhas.push(`"${frase}" → ${texto.replace(/\n/g, ' / ')}`);
  }
  console.log(`::warning::ÍRIS: ${linhas.join(' ‖ ')}`);
}
await fetch(`${URL_}/auth/v1/admin/users/${su.user.id}`, { method: 'DELETE', headers: service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` } });
