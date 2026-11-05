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
// Conversas sobre dinheiro: cada lista é uma conversa (a frase seguinte vê as anteriores e o caderno atualizado, como no app).
const conversas: string[][] = [
  ['tenho 2.300 na conta', 'quanto ainda posso gastar esse mês?'],
  ['gastei 45 no mercado e 18 no uber', 'na verdade o mercado foi 54'],
  ['comprei um tênis de 300 no crédito', 'paguei a fatura do cartão'],
  ['quanto gastei nesta semana?', 'e com comida?'],
  ['paguei a luz', 'anotei errado, apaga o último gasto'],
  ['minha academia é 110 todo dia 15', 'recebi 500 de um freela'],
  ['dá pra gastar 400 no fim de semana?'],
  ['gastei no mercado'],
];
let caderno = fin;
for (const conv of conversas) {
  const linhas: string[] = [];
  const recent: { who: 'me' | 'bot'; text: string }[] = [];
  for (const frase of conv) {
    const ctx = { now: new Date(), tasks, fin: caderno };
    const r = await fetch(`${URL_}/functions/v1/api`, { method: 'POST', headers: auth, body: JSON.stringify((() => { const p = L.buildPromptParts(frase, ctx, recent, { nome: 'Tiago' }); return { action: 'ai', system: p.system, prompt: p.user }; })()) });
    const body: any = await r.json().catch(() => ({}));
    let texto = '';
    try {
      const t = String(body.text || '');
      const cmd = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      const rep = L.aiToReply(cmd, frase, ctx);
      if (rep.fin?.length) caderno = L.applyFin(caderno, rep.fin).fin;
      const cx = L.caixa(caderno, L.dateKey(new Date()));
      const tipos = (cmd.acao === 'varios' ? (cmd.comandos || []) : [cmd]).map((c: any) => c.financa?.tipo || c.acao).join('+');
      texto = `[${tipos}] ${rep.text} ${rep.fin ? `[caderno: ${rep.fin.map((o: any) => o.type).join(',')}]` : ''} ${rep.sugs ? `[botões: ${rep.sugs.join(' | ')}]` : ''} {saldo ${cx.saldo == null ? '-' : cx.saldo / 100} · comprometido ${cx.comprometido / 100} · disponível ${cx.disponivel == null ? '-' : cx.disponivel / 100}}`;
      recent.push({ who: 'me', text: frase }, { who: 'bot', text: rep.text });
    } catch (e) { texto = `(resposta fora do formato) ${String(body.text || JSON.stringify(body)).slice(0, 160)}`; }
    linhas.push(`"${frase}" → ${texto.replace(/\n/g, ' / ')}`);
  }
  console.log(`::warning::ÍRIS: ${linhas.join(' ‖ ')}`);
}
await fetch(`${URL_}/auth/v1/admin/users/${su.user.id}`, { method: 'DELETE', headers: service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` } });
