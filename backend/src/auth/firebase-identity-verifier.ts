import type { AuthIdentityProvider } from './account-identity.service';

export interface FirebaseProviderIdentity {
  email: string | null;
  provider: Extract<AuthIdentityProvider, 'apple' | 'google'>;
  subject: string;
}

export interface FirebaseIdentityVerifier {
  verify(idToken: string): Promise<FirebaseProviderIdentity>;
}

export const FIREBASE_IDENTITY_VERIFIER = Symbol(
  'FIREBASE_IDENTITY_VERIFIER',
);
