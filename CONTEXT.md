# Cross-Stitch Game Domain

This context defines the playable content and player activity in a catalog-first cross-stitch game. Players can also create personal playable content from an imported photo or AI-generated artwork.

## Language

### System Boundaries

**Game Backend**:
The independently deployed API, database, and worker system that owns this game's accounts, content, progress, economy, moderation, and Processing Jobs. It shares no runtime, database, or schema with CrossCraft, even when CrossCraft algorithms inform a game-owned implementation.
_Avoid_: CrossCraft backend, shared service, common database

**Processing Queue**:
The delivery channel that carries Processing Job identifiers to workers with at-least-once delivery. It may replay work and is never the source of truth for job or domain state; the Game Backend's database is.
_Avoid_: Job database, Pattern state, fire-and-forget queue

**Job Outbox**:
The database record written atomically with a new Processing Job and later published by a retrying dispatcher. It closes the failure window between committing the job and delivering it to the Processing Queue.
_Avoid_: Queue payload, worker log, webhook

**Connectivity State**:
The explicit Online, Offline, or Reconnecting condition shown without blocking locally available play. Ready Sessions, Personal Patterns, and local Stitch and Undo Actions continue offline; only the specific operation that requires the Game Backend—such as Session Preparation, purchase, Unlock, Catalog Submission, or AI generation—shows an actionable retry state. A generic connection screen never replaces usable local content.
_Avoid_: App offline error, global loading screen, network reachability guess

**Support Reference**:
The short opaque code a player can copy from a failed or delayed sync, Processing Job, purchase, promotion, or moderation flow so support can find the corresponding server records. It contains no email, provider identifier, prompt, artwork, Pattern bytes, or access credential and can be shared without exposing another player's data.
_Avoid_: Raw log, transaction receipt, error stack

**App Display Language**:
The language the mobile app renders its own interface text in, resolved from the device language and overridable per device in Settings. It is a device preference rather than account data, never syncs between a player's devices, and resolves without connectivity. Region or script variants are distinct App Display Languages when the product supports them. It selects only app-authored interface text and the localized Catalog Tag and Catalog Category labels the Game Backend already serves; it never translates player-authored or moderator-authored text.
_Avoid_: Catalog Source Language, account language setting, server locale

### Player Identity

**Guest Player**:
A player represented by one Guest Installation Identity rather than a Registered Account. A Guest Player can browse the Pattern Catalog, maintain local-first Stitching Sessions, keep device-local Pattern Likes, and earn Stitch Coin into a server-authoritative Guest Ledger. Offline earnings wait as Pending Coin Rewards, while Stitch Coin spending and Pattern Unlock creation require connectivity. On iOS, a Guest Player may purchase Stitch Coin Packs through the durable Purchase Attempt and verified webhook path; Android Guest purchase remains disabled. A Guest Player cannot create a Catalog Submission.
_Avoid_: Anonymous user, device account

**Guest Installation Identity**:
The opaque backend-issued identity bound to one app installation for a player who has not registered. It requires no email, Apple, or Google identity and scopes the Guest Ledger plus backend session identities without making them portable to another device. There is no supported recovery on another device or after the installation credential is lost; registration is the durability and portability boundary. It can be promoted exactly once into a Registered Account and cannot purchase AI Credit Packs or Premium Membership.
_Avoid_: Registered Account, recoverable login, advertising identifier

**Inherited Session**:
A session record a fresh app installation reads from device credential storage that a previous installation of the app on the same device wrote, because that storage outlives app deletion on iOS. The installation holds none of the matching Local Identity Namespace, so an Inherited Session that the Game Backend will not honour is discarded in favour of Guest play rather than raising Sign in Required; one that still authenticates simply becomes this installation's session. A retained installation credential likewise lets a reinstalling Guest Player reopen the same Guest Installation Identity and Guest Ledger.
_Avoid_: Account Cloud State, session restore, Guest Data Promotion

**Sign in Required**:
The state of a Registered Account whose credentials the Game Backend definitively rejected, which asks the player to authenticate again before account writes resume. It never gates core play: the player can always leave it and continue as a Guest Player, and it is never the first screen a new player sees.
_Avoid_: Registration wall, logged out, Account Closure Hold

**Guest Data Risk Notice**:
The non-blocking warning shown before a Guest Player's first Stitch Coin spend and first Pattern Unlock. It explains that losing the device or app installation may make the Guest Installation Identity, Guest Ledger, local progress, and Likes unrecoverable, and offers signup or sign-in to preserve them. The player may dismiss the notice and continue as Guest.
_Avoid_: Forced registration, purchase confirmation, account recovery

**Guest Data Reset**:
The explicit online action that irreversibly closes the current Guest Installation Identity and Guest Ledger, deletes its server session references and the entire matching Local Identity Namespace, removes local progress, Pending Coin Rewards, Pattern Likes, Unlock access, and Offline Pattern Data, then creates a fresh Guest Installation Identity. It requires a destructive confirmation, cannot transfer value, and cannot reactivate the closed identity.
_Avoid_: Sign-out, Guest Data Promotion, cache clear

**Registered Account**:
A persistent private player identity that can be accessed through email, Apple, or Google authentication. A Registered Account is required to create Personal Patterns or Catalog Submissions, purchase AI Credit Packs or Stitch Coin Packs, and own the resulting content, balances, unlocks, and moderation history. Its email address, authentication-provider identifiers, and provider profile data are never exposed in the Pattern Catalog.
_Avoid_: User, member, profile

**Account Cloud State**:
The Game Backend copy of a Registered Account's synchronized progress, immutable content, balances, Unlocks, Likes, commerce grants, and moderation state. Email, Apple, and Google are access methods to the same backend account, not separate backup destinations. The first release does not write independent backups to Google Drive or iCloud; device-local unsynchronized operations remain protected by their Local Identity Namespace until sync or explicit Local Data Removal.
_Avoid_: Google Drive backup, iCloud save, authentication provider data

**Local Identity Namespace**:
The OS-protected on-device storage partition owned by exactly one Guest Installation Identity or Registered Account. It contains that identity's local operations, drafts, pending records, Offline Pattern Data, and device readiness and is encrypted or protected using platform facilities. Signing out locks the namespace without deleting unsynchronized data; another identity can never read or reuse it. Signing back into the same account reopens it, while Local Data Removal is the separate destructive action.
_Avoid_: Shared app cache, account folder, cloud state

**Local Data Removal**:
The separately confirmed destructive action that deletes one identity's Local Identity Namespace from the current device after clearly warning about unsynchronized records. It does not delete the Registered Account, Account Cloud State, Guest Ledger on another retained installation, purchases, or catalog content. Sign-out alone never performs it.
_Avoid_: Sign-out, Account Deletion, cache eviction

**Auth Identity**:
One globally unique `(provider, provider subject)` credential binding for Email Sign-In, Sign in with Apple, or Google Sign-In that opens exactly one Registered Account. Email string equality never creates or merges a binding automatically, including Apple private-relay addresses. A provider identity already bound to another account cannot be claimed by the current account.
_Avoid_: Email match, Public Creator Profile, Registered Account merge

**Auth Identity Link**:
The explicit addition or removal of an Auth Identity from an already authenticated Registered Account after recent reauthentication. Linking never merges two Registered Accounts or transfers content, balances, purchases, moderation state, or Guest Economy Promotion eligibility. The last remaining Auth Identity cannot be removed, and the first release provides no Registered Account merge.
_Avoid_: Automatic account merge, social login match, Guest Data Promotion

**Email Sign-In**:
The passwordless flow that creates or opens a Registered Account by proving access to an email address with a single-use six-digit code that expires after ten minutes. Request and verification attempts are rate-limited, and request responses do not reveal whether the address already has an account. The first release does not use a Magic Link.
_Avoid_: Email registration, email login, email and password

**Account Deletion Request**:
The recently reauthenticated, two-stage request that immediately revokes normal sessions, freezes new player-initiated purchases and account writes while required commerce, deletion, and committed-promotion reconciliation continues, applies Account Closure Hold to the Public Creator Profile and Community Patterns, and starts Deletion Recovery Window. Processing Jobs not yet sent to an external provider are cancelled and release their reservations; a fal.ai job already submitted continues toward terminal AI Artwork Delivery or reconciled failure through permitted system writes during the window. Delivered artwork stays private during closure, reappears if deletion is cancelled, and is erased by finalization. An exceptionally unresolved provider job does not extend finalization: it becomes a minimal deletion-reconciliation tombstone and any late output is discarded without creating artwork or value. The flow warns that deleting the game account does not cancel an Apple or Google store subscription and provides the platform's subscription-management route.
_Avoid_: Sign-out, Local Data Removal, instant erase

**Deletion Recovery Window**:
The 30-day interval after Account Deletion Request during which the frozen account may reauthenticate only to cancel deletion or reach required subscription-management and support actions. Account Closure Hold remains reversible throughout. Expiry authorizes Account Deletion Finalization; it does not silently extend because an offline device has not checked in.
_Avoid_: Subscription grace period, suspended account, backup retention

**Account Closure Hold**:
The reversible non-moderation state applied during Deletion Recovery Window to a closing account's Public Creator Profile and Community Patterns. It removes them from discovery, profile pages, Catalog Share Links, new sessions, revisions, and submissions while preserving existing sessions like Catalog Withdrawal. Cancelling deletion restores the same public identifiers and prior availability; finalization converts the Patterns to Catalog Withdrawal and attribution to Deleted Creator.
_Avoid_: Review Hold, Creator Restriction, Catalog Withdrawal

**Account Deletion Finalization**:
The irreversible end of Account Deletion Request after Deletion Recovery Window. It deletes authentication identifiers and private profile data, AI Artwork, Personal Patterns, progress, Likes, blocks, and ordinary private account records; forfeits remaining virtual balances and Unlocks without transferring or refunding them; and applies Catalog Withdrawal to every Community Pattern. Public attribution becomes Deleted Creator, Like aggregates are decremented, pending submissions and appeals close, and every server session or token is revoked immediately. Connected devices delete or cryptographically invalidate their Local Identity Namespace; a fully offline device receives the same instruction at its next app or backend check. Bounded pseudonymous commerce, moderation, security, deletion, and idempotency evidence may remain, while minimal non-regrant and username/profile-reservation tombstones persist for the life of the service. A new registration creates a different account.
_Avoid_: Account suspension, reversible deactivation, Guest rollback

