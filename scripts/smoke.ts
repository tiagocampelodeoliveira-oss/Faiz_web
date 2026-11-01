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
  check('IA usa o modelo Sonnet', /sonnet/.test(ai.body?.model || ''), ai.body?.model || ai.body);
  }

  // 4b. Lugares perto (OpenStreetMap). Serviço de terceiros: falha vira aviso, não trava a publicação.
  const nb = await call(`${fn}/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'nearby', lat: -23.5614, lon: -46.6559, termo: 'padaria', osm: ['shop=bakery'] }) });
  const nOk = nb.status === 200 && Array.isArray(nb.body?.places) && nb.body.places.length > 0;
  console.log(`${nOk ? '::notice::OK ' : '::warning::AVISO '} padarias perto da Av. Paulista — ${nOk ? nb.body.places.map((p: any) => `${p.nome} ${p.dist} m`).slice(0, 3).join('; ') + ' | ' + (nb.body.diag || []).join(', ') : JSON.stringify(nb.body).slice(0, 400)}`);

  // 4c. Frases reais com a IA de verdade, usando a lógica publicada no site (site/index.html).
  if (AI) {
    const { readFileSync } = await import('node:fs');
    const vm = await import('node:vm');
    const html = readFileSync('site/index.html', 'utf8');
    const logicSrc = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes('FazLogic'))!;
    const box: any = {}; vm.runInNewContext(logicSrc + ';this.L = FazLogic;', box);
    const L = box.L;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const amanha = L.addDays(L.dateKey(now), 1);
    const tasks = [{ id: 'acad1', title: 'Academia', date: amanha, start: 420, end: 480, category: 'pessoal', color: 'green', status: 'pendente', createdAt: 0 }];
    const frases: [string, (r: any) => boolean][] = [
      ['padaria mais proxima de mim', (r) => r.nearby?.osm?.includes('shop=bakery')],
      ['posto de gasolina mais proximo de mim', (r) => r.nearby?.osm?.includes('amenity=fuel')],
      ['quero correr amanhã depois do trabalho e jantar com a Ana às 21h', (r) => (r.ops || []).length >= 2 && (r.plan || []).some((p: any) => p.start === 1260)],
      ['marca uma reunião', (r) => !r.ops && /\?/.test(r.text)],
      ['cancela a academia de amanhã e coloca corrida às 7', (r) => (r.ops || []).some((o: any) => o.type === 'remove' && o.id === 'acad1') && (r.ops || []).some((o: any) => o.type === 'add' && o.task.start === 420)],
    ];
    const linhas: string[] = [];
    const caches: any[] = [];
    for (const [frase, ok] of frases) {
      const parts = L.buildPromptParts(frase, { now, tasks });
      const res = await call(`${fn}/api`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'ai', system: parts.system, prompt: parts.user }) });
      caches.push(res.body?.cache || {});
      let r: any = null;
      try { const t = String(res.body?.text || ''); r = L.aiToReply(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)), frase, { now, tasks }); } catch { /* resposta fora do formato */ }
      const good = !!r && ok(r);
      const resumo = r ? `${r.text.slice(0, 90)}${r.ops ? ' | ops: ' + r.ops.map((o: any) => o.type + (o.task ? ' ' + o.task.title + ' ' + L.fmtTime(o.task.start ?? 0) : '')).join(', ') : ''}${r.nearby ? ' | busca: ' + r.nearby.osm.join(',') : ''}` : String(res.body?.text || JSON.stringify(res.body)).slice(0, 160);
      linhas.push(`${good ? 'OK' : 'ERROU'} "${frase}" → ${resumo}`);
    }
    console.log(`::warning::FRASES DA IA: ${linhas.join(' ‖ ')}`);
    const lidos = caches.slice(1).filter((c) => c.read > 0).length;
    console.log(`${lidos >= 3 ? '::notice::OK ' : '::warning::AVISO '} cache da parte fixa — ${lidos} de 4 pedidos leram do cache ${JSON.stringify(caches)}`);
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
