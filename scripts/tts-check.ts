// Testa a voz da Íris (serviço de leitura do Edge) direto no computador do GitHub. Não publica nada.
import { falar } from '../supabase/functions/_shared/tts.ts';
const ini = Date.now();
try {
  const mp3 = await falar('Oi! Eu sou a Íris. Bora organizar o seu dia? 😉');
  const ok = mp3.length > 5000 && mp3[0] === 0xff || (mp3[0] === 0x49 && mp3[1] === 0x44);
  console.log(`::warning::VOZ (${typeof (globalThis as any).Deno !== 'undefined' ? 'Deno' : 'Node'}): ${ok ? 'OK' : 'ESTRANHO'} ${mp3.length} bytes em ${Date.now() - ini} ms, início ${[...mp3.slice(0, 4)].map((b) => b.toString(16)).join(' ')}`);
} catch (e) {
  console.log(`::warning::VOZ (${typeof (globalThis as any).Deno !== 'undefined' ? 'Deno' : 'Node'}): FALHOU ${String((e as Error)?.message || e)} em ${Date.now() - ini} ms`);
}
