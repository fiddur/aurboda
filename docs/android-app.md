# Android App Architecture

The Android app (`apps/android`, Jetpack Compose) is a **hybrid** of native
screens and embedded web views. Device-bound features stay native; read- and
config-heavy screens are embedded from the web app so we don't maintain two
implementations of the same UI.

## Navigation

A bottom navigation bar (`ui/screens/MainScreen.kt`, tabs in `AppState.kt`'s
`MainTab`) hosts the tabs:

| Tab     | Kind      | Why                                                        |
| ------- | --------- | ---------------------------------------------------------- |
| Sync    | Native    | Health Connect permissions, background sync management     |
| Add     | Native    | Native date/time pickers, offline entry queue              |
| Feed    | Embedded  | Renders the web app's `/feed` in a WebView                 |
| Live    | Native    | Bluetooth (BLE) sensor scanning + live heart rate          |
| Account | Native    | Server URL, logout                                         |

A tab can move from embedded to native later (e.g. if the feed becomes a heavily
used, interaction-rich screen) without affecting the other tabs.

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
