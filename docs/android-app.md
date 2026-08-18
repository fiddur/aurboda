# Android App Architecture

The Android app (`apps/android`, Jetpack Compose) is a **hybrid** of native
screens and embedded web views. Device-bound features stay native; read- and
config-heavy screens are embedded from the web app so we don't maintain two
implementations of the same UI.

## Navigation

A bottom navigation bar (`ui/screens/MainScreen.kt`, tabs in `AppState.kt`'s
`MainTab`) hosts five tabs:

| Tab  | Kind     | Why                                                         |
| ---- | -------- | ----------------------------------------------------------- |
| Home | Embedded | Web `/` (the dashboard); the default tab on launch          |
| Add  | Native   | Native date/time pickers, offline entry queue               |
| Feed | Embedded | Web `/feed`                                                 |
| Sync | Native   | Health Connect permissions, background sync management      |
| More | Hub      | Native list of everything else (`ui/screens/MoreScreen.kt`) |

There are far more web pages than fit on a bottom bar, so the **More** tab is a
hub (`MoreScreen.kt`, `moreGroups`): a grouped list where each entry opens the
corresponding web page in an embedded WebView (Timeline, Data, Chart, Meals,
Reports, Settings, Data sources, …). The two native-only screens — **Live**
sensors (BLE) and **Account** (server URL, logout) — also live in the hub.
Selecting an entry pushes it in place; the system back gesture returns to the
hub (after any embedded page has exhausted its own WebView history), and so does
tapping **More** on the bottom bar again. The pushed sub-page lives in
`AppState.moreDestination` rather than inside `MoreScreen`, so `selectTab` can
clear it — otherwise the hub would be unreachable from a sub-page. Keep
`moreGroups` in sync with the web navigation (`apps/web/src/components/nav-links.ts`).

A tab can move from embedded to native later (e.g. if the feed becomes a heavily
used, interaction-rich screen) without affecting the other tabs.

## Post notifications

A native background poller (`NotificationWorker`, a periodic WorkManager job)
notifies the user when accounts they follow post to their home timeline. Each
run fetches `/feed/following` and `/feed/timeline`, then the pure, unit-tested
`decideNotifications` (`PostNotifications.kt`) picks which posts to notify: those
newer than a stored high-water mark and from a followed actor whose server-side
`notify_on_post` flag is on (toggled per-account on the web Feed page). The first
run only records the high-water mark, so enabling the feature doesn't dump the
backlog. The user opts in with the **"Notify me about new posts"** switch on the
Account screen, which requests `POST_NOTIFICATIONS` (Android 13+) and
schedules/cancels the worker; tapping a notification opens the Feed tab.

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
  invariant: never allow-list `<iframe>` into the feed sanitiser.

### External links

Links inside an embedded page that point **outside the server's origin** open in
the external browser (via `ACTION_VIEW`); same-origin links stay in the WebView.
The decision is a pure, unit-tested helper: `ui/screens/WebLink.kt`
(`isExternalLink`). Non-http(s) schemes (`mailto:`, `tel:`, …) are treated as
external.

## Home-screen widgets

Two `AppWidgetProvider`s live in `widget/`:

- **HR Zones** (`HrZoneWidgetProvider` + `GoalsWidgetService`): the goal
  progress bars, see `docs/GOAL_WIDGET.md`. Tapping it opens the Goals page.
- **Challenge** (`ChallengeWidgetProvider`, min 2×2, resizable): the race chart
  and leaderboard of **one** challenge, hosted or joined. When the widget is
  placed the launcher opens `ChallengeWidgetConfigActivity` (a Compose list of
  the user's hosted + active joined challenges, from `GET /challenges` and
  `GET /challenges/participations/mine`); the pick is stored per widget id in
  SharedPreferences (`ChallengeWidgetPrefs.kt`). Rendering — including the
  network fetch — runs in `ChallengeWidgetWorker` (WorkManager, unique
  `APPEND_OR_REPLACE`), enqueued by the provider's `onUpdate`/resize, the config
  screen, and after every sync; the receiver itself never blocks. Data comes from
  the user's own instance for the challenge itself (name, unit, window — so a
  rename or a left challenge shows) and from the **hosting** instance's public
  `GET /public/:username/:slug/standings` (discovered via `/.well-known/aurboda`
  like a federated join, `ChallengeApi.kt`). The chart is a Canvas bitmap
  (`ChallengeChart.kt`) — a widget can't host a WebView — with the same member
  palette as the web page; the leaderboard rows are added with
  `RemoteViews.addView`, as many as fit for the launcher-reported size
  (`planChallengeWidgetLayout`), always keeping the signed-in user's row. All
  the pure logic (series, rows, layout, texts) is in `ChallengeWidgetModel.kt`
  and unit-tested. Tapping the widget deep-links to `/u/<owner>/<slug>` (or the
  absolute URL for a challenge on another instance) in the More tab.

Widget taps and notification taps reach `MainActivity` as `EXTRA_OPEN_TAB` /
`EXTRA_MORE_PATH` extras (`deepLinkFrom` in `AppState.kt`). On a cold start they
pick the initial tab/page; because the activity is `singleTop`, a tap while the
app is running arrives in `onNewIntent` and navigates the running app to the same
place (`AppState.open`). `MoreDestination.Web` accepts either a site path or an
absolute URL (`embeddedPageUrl`), so a joined challenge hosted elsewhere opens
embedded too — its own in-page links open in the browser as any external link.
