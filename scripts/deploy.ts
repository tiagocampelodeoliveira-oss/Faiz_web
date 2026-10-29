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
