# Localize the app shell only

The mobile app ships every interface string as hardcoded English, while the
Game Backend is already locale-aware for taxonomy: `catalog.controller.ts`
accepts a `?locale=` query parameter and `catalog.tag_labels` stores a label
per `(tag_code, locale)`, falling back to `en` per label. Adding player
languages could therefore have been scoped anywhere between "app text only"
and "every player-facing surface the game owns."

We localize the mobile app's own interface text and nothing else. The
Game Backend, the public website, the operator console, store listings, and
the transactional emails the backend sends stay English-only and are not
modified by this work. The App Display Language resolves from the device
language with a per-device Settings override, ships bundled in the app
binary, and is sent to the existing `?locale=` catalog contract without any
backend change. The first release covers English and Turkish.

Three categories of player-facing text therefore stay in their original
language by design, and a future reader should not treat any of them as an
oversight:

- **Player-authored catalog text.** Community Pattern titles and
  descriptions keep their Catalog Source Language, which the first release
  already decided not to auto-translate. Cross-language discovery keeps
  running through localized Catalog Tags and Catalog Categories.
- **Moderator-authored text.** A Catalog Rejection Reason is written by a
  human moderator and cannot be mapped to a translation key. The app wraps it
  in localized framing and shows the reason itself verbatim.
- **Official Pattern titles**, including the bundled starter patterns.
  Translating a bundled title in the app while the same Official Pattern
  keeps its English title in the catalog would present one pattern under two
  names.

## Consequences

Backend error responses are English, so the app must stop rendering the
server's `message` field to players. It maps the accompanying machine-readable
`reason` code to a localized string, falls back to a generic localized failure
with a Support Reference for unrecognized codes, and keeps the raw server
message only as Sentry breadcrumb data.

Players who read Turkish still receive English one-time-password emails from
the backend. This is an accepted gap of this scope boundary, not a defect.

Reversing the boundary is expensive in the direction that matters: making the
backend locale-aware later means threading a player language through email
delivery, moderation output, and error construction, and deciding where a
player's language is stored server-side once the client has already treated it
as device-local preference.
