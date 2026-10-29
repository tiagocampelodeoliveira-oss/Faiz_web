// Envio de notificações Web Push (RFC 8291 + VAPID, RFC 8292) só com WebCrypto.
// Funciona no Deno (Supabase Edge Functions) e no Node 20+ (testes). Sem dependências.

const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export type VapidKeys = { publicKey: string; privateKey: string }; // base64url: público 65 bytes (não comprimido), privado 32 bytes
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Gera um par de chaves VAPID novo (usado uma vez, na primeira publicação). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64u(raw), privateKey: jwk.d! };
}

async function vapidAuth(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const pub = unb64u(keys.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: keys.privateKey, ext: true };
  const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}

/** Criptografa a mensagem para uma inscrição (aes128gcm, um registro). */
export async function encrypt(payload: Uint8Array, sub: Subscription, salt?: Uint8Array): Promise<Uint8Array> {
  const uaPub = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  salt = salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const as = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await subtle.exportKey('raw', as.publicKey));
  const uaKey = await subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export type SendResult = { ok: boolean; status: number; gone: boolean; text?: string };

/** Envia uma notificação. `gone` = a inscrição não existe mais (apagar do banco). */
export async function sendPush(sub: Subscription, data: unknown, keys: VapidKeys, subject: string, ttl = 1800): Promise<SendResult> {
  const body = await encrypt(te.encode(JSON.stringify(data)), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body,
  });
  const text = res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 300);
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, text };
}

export const _test = { vapidAuth, hkdf, concat };
