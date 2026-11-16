# Android distribution: GitHub, Google Play and F-Droid

The Android app (`apps/android`) is built in three **product flavors** on one flavor dimension,
`channel`, one per place it is distributed. All three have the same `applicationId`
(`net.aurboda`), so an install from one channel is replaced by an install from another only when
both are signed with the same key. Each flavor sets `BuildConfig.CHANNEL` to its name.

| Flavor   | Where it goes                              | Updates                                                                         | Embedded pages get    |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------- | --------------------- |
| `github` | `aurboda.apk` on GitHub releases (default) | Itself, from `version.json` ([update channels](android-app.md#update-channels)) | `?embed=1`            |
| `play`   | Google Play                                | Google Play                                                                     | `?embed=1&store=play` |
| `fdroid` | F-Droid / IzzyOnDroid                      | The F-Droid client                                                              | `?embed=1`            |

## What differs between the flavors

- **Self-update.** `src/github/java/net/aurboda/update/` holds the updater (`checkForUpdate`, the
  download and install dialogs, and `SelfUpdate`, the composable `MainActivity` calls).
  `src/store/java/net/aurboda/update/SelfUpdate.kt` is a no-op with the same signature, added to the
  `play` and `fdroid` source sets in `app/build.gradle.kts`, so `MainActivity` has no flavor checks.
  A store must not let an app install APKs by itself, so `REQUEST_INSTALL_PACKAGES` and the APK
  `FileProvider` (with `res/xml/file_paths.xml`) live in `src/github/AndroidManifest.xml` and are
  merged into the `github` build only. The updater's unit tests are in `src/testGithub/`.
- **Payments in the Play build.** Google Play's payments policy does not allow an app to point
  users at a payment outside Google Play for digital services. The `play` build therefore adds
  `store=play` to every embedded web page (`embeddedPageUrl` in `MoreScreen.kt`, the one place that
  adds `embed=1`). The web app reads it once and keeps it for the WebView session, like the embed
  flag (`isPlayStoreBuild()` in `apps/web/src/embed.ts`). With it set, the plan banner,
  Settings › Plan and the signup page's billing line still show the plan state but leave out the
  price and the Pay or Renew link. An account paid on the web keeps working in the Play build;
  there is no Play Billing.
- **No Google Play Services.** Passkey login uses the platform Credential Manager
  (`androidx.credentials`, which serves passkeys itself from Android 14, the app's `minSdk`), so no
  flavor depends on `credentials-play-services-auth`. Notifications are polled
  ([no FCM](android-app.md#notifications)). This keeps every flavor free of proprietary
  dependencies, which F-Droid requires.

## Building

From `apps/android`, after generating the Kotlin models
(`pnpm --filter @aurboda/api-spec build && pnpm --filter @aurboda/api-spec generate` from the repo
root):

| Build            | Command                                                             | Output                                                        |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| GitHub, debug    | `./gradlew assembleGithubDebug`                                     | `app/build/outputs/apk/github/debug/`                         |
| GitHub, release  | `./gradlew assembleGithubRelease`                                   | `app/build/outputs/apk/github/release/app-github-release.apk` |
| Play, release    | `./gradlew assemblePlayRelease` (or `bundlePlayRelease` for an AAB) | `app/build/outputs/apk/play/release/`                         |
| F-Droid, release | `./gradlew assembleFdroidRelease`                                   | `app/build/outputs/apk/fdroid/release/`                       |
| Unit tests       | `./gradlew testGithubDebugUnitTest`                                 | `app/build/reports/tests/`                                    |

`pnpm build:android` builds the GitHub debug APK. CI (`.github/workflows/ci.yml`) runs the GitHub
unit tests and compiles the debug build of all three flavors; the release pipeline
(`.github/workflows/android.yml`) builds and publishes only the `github` release APK, still as
`aurboda.apk` with its `version.json`.

## Store listing

The listing text and screenshots are in [fastlane](https://docs.fastlane.tools/actions/supply/)
layout at the repo root, `fastlane/metadata/android/en-US/` (`title.txt`, `short_description.txt`,
`full_description.txt`, `images/phoneScreenshots/`), which is where F-Droid and IzzyOnDroid look by
default and what `fastlane supply` uploads to Google Play. There is no `changelogs/` directory: the
release notes live on the [GitHub releases](https://github.com/fiddur/aurboda/releases).

## Draft F-Droid build recipe

A starting point for `metadata/net.aurboda.yml` in
[fdroiddata](https://gitlab.com/fdroid/fdroiddata), not yet submitted. `versionName` and
`versionCode` must match a tagged release (`v1.0.<versionCode>`, see
[Cutting a release](docker.md#cutting-a-release)); `VERSION_CODE` is the environment variable
`app/build.gradle.kts` reads.

```yaml
Categories:
  - Sports & Health
License: AGPL-3.0-only
SourceCode: https://github.com/fiddur/aurboda
IssueTracker: https://github.com/fiddur/aurboda/issues

AutoName: Aurboda

RepoType: git
Repo: https://github.com/fiddur/aurboda.git

Builds:
  - versionName: 1.0.NNNN
    versionCode: NNNN
    commit: v1.0.NNNN
    subdir: apps/android/app
    sudo:
      - apt-get update
      - apt-get install -y nodejs npm
      - npm install -g pnpm
    init: export VERSION_CODE=NNNN
    gradle:
      - fdroid
    prebuild:
      - cd ../../..
      - pnpm install
      - pnpm --filter @aurboda/api-spec build
      - pnpm --filter @aurboda/api-spec generate

AutoUpdateMode: Version
UpdateCheckMode: Tags ^v1\.0\.\d+$
CurrentVersion: 1.0.NNNN
CurrentVersionCode: NNNN
```

**A known obstacle.** The Kotlin models are generated at build time, and the generator
(`@openapitools/openapi-generator-cli`) downloads a prebuilt `openapi-generator` JAR, which F-Droid's
build server may refuse as a non-source binary (as it may the npm install itself, which needs the
network, and Debian's `nodejs` package is older than the Node version in `.nvmrc`). The alternative is to check the generated models
(`packages/api-spec/generated/kotlin`) into the repository, so the F-Droid build needs neither Node
nor the generator; that is a change to make if the fdroiddata review asks for it. IzzyOnDroid
publishes the signed APK from GitHub releases instead and has no such constraint.

## What remains for the owner

None of this needs code in this repository:

- A Google Play developer account, and the app created there.
- The Play Console declarations: Health Connect permissions (with the privacy policy and the
  permission rationale), the `connectedDevice` foreground service, the location permission used for BLE
  scanning, and the data safety form.
- The camera, in the data safety form and the privacy policy: it is used on the device to read
  food barcodes, and no image is stored or sent (only the decoded digits go to the barcode lookup).
- The Play upload key and Play App Signing. Play re-signs the app with its own key, so its
  SHA-256 fingerprint has to be added to `ANDROID_APP_FINGERPRINTS` (see [docker.md](docker.md))
  for passkeys to work in the Play build.
- The IzzyOnDroid request and the fdroiddata merge request (the recipe above).
- Store badges on the welcome page (`apps/web/src/pages/Home`), once a listing is live, and its
  "Not in Google Play or F-Droid yet" note.
