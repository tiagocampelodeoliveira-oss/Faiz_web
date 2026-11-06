// Diagnóstico dos avisos (sem conteúdo): por pessoa, quais celulares estão inscritos e quantos avisos saíram.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
let keys: any = null;
for (let i = 0; i < 4 && !Array.isArray(keys); i++) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  keys = await r.json().catch(() => null);
  if (!Array.isArray(keys)) { console.log(`::warning::Supabase respondeu ${r.status}: ${JSON.stringify(keys).slice(0, 200)} (tentativa ${i + 1})`); await new Promise((ok) => setTimeout(ok, 5000 * (i + 1))); }
}
if (!Array.isArray(keys)) process.exit(1);
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const H = { apikey: service, ...(service.startsWith('sb_') ? {} : { Authorization: `Bearer ${service}` }) };
const get = async (p: string) => (await fetch(`https://${REF}.supabase.co/rest/v1/${p}`, { headers: H })).json();
const states: any[] = await get('states?select=user_id,name:data->>name,device:data->stats->>device,push:data->stats->>pushTest,perm:data->>permAsked,notify:data->settings->notify->>enabled,days:data->stats->days,updated_at');
const subs: any[] = await get('subs?select=user_id,endpoint,ua,created_at');
const sent: any[] = await get(`sent?select=user_id,key,created_at&created_at=gte.${new Date(Date.now() - 5 * 864e5).toISOString()}`);
const linhas = states.filter((s) => s.name).map((s) => {
  const ss = subs.filter((x) => x.user_id === s.user_id);
  const env = sent.filter((x) => x.user_id === s.user_id);
  const tipos = env.reduce((a: any, x) => { const k = x.key.split(':')[0]; a[k] = (a[k] || 0) + 1; return a; }, {});
  return `${String(s.name).split(' ')[0]} | ${s.device} | teste:${s.push || '-'} | permAsked:${s.perm} | notify:${s.notify} | inscricoes:${ss.length} ${ss.map((x) => `${new URL(x.endpoint).host} ${x.created_at.slice(0, 16)} ${/Android/.test(x.ua || '') ? 'Android' : /iPhone|Mac/.test(x.ua || '') ? 'Apple' : (x.ua || '').slice(0, 30)}`).join(' ; ')} | avisos5d:${env.length} ${JSON.stringify(tipos)} | ultimo uso:${String(s.updated_at).slice(0, 16)}`;
});
console.log(`::warning::DIAG PUSH: ${linhas.join(' ‖ ')}`);

// Novidade do Google: quem já recebeu o aviso e se o celular aceitou (push_log), quem já ligou a agenda.
const nvLog: any[] = await get(`push_log?select=user_id,ok,status&kind=eq.nv&at=gte.${new Date(Date.now() - 7 * 864e5).toISOString()}`);
const integ: any[] = await get('states?select=user_id,agenda:data->integ->>agenda,viu:data->news->>google');
const nv = states.filter((s) => s.name).map((s) => {
  const env = sent.find((x) => x.user_id === s.user_id && x.key === 'nv:google');
  const lg = nvLog.filter((x) => x.user_id === s.user_id);
  const ig = integ.find((x) => x.user_id === s.user_id) || {};
  return `${String(s.name).split(' ')[0]}: ${env ? 'aviso ' + env.created_at.slice(11, 16) + 'Z ' + (lg.some((x) => x.ok) ? 'entregue' : lg.length ? 'falhou ' + lg.map((x) => x.status).join('/') : '?') : 'sem aviso'}${ig.viu ? ' · viu' : ''}${ig.agenda ? ' · LIGOU agenda' : ''}`;
});
console.log(`::warning::NOVIDADE GOOGLE: ${nv.join(' ‖ ')}`);

// Google Agenda por pessoa: só contagens (nunca o nome dos compromissos).
const ga: any[] = await get('states?select=user_id,data');
const gl = ga.filter((x) => x.data?.integ?.agenda).map((x) => {
  const d = x.data, ts = (d.tasks || []).filter((t: any) => t.source === 'google');
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const fut = ts.filter((t: any) => t.date >= hoje), dias = new Set(fut.map((t: any) => t.date)).size;
  return `${String(d.name || '?').split(' ')[0]}: ${ts.length} do Google (${fut.length} de hoje em diante, em ${dias} dias; até ${fut.map((t: any) => t.date).sort().pop() || '-'}) · sem horário ${fut.filter((t: any) => t.start == null).length} · sincronizou ${d.stats?.agendaSync || 0}x · agendas ${d.stats?.gcals ?? '?'} · erro ${d.stats?.agendaErr || '-'} · cópias velhas ${Object.keys(d.gmap || {}).length}`;
});
console.log(`::warning::GOOGLE AGENDA: ${gl.join(' ‖ ') || 'ninguém ligou'}`);

// Uso da IA (para estimar o crédito): chamadas e tokens de saída por dia, desde o registro (5/11).
const ai: any[] = await get('ai_log?select=at,model,status,out_tokens&order=at.asc&limit=10000');
const porDia = new Map<string, { n: number; ok: number; out: number; sonnet: number }>();
for (const x of ai) { const d = new Date(Date.parse(x.at) - 3 * 3600e3).toISOString().slice(0, 10); const o = porDia.get(d) ?? { n: 0, ok: 0, out: 0, sonnet: 0 }; o.n++; if (x.status === 200) o.ok++; o.out += x.out_tokens || 0; if (/sonnet/.test(x.model || '')) o.sonnet++; porDia.set(d, o); }
const reqs = (await get('states?select=data->stats->>requests')).reduce((a: number, x: any) => a + (+x.requests || 0), 0);
console.log(`::warning::IA USO: ${[...porDia].map(([d, o]) => `${d}: ${o.n} chamadas (${o.ok} ok, ${o.sonnet} Sonnet), ${o.out} tokens de saída`).join(' ‖ ')} ‖ total ${ai.length} chamadas registradas; pedidos somados de todos desde o início: ${reqs}`);

// Planos da Íris esperando "Confirmar" (só contagens e datas, nunca o texto).
const pend = ga.filter((x) => (x.data?.chat || []).some((m: any) => m?.proposal)).map((x) => {
  const ps = (x.data.chat || []).filter((m: any) => m?.proposal);
  const p = ps.filter((m: any) => m.proposal.status === 'pending');
  return `${String(x.data.name || '?').split(' ')[0]}: ${ps.length} planos, ${p.length} sem confirmar${p.length ? ` (último ${new Date(Math.max(...p.map((m: any) => m.at || m.ts || 0))).toISOString().slice(0, 16)})` : ''} · perguntar antes: ${x.data.settings?.askBefore !== false ? 'sim' : 'não'}`;
});
console.log(`::warning::CONFIRMAR: ${pend.join(' ‖ ')}`);

// Login com Google ligado?
const anon = keys.find((k) => k.name === 'anon' || k.type === 'publishable')!.api_key;
const conf: any = await (await fetch(`https://${REF}.supabase.co/auth/v1/settings`, { headers: { apikey: anon } })).json();
const red = await fetch(`https://${REF}.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://tiagocampelodeoliveira-oss.github.io/Faiz_web/')}`, { redirect: 'manual', headers: { apikey: anon } });
console.log(`::warning::GOOGLE: provedor ${conf?.external?.google ? 'LIGADO' : 'DESLIGADO'} | anônimo ${conf?.external?.anonymous_users ?? '?'} | redireciona para ${(red.headers.get('location') || '').slice(0, 60)} (${red.status})`);
