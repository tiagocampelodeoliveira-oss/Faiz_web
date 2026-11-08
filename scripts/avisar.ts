// Manda um aviso pessoal para UMA pessoa do teste, pelo primeiro nome cadastrado no app.
// Roda no GitHub Actions: workflow "Mandar aviso" (campos nome, titulo, texto, quando).
// "quando" = data e hora de Brasília ("2026-11-09 12:00"); vazio = agora. Quem manda é o relógio (tick), uma vez só.
// Sem nome (só "quando" vazio e nome "-") só lista os últimos avisos e se chegaram.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const NOME = String(process.env.NOME || '').trim();
const TITULO = String(process.env.TITULO || '').trim().slice(0, 80);
const TEXTO = String(process.env.TEXTO || '').trim().slice(0, 300);
const QUANDO = String(process.env.QUANDO || '').trim();
const URL_ = String(process.env.LINK || '').trim() || './?v=planejar';
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const H = { apikey: service, ...(service.startsWith('sb_') ? {} : { Authorization: `Bearer ${service}` }), 'Content-Type': 'application/json' };
const base = `https://${REF}.supabase.co/rest/v1`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const brt = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '-';
let linha = '';

if (NOME && NOME !== '-') {
  if (!TITULO || !TEXTO) { console.log('::error::Falta título ou texto.'); process.exit(1); }
  let sendAt = new Date();
  if (QUANDO) {
    const m = QUANDO.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (!m) { console.log('::error::"quando" deve ser como 2026-11-09 12:00'); process.exit(1); }
    sendAt = new Date(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:00-03:00`);
  }
  const states: { user_id: string; name: string }[] = await (await fetch(`${base}/states?select=user_id,name:data->>name`, { headers: H })).json();
  const alvo = norm(NOME).split(/\s+/);
  const pont = states.map((s) => ({ s, n: alvo.filter((w) => norm(String(s.name || '')).split(/\s+/).includes(w)).length }));
  const max = Math.max(0, ...pont.map((p) => p.n));
  const achados = max ? pont.filter((p) => p.n === max).map((p) => p.s) : [];
  if (achados.length !== 1) {
    linha = `${NOME}: ${achados.length === 0 ? 'ninguém com esse nome' : `${achados.length} pessoas com esse nome, não mandei (${achados.map((a) => a.name).join(' / ')})`}`;
  } else {
    const p = achados[0];
    const subs: any[] = await (await fetch(`${base}/subs?select=endpoint&user_id=eq.${p.user_id}`, { headers: H })).json();
    const r = await fetch(`${base}/manual_push`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: p.user_id, nome: p.name, title: TITULO, body: TEXTO, url: URL_, send_at: sendAt.toISOString() }) });
    linha = r.ok ? `${p.name}: AGENDADO para ${brt(sendAt.toISOString())} (${subs.length} celular(es) com avisos ligados${subs.length ? '' : ' — NÃO VAI CHEGAR'})` : `${NOME}: erro ${r.status} ${(await r.text()).slice(0, 200)}`;
  }
}
const ult: any[] = await (await fetch(`${base}/manual_push?select=nome,title,send_at,sent_at,entregues&order=id.desc&limit=8`, { headers: H })).json();
const lista = (Array.isArray(ult) ? ult : []).map((u) => `${u.nome} "${u.title}" para ${brt(u.send_at)}: ${u.sent_at ? `saiu ${brt(u.sent_at)}, chegou em ${u.entregues ?? '?'} celular(es)` : 'aguardando'}`).join(' ‖ ');
console.log(`::warning::AVISO: ${linha || '(só lista)'} ‖ Últimos: ${lista || '(nenhum)'}`);
