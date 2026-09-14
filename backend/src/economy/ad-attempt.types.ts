export interface OpenAdAttemptView {
  nonce: string;
  expiresAt: string;
  ssvActive: boolean;
}

export interface AdAttemptStateView {
  state: 'pending' | 'verified' | 'expired';
  expiresAt: string;
}
