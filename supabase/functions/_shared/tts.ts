// Voz da Íris (Thalita) para o chat de voz, pelo serviço oficial da Microsoft (Azure Speech, plano grátis F0).
// Liga sozinha quando existem os segredos FAIZ_AZURE_SPEECH_KEY e FAIZ_AZURE_SPEECH_REGION.
// Sem eles (ou se falhar), o app usa a voz do próprio celular.

export const VOZ = 'pt-BR-ThalitaMultilingualNeural';
const env = (k: string) => (typeof Deno !== 'undefined' ? Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';
export const ttsLigado = () => !!(env('FAIZ_AZURE_SPEECH_KEY') && env('FAIZ_AZURE_SPEECH_REGION'));

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Tira emoji e espaços sobrando (a voz lê "carinha sorrindo" se não tirar). */
export function limpar(t: string): string {
  return String(t || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[•]/g, ',').replace(/\s+/g, ' ').trim().slice(0, 700);
}

export function ssml(text: string, voz = VOZ): string {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'><voice name='${voz}'><prosody pitch='+4Hz' rate='+6%'>${xml(text)}</prosody></voice></speak>`;
}

/** Áudio MP3 com a fala (até ~700 caracteres). */
export async function falar(texto: string, voz = VOZ): Promise<Uint8Array> {
  const t = limpar(texto);
  if (!t) throw new Error('tts_texto');
  if (!ttsLigado()) throw new Error('tts_off');
  const r = await fetch(`https://${env('FAIZ_AZURE_SPEECH_REGION')}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env('FAIZ_AZURE_SPEECH_KEY'),
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'faiz',
    },
    body: ssml(t, voz),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`tts_${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
