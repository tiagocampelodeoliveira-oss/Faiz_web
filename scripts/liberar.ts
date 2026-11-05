// Libera pessoas do teste sem limite (7 dias de IA e 40 pedidos por dia), pelo primeiro nome cadastrado no app.
// Roda no GitHub Actions: workflow "Liberar sem limite", campo "nomes" (ex.: "Amanda, Jhuliana").
// Só libera quando o nome bate com UMA pessoa; se bater com mais de uma, avisa e não libera ninguém com aquele nome.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const NOMES = String(process.env.NOMES || '').split(',').map((s) => s.trim()).filter(Boolean);
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const H = { apikey: service, ...(service.startsWith('sb_') ? {} : { Authorization: `Bearer ${service}` }), 'Content-Type': 'application/json' };
const base = `https://${REF}.supabase.co/rest/v1`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const states: { user_id: string; data: any }[] = await (await fetch(`${base}/states?select=user_id,data->name`, { headers: H })).json().then((r: any) => r.map((x: any) => ({ user_id: x.user_id, data: { name: x.name } })));
const linhas: string[] = [];
for (const nome of NOMES) {
  const alvo = norm(nome).split(/\s+/);
  // pontua quantas palavras digitadas aparecem no nome; fica com quem tem a maior pontuação (precisa ser uma pessoa só)
  const pont = states.map((s) => ({ s, n: (() => { const ws = norm(String(s.data?.name || '')).split(/\s+/); return alvo.filter((w) => ws.includes(w)).length; })() }));
  const max = Math.max(0, ...pont.map((p) => p.n));
  const achados = max ? pont.filter((p) => p.n === max).map((p) => p.s) : [];
  if (achados.length !== 1) { linhas.push(`${nome}: ${achados.length === 0 ? 'ninguém com esse nome' : `${achados.length} pessoas com esse nome, não liberei (${achados.map((a) => a.data.name).join(' / ')})`}`); continue; }
  const p = achados[0];
  const r = await fetch(`${base}/unlimited?on_conflict=user_id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: p.user_id, nome: p.data.name }) });
  linhas.push(`${nome}: ${r.ok ? `LIBERADO (${p.data.name})` : `erro ${r.status}`}`);
}
const lista: any[] = await (await fetch(`${base}/unlimited?select=nome`, { headers: H })).json();
console.log(`::warning::LIBERAR: ${linhas.join(' ‖ ')} ‖ Sem limite agora: ${lista.map((l) => l.nome).join(', ') || '(ninguém)'}`);