**Deleted Creator**:
The non-interactive public tombstone replacing a finalized account's Public Creator Profile wherever an existing Stitching Session must retain attribution. It exposes no avatar, username, account identifier, or profile link; the former permanent username and opaque profile identifier are reserved and never reassigned. The account's Community Patterns are under Catalog Withdrawal and cannot start new sessions.
_Avoid_: Restricted Creator, anonymous account, reusable username

### Creator Profile and Profile Moderation

**Public Creator Profile**:
The public identity a Registered Account must create before its first Catalog Submission. It contains a globally unique username that the player can never change, plus an editable display name and optional avatar; Moderator Username Reset is the only exceptional replacement path. Creation and later display-name or avatar changes must pass Profile Safety Check but do not wait for routine human Profile Review. Passing values become public immediately and appear across all of the account's existing Community Patterns rather than being copied into each immutable Pattern; a failed change leaves the last accepted public values untouched. Earlier public values remain only in the Creator Profile Audit. The profile is separate from authentication and never reveals the account's email address or Apple or Google identity data.
_Avoid_: Registered Account, login profile, email identity

**Profile Safety Check**:
The server-side automated gate applied before a Public Creator Profile is created or changed. It validates username and display-name text against reserved-name and profanity rules and checks the optional avatar with automated image safety moderation. A failed candidate is not published and returns a user-facing reason; a passing candidate is published immediately without human Profile Review.
_Avoid_: Profile Review, Catalog Precheck, post-publication report

**Profile Report**:
An in-game signal submitted by a Registered Account that an already-public Public Creator Profile may violate safety or profile policy. It is unique per submitting account and open Profile Investigation, so a repeat during the same case returns the existing report. After a case closes, a newly published profile state or materially new evidence may create a new rate-limited report rather than being blocked by the earlier case forever. A report starts or contributes to an investigation but never hides, edits, or restricts the profile by itself.
_Avoid_: Profile Safety Check, automatic profile suspension, Community Report

**Profile Investigation**:
The human post-publication review of a Public Creator Profile initiated by one or more Profile Reports. It is reactive moderation rather than routine approval: profiles that pass Profile Safety Check become public immediately, and only a human moderator may close the reports without action, apply Profile Remediation, perform Moderator Username Reset, or impose Creator Restriction.
_Avoid_: Profile Review, Catalog Review, automated enforcement

**Profile Remediation**:
The moderator action used when a Public Creator Profile's editable display name or avatar violates policy without requiring Creator Restriction. It replaces the display name with a safe default and removes the avatar while retaining the permanent username, Registered Account access, existing Community Patterns, and the ability to submit future compliant profile values through Profile Safety Check.
_Avoid_: Creator Restriction, Safety Removal, account suspension

**Moderator Username Reset**:
The exceptional, moderator-only replacement of a violating permanent username with one safe system-generated username. It preserves the Public Creator Profile's opaque identifier, Catalog Share Link, Community Pattern ownership, and private audit history; the released violating value is never made available for reuse. The player cannot invoke or choose this reset, and ordinary username changes remain prohibited.
_Avoid_: Username edit, new Creator Profile, account merge

**Creator Restriction**:
The moderator action used for a permanent-username violation or repeated serious profile violations. It masks the public identity as `Restricted Creator`, removes the public avatar, and blocks further profile changes and new Catalog Submissions. It does not remove existing Community Patterns; each Pattern remains available unless its content independently receives Safety Removal. The owner may create one Creator Restriction Appeal, but the restriction remains effective unless that appeal succeeds.
_Avoid_: Account deletion, Safety Removal, profile reset

**Creator Restriction Appeal**:
The restricted account's single request for another human review of the same Creator Restriction decision and moderation record. The restriction remains fully effective while the appeal is open, and the appeal is assigned to a different moderator when operationally possible. Acceptance restores the last safe Public Creator Profile values plus profile-editing and Catalog Submission access; when no safe permanent username exists, the moderator first applies Moderator Username Reset. An upheld restriction is final. Profile Remediation has no separate appeal because the player may submit new compliant values through Profile Safety Check.
_Avoid_: Catalog Appeal, Safety Removal Appeal, repeated profile appeal

**Creator Block**:
A private, reversible relationship created by a Registered Account against a Public Creator Profile. It hides that creator and their Community Patterns from the blocking player's catalog search, discovery, and recommendations across signed-in devices. It neither changes global catalog availability nor creates a Profile Report or Community Report, and the blocked creator is not notified. Existing Stitching Sessions remain playable.
_Avoid_: Creator Restriction, Safety Removal, report, global hide

**Creator Profile Audit**:
The private append-only moderation history of a Public Creator Profile's previous display names, avatars, and any exceptional Moderator Username Reset, including who changed each value, why, and when. It supports investigation and accountability but is never shown as a public profile history; ordinary player-driven username change remains impossible.
_Avoid_: Public profile history, editable log, Community Pattern metadata

### Economy and Commerce

**Commerce Store**:
The single player-facing purchase surface where Premium Plans, Stitch Coin Packs, and AI Credit Packs can be compared. A Guest Player may browse the products and current store prices but must become a Registered Account before purchasing; a Registered Account can buy there. The surface presents recurring membership and one-time top-ups together while keeping their grants, durations, and purchase terms distinct. It shows whatever products the current store offering returns, each with the price and billing period read from its own package, and declares itself unavailable only when there is genuinely nothing to sell; a product the offering omits is reported to the team as a warning and a `commerce_catalog_incomplete` event rather than hiding the rest of the catalogue. Above the Premium purchase action, and again inside the Premium confirmation, it carries the store-standard subscription disclosure — charge at confirmation, automatic renewal at the selected Premium Plan's own price and billing period, the 24-hour auto-renew deadline, forfeiture of an unused free trial, and cancellation from the store account, named App Store on iOS and Google Play on Android — together with links to the Privacy Policy and the Terms of Service. It is not a gate over core play or creation, and entering it never implies that Premium Membership is required.
_Avoid_: Paywall, Premium-only screen, locked game

**Premium Membership**:
The paid access held by a Registered Account through a Weekly, Monthly, or Annual Premium Plan. Its first-release benefits are limited to the Membership Credit Grant, Premium Daily Coin Claim, and Premium Theme Collection. It is not required to purchase or spend AI Credit and does not gate Pattern Conversion, photo tools, Progress Sync, Catalog Submission, core play, accessibility, or Official Pattern access.
_Avoid_: Premium Account, paid user, VIP

**Premium Plan**:
One of the three auto-renewing store products offered from the first release. The United States base prices are `$2.99` for Weekly, `$7.99` for Monthly, and `$39.99` for Annual; only Monthly offers a Monthly Trial.
_Avoid_: Membership tier, lifetime purchase, credit pack

**Monthly Trial**:
The three-day no-charge introductory period available to store-eligible players who start the Monthly Premium Plan. It unlocks the Premium Theme Collection and Premium Daily Coin Claim, but grants no AI Credit; the first Membership Credit Grant occurs only after the store verifies conversion into the first paid monthly period. Weekly and Annual Premium Plans do not include a trial. Store eligibility is consumed once across all three Premium Plans, because they share a single subscription group (ADR-0043): a player who has already held any Premium Plan starts the Monthly Premium Plan as a paid period with no trial.
_Avoid_: Free credits, weekly trial, annual trial

**Premium Theme Collection**:
A membership-only set of cosmetic grid backgrounds, completed-stitch appearances, and completion animations. It never changes rewards, Stitch Actions, timing, or accessibility; when membership or trial access ends, the game returns to its default theme without altering content or progress.
_Avoid_: Gameplay boost, Pattern skin, permanent theme purchase

**AI Credit**:
A non-expiring consumable balance that any Registered Account may purchase in an AI Credit Pack or receive through a Membership Credit Grant and spend when requesting AI Artwork, regardless of Premium Membership. Purchased and membership-granted credits form one balance that remains available after membership ends; gameplay rewards never add AI Credit. In the first release, one successfully delivered AI Artwork costs exactly one AI Credit.
_Avoid_: Coin, token, Premium credit

**AI Credit Pack**:
A consumable real-money product that a Registered Account may purchase to add AI Credit to its durable balance. The first-release United States products grant 5 credits for `$2.99`, 20 for `$9.99`, or 50 for `$19.99`. They are independent of Stitch Coin Packs and Premium Membership.
_Avoid_: Stitch Coin Pack, Membership Credit Grant, AI subscription

**Stitch Coin**:
The backend-authoritative gameplay currency earned through play or Rewarded Ads, received through a Premium Daily Coin Claim, or purchased in a Stitch Coin Pack. A Registered Account holds it in its account balance, while a Guest Player holds it in a Guest Ledger. In the first release its only spend is the online purchase of permanent Pattern Unlocks; it remains separate from AI Credit and can never fund AI Artwork generation.
_Avoid_: Coin, gold, point, token

**Stitch Coin Pack**:
A consumable real-money product that a Registered Account or an iOS Guest Player may purchase to add Stitch Coin to its durable balance. The first-release United States products grant 300 Coin for `$1.99`, 900 for `$4.99`, or 2,000 for `$9.99`. They are independent of AI Credit and do not create any exchange or conversion between the two balances.
_Avoid_: AI Credit Pack, Premium Membership, currency exchange

**Guest Ledger**:
The Game Backend source of truth for a Guest Installation Identity's Stitch Coin balance, reward grants, spends, and permanent Pattern Unlocks. Every mutation is idempotent and auditable. Offline gameplay may create Pending Coin Rewards, but changing the spendable balance, spending Coin, and acquiring an Unlock require backend reconciliation and connectivity; the client cannot directly mutate the ledger.
_Avoid_: Local Coin balance, Commerce Ledger, client save data

**CommerceOwner**:
The single owner reference a Commerce Ledger record carries: either a Registered Account or a Guest Installation Identity, and never both or neither. Commerce Transaction Binding rows hold it as a nullable account reference and a nullable Guest Installation reference under one database constraint enforcing exactly one is set, alongside the existing account-only principal columns kept unchanged for backward compatibility. Its Guest form is enabled for iOS Stitch Coin Pack Purchase Attempts; Guest Premium, AI Credit, restore, promotion, refund, and deletion remain separate decisions.
_Avoid_: unverified Guest purchase, principal_id alone, polymorphic owner without a DB constraint

