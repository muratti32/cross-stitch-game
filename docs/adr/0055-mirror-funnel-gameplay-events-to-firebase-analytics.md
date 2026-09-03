# Mirror funnel Gameplay Events to Firebase Analytics

Product analytics adds Firebase Analytics as a discovery and dashboard layer. This
supersedes the paragraph of ADR-0035 that rules out a third-party analytics SDK;
the rest of ADR-0035 stands, and the first-party Gameplay Event stream remains the
single source of truth for every product and Daily Task question. Firebase receives
a filtered Analytics Mirror only: the endpoints of each funnel plus screen views,
so funnel, retention, and exploration reports are available without querying the
Game Backend by hand. Nothing is answered from Firebase that the first-party stream
cannot confirm.

The mirror is bounded by construction. Collection is disabled until the existing
ads consent flow reports consent granted, and that consent message is extended to
name the analytics purpose; ad-personalization signals stay off and no App Tracking
Transparency prompt is requested, so ADR-0033 is unchanged and the store listing
keeps declaring no cross-app tracking. The only identity sent is the same opaque
player reference used for a Support Reference — a Registered Account id or a Guest
Installation Identity — never an email address, a Firebase UID, or an auth-provider
subject. Event parameters are the existing first-party payload fields, every one a
closed enum or boolean, so no prompt text, artwork, Pattern bytes, or free text can
travel. Screen views carry the route template without its parameters. User
properties are limited to guest-or-account, display language, and membership tier.
Data retention stays at the vendor's two-month default. Mirroring is fire-and-forget:
a failure can never block play nor affect the first-party enqueue that precedes it.

Scope is Analytics alone. Crashlytics is not added — Sentry owns crash and
performance reporting under ADR-0035, and running both would duplicate cost for one
answer. Firestore, Realtime Database, and Firebase Storage remain out. ADR-0038's
sentence listing Analytics among the Firebase products not added is corrected by
this decision, but its authentication boundary is not: the native Firebase app
introduced here never authorizes anything, Firebase tokens still cannot reach game
endpoints, and Firebase is still not the source of truth for accounts or sessions.
A future push-notification decision remains separate. One Firebase project serves
every environment; a separate non-production project was deferred because splitting
it would also force re-provisioning the Google and Apple auth clients.

We accept a third-party analytics vendor, a native SDK in the build, an additional
deletion and retention obligation, and updated store privacy labels declaring
analytics data, in exchange for funnel and retention reporting the game owner can
read without writing queries, at a privacy surface that adds no tracking prompt, no
advertising identifier, and no identity the game does not already send to Sentry.
