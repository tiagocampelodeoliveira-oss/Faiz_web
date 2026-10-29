// Acesso ao banco (PostgREST com a chave de serviço) e ao login, só com fetch.

export const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('FAIZ_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('FAIZ_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;

function keyHeaders(key: string): Record<string, string> {
  // Chaves novas (sb_...) vão só no apikey; chaves antigas (JWT) também no Authorization.
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Chamada ao banco como servidor (ignora as regras de acesso por pessoa). */
export async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { ...keyHeaders(SERVICE), 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${res.status} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Quem está chamando (pelo token do app). */
export async function getUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { id: u.id } : null;
}

export function vapid() {
  const publicKey = Deno.env.get('FAIZ_VAPID_PUBLIC') || '';
  const privateKey = Deno.env.get('FAIZ_VAPID_PRIVATE') || '';
  const subject = Deno.env.get('FAIZ_SITE_URL') || 'https://github.com';
  return { keys: { publicKey, privateKey }, subject };
}