**Commerce Ledger**:
The backend source of truth for verified store transactions, their Commerce Transaction Bindings, normalized Membership Periods, and the Account or Guest Ledger grants they produce. Each provider transaction identifier and paid membership period is recorded idempotently and can produce its grant exactly once; the mobile client cannot mutate paid balances or entitlements directly.
_Avoid_: Client purchase history, local receipt cache, balance endpoint

**Paid Reserve**:
The remaining portion of a Coin or AI Credit balance minted by a verified provider purchase. It increases only from `coin_pack_purchase` or `pack_purchase`, is spent after free value, and is reduced first by a Commerce Reversal or Membership Reversal. Membership Credit Grants and Premium Daily Coin Claims are free recurring benefits and never enter the Paid Reserve.
_Avoid_: total balance, membership benefit, client purchase cache

**Purchase Reconciliation Pending**:
The non-failure state shown after the store reports a completed purchase or restore but the Commerce Ledger has not yet exposed its verified grant. It grants no client-side value, prevents the player from being prompted to repeat the same purchase, and keeps checking the backend until the recorded result appears. A prolonged delay provides retry and Support Reference actions without claiming that the store transaction failed.
_Avoid_: Purchase success, purchase failure, repurchase prompt, local grant

**Purchase Attempt**:
A durable Game Backend record created before StoreKit opens. It binds one CommerceOwner, Stitch Coin Pack product, RevenueCat subscriber association, idempotency key, lifecycle state, and opaque Support Reference; StoreKit success only advances verification and never grants value.
_Avoid_: local purchase flag, receipt success, client grant

**Commerce Transaction Binding**:
The permanent association created when a verified Apple or Google store transaction is first granted to one CommerceOwner. Resubmitting or restoring it for the same owner is idempotent; another owner cannot claim, transfer, or merge it. Account Deletion may remove bounded receipt and account detail but retains a minimal one-way provider-transaction tombstone for the life of the service to prevent regranting. Guest-owned rows grant only to the matching Guest Ledger.
_Avoid_: Store account, receipt ownership transfer, purchase restore grant

**Membership Period**:
The normalized, provider-verified paid interval of one Premium subscription, identified independently from delivery retries and plan changes. Exactly one Membership Credit Grant may be attached to each paid period. Premium entitlement is derived from the latest verified subscription status across periods, including trial, grace, billing retry, upgrade, downgrade, expiration, and refund; reversing an older period never deactivates a newer valid period.
_Avoid_: Store webhook, transaction retry, permanent entitlement

**Scheduled Plan Change**:
The server-authoritative projection of a store-accepted Premium Plan change that has not activated yet: the target plan and the date it takes effect, derived from an unactivated `PRODUCT_CHANGE` against the currently active plan and exposed through the membership read model so every device shows the same pending downgrade. Only a downgrade qualifies; an upgrade activates immediately and passes through Purchase Reconciliation Pending instead. It disappears once the change activates, or once the active period renews on its original plan, which means the provider never delivered the change or the player cancelled it through Manage Subscription.
_Avoid_: Pending purchase, client-side plan flag, cancelled membership

**Membership Transfer**:
The re-anchoring of one subscription's Membership Periods onto the CommerceOwner the store subscription now belongs to, applied only from a provider-verified transfer event that names both the previous and the new subscriber identity. The destination is the Registered Account or Guest Installation Identity the new subscriber identity resolves to; when that identity is one the provider has just minted, the owner is inherited from the previous side of the same event and the new identity is claimed for it, so the subscription's later events stay resolvable. A transfer whose previous side names both an Account and a Guest is refused rather than attributed to either. It moves entitlement state alone: Membership Credit Grants already delivered to the previous account are neither clawed back nor regranted, Commerce Transaction Bindings for one-time purchases stay with the account that received their goods, and an account claiming a subscription's provider transaction without a verified transfer is still refused, unless every recorded owner of that transaction is one Guest Installation Identity that the claiming event's own subscriber aliases still resolve to, in which case the Membership is adopted into the signed-in Registered Account and those aliases are claimed for it. That refusal is treated as unresolved rather than settled, because the provider does not order a transfer against the transferred subscription's own events: the refused delivery is asked for again instead of being dropped, so an event that arrives just before its transfer still lands once ownership is settled.
_Avoid_: Account merge, entitlement sharing, receipt ownership transfer

**Membership Credit Grant**:
The AI Credit added to a Registered Account exactly once for each verified paid Membership Period: 3 credits for Weekly, 15 for Monthly after trial conversion and each renewal, and the full 180-credit Annual allowance at purchase or renewal. Delivery retries and plan-change events cannot duplicate it. It joins the same non-expiring balance as purchased AI Credit and remains available after the membership period ends.
_Avoid_: Free credit, monthly coin, Premium balance

**Commerce Reversal**:
The idempotent withdrawal of the original Stitch Coin or AI Credit grant after its store transaction is refunded or charged back. The affected balance may become negative and cannot fund new spending until it again covers the requested cost; existing Pattern Unlocks, AI Artwork, Patterns, and Stitching Sessions are not deleted.
_Avoid_: Content rollback, account reset, purchase deletion

**Membership Reversal**:
The idempotent response to a refunded or charged-back Membership Period. It reverses only that period's Membership Credit Grant under the same negative-balance rule as a Commerce Reversal; Premium entitlement is recomputed from current verified store status, so a later valid period remains active. Previously claimed Premium daily Stitch Coin and existing Pattern Unlocks or content remain preserved.
_Avoid_: Subscription cancellation, daily reward rollback, account deletion

### Rewards

**Rewarded Ad**:
An optional advertisement that a player explicitly starts outside an active Stitching Session. A verified completion consumes 10 Coin from that Reward Day's Ad-Equivalent Coin Pool and grants the same amount. When the pool is exhausted or closed, the Rewarded Ad entry point is disabled and shows the time remaining until the next Reward Day instead of offering an unrewarded advertisement. The game does not show forced interstitial ads or banners, and advertising can never grant AI Credit.
_Avoid_: Forced ad, commercial break, AI Credit ad

**Daily Rewarded Ad Limit**:
The maximum of three verified Rewarded Ad completions for which a player may receive Stitch Coin during one Reward Day, also bounded by the remaining Ad-Equivalent Coin Pool. Abandoned advertisements and completions that are not verified or rewarded consume neither an attempt nor the pool.
_Avoid_: Ad impression limit, attempt limit, AI Credit allowance

**Ad-Equivalent Coin Pool**:
The server-authoritative allowance of 30 Stitch Coin shared by Rewarded Ads and Premium Daily Coin Claim during one Reward Day. Each verified ad consumes and grants 10. A Premium claim grants only the unconsumed remainder and closes the pool, so every ordering of ads, membership activation, and claim yields at most 30 Coin without taking away Coin already earned.
_Avoid_: Separate Premium bonus, ad counter, stackable daily reward

**Premium Daily Coin Claim**:
A once-per-Reward-Day action through which a player with an active Premium Membership receives the remaining balance of that Reward Day's Ad-Equivalent Coin Pool without viewing more advertisements. It grants 30 Stitch Coin when no ad reward was taken, 20 or 10 after one or two ad rewards, and nothing after the pool is exhausted. Claiming closes the pool, so ads and the claim can never exceed 30 Coin in total.
_Avoid_: Automatic Premium reward, AI Credit grant, ad bonus stacking

**Reward Day**:
The server-authoritative calendar day from `00:00 UTC` up to but not including the next `00:00 UTC`. Daily reward limits reset at that boundary, and the client shows the player the remaining time rather than inferring the reset from device time.
_Avoid_: Local day, device midnight, rolling 24 hours

**Daily Task**:
One of three play activities offered during each Reward Day, each worth 10 Stitch Coin for a daily maximum of 30. The first-release set is: complete 100 successful cell-level Stitch Actions; complete at least 10 Stitch Actions in each of three different DMC Thread Colors; and achieve one Thread Color Completion. A Stitch Sweep contributes one Stitch Action for every newly filled eligible cell rather than one per gesture. All three tasks may progress together in catalog, Personal, or Replay Sessions; none requires advertising, purchasing, AI generation, or sharing. Completion grants its reward automatically, while incomplete tasks expire without a streak loss or missed-day penalty.
_Avoid_: Streak, mandatory quest, Premium task

**Pending Coin Reward**:
A durable local record that a Daily Task or eligible first Pattern completion occurred while its Stitch Coin reward could not reach the backend. It carries an idempotent source key, Session and Pattern references, the device's monotonic gameplay-event sequence, and enough state-transition evidence for server validation. The backend owns Reward Day and per-Pattern uniqueness, reward caps, and impossible-transition or velocity checks; a client record alone never authorizes Coin. Valid evidence survives any Reward Day boundary and is granted exactly once to the applicable Guest Ledger or Registered Account when connectivity returns; invalid evidence is rejected. It is evidence awaiting reconciliation, not spendable Stitch Coin.
_Avoid_: Unclaimed reward, expired reward, manual claim

**First Completion Reward**:
The base Stitch Coin reward granted automatically and exactly once when a player completes an eligible Official Pattern or Community Pattern for the first time. An offline completion creates a Pending Coin Reward. Personal Patterns never grant it, and Replay Sessions do not grant it again, but either kind of session may still advance separately defined quests or events.
_Avoid_: Replay reward, completion farming, repeat completion reward

**Completion Reward Tier**:
A bounded First Completion Reward category derived only from a Pattern's total number of stitchable cells: Small grants 25 Stitch Coin for 1–3,999 cells, Medium grants 60 for 4,000–14,999, and Large grants 120 for 15,000 or more. DMC Thread Color count does not affect the tier.
_Avoid_: Difficulty score, color multiplier, uncapped cell reward

**Unlock Earnability Target**:
The first-release economy guardrail that guaranteed Daily Task Coin alone, without Premium Membership, purchase, or Rewarded Ad, can fund a Small Pattern Unlock within at most three Reward Days, Medium within five, and Large within ten. First Completion Rewards and optional ads may shorten those times but are not required for the target. The first release has no Player Level or level-up Coin reward; the substantial free starting catalog supplies playable content while Coin is earned.
_Avoid_: Guaranteed daily unlock, ad requirement, level reward

### Guest Data Promotion

