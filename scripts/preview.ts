// Confere quem recebeu o aviso de volta (só nomes e horários, sem texto) e como a IA respondeu.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const H = { apikey: service, ...(service.startsWith('sb_') ? {} : { Authorization: `Bearer ${service}` }) };
const base = `https://${REF}.supabase.co/rest/v1`;
const sent: any[] = await (await fetch(`${base}/sent?select=user_id,key,created_at&key=like.v:2026-11-08:19h`, { headers: H })).json();
const st: any[] = await (await fetch(`${base}/states?select=user_id,name:data->>name`, { headers: H })).json();
const nome = (id: string) => st.find((s) => s.user_id === id)?.name || String(id).slice(0, 6);
const log: any[] = await (await fetch(`${base}/ai_log?select=user_id,at,status,err,stop,out_tokens,ms&model=like.volta*&order=at.desc&limit=20`, { headers: H })).json();
const hora = (x: string) => new Date(x).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
console.log(`::warning::VOLTA 19H: ${sent.map((s) => `${nome(s.user_id)} ${hora(s.created_at)}`).join(' ‖ ') || '(ninguém)'} ‖ IA: ${log.map((l) => `${nome(l.user_id)} ${hora(l.at)} ${l.status} ${l.err || 'ok'} ${l.stop} ${l.out_tokens}tok`).join(' | ')}`);
