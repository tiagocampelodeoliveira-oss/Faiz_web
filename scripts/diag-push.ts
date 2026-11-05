// Diagnóstico dos avisos (sem conteúdo): por pessoa, quais celulares estão inscritos e quantos avisos saíram.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
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

// Login com Google ligado?
const anon = keys.find((k) => k.name === 'anon' || k.type === 'publishable')!.api_key;
const conf: any = await (await fetch(`https://${REF}.supabase.co/auth/v1/settings`, { headers: { apikey: anon } })).json();
const red = await fetch(`https://${REF}.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://tiagocampelodeoliveira-oss.github.io/Faiz_web/')}`, { redirect: 'manual', headers: { apikey: anon } });
console.log(`::warning::GOOGLE: provedor ${conf?.external?.google ? 'LIGADO' : 'DESLIGADO'} | anônimo ${conf?.external?.anonymous_users ?? '?'} | redireciona para ${(red.headers.get('location') || '').slice(0, 60)} (${red.status})`);