**Guest Data Promotion**:
The one-time, idempotent consumption of a Guest Installation Identity into a target Registered Account reached through signup or sign-in. The backend produces a current Guest Promotion Preview from its ledger state and the device's Guest Promotion Manifest. When the player chooses to confirm it, the device durably records Promotion Handoff before sending the confirmed request; the backend then acquires Promotion Commit Lock and stages and validates the matching Promotion Transfer Package. The Guest identity remains unchanged if any pre-commit step fails or is cancelled. If the target has never received a Guest Economy Promotion, the commit performs that full economic transfer. Otherwise it performs Guest Data-Only Promotion. In both cases the staged package is retryably merged without duplicate records or counts. After backend commit the target account is immediately usable, but the promotion cannot be cancelled or rolled back and the consumed guest identity cannot be reactivated, spend, unlock, or promote again.
_Avoid_: Guest sync, recurring transfer, AI Credit transfer

**Guest Promotion Preview**:
The server-generated summary returned after target-account authentication but before Guest Data Promotion mutates either identity. It combines current backend ledger and target-account state with a checksummed Guest Promotion Manifest of device-local records, validates every Pending Coin Reward evidence record, states whether the operation will be Guest Economy Promotion or Guest Data-Only Promotion, and itemizes the Guest Coin, Pattern Unlocks, validated or rejected Pending Coin Rewards, sessions, progress, completion history, and Likes that will transfer, remain locked, or be discarded. Confirmation is bound to that guest identity, target account, relevant backend state versions, reward-validation version, and manifest checksum; if any bound state or validation result changes, the backend requires a new preview. Leaving the confirmation flow invalidates the preview. Cancellation signs out the target account and restores the unchanged Guest session without consuming the Guest Installation Identity.
_Avoid_: Promotion receipt, silent merge, generic confirmation

**Guest Promotion Manifest**:
The immutable device-generated inventory of stable identifiers, local record versions, and checksums for every Guest Session Progress, Session Completion, Pending Coin Reward, and Pattern Like considered by Guest Promotion Preview. For each Pending Coin Reward it also carries the complete source key, Session and Pattern references, monotonic event sequence, and state-transition evidence required for backend validation before the preview promises a transfer or discard disposition. It contains no Offline Pattern Data or playable artifact bytes. Its checksum binds the preview, Promotion Handoff, and Promotion Transfer Package to the same local snapshot and reward-validation result; a changed local record requires a new manifest and preview.
_Avoid_: Promotion Transfer Package, device backup, mutable sync list

**Promotion Handoff**:
The durable device record written before a confirmed Guest Data Promotion request. It binds the Guest Installation Identity, target Registered Account, confirmed preview version, Promotion Transfer Package identifier and checksum, and stable identifiers plus the preview-approved transfer or discard disposition for every local Session Progress, Session Completion, Pending Coin Reward, and Pattern Like. Before backend commit the player may cancel and return to the unchanged Guest session. The commit itself acknowledges every economic disposition; afterward the irreversible handoff follows only unresolved progress, history, and Like processing under the usable target account across app restarts and shows each item as Syncing with automatic retry plus a manual retry action. Each local item is removed only after an idempotent acknowledgement of its transfer or intentional discard. Promotion-Locked Offline Pattern Data is the exception: it is deleted after the backend confirms data-only promotion and before target-account gameplay, while its progress remains protected by the staged package. Repeated failure enters Promotion Needs Attention instead of expiring or rolling back; the handoff is removed only after every item is acknowledged.
_Avoid_: Guest backup, temporary memory, promotion preview

**Promotion Transfer Package**:
The immutable, checksummed server-side staging snapshot uploaded under Promotion Commit Lock after Guest Promotion Preview confirmation and before Guest Data Promotion commit. It is bound to the Guest Installation Identity, target Registered Account, preview version, Guest Promotion Manifest checksum, and Promotion Handoff, and contains the complete local Session Progress, Session Completion, Pending Coin Reward evidence, and Pattern Like records needed to apply each preview-approved transfer or intentional discard. Offline Pattern Data and playable artifact bytes are excluded. The backend validates schema, identifiers, checksum, preview freshness, manifest completeness, and relevant target-account versions before it may consume the Guest identity. A failed or cancelled pre-commit attempt leaves the Guest session unchanged and its staged package is deleted immediately when possible and no later than 24 hours. After commit the package never silently expires: acknowledged payloads are deleted item by item, unresolved payloads are retained through Promotion Needs Attention, and only a minimal idempotency receipt remains after completion.
_Avoid_: Device backup, pattern artifact upload, mutable sync batch

**Promotion Needs Attention**:
The non-blocking post-commit state entered when automatic Promotion Handoff retries cannot resolve one or more staged progress, history, or Like items. The target Registered Account remains usable, the durable package is retained, the player receives a manual retry and support route, and an operator alert is created. It can end only through an acknowledged transfer, intentional discard authorized by account deletion, or operator resolution; it never reactivates Guest mode or silently drops payloads.
_Avoid_: Promotion failure, rollback, expired package

**Promotion Commit Lock**:
The single short-lived server lease that one Guest Installation Identity may hold only after a current Guest Promotion Preview is confirmed. While it is held, the client stays in the transfer flow and that Guest identity cannot start gameplay, mutate its Guest Ledger, reconcile a new Pending Coin Reward, change a Pattern Like, or create another promotion attempt. The target Registered Account remains usable on its other devices, so a serializable compare-and-swap revalidates its economic-promotion and relevant Unlock versions before commit. Package failure, cancellation, stale target state, or lease expiry releases the lock without consuming the Guest identity; successful commit consumes it atomically.
_Avoid_: Account suspension, database transaction, post-commit handoff

**Guest Economy Promotion**:
The one lifetime Guest Data Promotion in which a Registered Account may receive a Guest Ledger's economic value. One serializable compare-and-swap commit verifies the Guest identity is unconsumed and the target account's economic-promotion version still matches the confirmed preview, then adds remaining Stitch Coin, unions Pattern Unlocks, validates and grants eligible Pending Coin Rewards, deduplicates completion-reward source keys, closes the Guest Ledger, and marks the account's slot consumed. A concurrent promotion that changes eligibility makes the preview stale and requires new player confirmation; the backend never silently converts the confirmed operation into Guest Data-Only Promotion.
_Avoid_: Commerce grant, repeated Guest merge, data-only promotion

**Guest Data-Only Promotion**:
A Guest Data Promotion into a Registered Account whose Guest Economy Promotion slot is already consumed. It merges session identities, Session Progress, Session Completion history, and Pattern Likes, but transfers no Guest Ledger balance, Pattern Unlock, Pending Coin Reward, or other reward value. The abandoned Guest Ledger is closed. A promoted session for a non-free Official Pattern whose Unlock is absent becomes a Promotion-Locked Session and loses its device-local Offline Pattern Data without losing progress or history.
_Avoid_: Guest Economy Promotion, Unlock transfer, Coin grant

**Promotion-Locked Session**:
An account-owned Stitching Session preserved by Guest Data-Only Promotion for a non-free Official Pattern that the target Registered Account has not unlocked. Its Session Progress and completion history remain protected by Promotion Handoff, but Offline Pattern Data is removed after the backend commits the identity switch and before target-account gameplay; the backend issues no Artifact Access Grant. After the account acquires the Pattern Unlock, Session Preparation reuses the same session identity to download verified data and continue.
_Avoid_: Safety Removal, deleted Session, transferred Pattern Unlock

**Promotion Session Merge**:
The deterministic reconciliation of Guest and target-account Stitching Sessions for the same Pattern during Guest Data Promotion. Two active sessions combine through Progress Merge into the target account's surviving active session, while the Guest session identity becomes an auditable merged tombstone. If one session is completed and the other active, the completed session remains history and the active session continues as a Replay Session. If both are completed, both immutable history entries remain. First Completion Reward and completion eligibility are deduplicated by player and Pattern in every case.
_Avoid_: Session overwrite, duplicate active session, completion reset

### AI Generation and Source Artwork

**AI Credit Reservation**:
A temporary hold placed on AI Credit when an AI Artwork request starts. A client or API timeout does not release it. It becomes a charge only through AI Artwork Delivery and is released only after backend reconciliation proves a terminal provider failure, safety rejection, or unusable result. Account Deletion Finalization is the sole disposal exception: an exceptionally unresolved reservation is extinguished with the deleted balance and its later provider output is discarded.
_Avoid_: Credit charge, deduction, refund

**AI Generation Request**:
A single attempt to produce one AI Artwork using the first release's fixed model and quality profile. A successfully delivered result consumes one reserved AI Credit even if the player dislikes or declines the artwork; trying again is a new request.
_Avoid_: Pattern Conversion, regeneration, retry

**AI Artwork Delivery**:
The terminal success of an AI Generation Request after the output bytes are copied into game-owned private storage and the AI Artwork Library record is durably committed. Only this transition captures the AI Credit Reservation. A late fal.ai webhook reconciles idempotently against the same Processing Job even after a client timeout; it never creates free duplicate artwork or a second charge.
_Avoid_: Provider callback, preview URL, client success

**Artwork Approval**:
The owner's explicit choice to use a delivered AI Artwork or framed Photo Artwork as Source Artwork for Pattern Conversion. Delivery, import, or framing never starts conversion automatically. Declining or leaving an AI result does not refund its charged AI Credit and leaves the delivered artwork in the private AI Artwork Library until deletion.
_Avoid_: Catalog approval, AI safety check, automatic conversion

**Prompt Safety Check**:
The server-side review that accepts or blocks an AI prompt before any AI Credit is reserved or fal.ai generation is requested. In the first release, the moderation model's `flagged` result is the decision: flagged prompts are blocked and unflagged prompts may proceed. Passing this check does not replace the provider's output safety checker.
_Avoid_: Catalog Review, prompt validation, output moderation

**Prompt Safety Rejection**:
A Prompt Safety Check result that blocks a flagged prompt before AI Credit Reservation or fal.ai generation. It produces no AI Artwork and costs no AI Credit.
_Avoid_: Safety-Rejected Generation, failed request, moderation failure

**Safety-Rejected Generation**:
An AI Generation Request whose result is marked unsafe by the provider safety checker. It produces no AI Artwork, stores no result, releases its AI Credit Reservation, and is never retried automatically.
_Avoid_: Failed Pattern, rejected artwork, moderated Pattern

