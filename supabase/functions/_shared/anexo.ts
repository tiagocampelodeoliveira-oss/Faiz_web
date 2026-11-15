// Foto ou documento que a pessoa manda para a Íris (boleto, horário de aula, convite...).
// O arquivo vai direto para a IA e é descartado: o servidor nunca guarda nem registra o conteúdo.

/** Tamanho máximo em base64 (~3,3 MB de arquivo). O app reduz as fotos antes de mandar. */
export const ANEXO_MAX = 4_500_000;
export const ANEXO_TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

/** Confere o anexo e monta o bloco no formato da Anthropic. Sem anexo = {}. */
export function anexoBloco(a: unknown): { bloco?: Record<string, unknown>; erro?: 'bad_request' | 'anexo_grande' } {
  if (a == null) return {};
  const mt = String((a as any)?.mt || '');
  const data = String((a as any)?.data || '');
  if (!ANEXO_TIPOS.includes(mt) || !data || !/^[A-Za-z0-9+/]+=*$/.test(data.slice(0, 4000))) return { erro: 'bad_request' };
  if (data.length > ANEXO_MAX) return { erro: 'anexo_grande' };
  const source = { type: 'base64', media_type: mt, data };
  return { bloco: mt === 'application/pdf' ? { type: 'document', source } : { type: 'image', source } };
}
