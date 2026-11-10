// Assinatura do Plus pelo Mercado Pago (conta no CPF do Tiago; chave no segredo FAIZ_MP_TOKEN).
// Fluxo: o app pede "assinar" → o servidor cria a assinatura no Mercado Pago (preapproval "pending", sem plano)
// → a pessoa paga na página do Mercado Pago (init_point) → volta ao app em ?v=assinatura → o servidor confere no Mercado Pago.
// A cobrança é mensal e começa no dia em que a pessoa confirma o pagamento (decisão do Tiago, 10/11).
// O Faiz nunca vê o cartão: só o status da assinatura.
import type { Assinatura } from './plan.ts';

const API = 'https://api.mercadopago.com';
export const mpToken = () => (Deno.env.get('FAIZ_MP_TOKEN') || '').trim();

export async function mp(path: string, init: RequestInit = {}): Promise<any> {
  const tk = mpToken();
  if (!tk) throw new Error('mp_off');
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`mp ${r.status} ${String(j.message || j.error || '').slice(0, 120)}`);
  return j;
}

/** Corpo da assinatura nova: R$ por mês, sem plano, a pessoa autoriza na página do Mercado Pago. */
export function corpoAssinatura(o: { userId: string; email: string; preco: number; volta: string }) {
  return {
    reason: 'Faiz Plus',
    external_reference: o.userId,
    payer_email: o.email,
    back_url: o.volta,
    status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Math.round(o.preco) / 100, currency_id: 'BRL' },
  };
}

const dia = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Lê a assinatura do Mercado Pago no formato do Faiz. Cancelada depois de pagar: vale até a próxima cobrança que não vai acontecer. */
export function lerAssinatura(pre: any): Assinatura & { mp_id: string; pagas: number; valor: number | null } {
  const status = String(pre?.status || 'pending');
  const proximo = dia(pre?.next_payment_date);
  const pagas = Number(pre?.summarized?.charged_quantity || 0);
  const ultima = dia(pre?.summarized?.last_charged_date);
  let ate: string | null = null;
  if (status !== 'authorized' && pagas > 0) {
    // pago até 1 mês depois da última cobrança (ou a próxima data marcada, o que vier depois)
    const base = ultima ? new Date(Date.parse(ultima + 'T12:00:00Z')) : null;
    if (base) base.setUTCMonth(base.getUTCMonth() + 1);
    const umMes = base ? base.toISOString().slice(0, 10) : null;
    ate = [umMes, proximo].filter(Boolean).sort().pop() || null;
  }
  const valor = typeof pre?.auto_recurring?.transaction_amount === 'number' ? Math.round(pre.auto_recurring.transaction_amount * 100) : null;
  return { mp_id: String(pre?.id || ''), status, proximo: status === 'authorized' ? proximo : null, ate, pagas, valor };
}

/** Pix de 1 mês: cobrança avulsa, vale por 30 minutos. O Mercado Pago devolve o QR code e o copia-e-cola. */
export function corpoPix(o: { userId: string; email: string; preco: number; aviso: string; agora: Date }) {
  return {
    transaction_amount: Math.round(o.preco) / 100,
    description: 'Faiz Plus (1 mês)',
    payment_method_id: 'pix',
    external_reference: o.userId,
    notification_url: o.aviso,
    date_of_expiration: new Date(o.agora.getTime() + 30 * 60e3).toISOString().replace('Z', '+00:00'),
    payer: { email: o.email },
  };
}

/** Novo "pago até": 30 dias a partir de hoje ou do fim do que já estava pago (o que for mais tarde). */
export function somaPix(hoje: string, jaPago: (string | null | undefined)[], dias: number): string {
  const base = [hoje, ...jaPago.filter((d): d is string => !!d && d > hoje)].sort().pop()!;
  return new Date(Date.parse(base + 'T12:00:00Z') + dias * 864e5).toISOString().slice(0, 10);
}
