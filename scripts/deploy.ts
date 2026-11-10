// Prepara o Supabase pela API de gerenciamento (roda no GitHub Actions).
// Entradas (segredos do GitHub): SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, ANTHROPIC_API_KEY, OWNER_WHATSAPP, SITE_URL.
// Saídas: site/config.js e, em $GITHUB_ENV, as variáveis usadas pelo teste de fumaça.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { generateVapidKeys } from '../supabase/functions/_shared/webpush.ts';

const TOKEN = need('SUPABASE_ACCESS_TOKEN');
const REF = need('SUPABASE_PROJECT_REF').trim();
const SITE_URL = need('SITE_URL');
const API = `https://api.supabase.com/v1/projects/${REF}`;

function need(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`::error::Falta o segredo ${k} no GitHub (Settings > Secrets and variables > Actions).`); process.exit(1); }
  return v;
}
for (const ev of ['unhandledRejection', 'uncaughtException']) process.on(ev as 'uncaughtException', (e) => { console.log(`::error::Preparar Supabase: ${String((e as Error)?.message || e).replace(/\n/g, ' ').slice(0, 900)}`); process.exit(1); });
function step(msg: string) { console.log(`::notice::${msg}`); }
async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query: string) => api('/database/query', { method: 'POST', body: JSON.stringify({ query }) });

// 1. Chaves do projeto (a pública vai para o site; a de serviço fica só no servidor).
const keys: { name: string; type?: string; api_key: string }[] = await api('/api-keys?reveal=true');
const pick = (...names: string[]) => keys.find((k) => names.includes(k.name) || names.includes(k.type || ''))?.api_key;
const anon = pick('anon', 'publishable');
const service = pick('service_role', 'secret');
if (!anon || !service) throw new Error('Não achei as chaves do projeto: ' + keys.map((k) => k.name + '/' + k.type).join(', '));
step('chaves: ' + keys.map((k) => k.name).join(', '));

// 2. Login sem cadastro (conta anônima por celular).
try {
  await api('/config/auth', { method: 'PATCH', body: JSON.stringify({ external_anonymous_users_enabled: true }) });
  step('login anônimo ligado');
} catch (e) {
  console.log('::warning::Não pude ligar o login anônimo pela chave (falta permissão de administrador). Ligue no painel: Authentication > Sign In / Providers > Allow anonymous sign-ins.');
}

// 3. Banco.
await sql(readFileSync('supabase/schema.sql', 'utf8'));
step('banco aplicado');
try {
  const pt = await sql("select count(*)::int as contas, (select count(*)::int from auth.identities i where i.provider = 'google' and i.user_id in (select user_id from public.pagar_teste)) as com_google from public.pagar_teste");
  step('TESTE DE PAGAMENTO liberado para: ' + JSON.stringify(pt).slice(0, 200));
} catch (e) { console.log(`::warning::não consegui contar pagar_teste: ${(e as Error).message.slice(0, 150)}`); }

