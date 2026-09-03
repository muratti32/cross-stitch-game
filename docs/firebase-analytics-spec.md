# Firebase Analytics mirror

## Problem Statement

The Firebase console for `stitchwish-d3b28` shows no activity at all. The game
owner opens it expecting to watch how players move through onboarding, stitching,
generation and purchase, and finds an empty project — with no way to tell whether
this is a broken configuration, a dev-environment artefact, or something that was
never built.

It was never built. Firebase is present only as a federated identity broker
(ADR-0038): the `firebase` npm package is the JS web SDK, imported solely by the
identity module for Google and Apple sign-in. No native Firebase SDK, no Google
service files, no config plugin — so no product event has ever reached Firebase
and none ever would.

Product analytics today is entirely first-party (ADR-0035): the client records
pseudonymous Gameplay Events, queues them locally, and batches them to the Game
Backend, where they land in the partitioned analytics event stream. That pipeline
works, but answering a product question means writing SQL against it. There are no
funnels, no retention curves, no screen-flow view, and no exploration surface — so
the owner cannot casually look at how the game is being played.

## Solution

Firebase Analytics is added as a **discovery and dashboard layer** over the
existing first-party stream. The first-party Gameplay Event stream stays the
single source of truth; Firebase receives a filtered mirror of funnel-defining
events plus screen views, so GA4's built-in funnel, retention and exploration
reports become available without the owner writing queries.

The mirror is consent-gated and privacy-bounded by construction: collection is off
until the existing ads-consent flow grants it, the only identity sent is the same
opaque player reference already used for crash reports, event parameters are the
existing closed-enum payload fields, no App Tracking Transparency prompt is
requested, and data retention stays at the two-month default. Nothing about
sign-in, ads personalisation, or the first-party pipeline changes.

## User Stories

1. As the game owner, I want Firebase Analytics receiving events from the app, so that the console stops being empty and becomes a place I can actually look at.
2. As the game owner, I want to see how many players open the game for the first time, so that I can tell installs apart from returning play.
3. As the game owner, I want to see Stitching Session starts and completions in GA4, so that I can judge whether players finish what they begin.
4. As the game owner, I want Daily Task completions in GA4, so that I can see whether the daily loop is holding attention.
5. As the game owner, I want the Pattern conversion funnel (started → completed) in GA4, so that I can see where photo and AI artwork conversions are lost.
6. As the game owner, I want the AI generation funnel including failures, so that I can tell a demand problem apart from a provider problem.
7. As the game owner, I want store views and purchase starts in GA4, so that I can see the commerce funnel above the actual purchase.
8. As the game owner, I want completed purchases reported as GA4's native purchase event with value and currency, so that GA4's revenue reports work without extra configuration.
9. As the game owner, I want the onboarding funnel endpoints in GA4, so that I can measure how many new players reach playable state.
10. As the game owner, I want to see when players act on the account soft prompt, so that I can measure Guest-to-Registered-Account conversion.
11. As the game owner, I want screen views by route, so that I can see the paths players take through the app without instrumenting each screen by hand.
12. As the game owner, I want GA4 users correlatable with the first-party stream, so that anything surprising in the dashboard can be confirmed against the source of truth.
13. As the game owner, I want the noisy diagnostic events kept out of GA4, so that the console stays readable and the useful events are easy to find.
14. As the game owner, I want to verify the integration on a development device, so that I do not have to ship a build and wait a day to learn whether it works.
15. As the game owner, I want development-device events kept out of production reporting by default, so that my own testing does not distort the numbers.
16. As a player, I want no analytics collected before I have given consent, so that my choice in the consent form is actually respected.
17. As a player, I want the game not to ask for tracking permission, so that the experience stays as it is today and my advertising identifier is untouched.
18. As a player, I want my email address, Firebase identity and auth provider subject never sent to an analytics vendor, so that my identity stays with the game.
19. As a player, I want no prompt text, artwork, or Pattern data leaving the device as analytics, so that my creations stay private.
20. As a player, I want the privacy policy and the store privacy labels to describe this new collection accurately, so that I can make an informed choice.
21. As a player, I want analytics failures to never interrupt stitching, so that a network problem cannot cost me a move.
22. As a player, I want the game to keep working normally if the analytics SDK cannot start, so that a vendor outage is invisible to me.
23. As a developer, I want a single place where mirroring is decided, so that adding or removing a mirrored event is a one-line change.
24. As a developer, I want mirroring failures reported to the crash reporter but rate-limited, so that I learn about breakage without burning the error quota.
25. As a developer, I want the build to succeed when the Google service files are absent, so that a fresh clone and CI are not blocked on credentials.
26. As a developer, I want the test suite to run without the native Firebase module, so that unit tests stay fast and hermetic.
27. As a developer, I want the existing first-party analytics tests untouched, so that the change is provably additive.
28. As a developer, I want the decision recorded as an ADR that corrects the two ADRs it contradicts, so that the next reader is not misled by superseded text.
29. As a developer, I want no new user-facing strings, so that the change does not trigger a full translation round across every supported display language.
30. As a release manager, I want the privacy policy, store labels and the service inventory updated in the same change, so that the release cannot ship with stale disclosures.
31. As a release manager, I want tracking to remain declared as "not used" in the store labels, so that the existing listing posture is preserved.

