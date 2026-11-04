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
// Conversas: cada lista é uma conversa (a frase seguinte vê as anteriores, como no app).
const conversas: string[][] = [
  ['quero ir pra academia amanhã', 'montar treino da semana', '3 dias, seg qua e sex de manhã, quero ganhar massa'],
  ['tenho prova de cálculo sexta'],
  ['vou no mercado depois do trabalho'],
  ['jantar com a Ana sábado às 20h'],
  ['gastei 80 no ifood'],
  ['to muito cansado hoje, não quero fazer nada'],
];
{
  const linhas: string[] = [];
  const ctx = { now, tasks, fin };
  for (const conv of conversas) {
    const recent: { who: 'me' | 'bot'; text: string }[] = [];
    for (const frase of conv) {
      const r = await fetch(`${URL_}/functions/v1/api`, { method: 'POST', headers: auth, body: JSON.stringify((() => { const p = L.buildPromptParts(frase, ctx, recent, { nome: 'Tiago' }); return { action: 'ai', system: p.system, prompt: p.user }; })()) });
      const body: any = await r.json().catch(() => ({}));
      let texto = '';
      try {
        const t = String(body.text || '');
        const rep = L.aiToReply(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)), frase, ctx);
        const extra = [
          rep.routines ? `[rotinas: ${rep.routines.map((x: any) => `${x.title} ${x.dias.join(',')} ${x.start}`).join('; ')}]` : '',
          rep.ops ? `[agenda: ${rep.ops.length}]` : '',
          rep.fin ? `[caderno: ${rep.fin.length}]` : '',
          rep.sugs ? `[botões: ${rep.sugs.join(' | ')}]` : '',
        ].filter(Boolean).join(' ');
        texto = `${rep.text} ${extra}`;
        recent.push({ who: 'me', text: frase }, { who: 'bot', text: rep.text });
      } catch { texto = `(resposta fora do formato) ${String(body.text || JSON.stringify(body)).slice(0, 120)}`; }
      linhas.push(`"${frase}" → ${texto.replace(/\n/g, ' / ')}`);
    }
  }
  console.log(`::warning::ÍRIS: ${linhas.join(' ‖ ')}`);
}
await fetch(`${URL_}/auth/v1/admin/users/${su.user.id}`, { method: 'DELETE', headers: service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` } });
