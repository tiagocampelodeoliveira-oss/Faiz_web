// Teste de fumaça do servidor no ar (roda no GitHub Actions depois de publicar).
// Cria uma conta anônima de teste, grava uma agenda, chama a IA, o relógio e o aviso de teste, e apaga a conta.
const URL_ = process.env.SUPA_URL!;
const ANON = process.env.SUPA_ANON!;
const SERVICE = process.env.SUPA_SERVICE!;
const TICK = process.env.TICK_SECRET!;
const fn = `${URL_}/functions/v1`;
const keyH = (k: string): Record<string, string> => (k.startsWith('sb_') ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` });
let failures = 0;
const check = (name: string, ok: boolean, info: unknown = '') => {
  console.log(`${ok ? '::notice::OK ' : '::error::FALHA '} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`);
  if (!ok) failures++;
};
async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, body };
}

// 1. Configuração pública
const cfg = await call(`${fn}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ action: 'config' }) });
check('função api responde', cfg.status === 200, cfg.status);
check('chave pública de aviso existe', typeof cfg.body?.vapidPublicKey === 'string' && cfg.body.vapidPublicKey.length > 80);
const AI = process.env.ANTHROPIC_SET !== 'false';
if (AI) check('IA configurada', cfg.body?.ai === true); else console.log('AVISO IA ainda sem chave (segredo ANTHROPIC_API_KEY): pulei os testes da IA');

// 2. Conta anônima
const su = await call(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ data: {} }) });
const token = su.body?.access_token;
const uid = su.body?.user?.id;
check('conta anônima criada', !!token && !!uid, su.status === 200 ? '' : su.body);

if (token) {
  const auth = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` };
  // 3. Grava e lê a agenda (regras de acesso por pessoa)
  const data = { name: 'Teste', settings: { tz: 'America/Sao_Paulo' }, tasks: [{ id: 'x1', title: 'Teste', date: '2026-01-01', start: 600 }] };
  const up = await call(`${URL_}/rest/v1/states?on_conflict=user_id`, { method: 'POST', headers: { ...auth, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, data, updated_at: new Date().toISOString() }) });
  check('grava a agenda', up.status === 201 || up.status === 200 || up.status === 204, up.status === 201 ? '' : up.body);
  const rd = await call(`${URL_}/rest/v1/states?select=data`, { headers: auth });
  check('lê só a própria agenda', Array.isArray(rd.body) && rd.body.length === 1 && rd.body[0].data?.tasks?.[0]?.id === 'x1', Array.isArray(rd.body) ? rd.body.length : rd.body);

  // 4. IA
  if (AI) {
  const ai = await call(`${fn}/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'ai', prompt: 'Responda só com o JSON {"ok": true}.' }) });
  check('IA responde', ai.status === 200 && /ok/.test(ai.body?.text || ''), ai.status === 200 ? (ai.body?.text || '').slice(0, 60) : ai.body);
  }

  // 5. Aviso de teste sem celular inscrito
  const t = await call(`${fn}/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'test' }) });
  check('aviso de teste responde', t.status === 200 && t.body?.reason === 'no_subscription', t.body);

  // 6. Inscrição recusa endereço inválido
  const bad = await call(`${fn}/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'subscribe', subscription: { endpoint: 'http://x' } }) });
  check('inscrição valida os dados', bad.status === 400, bad.status);
}

// 7. Relógio
const tk = await call(`${fn}/tick`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tick-secret': TICK }, body: '{}' });
check('relógio roda', tk.status === 200, tk.body);
const tk2 = await call(`${fn}/tick`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tick-secret': 'errado' }, body: '{}' });
check('relógio recusa quem não tem o segredo', tk2.status === 403, tk2.status);

// 8. Limpeza
if (uid) {
  const del = await call(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: keyH(SERVICE) });
  check('conta de teste apagada', del.status === 200, del.status);
}

if (failures) { console.log(`::error::${failures} verificação(ões) falharam`); process.exit(1); }
console.log('Tudo certo no servidor.');