## Implementation Decisions

### Scope

- Firebase **Analytics only**. Crashlytics is explicitly not added — crash and
  performance reporting stay with the existing vendor per ADR-0035. Firestore,
  Realtime Database and Storage remain out. Push notifications stay an open,
  separate decision.
- One Firebase project serves every environment. A separate non-production
  project was considered and deferred, because splitting it would also force
  re-provisioning the Google and Apple auth clients that the identity broker
  depends on.

### Native integration

- The React Native Firebase app and analytics packages are added. The existing
  JS-web-SDK Firebase dependency stays for federated auth; the two runtimes
  coexist. The native app is never used to authorise anything — the ADR-0038
  boundary is unchanged.
- The mobile app's native project directories are generated prebuild output and
  are not tracked, so the Google service files are committed to the tracked
  credentials directory and referenced from the Expo app config. These files are
  client-side identifiers, not secrets.
- The Firebase config plugin is registered **conditionally**: when either service
  file is missing, the plugin is not added and the app builds and runs without
  analytics, mirroring how the ads config plugin already guards on its app ids.

### Consent, privacy and identity

- Analytics collection is **disabled by default** and enabled only after the
  existing consent flow reports that consent was granted. The consent module
  stays the single source of the consent signal; no parallel consent state is
  introduced.
- The consent message is extended in the vendor console to cover the analytics
  purpose. This keeps the legal basis correct **without adding a user-facing
  string to the app**, which would otherwise require a complete translation round
  in every supported display language before release.
- Ad-personalisation signals stay disabled and no App Tracking Transparency
  prompt is requested; the non-personalised-ads posture is untouched.
- Data retention stays at the vendor default of two months.
- The analytics user id is the **opaque player reference already used for crash
  reports** — the Registered Account identifier when signed in, otherwise the
  Guest Installation identifier. Firebase UID, email address and auth provider
  subjects are never sent.
- User properties are limited to low-cardinality values: guest-or-account,
  display language, and membership tier.

### Event mirroring

- A single tap inside the existing Gameplay Event capture function forwards every
  captured event to one new mirror module, which filters against an allow-list.
  No call site changes.
- Fourteen of the thirty-five Gameplay Event kinds are mirrored — the endpoints of
  each funnel: Stitching Session started and completed; Daily Task completed;
  Pattern conversion started and completed; AI generation started, completed and
  failed; store viewed; purchase started and completed; onboarding started and
  finished; account soft prompt action.
- Deliberately excluded as GA4 noise: tutorial beats, per-step onboarding views,
  most cancelled and failed variants, catalog-incomplete, purchase reconciliation
  pending, and subscription change events. They remain fully available in the
  first-party stream.
- Mirrored names carry a game-specific prefix to avoid colliding with the
  vendor's reserved and automatically collected names. The **single exception** is
  completed purchases, which are sent under GA4's reserved purchase name so its
  revenue reports work.
- Event parameters are the existing first-party payload fields verbatim. Every
  one is a closed enum or boolean, so no free text and no personal data can leak,
  and payloads stay well inside the vendor's parameter-count and name-length
  limits.
- **Purchase revenue**: the first-party purchase payload carries only product kind
  and product key, and the backend rejects unknown fields, so price cannot be
  added there. The capture function gains an **optional mirror-only argument that
  is never enqueued for the backend**, carrying value and currency taken from the
  store product at the purchase call site.
