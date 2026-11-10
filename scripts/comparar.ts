// Compara a Íris completa (Sonnet) com a Íris rápida (Haiku) nas mesmas frases, com a mesma agenda.
// Chama a IA direto (segredo ANTHROPIC_API_KEY do GitHub). Não grava nada. Roda no ramo "previa".
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const KEY = process.env.ANTHROPIC_API_KEY!;
const html = readFileSync('site/index.html', 'utf8');
const logicSrc = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes('FazLogic'))!;
const box: any = {}; vm.runInNewContext(logicSrc + ';this.L = FazLogic;', box);
const L = box.L;
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
now.setHours(10, 0, 0, 0);
const hoje = L.dateKey(now), amanha = L.addDays(hoje, 1);
const qui = (() => { for (let i = 1; i <= 7; i++) { const d = L.addDays(hoje, i); if (L.parseKey(d).getDay() === 4) return d; } return hoje; })();
const routines = [
  { id: 'rtrab', title: 'Trabalho', dias: [1, 2, 3, 4, 5], start: 540, end: 1080, category: 'trabalho', color: 'blue', since: L.addDays(hoje, -7), createdAt: 0 },
  { id: 'racad', title: 'Academia', dias: [1, 3, 4, 5], start: 1140, end: 1200, category: 'pessoal', color: 'green', since: L.addDays(hoje, -7), createdAt: 0 },
];
const extra = [
  { id: 'cor1', title: 'Corrida', date: hoje, start: 1110, end: 1170, status: 'pendente', category: 'pessoal', color: 'green', createdAt: 0 },
  { id: 'cas1', title: 'Casamento', date: qui, start: 960, end: 1080, status: 'pendente', category: 'pessoal', color: 'peach', createdAt: 0 },
];
const tasks = [...L.materialize([], routines, hoje).tasks, ...extra];
const fin = L.applyFin(L.emptyFin(), [
  { type: 'fixa', fixa: { tipo: 'conta', nome: 'Luz', valor: 18000, dia: 10, cat: 'casa', desde: L.monthOf(hoje) } },
  { type: 'fixa', fixa: { tipo: 'conta', nome: 'Aluguel', valor: 150000, dia: 5, cat: 'casa', desde: L.monthOf(hoje) } },
  { type: 'mov', mov: { tipo: 'saida', valor: 3200, cat: 'comida', desc: 'Ifood', data: hoje } },
]).fin;
const FRASES = [
  'quero correr amanhã às 7', 'lembra de pagar a luz amanhã às 9h', 'gastei 32 no ifood', 'paguei a luz, deu 187',
  'academia toda segunda, quarta e sexta às 19h', 'reajusta a corrida pra 19h', 'cancela a corrida de hoje',
  'o casamento de quinta vai até 23h, tira a academia desse dia', 'quanto gastei essa semana?', 'tô muito cansado hoje, o que eu faço?',
  'sexta tenho reunião às 10h e depois almoço com a Ana', 'faculdade de segunda a sexta das 8 às 11:40', 'boleto de 250 do curso vence dia 15',
  'marca dentista', 'organiza meu dia', 'estudar inglês 30 min todo dia depois do trabalho', 'passa a academia de amanhã pra de manhã',
  'na verdade o ifood foi 38', 'quero começar a correr, me ajuda?', 'tenho prova de cálculo terça, monta um cronograma de estudo até lá',
];
// preço por milhão de tokens (tabela da Anthropic, 10/11/2026): entrada, saída, leitura de cache, escrita de cache
const PRECO: Record<string, number[]> = { 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125] };
const custo: Record<string, number> = {}, tempo: Record<string, number[]> = {};

async function chamar(model: string, system: string, user: string) {
  const t0 = Date.now();
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 3000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] }) });
  const j: any = await r.json();
  (tempo[model] ??= []).push(Date.now() - t0);
  if (!r.ok) return { erro: `${r.status} ${JSON.stringify(j).slice(0, 120)}` };
  const u = j.usage || {}, p = PRECO[model];
  custo[model] = (custo[model] || 0) + ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
  return { text: (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''), stop: j.stop_reason };
}

function efeito(text: string, frase: string, ctx: any): string {
  try {
    const cmd = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const rep = L.aiToReply(cmd, frase, ctx);
    const acoes = (cmd.acao === 'varios' ? (cmd.comandos || []).map((c: any) => c.acao) : [cmd.acao]).join('+');
    const ops = (rep.ops || []).map((o: any) => o.type === 'add' ? `+${o.task.title} ${o.task.date.slice(5)} ${L.fmtTime(o.task.start ?? 0)}` : o.type === 'move' ? `~${o.id} ${o.date.slice(5)} ${L.timeRange(o.start, o.end)}` : `-${o.id}`).join(', ');
    const rot = (rep.routines || []).map((r: any) => `rotina ${r.title} ${L.diasLabel(r.dias)} ${L.fmtTime(r.start)}${r.end ? '-' + L.fmtTime(r.end) : ''}`).join(', ');
    const red = (rep.routineEdits || []).map((e: any) => `muda rotina ${e.id}${e.remove ? ' (apaga)' : ''}`).join(', ');
    const fi = (rep.fin || []).map((f: any) => f.type + (f.mov ? ` ${f.mov.valor / 100}` : f.fixa ? ` ${f.fixa.nome} ${f.fixa.valor / 100}` : f.pago ? ` ${f.pago.valor / 100}` : '')).join(', ');
    return `[${acoes}] ${[ops, rot, red, fi].filter(Boolean).join(' | ') || ''} «${String(rep.text || '').replace(/\n/g, ' / ').slice(0, 140)}»`;
  } catch (e) { return `(fora do formato) ${text.slice(0, 100)}`; }
}

const linhas: string[] = [];
for (const frase of FRASES) {
  const ctx = { now, tasks, fin, routines, recentUser: '' };
  const p = L.buildPromptParts(frase, ctx, [], { nome: 'Kauã' });
  const out: string[] = [];
  for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
    const r: any = await chamar(model, p.system, p.user);
    out.push(`${model.includes('haiku') ? 'H' : 'S'}: ${r.erro ? 'ERRO ' + r.erro : efeito(r.text, frase, ctx)}${r.stop === 'max_tokens' ? ' (cortada)' : ''}`);
  }
  linhas.push(`"${frase}" ⇒ ${out.join(' ‖ ')}`);
}
const med = (xs: number[]) => xs.slice().sort((a, b) => a - b).at(Math.floor(xs.length / 2)) ?? 0;
console.log(`::warning::COMPARAR CUSTO: Sonnet US$ ${(custo['claude-sonnet-5-5'] || 0).toFixed(4)} (${((custo['claude-sonnet-5-5'] || 0) / FRASES.length).toFixed(5)} por msg, mediana ${med(tempo['claude-sonnet-5-5'] || [])} ms) · Haiku US$ ${(custo['claude-haiku-5-5'] || 0).toFixed(4)} (${((custo['claude-haiku-5-5'] || 0) / FRASES.length).toFixed(5)} por msg, mediana ${med(tempo['claude-haiku-5-5'] || [])} ms)`);
// no máximo 10 anotações por etapa: junta em blocos
for (let i = 0; i < linhas.length; i += 3) console.log(`::warning::COMPARAR ${i / 3 + 1}: ${linhas.slice(i, i + 3).join(' ### ')}`);
