// Prévia da foto/documento na Íris: manda uma conta de luz (foto) e um horário de faculdade (PDF)
// de exemplo para a IA no ar, com a lógica do site (site/index.html). Não publica nada.
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

const casos = [
  { arq: 'scripts/anexos/calendario-2027.pdf', mt: 'application/pdf', tipo: 'pdf', nome: 'calendario-2027.pdf', frase: '' },
  { arq: 'scripts/anexos/calendario-2027.pdf', mt: 'application/pdf', tipo: 'pdf', nome: 'calendario-2027.pdf', frase: 'esse é o calendário da minha faculdade, coloca as provas e entregas na agenda' },
];
const linhas: string[] = [];
for (const c of casos) {
  const data = readFileSync(c.arq).toString('base64');
  const pedido = c.frase || (c.tipo === 'pdf' ? 'Lê esse documento e coloca no lugar certo pra mim' : 'Vê essa foto e coloca no lugar certo pra mim');
  const ctx = { now: new Date(), tasks: [], fin: L.emptyFin(), routines: [] };
  const p = L.buildPromptParts(pedido, ctx, [], { nome: 'Tiago' }, { anexo: { tipo: c.tipo, nome: c.nome } });
  const t0 = Date.now();
  const r = await fetch(`${URL_}/functions/v1/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'ai', system: p.system, prompt: p.user, modelo: 'completa', anexo: { mt: c.mt, data } }) });
  const body: any = await r.json().catch(() => ({}));
  let texto = '';
  try {
    if (!r.ok) throw new Error(`http ${r.status} ${JSON.stringify(body)}`);
    const t = String(body.text || '');
    const cmd = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const rep = L.aiToReply(cmd, pedido, ctx);
    const fin = (rep.fin || []).map((o: any) => o.fixa ? `conta ${o.fixa.nome} ${o.fixa.valor / 100} dia ${o.fixa.dia} ${o.fixa.desde}→${o.fixa.ate || '∞'}` : o.mov ? `${o.mov.tipo} ${o.mov.desc} ${o.mov.valor / 100} ${o.mov.data}` : o.type).join('; ');
    const ops = (rep.ops || []).filter((o: any) => o.type === 'add').map((o: any) => `${o.task.date} ${o.task.title}`).join('; ');
    const rot = (rep.routines || []).map((x: any) => `${x.title} ${L.diasLabel(x.dias)} ${L.timeRange(x.start, x.end)}`).join('; ');
    const tipos = (cmd.acao === 'varios' ? (cmd.comandos || []) : [cmd]).map((x: any) => x.acao).join('+');
    texto = `[${tipos}] ${rep.text} ${fin ? `{contas: ${fin}}` : ''} ${rot ? `{rotinas: ${rot}}` : ''} ${ops ? `{agenda (${(rep.ops || []).length}): ${ops}}` : ''} [stop ${body.stop}, saída ${String(body.text || '').length} car.] ${rep.sugs ? `[botões: ${rep.sugs.join(' | ')}]` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s, ${body.model}, entrada ${body.cache?.input || 0} tokens)`;
  } catch (e) { texto = `(falhou) ${String(e).slice(0, 300)} ${String(body.text || '').slice(0, 200)}`; }
  linhas.push(`${c.nome} + "${c.frase}" → ${texto.replace(/\n/g, ' / ')}`);
}
for (const l of linhas) console.log(`::warning::ANEXO: ${l}`);
await fetch(`${URL_}/auth/v1/admin/users/${su.user.id}`, { method: 'DELETE', headers: service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` } });