- **Screen views** are logged from the router with the **route template only**;
  route parameters such as Pattern identifiers are never sent.

### Failure handling

- Mirroring is fire-and-forget and fully guarded: a mirror failure can never
  block play, and can never affect the first-party enqueue that precedes it.
- Mirror errors are reported to the crash reporter, **rate-limited to once per
  session**, so offline periods and initialisation races cannot flood the quota.
- The crash reporter's scrubber redacts any context key containing the vendor's
  name, so the mirror's diagnostic context is named after the mirror module
  instead — otherwise the diagnostics would arrive already redacted.

### Development builds

- Collection is off in development builds by default, so local testing does not
  distort production reporting.
- A public environment flag can force it on for a development device, which is
  what makes the DebugView verification below reachable without a preview build.

### Records to update

- A **new ADR** partially supersedes the ADR that forbids a third-party analytics
  SDK, recording why the exception is made and how the privacy surface is
  bounded, and corrects the identity-broker ADR's sentence listing Analytics
  among the Firebase products not added. The domain glossary gains the matching
  term.
- The public privacy policy page, the App Store privacy labels and Play data
  safety declarations, and the app service inventory are updated **in the same
  change**. Tracking stays declared as not used.

## Testing Decisions

A good test here asserts only externally observable behaviour: given a Gameplay
Event captured the way production captures it, what does the Firebase SDK
boundary receive? It must not assert the mirror module's internal shape, so the
mirror can be restructured without touching tests.

**One seam.** Tests drive the existing Gameplay Event capture function — already
the single funnel for all thirty-five event kinds — and observe the mocked native
Firebase analytics module. The mirror module is not unit-tested directly; its
allow-list, name mapping, consent gating and purchase value handling are all
observable through that one seam.

Prior art: the existing first-party analytics test mocks the local database
module and asserts what the capture function enqueues. The new assertions sit in
the same style, with a second mocked boundary.

Covered through that seam:

- allow-listed kinds reach the SDK, excluded kinds do not;
- names carry the game prefix, completed purchases arrive under the reserved
  purchase name with value and currency;
- the mirror-only purchase argument never appears in what is enqueued for the
  backend;
- nothing is logged while consent has not been granted;
- an SDK that throws does not prevent the first-party enqueue and does not
  propagate to the caller.

The one direct call is the mirror's screen-view function; mocking the router to
drive it through the layout would make the test brittle for no added confidence.

The native Firebase analytics module is mocked in the shared jest setup, next to
the existing native-module stand-ins. The fifty-seven existing first-party
analytics assertions are not modified.

**Definition of done**: type check and test suite pass, **and** a rebuilt
development client shows real events arriving in Firebase DebugView — first open,
a mirrored Stitching Session start, and a purchase. Standard GA4 reports lag up to
twenty-four hours, so the console can still look empty immediately after the first
run; DebugView is the acceptance surface.

## Out of Scope

- An in-app analytics opt-out control in Settings. It is the one item that would
  add user-facing strings and force a full translation round; deferred to a later
  release.
- Crashlytics, push notifications, and any other Firebase product.
- A separate non-production Firebase project, and with it any re-provisioning of
  auth clients.
- App Tracking Transparency, advertising-identifier use, and cross-app tracking.
- Raising data retention beyond the vendor default.
- Attribution and user-acquisition campaign measurement, which is what would
  actually require the tracking prompt.
- Changes to the first-party Gameplay Event schema, the backend event stream, or
  its retention behaviour.
- Migrating any existing analysis off the first-party stream. Firebase is
  additive; it does not become a source of truth.
- Submitting updated store metadata; drafts are prepared for review, publishing
  stays a human action.

## Further Notes

Work is delivered on a branch off the staging branch as three commits: the ADR and
glossary entry; the integration and its tests; the privacy, store-label and
inventory updates.

An unrelated uncommitted build-script rename in the mobile app's package manifest
is present on the branch and is left alone.

Four steps are blocked on the account owner and cannot be performed from the
repository:

1. register an iOS app (bundle identifier) and an Android app (package name plus
   debug and release signing certificate fingerprints) in the Firebase project;
2. download both Google service files for the tracked credentials directory;
3. extend the consent message to cover the analytics purpose;
4. confirm data retention is left at two months.

Everything except the final prebuild and the DebugView verification can be written
before those land.
