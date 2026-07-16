# Use Firebase Authentication only as a federated identity broker

Google and Apple sign-in use Firebase Authentication as an external identity
broker. The mobile client completes the native provider flow, signs in to an
in-memory Firebase Auth instance, obtains a fresh Firebase ID token, sends it to
the Game Backend, and immediately clears the Firebase session. The Game Backend
verifies token signature, audience, expiry, revocation, and enabled-user state
with Firebase Admin before resolving the actual Google or Apple provider record.
It then maps that provider's stable subject to `(provider, subject)` and issues
the same game-owned short-lived access token and rotating refresh token used by
Email Sign-In.

Firebase UID and email address are never Registered Account identifiers. The
backend never merges accounts from matching email strings, including Apple
private-relay addresses, and a Firebase user linked to more than one provider
does not bypass the explicit Auth Identity Link rules in ADR-0002. Until that
linking flow is implemented, signing in with a provider subject that has no
existing Auth Identity creates a distinct Registered Account. Firebase tokens
cannot authorize catalog, progress, economy, moderation, or commerce endpoints;
only a Game Backend session can.

Passwordless Email Sign-In remains fully game-owned and does not pass through
Firebase. Firestore, Realtime Database, Firebase Storage, Analytics,
Crashlytics, Dynamic Links, and Firebase Cloud Messaging are not added by this
decision. A future push-notification decision may still use a Firebase project
for FCM credentials, but that does not expand the authentication boundary.

We accept a new Firebase Auth and Firebase Admin dependency, native Google and
Apple provider provisioning, token-exchange availability risk, and an
additional vendor deletion/retention obligation in exchange for consistent
provider verification across iOS and Android without making Firebase the
source of truth for accounts or application sessions.
