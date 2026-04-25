# Passkeys (WebAuthn)

Aurboda supports passkey login alongside the existing username + password
flow. Passkeys are public-key credentials managed by the user's
authenticator (browser, password manager, OS keystore, hardware key) and
never leave that device — the server only stores the public key.

## What works

- **Web**: Sign in with passkey directly from the login page; manage
  registered passkeys from `/settings`.
- **Android**: The login screen offers a "Sign in with passkey" button
  that uses the system Credential Manager (Google Password Manager,
  1Password, Samsung Pass, etc.).
- **Cross-platform**: A passkey registered from the web on the same
  domain is also offered to the Android app via Digital Asset Links.

## How users register a passkey

1. Sign in with username + password (passkey-only signup is not yet
   supported — password remains the recovery factor).
2. Go to **Settings → Passkeys**, optionally type a nickname (e.g. "Work
   laptop"), and click **Add a passkey**.
3. Confirm the prompt from your authenticator (Touch ID, Windows Hello,
   1Password, security key, etc.). The passkey is stored against the
   server's domain (its **Relying Party ID**).

A user can register multiple passkeys (e.g. one in 1Password and one
device-bound on Android).

## How users sign in

- **Web**: Click **Sign in with passkey**. The browser/password manager
  presents matching passkeys for the current domain. No username typed.
- **Android**: Open the app, leave the default Server URL (or set your
  self-hosted domain), tap **Sign in with passkey**. The system shows
  passkeys that match the same RP ID via Digital Asset Links.

## Self-hosting

A self-hosted instance is its own Relying Party — passkeys are bound to
its domain. Configuration is via env vars (see `docs/docker.md` for the
full table).

### Minimal setup

If you serve Aurboda from `https://aurboda.example.com`:

```env
WEBAUTHN_RP_ID=aurboda.example.com
WEBAUTHN_ORIGINS=https://aurboda.example.com
```

Both default to values derived from `API_BASE_URL` and `WEB_HOST`, so
in many cases you don't need to set them explicitly.

### Linking the Android app to your domain

For passkeys to be shared between the website and the Aurboda Android
app, the server must publish a `/.well-known/assetlinks.json` file that
declares which APK signing keys are trusted. The backend serves this
endpoint automatically — you just need to tell it which fingerprints to
list.

#### Using the official APK from GitHub releases

Set the `ANDROID_APP_FINGERPRINTS` env var to the fingerprint of the
official release key. If you trust the upstream releases, copy the
fingerprint published in the project README and put it in your env:

```env
ANDROID_APP_FINGERPRINTS=AB:CD:EF:...
```

Verify with:

```bash
curl https://aurboda.example.com/.well-known/assetlinks.json
```

#### Using your own custom-built APK

If you build the APK yourself, extract your release key's SHA-256
fingerprint:

```bash
keytool -list -v -keystore release.keystore -alias <alias> | grep SHA256
```

Set it in the backend env:

```env
ANDROID_APP_FINGERPRINTS=YOUR:SHA:256:FINGERPRINT
ANDROID_APP_PACKAGE=net.aurboda          # if you renamed the package
```

Multiple fingerprints can be listed comma-separated (e.g. official
release key + your custom key).

#### Sanity check

Google's Digital Asset Links checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://aurboda.example.com&relation=delegate_permission/get_login_creds
```

### Reverse proxy notes

If you front the backend with nginx, Caddy or Traefik, make sure the
proxy passes `/.well-known/*` requests through to the backend. The
default `nginx.conf` shipped in the official Docker image already does
this.

## Recovery

A passkey is bound to the device or password manager that holds it.
Losing access (broken phone, deleted credential) means losing that
passkey — but **password login is always available** as a fallback. If
you lose all passkeys, sign in with the password and register a new
one.

## Privacy & security notes

- The server only stores public keys, credential IDs and counter values
  — never private keys or biometric data.
- Authentication challenges are kept in memory with a 5-minute TTL.
  This is appropriate for single-instance deploys; if you horizontally
  scale Aurboda you'll need a shared challenge store (not currently
  supported).
- Passkeys are never sent to any third party — they're verified locally
  by your backend.