// 4. Segredos das funções. As chaves VAPID nascem uma vez e nunca mudam (senão os celulares param de receber).
const existing = new Set(((await api('/secrets')) as { name: string }[]).map((s) => s.name));
const tick = randomBytes(24).toString('hex');
if (process.env.GITHUB_ENV) console.log(`::add-mask::${tick}`);
const secrets: { name: string; value: string }[] = [
  { name: 'FAIZ_SERVICE_KEY', value: service },
  { name: 'FAIZ_ANON_KEY', value: anon },
  { name: 'FAIZ_SITE_URL', value: SITE_URL },
  { name: 'FAIZ_TICK_SECRET', value: tick },
];
if (process.env.ANTHROPIC_API_KEY) secrets.push({ name: 'FAIZ_ANTHROPIC_KEY', value: process.env.ANTHROPIC_API_KEY.trim() });
if (process.env.AZURE_SPEECH_KEY) secrets.push({ name: 'FAIZ_AZURE_SPEECH_KEY', value: process.env.AZURE_SPEECH_KEY.trim() });
if (process.env.AZURE_SPEECH_REGION) secrets.push({ name: 'FAIZ_AZURE_SPEECH_REGION', value: process.env.AZURE_SPEECH_REGION.trim().toLowerCase() });
if (process.env.GOOGLE_CLIENT_ID) secrets.push({ name: 'FAIZ_GOOGLE_ID', value: process.env.GOOGLE_CLIENT_ID.trim() });
if (process.env.GOOGLE_CLIENT_SECRET) secrets.push({ name: 'FAIZ_GOOGLE_SECRET', value: process.env.GOOGLE_CLIENT_SECRET.trim() });
// Mercado Pago (assinatura do Plus). Confere a chave sem mostrar dados da conta.
const mpTok = (process.env.MP_ACCESS_TOKEN || '').trim();
if (mpTok) {
  try {
    // /users/me pode vir 403 (política da aplicação); o que importa é a chave abrir as assinaturas.
    const H = { Authorization: `Bearer ${mpTok}` };
    const r = await fetch('https://api.mercadopago.com/preapproval/search?limit=1', { headers: H });
    const j: any = await r.json().catch(() => ({}));
    const pm = await fetch('https://api.mercadopago.com/v1/payment_methods', { headers: H });
    if (!r.ok) console.log(`::warning::MERCADO PAGO: assinaturas recusaram a chave (${r.status} ${String(j.message || j.error || '').slice(0, 80)}); meios de pagamento: ${pm.status} ${String(((await pm.json().catch(() => ({}))) as any).message || '').slice(0, 80)}; a chave tem ${mpTok.length} caracteres, começa com "${mpTok.slice(0, 8)}", ${/\s/.test(mpTok) ? 'TEM espaço ou quebra de linha no meio' : 'sem espaços'}. Confira o segredo MP_ACCESS_TOKEN (Access Token de produção, começa com APP_USR-).`);
    else {
      step(`MERCADO PAGO: chave aceita nas assinaturas (${j.paging?.total ?? 0} até agora) · meios de pagamento ${pm.status} · ${mpTok.startsWith('APP_USR-') ? 'formato de produção' : 'formato de teste'}`);
      secrets.push({ name: 'FAIZ_MP_TOKEN', value: mpTok });
      // Só quando o commit traz [pix-teste]: cria um Pix de teste (ninguém paga) e cancela na hora, para conferir se a conta recebe Pix.
      if (process.env.PIX_TESTE === 'true') {
        const c = await fetch('https://api.mercadopago.com/v1/payments', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', 'X-Idempotency-Key': randomBytes(16).toString('hex') }, body: JSON.stringify({ transaction_amount: 9.9, description: 'Faiz Plus (1 mês)', payment_method_id: 'pix', external_reference: 'teste-do-deploy', date_of_expiration: new Date(Date.now() + 30 * 60e3).toISOString().replace('Z', '+00:00'), payer: { email: 'teste@example.com' } }) });
        const cj: any = await c.json().catch(() => ({}));
        if (!c.ok || !cj.id) console.log(`::warning::PIX TESTE: criar o Pix falhou (${c.status} ${String(cj.message || cj.error || '').slice(0, 200)} ${JSON.stringify(cj.cause || '').slice(0, 200)})`);
        else {
          const td = cj.point_of_interaction?.transaction_data || {};
          const x = await fetch(`https://api.mercadopago.com/v1/payments/${cj.id}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
          const xj: any = await x.json().catch(() => ({}));
          step(`PIX TESTE: Pix criado (status ${cj.status}, código ${String(td.qr_code || '').startsWith('000201') ? 'ok' : 'FALTOU'}, QR ${td.qr_code_base64 ? 'ok' : 'FALTOU'}, valor ${cj.transaction_amount}, vence ${cj.date_of_expiration}, taxa ${JSON.stringify((cj.fee_details || []).map((f: any) => f.amount))}) e cancelado (${x.status} ${xj.status || String(xj.message || '').slice(0, 80)})`);
        }
      }
      // Só quando o commit traz [mp-teste]: cria uma assinatura de teste (ninguém paga) e cancela na hora, para conferir o formato.
      if (process.env.MP_TESTE === 'true') {
        const c = await fetch('https://api.mercadopago.com/preapproval', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Faiz Plus', external_reference: 'teste-do-deploy', payer_email: 'teste@example.com', back_url: SITE_URL + '?v=assinatura', status: 'pending', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 9.9, currency_id: 'BRL' } }) });
        const cj: any = await c.json().catch(() => ({}));
        if (!c.ok || !cj.id) console.log(`::warning::MP TESTE: criar assinatura falhou (${c.status} ${String(cj.message || cj.error || '').slice(0, 160)})`);
        else {
          const x = await fetch(`https://api.mercadopago.com/preapproval/${cj.id}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
          const xj: any = await x.json().catch(() => ({}));
          step(`MP TESTE: assinatura criada (status ${cj.status}, link ${String(cj.init_point || '').startsWith('https://www.mercadopago.com.br/') ? 'ok' : 'FALTOU'}, valor ${cj.auto_recurring?.transaction_amount} ${cj.auto_recurring?.currency_id}, referência ${cj.external_reference === 'teste-do-deploy' ? 'ok' : 'FALTOU'}) e cancelada (${x.status} ${xj.status || String(xj.message || '').slice(0, 80)})`);
        }
      }
    }
  } catch (e) { console.log(`::warning::MERCADO PAGO: não consegui falar com a API (${(e as Error).message}).`); }
} else console.log('::warning::MERCADO PAGO: o segredo MP_ACCESS_TOKEN não chegou (vazio).');
if (process.env.OWNER_WHATSAPP) secrets.push({ name: 'FAIZ_WHATSAPP', value: process.env.OWNER_WHATSAPP.replace(/\D/g, '') });
if (!existing.has('FAIZ_VAPID_PRIVATE') || !existing.has('FAIZ_VAPID_PUBLIC')) {
  const v = await generateVapidKeys();
  secrets.push({ name: 'FAIZ_VAPID_PUBLIC', value: v.publicKey }, { name: 'FAIZ_VAPID_PRIVATE', value: v.privateKey });
  step('chaves de aviso criadas');
}
await api('/secrets', { method: 'POST', body: JSON.stringify(secrets) });
step('segredos gravados: ' + secrets.map((s) => s.name).join(', '));

// 5. Relógio: chama a função tick a cada minuto.
const fnUrl = `https://${REF}.supabase.co/functions/v1/tick`;
const headers = JSON.stringify({ 'Content-Type': 'application/json', 'x-tick-secret': tick }).replace(/'/g, "''");
await sql(`select cron.schedule('faiz-tick', '* * * * *', $cron$ select net.http_post(url := '${fnUrl}', headers := '${headers}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 25000) $cron$);`);
step('relógio de 1 minuto agendado');

// 6. Configuração do site (só dados públicos).
const supaUrl = `https://${REF}.supabase.co`;
writeFileSync('site/config.js', `window.FAIZ_CONFIG = ${JSON.stringify({ supabaseUrl: supaUrl, anonKey: anon, siteUrl: SITE_URL })};\n`);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SUPA_URL=${supaUrl}\nSUPA_ANON=${anon}\nTICK_SECRET=${tick}\n`);
// A chave de serviço só passa para o teste de fumaça (apagar o usuário de teste), mascarada no log.
if (process.env.GITHUB_ENV) { console.log(`::add-mask::${service}`); appendFileSync(process.env.GITHUB_ENV, `SUPA_SERVICE=${service}\n`); }
console.log('pronto');