**Artwork Aspect**:
The shape selected before an AI Generation Request: Square, Portrait 4:3, or Landscape 4:3. Pattern Conversion preserves the selected shape so approved AI Artwork is not forcibly cropped.
_Avoid_: Image size, Pattern Size, orientation

**Source Artwork**:
The non-playable visual input used to create a Pattern. It may be an imported photo or artwork produced by the AI image generator.
_Avoid_: Pattern, level, playable image

**Photo Artwork**:
Source Artwork imported from a Registered Account's photo. It initially preserves the photo's own shape and can be freely cropped, zoomed, and reframed before approval and Pattern Conversion.
_Avoid_: Uploaded image, original photo, photo Pattern

**Local Photo Source**:
The full-resolution photo kept only on the player's device during creation. It is never retained by the game backend and may be discarded after Pattern Conversion or when the local creation flow ends.
_Avoid_: Retained original, cloud photo, source upload

**Conversion Upload**:
The cropped and downscaled derivative of Photo Artwork sent temporarily for Pattern Conversion. It is deleted from backend processing storage after conversion succeeds or fails.
_Avoid_: Original upload, stored photo, Pattern image

**Artwork Framing**:
The free crop, zoom, and positioning step used to choose the visible area of Photo Artwork before approval. It is available to every Registered Account and is not restricted to the AI Artwork aspect presets, but the chosen frame's aspect ratio is bounded between 1:6 and 6:1 so every framing yields at least one Conversion Profile within the Pattern Size limits.
_Avoid_: Image editing, re-cropping, Premium crop

**AI Artwork**:
Source Artwork produced from a Registered Account's AI prompt by spending AI Credit. A successfully delivered result is retained privately until the owner deletes it and remains distinct from every Pattern created from it.
_Avoid_: AI Pattern, generated Pattern

**AI Artwork Library**:
The Registered Account's private collection of successfully delivered AI Artwork. Artwork remains available for repeated Pattern Conversion until the owner deletes it; deletion does not alter Patterns already created from that artwork.
_Avoid_: Gallery, generation history, AI Pattern Library

### Pattern Creation and Conversion

**Pattern Conversion**:
The unlimited transformation of Source Artwork into a new playable Personal Pattern for a Registered Account only after Artwork Approval. Repeating conversion always creates another Personal Pattern rather than replacing an earlier result.
_Avoid_: AI generation, image generation

**Conversion Recipe**:
The immutable provenance stored with a converted Pattern: Conversion Engine version, DMC palette version, Conversion Profile or Custom values, Pattern Size, and DMC Thread Color limit. It explains how the result was produced but does not retain a deleted Local Photo Source.
_Avoid_: Source Artwork, editable settings, conversion request

**Processing Job**:
The durable backend record for one long-running AI Generation Request or Pattern Conversion. The API persists it before accepting the work, and an independent worker may resume or retry it without producing more than one terminal result.
_Avoid_: In-process task, HTTP request, provider queue

**Conversion Engine**:
The stateless Python and FastAPI service that turns approved Source Artwork into a DMC-mapped stitch grid, palette, preview, and conversion statistics. It owns no account, credit, Processing Job, Pattern, or moderation state; the Game Backend worker owns orchestration and persistence.
_Avoid_: Game Backend, Pattern owner, conversion worker

**Pattern Size**:
The width and height of a Pattern's stitch grid. Pattern Conversion preserves the Source Artwork's shape, keeps each axis between 20 and 300 cells, and derives the long edge from the selected short-edge detail.
_Avoid_: Image size, resolution, canvas size

**Conversion Profile**:
A player-facing choice that controls Pattern Size and DMC Thread Color count while preserving the Source Artwork's shape. Easy uses a 50-cell short edge and at most 12 colors; Standard uses 100 and at most 20; Detailed uses 150 and at most 30. A profile whose derived long edge would exceed the 300-cell Pattern Size limit for the current framing is unavailable, exactly like out-of-limit Custom Conversion values; the Artwork Framing aspect bound guarantees at least Easy is always selectable.
_Avoid_: Difficulty, quality, resolution preset

**Custom Conversion**:
The free Conversion Profile that lets a Registered Account choose Pattern Size within 20–300 cells per axis and a DMC Thread Color limit from 5–60 instead of using Easy, Standard, or Detailed. The Source Artwork's shape remains locked, and values that would push either axis beyond the limit are unavailable.
_Avoid_: Advanced mode, Premium conversion, custom Pattern

**Personal Pattern**:
A Registered Account-owned Pattern created by Pattern Conversion or saved as a Derived Personal Pattern. Conversion Engine changes and editor saves never regenerate or replace it. It is private unless the player submits it and it passes Catalog Review.
_Avoid_: Private Pattern, custom Pattern, user Pattern

**Personal Pattern Editor**:
The non-destructive editor for adding, removing, or recoloring individual cells and replacing one DMC Thread Color throughout a Personal Pattern. Saving never mutates the source and always creates a Derived Personal Pattern.
_Avoid_: Pattern Conversion, in-place edit, Source Artwork editor

**Editor Draft**:
The device-local, automatically persisted working state and complete undo/redo history for editing one source Personal Pattern. Closing or reopening the editor preserves it but creates no Pattern; only explicit Save as New finalizes a Derived Personal Pattern.
_Avoid_: Personal Pattern, autosaved Pattern, server revision

**Derived Personal Pattern**:
A new Personal Pattern saved from the Personal Pattern Editor with its own final grid and palette and a lineage reference to the source Personal Pattern. Source Pattern data, Stitching Sessions, and Catalog Submissions remain unchanged.
_Avoid_: Pattern revision, overwritten Pattern, Catalog Submission version

**Pending Personal Pattern**:
A Derived Personal Pattern created locally by Save as New while the Registered Account is offline. It has a client-generated UUID, is immediately playable, and synchronizes idempotently as that same Personal Pattern when connectivity returns; Catalog Submission remains unavailable until backend synchronization succeeds.
_Avoid_: Editor Draft, temporary Pattern, offline Catalog Submission

### Playable Content and Catalog

**Pattern**:
A playable cross-stitch picture represented by marked cells and DMC Thread Colors. A Pattern may come from the curated catalog, an imported photo, or AI-generated artwork.
_Avoid_: Level, template, image

**Pattern Artifact**:
The immutable, schema-versioned package containing a Pattern's dimensions, DMC palette, and cell-to-color grid. Its bytes are stored privately outside the database, and an authorized client downloads it only through a short-lived Artifact Access Grant before verifying its checksum; the binary encoding is fixed by ADR-0018.
_Avoid_: Grid JSON, cell rows, preview image

**Artifact Access Grant**:
A short-lived download authorization issued after the Game Backend verifies that a player may download a Pattern Artifact. It permits transfer but changes no ownership or catalog state; Safety Removal prevents new grants for the affected Pattern.
_Avoid_: Public artifact URL, Pattern Unlock, ownership grant

**Pattern Preview**:
The exact flat-pixel image of a Pattern's grid, in which every cell is rendered as a uniform block of its own DMC Thread Color. It is the audit artefact that Catalog Technical Validation, Catalog Similarity Signal, and automated safety moderation read, not the image players are meant to browse. Personal Pattern Previews require owner-only signed access; Official and Community Pattern Previews are public and are purged on Safety Removal. Every renderer writes the cells a design does not stitch as fully transparent pixels (RGBA 0,0,0,0), so the same grid yields the same image on either conversion path.
_Avoid_: Source Artwork, Pattern Artifact, screenshot, thumbnail

**Pattern Thumbnail**:
The decorative image of a finished cross-stitch piece derived from a Pattern's grid and palette, used on every surface where a player or operator browses or identifies a Pattern. It is regenerable rather than immutable, carries no moderation or validation authority, and never reflects any Stitching Session's progress. It exists in a browsing and a detail variant, and its absence falls back to the Pattern Preview. It follows Pattern Preview's access and Safety Removal rules.
_Avoid_: Pattern Preview, cover image, progress image, hero image

**DMC Thread Color**:
A canonical thread color identified by its DMC code and used by Pattern cells. Pattern Conversion maps source colors into this palette rather than keeping arbitrary digital RGB colors.
_Avoid_: Paint color, pixel color, generic color

**Thread Color Number**:
The stable Pattern-local integer `1..N` assigned to one DMC Thread Color by its immutable Pattern Artifact palette order. The same number appears on every unfinished matching cell at a readable zoom and beside that color in Thread Palette, so color is never the sole gameplay cue. It is a play aid, not the DMC code or a globally reusable color identity.
_Avoid_: DMC code, cell index, difficulty number

**Pattern Catalog**:
The collection of ready-to-play Patterns available without requiring the player to provide or create artwork. It contains a substantial free starting selection, Official Patterns, and Community Patterns; every catalog Pattern has one Catalog Category and at most five Catalog Tags, and only Official Patterns may require a Pattern Unlock. First-release discovery consists of Staff Picks, New Patterns, category and tag navigation, and Catalog Search rather than personalized recommendations. The last successfully fetched pages may remain visible offline through Offline Catalog Cache, but offline catalog browsing cannot start a new Stitching Session.
_Avoid_: Gallery, store, library

**Staff Picks**:
The operator-curated, explicitly ordered discovery collection of currently available Official Patterns and Community Patterns. Like counts do not select or order it, and moderation or availability state removes an ineligible Pattern from the surface.
_Avoid_: Personalized recommendations, popularity ranking, sponsored placement

**New Patterns**:
The non-personalized discovery collection ordered by the Pattern's first catalog publication time, newest first. An accepted Catalog Metadata Revision does not change that timestamp or move the Pattern back to the top.
_Avoid_: Trending, recently edited, Like ranking

**Catalog Search**:
The non-personalized search over a Pattern's current approved title, its creator's permanent public username, and localized Catalog Tag labels. Results exclude unavailable content and Community Patterns hidden by the searching account's Creator Blocks. The first release has no behavioral recommendation or personalized ranking model.
_Avoid_: AI recommendations, full Pattern Artifact search, private-content search

