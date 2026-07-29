import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';

export async function fetchAiCreditBalance(): Promise<number> {
  const res = await apiFetch('/v1/economy/ai-credit-balance');
  if (!res.ok) {
    throw new Error('Failed to fetch AI Credit balance: ' + res.status);
  }
  const data = (await res.json()) as { balance: number };
  return data.balance;
}

export function useAiCreditBalance(enabled = true) {
  return useQuery({
    queryKey: ['economy', 'aiCreditBalance'],
    queryFn: fetchAiCreditBalance,
    enabled,
  });
}
