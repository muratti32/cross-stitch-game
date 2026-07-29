import { apiFetch } from './apiFetch';

export type AiCreditPackProductKey =
  | 'ai_credit_pack_5'
  | 'ai_credit_pack_20'
  | 'ai_credit_pack_50';

export interface AiCreditPackReconciliationReference {
  id: string;
  supportReference: string;
}

export type AiCreditPackReconciliationStatus =
  | { status: 'pending'; balance: null }
  | { status: 'verification_failed'; balance: null }
  | { status: 'grant_failed'; balance: null }
  | { status: 'granted'; balance: number };

export async function createAiCreditPackReconciliation(
  productKey: AiCreditPackProductKey,
  transactionIdentifier: string,
): Promise<AiCreditPackReconciliationReference> {
  const response = await apiFetch('/v1/commerce/ai-credit-packs/reconciliations', {
    method: 'POST',
    body: JSON.stringify({ productKey, transactionIdentifier }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`AI Credit Pack verification could not be started: ${response.status}`);
  }
  return (await response.json()) as AiCreditPackReconciliationReference;
}

export async function fetchAiCreditPackReconciliation(
  id: string,
): Promise<AiCreditPackReconciliationStatus> {
  const response = await apiFetch(`/v1/commerce/ai-credit-packs/reconciliations/${id}`);
  if (!response.ok) {
    throw new Error(`AI Credit Pack verification could not be read: ${response.status}`);
  }
  return (await response.json()) as AiCreditPackReconciliationStatus;
}