**Catalog Category**:
The single required, operator-managed primary classification assigned to every Official Pattern and Community Pattern. Each category has a stable language-neutral code and localized display labels; it cannot become active until every released App Display Language has a label, and an English fallback represents exceptional incomplete data rather than a valid translated state. Catalog Submission Metadata stores the selected code rather than a rendered label. The first-release seed values are Animals, Nature and Flowers, People, Places and Architecture, Food and Drink, Holidays and Seasons, Fantasy, Geometric and Abstract, Words and Symbols, and Other; operators may add further categories or relabel existing ones from the Operator Console the same way they manage Catalog Tags (ADR-0040). A referenced category is deactivated, never deleted.
_Avoid_: Tag, collection, multiple categories

**Catalog Tag**:
One of at most five operator-managed search descriptors attached to an Official Pattern or Community Pattern. Each tag has a stable language-neutral code and localized display labels; it cannot become active until every released App Display Language has a label, and an English fallback represents exceptional incomplete data rather than a valid translated state. Catalog Submission Metadata stores the selected codes rather than the rendered labels. A player may select existing tags but cannot create a new tag in the first release. Tags refine discovery within and across Catalog Categories but do not replace the single required primary category.
_Avoid_: Category, keyword stuffing, private label

**Catalog Share Link**:
A stable Universal Link targeting an approved Community Pattern or a Public Creator Profile by opaque public identifier. The URL never contains a Pattern Artifact, Artifact Access Grant, private account identifier, or other credential. It opens the corresponding in-app page when the game is installed; otherwise it opens a web page containing only public profile or catalog metadata and the Pattern Preview plus store links. A target under Review Hold, Account Closure Hold, Catalog Withdrawal, or Safety Removal resolves to an unavailable state instead of exposing its former public content.
_Avoid_: Artifact URL, signed download link, private share, exported Pattern

**Official Pattern**:
A Pattern published in the Pattern Catalog by the game operator rather than through a player's Catalog Submission. It may be free or require a Pattern Unlock.
_Avoid_: Community Pattern, Personal Pattern, sponsored Pattern

**Bundled Starter Pattern**:
A free Official Pattern whose Pattern Artifact and Pattern Preview ship inside the app package so a player can start stitching immediately, including on a first launch without connectivity. Starting one is the sole exception to online Session Preparation for catalog content: the session becomes Ready from the bundled bytes, its backend session identity and the installation's Guest Installation Identity are created idempotently at first connectivity, and its progress, completion, and rewards then follow the ordinary local-first rules. It never requires a Pattern Unlock and behaves as a normal free Official Pattern in every other way.
_Avoid_: Offline Catalog Cache, demo Pattern, tutorial-only Pattern

**Pattern Unlock**:
The permanent backend entitlement to start Stitching Sessions for a non-free Official Pattern after a one-time online Stitch Coin spend from a Registered Account balance or Guest Ledger. Premium Membership does not replace or temporarily grant it. It survives session deletion, replay, and Guest Data Promotion; Community Patterns, undo, Stitch Actions, accessibility features, and other core play capabilities never require it.
_Avoid_: Rental, Pattern purchase, pay-to-play action

**Pattern Unlock Price Tier**:
The fixed Stitch Coin price of an Official Pattern, derived from the same stitchable-cell ranges as its Completion Reward Tier: Small costs 75, Medium costs 150, and Large costs 300. Popularity and demand do not change the price.
_Avoid_: Dynamic pricing, popularity price, real-money Pattern price

**Community Pattern**:
The immutable player-created Pattern copy whose Catalog Submission passed Catalog Review and is visible for free in the Pattern Catalog with its owner's Public Creator Profile. Its Pattern Artifact and Pattern Preview never change, while its current public metadata may advance only through an accepted Catalog Metadata Revision whose earlier snapshots remain auditable. An edited Personal Pattern submitted again becomes a new Community Pattern rather than a revision of an existing one; publishing the new Community Pattern does not replace or remove any earlier one. Community Patterns do not require Pattern Unlocks in the first release.
_Avoid_: Shared Pattern, public Pattern, user post

**Offline Catalog Cache**:
The last successfully fetched catalog pages stored on-device as public metadata and Pattern Previews only. Offline surfaces clearly mark the data as potentially stale and expose it read-only; they cannot perform a server search, obtain an Artifact Access Grant, or start a new Stitching Session. The cache never contains Pattern Artifacts and is reconciled with current catalog and moderation state when connectivity returns.
_Avoid_: Offline Pattern Data, offline catalog entitlement, full catalog download

### Stitching Sessions and Progress

**Stitching Session**:
A player's ongoing attempt to complete one immutable Official, Community, or Personal Pattern. The session references that Pattern and owns only player-specific state such as Session Progress; it is not a copied Pattern, and a later Personal Pattern edit cannot change it. A catalog session begins through idempotent Session Preparation and becomes playable on a device only after reaching Ready Session there; a Personal Pattern already available on-device may start ready.
_Avoid_: Game, project, pattern progress

**Session Preparation**:
The online, idempotent start flow for an Official Pattern or Community Pattern on a specific device. The Game Backend authenticates a Registered Account or Guest Installation Identity, verifies current catalog availability and any required Pattern Unlock, creates or returns that identity's one active Stitching Session for the Pattern, and issues an Artifact Access Grant. The device background service downloads the Pattern Artifact and Pattern Preview, verifies the checksum, atomically persists Offline Pattern Data, and completes the latest available Progress Merge before opening gameplay. A failed attempt remains Preparing on that device and retries the same backend session with a refreshed grant rather than creating another; any previously purchased Pattern Unlock remains permanent.
_Avoid_: Pattern Conversion, Processing Job, duplicate session

**Preparing Session**:
A catalog Stitching Session that exists in the Game Backend but is not yet playable on the current device because Session Preparation has not atomically persisted verified Offline Pattern Data and completed the latest available Progress Merge. Download, expiration, connectivity, checksum, or merge failure keeps this device-local state retryable without changing the backend session identity or another device's readiness.
_Avoid_: Failed Session, download job, partial Offline Pattern Data

**Session Preparation Cancellation**:
The player's explicit cancellation of a Preparing Session on the current device. It atomically stops local preparation and removes temporary bytes. If preparation created a new backend session that has no progress on any device, cancellation also deletes that empty session idempotently. If the backend session already has progress, cancellation leaves its identity and cloud progress intact and removes only this device's preparation state. A Pattern Unlock is never reversed or consumed again.
_Avoid_: Session deletion, Pattern Unlock refund, failed download

**Ready Session**:
A device-local availability state for a Stitching Session whose verified Offline Pattern Data is atomically present and whose latest available Progress Merge has completed on that device. Only this state may open gameplay; another device must independently prepare the same backend session, and partial or unverified bytes never make it ready.
_Avoid_: Completed Session, backend-only session, downloaded preview

**Session Completion**:
The permanent local-first result recorded atomically when every Pattern cell in an active Stitching Session has been completed. It closes that device's session at its final progress revision immediately, even offline, and the backend later validates and accepts the same idempotent completion as the terminal server revision. The completed session becomes read-only history; any Late Progress Operation from another device is acknowledged as superseded and cannot reopen it. Playing again creates a Replay Session instead of reopening or resetting the attempt.
_Avoid_: Pattern Completion, finished Pattern, 100% progress

**Replay Session**:
A new Stitching Session created when a player chooses to play a Pattern again after Session Completion, or an already-active session reclassified during Promotion Session Merge because another completed attempt is retained. A player has at most one active session for a Pattern at a time, and replay never overwrites an earlier completed session.
_Avoid_: Reset, restart, replay progress

**Offline Pattern Data**:
The verified Pattern Artifact and Pattern Preview atomically stored on-device when Session Preparation succeeds. They make that session a Ready Session, keep it playable without connectivity, and normally remain until the session is deleted. Guest Data-Only Promotion removes them when the target account lacks the paid Official Pattern's Unlock, and Safety Removal applies its stronger deletion rule; catalog browsing never pre-downloads other Pattern Artifacts.
_Avoid_: Offline Catalog Cache, downloaded Pattern, local Pattern

**Session Progress**:
The durable materialized cell state and revision of an active Stitching Session, derived from its idempotent Progress Operations. Every change is committed locally first so closing the app or losing connectivity does not discard play; a completed session freezes its final revision as read-only history.
_Avoid_: Save data, completion state, game progress

**Progress Operation**:
An idempotent local-first command that sets one Pattern cell to completed or incomplete and carries a globally unique operation identifier, device identifier, device sequence, cell identifier, desired state, and observed base revision. A causally later operation wins; only genuinely concurrent completed-versus-incomplete operations resolve to completed. Acknowledged operations may be compacted into a checkpoint after device watermarks prove they are no longer needed for merge.
_Avoid_: Cell value overwrite, tap log, last-write-wins update

**Late Progress Operation**:
A Progress Operation created on another device for a Stitching Session whose Session Completion has already been accepted by the backend. The completion revision is terminal: the backend idempotently acknowledges the late operation as superseded rather than applying it, reopening the session, retrying forever, or moving it into Replay Session. On reconciliation the device adopts the completed snapshot, removes the acknowledged local operation, and may show one conflict notice; only a new Replay Session accepts further play.
_Avoid_: Lost sync, completion rollback, automatic Replay

**Progress Sync**:
The background transfer and acknowledgement of locally committed Progress Operations and checkpoints to a Registered Account's cloud state. It applies causal merge while the session is active and returns a terminal superseded acknowledgement for any Late Progress Operation after accepted Session Completion. Guest Player operations stay local until Guest Data Promotion attaches their staged snapshot to a newly created or pre-existing target Registered Account.
_Avoid_: Auto-save, backup, upload queue

**Progress Merge**:
The causal combination of idempotent Progress Operations from multiple devices without replacing one device's full state with another's while the Stitching Session remains active. Operations observed later than their base revision apply normally, including Undo. Only concurrent operations for the same cell use the safety-biased rule that completed wins over incomplete; unrelated cells combine independently. Accepted Session Completion is a terminal boundary rather than another merge candidate.
_Avoid_: Last write wins, overwrite, conflict resolution

### Gameplay Interaction

**Active Thread Color**:
The DMC Thread Color currently selected by the player for Stitch Actions in a Stitching Session.
_Avoid_: Paint color, current color, selected number

**Thread Palette**:
The persistent gameplay control listing every Pattern color with its swatch, Thread Color Number, completion state, and remaining-cell count. It remains reachable while stitching, sweeping, panning, zooming, using Undo, or using Remaining Cell Locator; selecting a tool never hides it behind a mode exit. It uses accessible touch targets and platform text scaling and follows Handedness Layout.
_Avoid_: Hidden tool tray, color-only picker, DMC inventory

