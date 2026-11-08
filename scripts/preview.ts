// Prévia do AVISO DE VOLTA escrito pela IA (situações de exemplo). Não manda aviso a ninguém.
import { voltaLer, voltaPrompt, voltaPronto, type VoltaCtx } from '../supabase/functions/_shared/plan.ts';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const anon = keys.find((k) => k.name === 'anon' || k.type === 'publishable')!.api_key;
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const URL_ = `https://${REF}.supabase.co`;
const su = await (await fetch(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: '{"data":{}}' })).json();
const auth = { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${su.access_token}` };
const b = { diaDaSemana: 'segunda', feitasHoje: 0, amanha: 0, rotinas: 0, usaContas: false, usaVoz: false, googleAgenda: false, planosConfirmados: 0 };
const casos: VoltaCtx[] = [
  { ...b, nome: 'Leo', hora: '12h', diasSemAbrir: 2, diasQueUsou: 2, pedidosAIris: 3, hojeAberto: [], googleAgenda: true, usaVoz: true, amanha: 9 },
  { ...b, nome: 'Isabela', hora: '12h', diasSemAbrir: 2, diasQueUsou: 1, pedidosAIris: 1, planosConfirmados: 1, hojeAberto: [] },
  { ...b, nome: 'Guilherme', hora: '12h', diasSemAbrir: 1, diasQueUsou: 1, pedidosAIris: 0, hojeAberto: [] },
  { ...b, nome: 'Kauã', hora: '19h', diasSemAbrir: 1, diasQueUsou: 4, pedidosAIris: 14, planosConfirmados: 6, rotinas: 5, hojeAberto: ['Academia às 19:30 (furou 3x seguidas)'], amanha: 4 },
  { ...b, nome: 'Marcelo', hora: '12h', diasSemAbrir: 1, diasQueUsou: 3, pedidosAIris: 15, usaContas: true, usaVoz: true, hojeAberto: ['Pagar internet'] },
  { ...b, nome: 'Henrique', hora: '19h', diasSemAbrir: 0, diasQueUsou: 5, pedidosAIris: 15, rotinas: 2, usaContas: true, feitasHoje: 0, hojeAberto: ['Estudar às 20:00 (furou 1x seguidas)'], amanha: 3 },
];
for (const c of casos) {
  const p = voltaPrompt(c);
  const r = await fetch(`${URL_}/functions/v1/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'ai', system: p.system, prompt: p.user }) });
  const body: any = await r.json().catch(() => ({}));
  const v = voltaLer(String(body.text || ''));
  const fb = voltaPronto(c);
  console.log(`::warning::VOLTA ${c.nome} ${c.hora}: ${v ? `${v.title} — ${v.body}` : `(fora do formato: ${String(body.text || JSON.stringify(body)).slice(0, 120)})`} ‖ texto pronto: ${fb.title} — ${fb.body}`);
}
await fetch(`${URL_}/auth/v1/admin/users/${su.user.id}`, { method: 'DELETE', headers: service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` } });
