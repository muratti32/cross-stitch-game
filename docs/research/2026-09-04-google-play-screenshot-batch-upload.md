# Google Play screenshot batch upload

Date: 2026-09-04  
Scope: phone and 10-inch tablet screenshots for one or more existing Play Store locales. Research only; no upload was performed.

## Conclusion

The failure is caused by the client's transaction boundary, not by `images.upload` being inherently single-file. Google Play's supported model is one **Edit** containing all image mutations, followed by one validation and one commit. The present client commits after each image, so its first commit exposes an invalid one-screenshot set and Google rejects it. The fix is an edit-scoped batch operation (direct API), `fastlane supply`, or Gradle Play Publisher (GPP); all three can upload the complete set before committing. Google documents edits as atomic groups whose changes are not live until commit. [Google: Edits workflow](https://developers.google.com/android-publisher/edits)

## Current local setup

- Codex is configured with `play-store-mcp==0.6.0` and a Google credential reference (`<SET>`). Its `upload_image` implementation creates an edit, uploads exactly one image, and commits immediately; this is the incompatible transaction boundary. [play-store-mcp v0.6.0 source](https://github.com/lusky3/play-store-mcp/blob/v0.6.0/src/play_store_mcp/client.py#L4586-L4625)
- `fastlane 2.229.1` is already installed locally. The shell does not currently expose `GOOGLE_APPLICATION_CREDENTIALS`, so an actual Supply run must receive the same service-account JSON path securely via `--json_key` or `SUPPLY_JSON_KEY`.
- Prepared assets already contain 256 phone and 256 ten-inch-tablet files: eight of each type for 32 missing locales. The existing `en-US` sets can be omitted and left unchanged.

## Exact direct-API transaction

For `packageName=com.avk.stitchwish`:

1. Create one edit: `POST /androidpublisher/v3/applications/{packageName}/edits`. Save returned `editId`. [Google: `edits.insert`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/insert)
2. For each `(language, imageType)` being replaced, call `DELETE /androidpublisher/v3/applications/{packageName}/edits/{editId}/listings/{language}/{imageType}` once. This mutates only the edit. [Google: `images.deleteall`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/deleteall)
3. Upload all screenshots, in display order, using the **same `editId`**: `POST /upload/androidpublisher/v3/applications/{packageName}/edits/{editId}/listings/{language}/{imageType}?uploadType=media`. Repeat for every file; PNG and JPEG are supported by the tools reviewed. [Google: `images.upload`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload), [Google: media upload protocol](https://developers.google.com/android-publisher/upload)
4. Validate once: `POST /androidpublisher/v3/applications/{packageName}/edits/{editId}:validate`. Validation does not publish. [Google: `edits.validate`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/validate)
5. Commit once: `POST /androidpublisher/v3/applications/{packageName}/edits/{editId}:commit`. If any upload/validation fails, delete or abandon the edit instead; uncommitted changes do not affect the live listing. [Google: `edits.commit`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit), [Google: Edits workflow](https://developers.google.com/android-publisher/edits)

One edit may contain both phone and tablet sets, and may contain multiple locales. Sequential upload is safest because screenshot order is upload order; GPP's maintained implementation explicitly uploads each set sequentially because order matters. [GPP 4.0.0 source: `DefaultEditManager.publishImages`](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/play/android-publisher/src/main/kotlin/com/github/triplet/gradle/androidpublisher/internal/DefaultEditManager.kt#L95-L101)

### Exact values

- `language`: an existing listing's BCP-47 code, e.g. `pt-BR`; an unsupported code is a no-op. [Google: `images.upload` parameters](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload)
- Phone: `imageType=phoneScreenshots`.
- 7-inch tablet: `imageType=sevenInchScreenshots`.
- 10-inch tablet: `imageType=tenInchScreenshots`.
- Do not use a generic `tabletScreenshots`; it is not an API enum. [Google: `AppImageType`](https://developers.google.com/android-publisher/api-ref/rest/v3/AppImageType)

For the currently prepared non-English-US listing set, preserve these exact existing locale identifiers: `ar`, `ca`, `cs-CZ`, `da-DK`, `de-DE`, `el-GR`, `es-ES`, `fi-FI`, `fil`, `fr-FR`, `hi-IN`, `hr`, `hu-HU`, `id`, `it-IT`, `ja-JP`, `ko-KR`, `ms-MY`, `nl-NL`, `no-NO`, `pl-PL`, `pt-BR`, `pt-PT`, `ro`, `ru-RU`, `sk`, `sl`, `sv-SE`, `uk`, `vi`, `zh-CN`, `zh-TW`. Confirm each via `edits.listings.list` before mutation because unsupported locales silently no-op.

## Alternative 1: fastlane `supply` (recommended ready-made route)

Directory layout:

```text
metadata/<locale>/images/phoneScreenshots/01.png ... 08.png
metadata/<locale>/images/tenInchScreenshots/01.png ... 08.png
```

Run screenshots only:

```bash
bundle exec fastlane supply \
  --package_name com.avk.stitchwish \
  --metadata_path /absolute/path/to/metadata \
  --json_key /secure/path/play-service-account.json \
  --skip_upload_apk \
  --skip_upload_aab \
  --skip_upload_metadata \
  --skip_upload_changelogs \
  --skip_upload_images
```

`skip_upload_images` excludes icon/feature graphics, not screenshots. Supply sorts filenames, clears each remote screenshot type, uploads every local file into one active edit, then commits only after all metadata work completes. Thus it directly avoids the first-image commit failure. [fastlane docs: screenshots and replacement behavior](https://docs.fastlane.tools/actions/supply/#images-and-screenshots), [fastlane source: screenshot loop](https://github.com/fastlane/fastlane/blob/280c8e8873a77fc28302c2a89cda2afa99edfcfb/supply/lib/supply/uploader.rb#L307-L339), [fastlane source: one final validate/commit](https://github.com/fastlane/fastlane/blob/280c8e8873a77fc28302c2a89cda2afa99edfcfb/supply/lib/supply/uploader.rb#L8-L54)

Safety dry run: add `--validate_only`; Supply validates instead of committing. Then rerun without it for the actual commit. `--sync_image_upload` can preserve matching leading screenshots by SHA-256, but replacement without it is simpler and deterministic. Keep the metadata root limited to intended locales/types. [fastlane docs: `validate_only` and `sync_image_upload`](https://docs.fastlane.tools/actions/supply/)

## Alternative 2: Gradle Play Publisher 4.0.0

Directory layout:

```text
app/src/main/play/listings/<locale>/graphics/phone-screenshots/01.png ... 08.png
app/src/main/play/listings/<locale>/graphics/large-tablet-screenshots/01.png ... 08.png
```

Run `./gradlew publishListing`. GPP maps `phone-screenshots` to `phoneScreenshots` and `large-tablet-screenshots` to `tenInchScreenshots`; `tablet-screenshots` means **7-inch**. It permits at most eight per set. [GPP 4.0.0 docs: listing layout](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/README.md#uploading-graphic-based-listings), [GPP source: directory/API mapping](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/play/plugin/src/main/kotlin/com/github/triplet/gradle/play/internal/ListingModels.kt#L25-L37)

GPP compares ordered hashes; when different, it deletes the remote set and uploads local files sequentially inside one edit. Commit defaults to `true`, and the listing task is finalized by one commit task. `./gradlew publishListing --no-commit` validates and leaves changes pending rather than publishing. [GPP source: media comparison](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/play/plugin/src/main/kotlin/com/github/triplet/gradle/play/tasks/PublishListings.kt#L230-L255), [GPP source: commit default](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/play/plugin/src/main/kotlin/com/github/triplet/gradle/play/PlayPublisherPlugin.kt#L72-L81), [GPP source: no-commit validation](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/play/plugin/src/main/kotlin/com/github/triplet/gradle/play/tasks/CommitEdit.kt#L29-L45)

GPP merges resources from its default language into missing translations. Use an isolated source set containing only intended locale directories, or verify generated resources before publishing. [GPP 4.0.0 docs: translation merging](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/README.md#directory-structure)

## Authentication

All edit/image/commit calls require OAuth scope `https://www.googleapis.com/auth/androidpublisher`. Google requires a Cloud project with the Google Play Developer API enabled, plus a service account (recommended for automation) or OAuth client; the identity must be invited under Play Console Users & permissions and granted access to this app and the required listing-edit actions. [Google: Getting started](https://developers.google.com/android-publisher/getting_started), [Google: authorization](https://developers.google.com/android-publisher/authorization)

- fastlane accepts `--json_key`, raw JSON, or Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`/ADC). [fastlane source: credential selection](https://github.com/fastlane/fastlane/blob/280c8e8873a77fc28302c2a89cda2afa99edfcfb/supply/lib/supply/client.rb#L20-L43)
- GPP accepts `serviceAccountCredentials`, `ANDROID_PUBLISHER_CREDENTIALS`, or ADC; do not commit a service-account key. [GPP 4.0.0 docs: authentication](https://github.com/Triple-T/gradle-play-publisher/blob/4.0.0/README.md#authenticating-gradle-play-publisher)

## Commit and concurrency safety

- Use one writer. Creating another edit for the same user invalidates its existing edit; any Play Console change or another committed edit can invalidate open edits. [Google: Edits workflow](https://developers.google.com/android-publisher/edits)
- A successful commit makes the whole edit live and propagation may take hours. No partial live set exists before commit. [Google: Edits workflow](https://developers.google.com/android-publisher/edits)
- The current commit API defaults `changesInReviewBehavior` to `CANCEL_IN_REVIEW_AND_SUBMIT`, which can cancel an existing review and submit all changes. A direct client should explicitly use `ERROR_IF_IN_REVIEW` unless cancellation is intended. `changesNotSentForReview=true` may be used when the desired result is changes held for explicit Play Console submission. [Google: `edits.commit`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit)
- Before replacement, list and record current image count/order; after upload, list inside the same edit, validate, commit once, then open a fresh read-only edit and verify counts/order. On failure, delete the edit rather than trying to commit a partial set.

## Recommendation for the MCP

Add one tool such as `replace_screenshot_set(packageName, language, imageType, imagePaths[])` that owns the full edit lifecycle. Better: accept multiple locale/type sets, upload all within one edit, validate, and require a separate explicit commit token. Do not implement it by calling the current auto-committing single-image tool repeatedly.