**Handedness Layout**:
The Left or Right gameplay preference that mirrors the interactive tool rail, Thread Palette entry edge, Undo, and Remaining Cell Locator without changing the Pattern, progress, rewards, or gesture semantics. A Registered Account synchronizes the preference through Account Cloud State with a device-local cache; a Guest Player stores it in the Local Identity Namespace.
_Avoid_: Screen rotation, accessibility entitlement, Pattern mirror

**Thread Color Completion**:
The moment every cell of the Active Thread Color has been filled. Any active Stitch Sweep ends, Thread Palette derives that color's complete state from zero remaining cells, and another color becomes active only after an explicit player choice. An Undo Action that reopens one of those cells makes the color incomplete and selectable again, but never claws back an already idempotently granted Daily Task reward.
_Avoid_: Auto-next color, color finished, palette completion

**Stitch Action**:
A player action that turns an unfinished Pattern cell whose DMC Thread Color matches the Active Thread Color into a Completed Stitch and records a completed Progress Operation. It may be undone freely while the Stitching Session remains active.
_Avoid_: Paint, color, mark

**Completed Stitch**:
The completed state of one Pattern cell after a Stitch Action. At a legible cell scale it replaces the unfinished Thread Color Number with a cross-shaped thread mark in that cell's DMC Thread Color; a distant view may summarize Completed Stitches as a color mosaic.
_Avoid_: Node, knot, painted cell, filled square

**Stitch Interaction Budget**:
The first-release performance gate for stitching interactions, measured on the oldest supported iOS and Android reference devices with a maximum-size Pattern: Stitch and Undo Actions must reach visible local state within the fixed latency budget, and pan, Anchored Zoom, and Stitch Sweep must hold the target frame rate with no network, sync, conversion, or decompression work on the interaction-critical path. Background work yields while an active gesture runs; the concrete scenario, latency, frame-rate, and thermal thresholds are fixed by ADR-0031, and failing them blocks release.
_Avoid_: Best-effort performance, server tap, average-only benchmark

**Undo Action**:
The free action that records an incomplete Progress Operation for a previously completed cell in an active Stitching Session. It is never gated by Stitch Coin, AI Credit, Premium Membership, advertising, lives, or score. A causally later Undo synchronizes normally; only a truly concurrent completed operation wins. Completed sessions are read-only and use Replay Session instead.
_Avoid_: Paid correction, reset, delete progress

**Stitch Sweep**:
A gesture that begins by pressing an eligible cell and produces one distinct Stitch Action and Progress Operation for every unfinished matching cell crossed while dragging. Non-matching and already completed cells produce no action, so Daily Tasks count newly filled cells rather than sweep gestures. An ordinary drag before the sweep begins remains a viewport pan.
_Avoid_: Paint mode, drag fill, continuous stitch

**Gameplay Event**:
A pseudonymous first-party record of a discrete player action or milestone — a Stitch Action, Thread Color Completion, session start, or funnel step — carrying only opaque identities and batched to the Game Backend over the existing sync channel per ADR-0035. Daily Task progress and product analytics are both queried from the same event stream; a Gameplay Event is evidence, not a reward grant or a Progress Operation.
_Avoid_: Analytics ping, telemetry event, Progress Operation, Pending Coin Reward

**Analytics Mirror**:
The filtered, consent-gated copy of selected Gameplay Events and screen views sent to Firebase Analytics for funnel and retention reporting per ADR-0055. It carries only funnel endpoints, closed-enum payload fields, route templates without parameters, and the same opaque player reference used for a Support Reference. The Mirror is a reporting convenience and never an authority: every product or Daily Task answer is confirmed against the first-party Gameplay Event stream, which remains the single source of truth.
_Avoid_: Firebase event stream, analytics source of truth, third-party telemetry

**Edge Auto-Pan**:
The viewport movement triggered when an active Stitch Sweep approaches a screen edge, allowing the player to continue stitching beyond the currently visible area without lifting their finger.
_Avoid_: Auto-scroll, follow finger, edge scroll

**Fit View**:
The minimum grid zoom at which the entire Pattern is visible. Every Stitching Session opens in Fit View rather than restoring a previous viewport position.
_Avoid_: Zoom out, reset zoom, overview

**Anchored Zoom**:
The grid zoom interaction that keeps the Pattern point beneath the player's pinch gesture fixed while scaling. Zoom is bounded between Fit View and a cell-readable maximum, and panning keeps the Pattern from drifting into unnecessary empty space.
_Avoid_: Pinch zoom, free zoom, double-tap zoom

**Mismatched Tap**:
A tap on a cell whose DMC Thread Color does not match the Active Thread Color. It changes no cell, gives only gentle feedback, and never consumes currency, credit, lives, or score.
_Avoid_: Mistake, wrong stitch, error

**Remaining Cell Locator**:
The free, unlimited action that centers the viewport on the next unfinished cell for Active Thread Color and cycles deterministically through remaining matches. It never fills a cell, changes progress, grants a reward, selects the next color, shows an advertisement, or consumes Stitch Coin, AI Credit, or Premium access. The first release provides no auto-fill assistance.
_Avoid_: Hint currency, auto-stitch, paid help

### Social

**Pattern Like**:
The single reversible heart action for an Official Pattern or Community Pattern. For a Registered Account it creates or removes one unique account–Pattern relationship, updates the public aggregate Like count, and adds or removes the Pattern from the account's private Liked Patterns collection. A Guest Player's Like remains device-local and does not affect the public count until Guest Data Promotion upserts it exactly once into the target account. The public count is display-only social proof in the first release: it affects neither catalog ranking or recommendations nor Stitch Coin, AI Credit, Premium benefits, or creator compensation.
_Avoid_: Separate Favorite, rating, completion, anonymous public Like

**First-Release Social Scope**:
The bounded set of social interactions consisting of Pattern Like, Catalog Share Link, Community Report, Profile Report, and Creator Block. The first release has no comments, creator following, direct messaging, or separate Favorite action.
_Avoid_: Social network, comment feed, follower graph

### Catalog Publishing and Moderation

**Catalog Submission**:
A player's explicit request to have an immutable copy of a Personal Pattern reviewed for publication in the Pattern Catalog. The submitting Registered Account must first have a Public Creator Profile. Every submission captures a new copy together with its Catalog Submission Metadata and Publication Rights Declaration, including submissions made after editing a previously submitted Personal Pattern, and passes through Catalog Precheck before human Catalog Review; a pending, quarantined, or rejected submission is not visible in the catalog.
_Avoid_: Share, upload, post

**Catalog Submission Metadata**:
The required title, description, Catalog Source Language, one Catalog Category, and up to five distinct Catalog Tags captured with a Catalog Submission. These values are stored as part of the immutable submission snapshot and are available to Catalog Precheck and the human moderator rather than being read later from the mutable Personal Pattern. Catalog Metadata Validation is a publication invariant, not a moderator preference.
_Avoid_: Pattern data, editor metadata, optional review notes

**Catalog Metadata Validation**:
The deterministic validation that a Catalog Submission or Catalog Metadata Revision has normalized non-empty title and description within configured length limits, one supported Catalog Source Language, exactly one active Catalog Category, no more than five distinct active operator-managed Catalog Tag codes, and no unknown or malformed field. Failure makes backend acceptance impossible; a moderator may only reject the immutable snapshot as Technical Invalidity. Safety, rights, meaning, quality, and misleading presentation remain human decisions.
_Avoid_: Text moderation, metadata quality review, tag suggestion

**Catalog Metadata Revision**:
An owner's request to replace only a published Community Pattern's title, description, Catalog Source Language, Catalog Category, or Catalog Tags. Every request creates a new immutable metadata snapshot. Its changed text passes the safety subset of Catalog Precheck, the entire snapshot must pass Catalog Metadata Validation, and a human moderator makes the final contextual acceptance or rejection decision; unchanged Pattern data is not revalidated. A moderator cannot override invalid structure or taxonomy codes. A rejection includes a visible Catalog Rejection Reason and requires the owner to choose between one Catalog Metadata Appeal for that snapshot or a new revision; submitting a new revision permanently waives the earlier appeal right. A Community Pattern may have at most one pending revision or active metadata appeal at a time, and a pending snapshot cannot be edited. The owner may use Catalog Metadata Revision Withdrawal before a decision and then submit a new snapshot. The currently approved metadata remains public while a revision is pending, rejected, or appealed; acceptance makes the revision current for the same Community Pattern and retains every earlier snapshot in the private audit history. An owner may submit a revision during Review Hold, but it cannot publish or clear the hold independently; the moderator resolves the revision together with Post-Publication Review. Catalog Withdrawal and Safety Removal prevent new revisions and close any pending revision without publication. A Pattern Artifact or Pattern Preview change cannot use this path and requires a new Catalog Submission that creates a new Community Pattern.
_Avoid_: Pattern edit, in-place metadata edit, new Community Pattern

**Catalog Metadata Revision Withdrawal**:
The owner's irreversible cancellation of a pending Catalog Metadata Revision before a human decision. It changes no public metadata, retains the immutable proposed snapshot and withdrawal event in the private audit history, creates no Catalog Metadata Appeal right, and releases the Pattern to accept a new revision.
_Avoid_: Catalog Withdrawal, metadata edit, rejection

**Catalog Metadata Appeal**:
The owner's single opportunity to request another human review of the exact immutable Catalog Metadata Revision after its initial rejection. It cannot change any proposed value and is assigned to a different moderator when operationally possible. An active appeal prevents another metadata revision until it is decided. Acceptance publishes that revision on the existing Community Pattern only if current Catalog Metadata Validation passes; an upheld rejection is final for the revision, while the last accepted metadata remains public throughout. Submitting a new revision before opening the appeal permanently waives this right for the earlier rejection.
_Avoid_: Catalog Appeal, edited revision, new Catalog Submission

**Catalog Source Language**:
The single supported language recorded with a Community Pattern's title and description. The first release accepts only English. The immutable metadata stores that language together with the authored text, independently of the reading player's App Display Language. The game does not generate or publish automatic translations: catalog surfaces show the original text with its language label, while localized Catalog Categories and Catalog Tags provide cross-language discovery.
_Avoid_: App Display Language, app locale, automatic translation, multilingual submission

