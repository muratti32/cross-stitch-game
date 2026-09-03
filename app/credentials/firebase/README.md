# Firebase service files

Drop the two Google service files from the `stitchwish-d3b28` Firebase console
here (ADR-0055):

- `google-services.json` — Android app registration
- `GoogleService-Info.plist` — iOS app registration

`app/android/` and `app/ios/` are generated prebuild output and are not tracked,
so these files live here and are wired into the native projects by
`app.config.ts`. They are client-side identifiers, not secrets: the same values
ship inside every published binary.

When either file is missing, `app.config.ts` omits the Firebase config plugin
entirely and the app builds and runs without Analytics — a fresh clone and CI
are never blocked on them.
