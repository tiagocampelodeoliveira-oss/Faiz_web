// Voz da Íris (Thalita, voz neural da Microsoft) para o chat de voz.
// Usa o serviço gratuito de leitura em voz alta do navegador Edge (o mesmo do vídeo de apresentação).
// É um serviço não oficial: serve para o teste. Para o lançamento, trocar pelo Azure Speech (mesma voz, plano grátis).
// Se falhar, o app usa a voz do próprio celular.

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VERSIONS = ['143.0.3650.75', '140.0.3485.14', '130.0.2849.68'];
export const VOZ = 'pt-BR-ThalitaMultilingualNeural';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
const uuid = () => crypto.randomUUID().replace(/-/g, '');
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Senha que muda a cada 5 minutos, exigida pelo serviço. */
async function gec(now = Date.now()): Promise<string> {
  let t = Math.floor(now / 1000) + 11644473600;
  t -= t % 300;
  const ticks = BigInt(t) * 10000000n;
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ticks}${TOKEN}`)));
}

/** Tira emoji e espaços sobrando (a voz lê "carinha sorrindo" se não tirar). */
export function limpar(t: string): string {
  return String(t || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[•]/g, ',').replace(/\s+/g, ' ').trim().slice(0, 700);
}

function ssml(text: string, voz: string): string {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'><voice name='${voz}'><prosody pitch='+4Hz' rate='+6%' volume='+0%'>${xml(text)}</prosody></voice></speak>`;
}

function tentar(text: string, voz: string, version: string, sec: string, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${sec}&Sec-MS-GEC-Version=1-${version}&ConnectionId=${uuid()}`;
    const major = version.split('.')[0];
    const headers = {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    let ws: WebSocket;
    try {
      // Deno e Node aceitam cabeçalhos no 2º argumento (fora do padrão dos navegadores).
      ws = new (WebSocket as any)(url, { headers });
    } catch {
      ws = new WebSocket(url);
    }
    ws.binaryType = 'arraybuffer';
    const parts: Uint8Array[] = [];
    const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error('tts_timeout')); }, timeoutMs);
    const fim = (err?: Error) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* */ }
      if (err) return reject(err);
      const n = parts.reduce((a, p) => a + p.length, 0);
      if (!n) return reject(new Error('tts_vazio'));
      const out = new Uint8Array(n);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      resolve(out);
    };
    ws.onopen = () => {
      const ts = new Date().toString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      ws.send(`X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml(text, voz)}`);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        if (e.data.includes('Path:turn.end')) fim();
        return;
      }
      const buf = new Uint8Array(e.data as ArrayBuffer);
      if (buf.length < 2) return;
      const hl = (buf[0] << 8) | buf[1];
      const head = new TextDecoder().decode(buf.subarray(2, 2 + hl));
      if (head.includes('Path:audio')) parts.push(buf.slice(2 + hl));
    };
    ws.onerror = () => fim(new Error('tts_ws'));
    ws.onclose = (e: CloseEvent) => { if (!parts.length) fim(new Error(`tts_close_${e.code}`)); else fim(); };
  });
}

/** Áudio MP3 com a fala (até ~700 caracteres). Tenta as versões conhecidas do navegador. */
export async function falar(texto: string, voz = VOZ, timeoutMs = 9000): Promise<Uint8Array> {
  const t = limpar(texto);
  if (!t) throw new Error('tts_texto');
  const sec = await gec();
  let ultimo: unknown;
  for (const v of VERSIONS) {
    try { return await tentar(t, voz, v, sec, timeoutMs); } catch (e) { ultimo = e; }
  }
  throw ultimo;
}