**Publication Rights Declaration**:
The mandatory affirmation by the submitting Registered Account that the player created the submitted content or otherwise holds the rights necessary to publish it in the Pattern Catalog and grants the Catalog Publication License. The declaration, submitting account, license version, and submission time are stored with the immutable Catalog Submission and shown to the moderator; the declaration is an attestation, not automatic proof of ownership or a substitute for Catalog Review.
_Avoid_: Copyright verification, license approval, ownership proof

**Catalog Publication License**:
The non-exclusive, worldwide, royalty-free permission a submitting creator grants the game to host, technically transform, display, and distribute the immutable Community Pattern, Pattern Preview, and public metadata through the app, catalog CDN, Catalog Share Link, and service providers needed to operate them. The creator retains ownership. Catalog Withdrawal ends new catalog distribution but the license survives only for existing Stitching Sessions, backups, moderation, fraud, and legal records; Safety Removal ends player distribution while preserving private evidence. The game receives no right to sell the creator's standalone artwork or use it outside operating and promoting this catalog entry.
_Avoid_: Copyright transfer, exclusive ownership, unrestricted content license

**Catalog Precheck**:
The automated safety, similarity, metadata, and technical analysis performed before human Catalog Review. Automated safety moderation analyzes the Catalog Submission's title, description, and Pattern Preview, and perceptual hashing produces a Catalog Similarity Signal for identical or near-identical catalog images; these are moderator-facing evidence and never make the safety, rights, duplication, quality, or publication decision. Catalog Metadata Validation and Catalog Technical Validation separately enforce the non-negotiable invariants that malformed metadata or playable bytes cannot be published. No automated result can approve or publish content.
_Avoid_: Catalog Review, automatic moderation decision, prompt check

**Catalog Technical Validation**:
The deterministic validation of an immutable Catalog Submission's Pattern Artifact checksum, schema version, dimensions, palette, grid indices, decompression limits, and preview-to-artifact identity. Failure places the submission in Review Quarantine and makes backend acceptance impossible; a moderator may only reject it as Technical Invalidity. An appeal may rerun validators to correct a validator defect, but the same immutable bytes cannot publish until every technical invariant passes.
_Avoid_: Quality review, safety moderation, advisory signal

**Catalog Similarity Signal**:
The advisory result produced when perceptual hashing finds an identical or near-identical Pattern Preview among existing or pending Catalog Submissions. It identifies review candidates regardless of whether they belong to the same player, including edited and resubmitted versions, but never automatically rejects or merges a submission; the human moderator decides whether it is an acceptable new Community Pattern or a disallowed copy.
_Avoid_: Duplicate rejection, plagiarism verdict, version merge

**Review Quarantine**:
The non-public Catalog Submission state used when Catalog Precheck raises a safety or technical concern. Only authorized moderators and the submitting account may access its review status; a human moderator must still make the final decision.
_Avoid_: Rejection, Safety Removal, shadow ban

**Catalog Review**:
The human moderation decision that accepts or rejects every Catalog Submission after Catalog Precheck. Only an explicit moderator acceptance of a snapshot that currently passes both Catalog Metadata Validation and Catalog Technical Validation may create and publish a Community Pattern; automated systems never publish content, and a moderator cannot override malformed metadata or playable bytes. Every rejection must include a Catalog Rejection Reason and may include a moderator note, both visible to the submitting player.
_Avoid_: Approval, verification, AI approval

**Catalog Rejection Reason**:
The mandatory structured reason attached to a rejected Catalog Submission. The first-release reasons are Safety, Publication Rights, Duplicate or Spam, Technical Invalidity, and Quality Standard. The submitting player can see the selected reason and any optional moderator note; neither changes the immutable submission snapshot.
_Avoid_: Hidden moderation label, automated rejection, generic failure

**Catalog Appeal**:
The submitting player's single opportunity to request another human review of the exact immutable Catalog Submission after its initial rejection. The appeal cannot change the Pattern, Catalog Submission Metadata, or Publication Rights Declaration and is assigned to a different moderator when operationally possible. Acceptance publishes that snapshot as a Community Pattern only if current Catalog Metadata Validation and Catalog Technical Validation both pass; an upheld rejection is final for that submission. Any content change requires a new Catalog Submission rather than another appeal.
_Avoid_: Resubmission, content edit, repeated appeal

**Community Report**:
An in-game signal submitted by a Registered Account that a published Community Pattern may violate safety, legal, or catalog policy. It requires a Community Report Reason, accepts an optional explanation except when the selected reason requires one, and is unique per submitting account and open Post-Publication Review; repeated submissions during that case return the existing report. After closure, a new approved public metadata version or materially new evidence may create a new rate-limited report instead of being blocked forever by the earlier case. A Guest Player may see the report action but must sign in before submitting. The report starts or contributes to a review but never removes or changes the Pattern by itself.
_Avoid_: Automatic takedown, Catalog Rejection, app-store report

**Community Report Reason**:
The mandatory structured reason selected when submitting a Community Report. The first-release reasons are Inappropriate or Unsafe Content, Copyright or Publication Rights, Duplicate or Spam, Misleading Title or Tags, and Other. An explanation is optional for the first four reasons and required when Other is selected.
_Avoid_: Catalog Rejection Reason, free-form-only report, hidden category

**Post-Publication Review**:
The human moderation review of a published Community Pattern initiated by one or more Community Reports. A moderator may apply Review Hold while evidence is evaluated. The final decision restores normal catalog availability when no violation is found, applies Catalog Metadata Remediation when only the current approved metadata violates policy, or applies Safety Removal when the content presents a serious safety, legal, or policy violation.
_Avoid_: Catalog Review, automatic removal, creator withdrawal

**Review Hold**:
A temporary moderator-only state applied to a Community Pattern during Post-Publication Review. It removes the Pattern from catalog discovery and prevents new Stitching Sessions, while existing Stitching Sessions and their Offline Pattern Data remain playable until the final human decision. Reports and automated thresholds cannot apply it. The owner may propose a Catalog Metadata Revision, but neither submission nor acceptance can clear the hold outside the moderator's combined Post-Publication Review decision. Clearing the hold restores normal availability; a metadata-only violation may instead be resolved with Catalog Metadata Remediation; confirming a serious violation applies Safety Removal and closes any pending metadata revision without publication. Applying the hold and reaching the final decision each create a Moderation Notice for the Community Pattern owner.
_Avoid_: Review Quarantine, Catalog Withdrawal, Safety Removal, automatic hide

**Catalog Metadata Remediation**:
The moderator action used when Post-Publication Review confirms that a Community Pattern's current approved title, description, Catalog Category, or Catalog Tags violate policy without the playable content warranting Safety Removal. It replaces the violating title or description with a safe neutral default, removes violating Catalog Tags, may reassign the Catalog Category, and records the previous values in the private audit history. The Pattern Artifact, Pattern Preview, catalog availability, existing Stitching Sessions, and Offline Pattern Data remain unchanged, and the owner receives a Moderation Notice. It has no separate appeal because the owner may propose compliant values through an ordinary Catalog Metadata Revision.
_Avoid_: Safety Removal, Catalog Withdrawal, owner metadata edit, Profile Remediation

**Moderation Notice**:
The owner-facing record sent through both in-app messaging and email when Review Hold is applied and when Post-Publication Review reaches its final decision. It identifies the affected Community Pattern and explains the moderation reason, but never exposes the identity or account details of any player who submitted a Community Report.
_Avoid_: Reporter disclosure, public moderation log, marketing notification

**Catalog Withdrawal**:
The owner's irreversible voluntary removal of a Community Pattern from catalog discovery and new session starts. It prevents new Catalog Metadata Revisions and closes any pending revision without publication. Existing Stitching Sessions and their Offline Pattern Data remain playable; publishing the content again requires a new Catalog Submission and creates a new Community Pattern.
_Avoid_: Delete, unpublish, Safety Removal

**Safety Removal**:
A moderator-initiated removal for a serious safety, legal, or policy violation, including a violation confirmed by Post-Publication Review. It prevents new Catalog Metadata Revisions, closes any pending revision without publication, blocks new and existing Stitching Sessions, and deletes Offline Pattern Data when an affected device next checks with the backend. The Community Pattern owner receives a Moderation Notice explaining the decision without identifying any reporting player and may create one Safety Removal Appeal. The removal remains fully effective unless that appeal succeeds.
_Avoid_: Catalog Withdrawal, rejection, soft hide

**Safety Removal Appeal**:
The Community Pattern owner's single request for another human review of a Safety Removal decision against the same immutable Pattern and moderation record. Safety Removal remains fully effective while the appeal is open, and the appeal is assigned to a different moderator when operationally possible. Acceptance rescinds the removal, restores catalog discovery and Artifact Access Grants, republishes the Pattern Preview, and lets affected sessions download Offline Pattern Data again. An upheld removal is final for that Community Pattern.
_Avoid_: Catalog Appeal, edited resubmission, temporary restoration

### Operator Console

**Operator Console**:
The game-owned web application through which an authenticated Operator Account publishes and manages Official Patterns, curates Staff Picks and Catalog Tags, and will later perform catalog and profile moderation. Every state-changing action requires an Operator Account and is recorded in the Operator Audit Log; the console is never reachable with a player identity.
_Avoid_: Admin panel, player app, third-party CMS

**Operator Account**:
A multi-factor-protected staff identity that exists only for the Operator Console and its API. It is entirely separate from Registered Accounts, Guest Installation Identities, and the Firebase identity broker; a player credential can never open it and it can never play, own player content, or hold player balances.
_Avoid_: Registered Account, Firebase user, shared credential

**Official Pattern Draft**:
The non-public reviewable result produced when an operator uploads a source image for conversion into a stitch grid, DMC palette, and preview. It becomes an Official Pattern only through an explicit, separately audited publish action that fixes its metadata and derives any Pattern Unlock Price Tier from its stitchable-cell count; an unpublished or discarded draft never appears in the Pattern Catalog.
_Avoid_: Personal Pattern, Community Pattern, published Pattern

**Operator Audit Log**:
The append-only private record of every Operator Console action and security event, including who acted, what changed, when, and the prior value. Entries can never be edited or deleted, and the log is internal evidence rather than any public history.
_Avoid_: Application log, public changelog, editable history
