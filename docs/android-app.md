# Android App Architecture

The Android app (`apps/android`, Jetpack Compose) is a **hybrid** of native
screens and embedded web views. Device-bound features stay native; read- and
config-heavy screens are embedded from the web app so we don't maintain two
implementations of the same UI.

## Navigation

A bottom navigation bar (`ui/screens/MainScreen.kt`, tabs in `AppState.kt`'s
`MainTab`) hosts five tabs:

| Tab  | Kind     | Why                                                                             |
| ---- | -------- | ------------------------------------------------------------------------------- |
| Home | Embedded | Web `/` (the dashboard); the default tab on launch                              |
| Add  | Native   | Native date/time pickers, offline entry queue; skips `list` data fields (#1316) |
| Feed | Embedded | Web `/feed`                                                                     |
| Sync | Native   | Health Connect permissions, background sync management                          |
| More | Hub      | Native list of everything else (`ui/screens/MoreScreen.kt`)                     |

The Add tab's Activity form starts with **Log a strength session**, which opens the web
[strength session page](features/strength-logging.md) (`/strength`) in the More tab's web view:
sets are logged there, not natively. The form's data fields are sent as the type's `data_schema`
declares them (numbers as JSON numbers, a decimal comma accepted, booleans as booleans); a number
field that does not parse, or falls outside the field's `min` and `max` ("Must be between 0 and 10"),
is marked on the field and nothing is sent. A queued entry whose values are strings (the older queue
format) is converted with the cached activity types when it is sent.

Like the web Add data form, the Add tab offers the built-in catalogues. The activity type picker lists
the [activity type catalogue](features/activity-type-catalog.md)'s types not in use yet under
**Built-in**, after your own (matched by name, display name or alias; variants are not listed), and a
picked one shows its fields at once; saving the activity adds the type. The metric picker lists the
[metric catalogue](features/metric-catalog.md)'s metrics not in use yet under **Catalogue**, and a
catalogue metric gets a **Unit** choice next to the value, offering the same units as the web form,
the unit the metric is stored in preselected. A unit is sent only when another one is picked, and a
queued metric keeps it. Both catalogues are cached, so the pickers offer them offline after one
successful load; after logging a type or metric not in use yet, the tab reloads the lists.

There are far more web pages than fit on a bottom bar, so the **More** tab is a
hub (`MoreScreen.kt`, `moreGroups`): a grouped list where each entry opens the
corresponding web page in an embedded WebView (Timeline, Data, Chart, Training load, Meals,
Reports, Settings, Data sources, Help & support, …). Its first group, **Inbox**, holds
**Notifications** (the web `/notifications` page, see
[Notifications](features/notifications.md)). The two native-only screens — **Live**
sensors ([BLE](#live-sensors)) and **Account** (server URL, logout) — also live in the hub.
Selecting an entry pushes it in place; the system back gesture returns to the
hub (after any embedded page has exhausted its own WebView history), and so does
tapping **More** on the bottom bar again. The pushed sub-page lives in
`AppState.moreDestination` rather than inside `MoreScreen`, so `selectTab` can
clear it — otherwise the hub would be unreachable from a sub-page. Keep
`moreGroups` in sync with the web navigation (`apps/web/src/components/nav-links.ts`).

Tapping **Home** or **Feed** while already on it reloads that tab's root page in
a fresh WebView (with fresh history): `selectTab` bumps `AppState.tabReselections`
when the current tab is tapped again, and both embedded tabs are wrapped in
`key(appState.tabReselections)`. The native Add and Sync tabs are not reset, so a
half-filled form survives an accidental tap, and a notification or widget link to
the tab already showing (`AppState.open`) switches tabs without reloading it. A
link that names a More page is the exception: it always loads that page (see
below).

A tab can move from embedded to native later (e.g. if the feed becomes a heavily
used, interaction-rich screen) without affecting the other tabs.

## Notifications

The phone shows the server's [notifications](features/notifications.md) that are meant for
push. The server decides what is pushed: each notification type has its own **Push** switch,
set on the web Settings page under Notifications. The app only delivers them.

**The device switch.** "Notifications on this device" on the Account screen turns delivery on
or off for this phone. Turning it on requests `POST_NOTIFICATIONS` (Android 13+) and schedules
the poller; "Choose which kinds" opens the embedded `/settings#notifications` page. When the
switch is on but Android's app-level notification permission is off (nothing would be shown),
the Account screen shows a warning with a button into the system notification settings,
re-checked on every resume. On launch, `AutoEnablePostNotifications` turns the switch on by
itself, requesting the permission, when the user never made an explicit choice and the server
pushes at least one type (`GET /notifications/types`, any `push`). An explicit "off" is never
overridden, and a denied request records "off" so the user isn't re-prompted every launch.

**The poll.** There is no FCM (the app ships on F-Droid): `NotificationWorker` is a periodic
WorkManager job, every 15 minutes, that reads `GET /notifications?push_only=true&unread_only=true`
after a stored high-water mark. The pure, unit-tested `decideCentralNotifications`
(`CentralNotifications.kt`) picks the notifications created after the mark; the first run only
records it, so turning delivery on doesn't dump the backlog (the old post poller's mark seeds
it after an upgrade, so nothing that arrived since its last run is lost). After a background
sync succeeds, `SyncWorker` asks for one extra poll a minute later (`NotificationWorker.checkSoon`):
an auto-share announces itself shortly after the activity lands and shares after the rule's
wait, 10 minutes by default, which is shorter than the poll interval. The periodic poll and
`checkSoon` are two unique works, so they share one lock and never post the same notification
at once.

**Keeping the shade current.** Every poll also re-reads the server notifications still in the
shade: their server id and a key of what they show (title, body, link and actions,
`notificationContentKey`) ride in the notification's extras, and
`GET /notifications?push_only=true&ids=…` answers their current state. The pure
`reconcileShownNotifications` withdraws the ones read elsewhere (the web bell, **Mark all read**)
or no longer on the server, and reposts the revised ones under the same Android id without
alerting again (`setOnlyAlertOnce`): a pending auto-share turns into "was shared" or "will not be
shared" and loses its "Don't share" button. A server that predates `ids` ignores it and answers
notifications that were not asked for; the app then leaves the shade alone. Notifications posted
before this version carry no extras and are left as they are.

**Showing one.** Each notification shows its title and body on a channel per notification
group (`notifications_<group>`, named after the group, e.g. "Feed"; a type the server lists
without a group, or one unknown to it, goes to "Other"), so the user can mute a group in
Android's settings. Tapping it opens its link — `/feed` on the Feed tab, any other site path as
an embedded page in the More tab, `/notifications` when there is none — and marks it read
(`EXTRA_NOTIFICATION_ID`, validated as a UUID since the activity is exported). The
notification's action buttons (e.g. "Don't share" on a pending auto-share) run on the server
through `NotificationActionReceiver` (`POST /notifications/{id}/actions/{key}`); on success the
notification goes away, on failure it is replaced by one saying the action failed.

**Unread badge.** The More tab's icon and its Notifications row show the number of unread in-app
notifications (`unread_count`, "9+" above nine), refreshed when the app resumes, when More is
selected, and when a page opened from More is closed.

**Older servers.** A server without `/notifications` answers 404. Then the worker falls back to
the old post notifier: it fetches `/feed/following` and `/feed/timeline` and `decideNotifications`
(`PostNotifications.kt`) notifies posts newer than its own high-water mark (judged by
`received_at`), from a followed actor whose `notify_on_post` bell is on, and not a reply to
someone else, plus posts the user is involved in (a reply to their post, a Mention of them).
Tapping one opens the Feed tab. Auto-enable likewise falls back to "any bell is on".

## Embedded web views

`ui/screens/EmbeddedWebScreen.kt` is the reusable WebView host: it enables
JavaScript + DOM storage, shows a native loading spinner and a retry-able error
state (covering both network failures and main-frame HTTP errors such as a `5xx`
or `404` on the page shell — a client-rendered SPA returns `200` for `/feed`, so
token-expiry `401`s surface on client-side `fetch`, not the main-frame load), and
lets the system back gesture walk the WebView history first.

The WebView follows the **system dark-mode** setting even though the native UI
stays light: it is built against a day/night-themed context
(`Theme.Aurboda.WebView`) with algorithmic darkening allowed, so the embedded web
app's `prefers-color-scheme` resolves to dark when the system is dark and its own
dark CSS applies (the page declares `color-scheme: light dark`).

### JS dialogs and file inputs

A WebView without a `WebChromeClient` suppresses every JavaScript dialog —
`confirm()` returns `false`, `prompt()` returns `null`, `alert()` shows nothing —
and every `<input type="file">`. `EmbeddedWebScreen` installs one
(`ui/screens/EmbeddedWebChrome.kt`) that shows `alert`/`confirm`/`prompt` as
native dialogs (back or an outside tap counts as Cancel) and backs file inputs,
including `multiple`, with the system picker. Embedded pages can therefore keep
using the browser's own dialogs and file inputs.

### Camera (barcode scanning)

The food pages can read a product barcode with the camera (see
[openfoodfacts.md → Scanning](openfoodfacts.md#scanning)), which in the WebView
needs both the app's `CAMERA` permission and a `WebChromeClient` that answers the
page's `getUserMedia` request. The manifest declares `android.permission.CAMERA`
with `android.hardware.camera` marked `required="false"`, so the app still installs
on devices without a camera. The permission is not asked for at install or start:
the first time a page opens the scanner, the system dialog asks for it, and a
refusal shows the page's "camera is blocked" message.

`EmbeddedWebChrome.kt` (`rememberWebCameraPermission`) grants only
`RESOURCE_VIDEO_CAPTURE` (never the microphone or anything else a page asks for),
and only to a request whose origin has the scheme, host and port of the signed-in
server (`isSameOrigin`). A page that is not on that origin (a challenge on another
instance) gets a chrome client that denies every such request. A request still
pending when the screen leaves is denied.

### Page height and `vh` units

The WebView can resolve CSS viewport units (`100vh`, `40vh`) and the `%` height
chain to 0 even when the view itself is sized correctly, collapsing full-height
pages. `EmbeddedWebScreen` injects a viewport fix that pins `<html>` to
`window.innerHeight` in px (re-applied on resize and page finish) so `body` and
`#app` fill via `%`. Page CSS that must work embedded should therefore size from
that flex chain (`%`, `flex`) rather than from `vh`: a `vh` cap on an
`overflow: hidden` panel renders it empty in the app while looking fine in a
desktop browser (the Places list did exactly this). A page that fills the shell
(`height: 100%`, internal scrolling) must also not let its content size the
shell: on narrow screens `.app-content` is `height: auto`, so a tall list would
inflate it past the viewport and the page would scroll instead. `contain: size`
on the page root prevents that (see the Places page).

Modal dialogs cap their height with `%` of their `position: fixed` backdrop (or,
for a dialog that is itself fixed, `%` of the viewport it resolves against)
rather than `vh`: a `max-height: 90vh` share dialog collapsed to its own padding
in the app, showing only half its title. `apps/web/src/no-viewport-height-units.test.ts`
fails on any viewport-height unit in the web CSS outside a short allowlist; the
allowlisted uses only apply at tablet widths and are tracked in #1356.

The likely native root cause is that a WebView created without layout params
gets `WRAP_CONTENT`, which makes Chromium force a zero layout height.
`EmbeddedWebScreen` therefore gives the WebView `MATCH_PARENT` layout params
(what Accompanist's WebView does). Until that is confirmed on a device, the
injected viewport fix and the `vh` allowlist stay; #1356 tracks dropping them.
To confirm it, open **More → Help & support** in the app: in embed mode the
bottom of that page shows `Viewport: 100vh = … · innerHeight = … · html = …` in
px. If `100vh` equals `innerHeight`, the `MATCH_PARENT` fix works and `vh`
resolves in the WebView; `0` means it still does not (`html` always matches
`innerHeight`, since the viewport fix pins it).

### Soft keyboard

Focusing an input — a native text field or one inside an embedded page — must
not leave it behind the keyboard. Two mechanisms cover the supported API range:

- **API ≤ 34:** `android:windowSoftInputMode="adjustResize"` on `MainActivity`
  lets the system shrink the window.
- **API 35+:** edge-to-edge is enforced and `adjustResize` is ignored, so the app
  consumes the IME inset itself — `AurbodaAppShell` (MainActivity.kt) pads every
  screen by `WindowInsets.ime` (injectable, so tests can supply a fixed inset).

Both paths shrink the WebView rather than sliding it, which is what makes it
scroll the focused element into view; the injected viewport fix re-pins the page
height to the new `window.innerHeight`. `KeyboardInsetsTest` covers both.

### The embed contract (web ↔ native)

The web app supports an **embed mode** (`apps/web/src/embed.ts`):

- The native app loads pages with `?embed=1`. In embed mode the web app hides its
  own chrome (header, sidebar, footer) because the native app provides
  navigation. The flag is persisted to `sessionStorage` so it survives
  client-side navigation that drops the query string.
- **Auth is shared, not re-entered.** The WebView exposes a JavaScript bridge,
  `window.AurbodaNative.getAuth()`, returning `{ user, token }` JSON. The web app
  reads it at startup (`readNativeAuth`) and seeds its bearer-token auth from it,
  falling back to browser-stored credentials when the bridge is absent. This
  works because both the web app (localStorage) and the Android app
  (EncryptedSharedPreferences) authenticate with the same stateless bearer token.
  The bridge is installed as a **document-start script scoped to the trusted
  origin** (`WebViewCompat.addDocumentStartJavaScript` with `allowedOriginRules`),
  so the token reaches only that origin's frames — a cross-origin iframe never
  receives it. Older WebViews without document-start-script support fall back to
  `addJavascriptInterface`; that is safe because the feed sanitiser strips
  `<iframe>`/`<script>` and external navigation opens in the browser. Keep that
  invariant: never allow-list `<iframe>` into the feed sanitiser. Either way the
  bridge is installed only when the loaded page is on the signed-in server's
  origin (`EmbeddedWebScreen`); a page from another instance (a remote challenge)
  gets no `window.AurbodaNative` at all.

### External links

Links inside an embedded page that point **outside the server's origin** open in
the external browser (via `ACTION_VIEW`); same-origin links stay in the WebView.
The decision is a pure, unit-tested helper: `ui/screens/WebLink.kt`
(`isExternalLink`). Non-http(s) schemes (`mailto:`, `tel:`, …) are treated as
external.

## Login screen

The login screen (`ui/screens/LoginScreen.kt`) is native, since it works logged out: the server
URL, **Sign in with passkey** (Credential Manager), one button per
[sign-in provider](sso.md#in-the-android-app) the server offers, and username and password. The
providers load with the email check, half a second after the server URL stops changing
(`AuthApi.oidcProviders`; an older server without them shows none).

A provider button starts an app sign-in (`AuthApi.oidcStart`, `{"client": "app"}`), keeps the
verifier in memory (`OidcLogin.pending`, `OidcLogin.kt`, for ten minutes) and opens the provider in a
Custom Tab (`androidx.browser`), falling back to `ACTION_VIEW`. The server sends the browser back to
`net.aurboda.oidc://callback?code=…` (or `?error=…`), which `MainActivity` claims with an intent
filter. `MainActivity` hands the callback to `OidcLogin.callback` and clears the intent's data so a
rotation does not replay it; when the browser started a second `MainActivity` on top of its tab, that
copy brings the running one forward (`CLEAR_TOP | SINGLE_TOP`) and finishes. The login screen trades
the code with the verifier (`AuthApi.oidcExchange`) and saves the session like a password login.
Linking a provider is web-only: the embedded Settings page shows no Link buttons.

## Refused tokens and read-only accounts

- **401: logged out.** The HTTP clients that carry the stored token (background
  sync, the Sync tab, the app shell) install `tokenRefusalPlugin`
  (`SessionRefusal.kt`): a `401` to a request whose bearer token is the stored one
  clears the credentials and flags the session as refused. The app then shows the
  login screen with "Your session is no longer valid. Please log in again." — at
  once when it is open, otherwise on the next open. The embedded pages never tell
  the app about a `401` (they get the token through the auth bridge), so the app
  checks the stored token itself (`GET /api/user/settings`) whenever the main
  screen resumes. Background sync that hits a `401` stops without a retry.
- **402: read-only.** A read-only account (plan or trial expired) is answered
  `402` with `{ error, payment_url }` on every write. Sync stops that run without
  a retry or backoff, keeps the queued data (the Add Data queue, the Health Connect
  changes token, unacknowledged write-backs) for when the plan is renewed, and
  shows the server's `error` as the background sync status and in the sync
  progress view. It does not log out; the periodic run tries again on its normal
  schedule. `classifyHttpStatus` (`HttpOutcome.kt`) is where the status codes get
  their meaning.

## Live sensors

The native **Live** screen (`ui/screens/LiveScreen.kt`) connects to Bluetooth LE sensors that
speak the standard profiles: heart-rate monitors (Heart Rate service `0x180D`, e.g. a Polar H10)
and running speed and cadence pods (RSC service `0x1814`, e.g. a Zwift Runpod). It scans for them
and lists what it finds; each connected sensor gets a card with its live heart rate, or cadence
and steps, the sync state (with **Enable HC** while Health Connect writes are not permitted), an
**Auto-reconnect** switch and **Disconnect**. A heart-rate card also shows HRV (RMSSD over the
RR intervals, with a five-minute chart) once enough intervals are in. The **Phone Step Counter**
card counts steps from the phone's own step sensor instead.

The connections run in a foreground service (`ble/SensorService.kt`), so they go on with the
screen closed; **Stop All Sensors**, or the notification's stop action, ends it. Every five
seconds the service sends the new samples to the backend as Health Connect records
(`POST /sync/HeartRateRecord`, `/sync/StepsRecord`, and `/sync/HeartRateVariabilityRmssdRecord`
when the RR window is reliable) and writes them to Health Connect where permitted. A sensor with
auto-reconnect on is reconnected with backoff after a drop, and after a reboot or when Bluetooth
comes back on (`ble/BleAutoConnectReceiver.kt`).

## Home-screen widgets

Two `AppWidgetProvider`s live in `widget/`:

- **HR Zones** (`HrZoneWidgetProvider` + `GoalsWidgetService`): the goal
  progress bars from `GET /goals/progress/widget`, one row per goal in the web
  order, with the same colours and overflow bar as the web Goals page (see
  [Goals: Android Widget](features/goals.md#android-widget)). It is resizable and
  its rows scroll. Tapping it opens the Goals page.
- **Challenge** (`ChallengeWidgetProvider`, min 2×2, resizable): the race chart
  and leaderboard of **one** challenge, hosted or joined. When the widget is
  placed the launcher opens `ChallengeWidgetConfigActivity` (a Compose list of
  the user's hosted + active joined challenges, from `GET /challenges` and
  `GET /challenges/participations/mine`); the pick is stored per widget id in
  SharedPreferences (`ChallengeWidgetPrefs.kt`). Rendering — including the
  network fetch — runs in `ChallengeWidgetWorker` (WorkManager, unique
  `APPEND_OR_REPLACE`), enqueued by the provider's `onUpdate`/resize, the config
  screen, and after every sync; the receiver itself never blocks. The worker
  fetches the user's hosted + joined lists **once** per refresh and shares them
  with every widget (`fetchChallengeWidgetLists`, #991); the challenge itself
  (name, unit, window — so a rename or a left challenge shows) comes from those
  lists, the standings from the **hosting** instance's public
  `GET /public/:username/:slug/standings` (discovered via `/.well-known/aurboda`
  like a federated join, `ChallengeApi.kt`). A cancelled worker propagates its
  `CancellationException` out of the API helpers instead of turning it into an
  error result. The chart is a Canvas bitmap
  (`ChallengeChart.kt`) — a widget can't host a WebView — with the same member
  palette as the web page; bucket ends come from the host's
  `effective_bucket_size` on the standings response (calendar days/weeks/months
  in the challenge zone, `bucketEndAt`), inferred from the data only for a host
  that doesn't send it. The leaderboard rows are added with
  `RemoteViews.addView`, as many as fit for the launcher-reported size
  (`planChallengeWidgetLayout`), always keeping the signed-in user's row; when
  that row was pulled up from below the cut on a widget too narrow for the rank
  column, it alone keeps its rank, prefixed "…" (`rankCellText`, #992), so a
  10th place never reads as 2nd. All
  the pure logic (series, rows, layout, texts) is in `ChallengeWidgetModel.kt`
  and unit-tested. Once the challenge has **ended** the widget shows the final
  standings: a result banner above the chart — a big 🏆 "You won!" when the
  signed-in user won (or tied for the win), 🥈 / 🥉 "You came 2nd/3rd" naming
  the winner when they made the podium, otherwise "<winner> won" with where the
  user finished (`challengeResultBanner`) — and medals in the rank column
  (`rankLabel`; ranks are competition ranks, so equal totals share one). On a
  2×2 cell the chart gives way to the banner + two rows
  (`planChallengeWidgetLayout(showResult = true)` → `showChart = false`). The
  widget flips to final standings as soon as `end_ts` passes, while the host's
  feed announcement waits a grace period (6 h) for late syncs — so for those
  hours the widget's podium is provisional and may differ from what is
  eventually announced.
  Tapping the widget deep-links to `/u/<owner>/<slug>` (or the
  absolute URL for a challenge on another instance) in the More tab.
  **Moving on:** each refresh runs `widgetTarget` over the user's picks — a
  running, upcoming or less-than-a-day-finished challenge is kept; a day after
  the end (or at once when the challenge is gone from the lists) the widget
  advances to the running pick ending soonest, else the soonest upcoming, and
  rewrites its stored config; with nothing open it asks
  `GET /challenges/discover` and renders the first result as a **suggestion**
  ("Join a challenge?" + name, host, window; tap opens the user's own
  `/challenges/join?challenge=<share url>&confirm=1` — `challengeJoinConfirmPath` —
  which shows the challenge and joins it on a Join click; the host's page would only
  offer "Join from another instance", the user not being logged in there),
  falling back to the finished challenge's final standings when there is none,
  or to "No open challenges — tap to pick one" (opens the picker) when there
  isn't even that.

Widget taps and notification taps reach `MainActivity` as `EXTRA_OPEN_TAB` /
`EXTRA_MORE_PATH` extras (`deepLinkFrom` in `AppState.kt`). On a cold start they
pick the initial tab/page; because the activity is `singleTop`, a tap while the
app is running arrives in `onNewIntent` and navigates the running app to the same
place (`AppState.open`). A link with a More page always opens it in a fresh
WebView, also when More already shows a page (even that same page):
`AppState.open` bumps `AppState.morePageLinks`, and `MoreScreen` keys the
embedded page on the path and that counter, because `EmbeddedWebScreen` loads its
URL only when its WebView is built. `MoreDestination.Web` accepts either a site path or an
absolute URL (`embeddedPageUrl`), so a joined challenge hosted elsewhere opens
embedded too — its own in-page links open in the browser as any external link.
Because the activity is exported, any app can send these extras, so `deepLinkFrom`
keeps a `more_path` only when it is a site path (`/…`, not `//…`) or an http(s)
URL of a challenge the user configured a widget for (`challengeWidgetUrls`);
anything else opens the More hub.

## Update channels

Only the `github` build flavor (the APK on GitHub releases) updates itself; the Google Play and
F-Droid builds are updated by their store and share a no-op `SelfUpdate`. See
[Android distribution: GitHub, Google Play and F-Droid](android-stores.md) for the flavors.

The `github` build checks `BuildConfig.VERSION_JSON_URL` for a newer build (`checkForUpdate`,
called from `SelfUpdate` in `src/github/java/net/aurboda/update/`). CI bakes the URL in per branch
(`.github/workflows/android.yml`):

| Built from | Release                             | `VERSION_JSON_URL`                      |
| ---------- | ----------------------------------- | --------------------------------------- |
| `main`     | `v1.0.<versionCode>`, marked latest | `releases/latest/download/version.json` |
| `develop`  | pre-release on the fixed tag `beta` | `releases/download/beta/version.json`   |

A stable install therefore only ever updates to the next main release; a beta install
(APK from the `beta` pre-release) follows develop. Local builds default to the beta
channel. The tag is `beta`, not `develop`: a tag named like a branch shadows the branch in
git ref resolution (`git fetch origin develop` would fetch the tag). `versionCode` is `git rev-list --count HEAD` (`scripts/release-version.sh`), monotonic within each channel. On `main`
every release builds the APK, whether or not it touches `apps/android`, because `v1.0.<versionCode>` is also the
release's Docker image tag (`.github/workflows/release.yml`); its release notes are the release PR's change list.
