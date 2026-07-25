import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';

export interface AccountDeletionStatus {
  status: 'none' | 'pending';
  requestedAt?: string;
  recoveryWindowEndsAt?: string;
}

export class AccountDeletionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null,
    readonly reauthenticationRequired: boolean = false,
  ) {
    super(message);
    this.name = 'AccountDeletionApiError';
  }
}

async function parseDeletionError(response: Response, fallback: string): Promise<AccountDeletionApiError> {
  let message = fallback;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // ignore
  }
  return new AccountDeletionApiError(
    response.status,
    message,
    reason,
    response.status === 401,
  );
}

const accountDeletionStatusQueryKey = ['account-deletion-status'] as const;

export async function getAccountDeletionStatus(): Promise<AccountDeletionStatus> {
  const response = await apiFetch('/v1/account/deletion');
  if (!response.ok) {
    throw await parseDeletionError(response, 'Could not get account deletion status');
  }
  return (await response.json()) as AccountDeletionStatus;
}

export async function requestAccountDeletion(): Promise<AccountDeletionStatus> {
  const response = await apiFetch('/v1/account/deletion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmation: 'DELETE' }),
  });
  if (!response.ok) {
    throw await parseDeletionError(response, 'Could not request account deletion');
  }
  return (await response.json()) as AccountDeletionStatus;
}

export async function cancelAccountDeletion(): Promise<AccountDeletionStatus> {
  const response = await apiFetch('/v1/account/deletion/cancel', {
    method: 'POST',
  });
  if (!response.ok) {
    throw await parseDeletionError(response, 'Could not cancel account deletion');
  }
  return (await response.json()) as AccountDeletionStatus;
}

export function useAccountDeletionStatus(enabled: boolean) {
  return useQuery<AccountDeletionStatus>({
    queryKey: accountDeletionStatusQueryKey,
    queryFn: getAccountDeletionStatus,
    enabled,
    retry: false,
  });
}

export function useRequestAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestAccountDeletion,
    onSuccess: (data) => {
      queryClient.setQueryData(accountDeletionStatusQueryKey, data);
    },
  });
}

export function useCancelAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelAccountDeletion,
    onSuccess: (data) => {
      queryClient.setQueryData(accountDeletionStatusQueryKey, data);
    },
  });
}
