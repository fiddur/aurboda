# Single sign-on (OpenID Connect)

Users can log in to Aurboda with an account they already have elsewhere: Google, Microsoft, GitLab,
a company Keycloak or Authentik, or any other OpenID Connect provider the admin configures. A
provider is one more way into an account, next to the password and [passkeys](passkeys.md); with
the admin's permission it can also create the account.

What it does:

- **Log in**: the login page shows one button per enabled provider ("Continue with …"; Google's
  follows Google's own button design). An identity that is linked to an account signs in to it.
- **Link**: a signed-in user links a provider under **Settings → Linked sign-in providers**, and
  can unlink it there.
- **Sign up**: when the admin allows it for a provider, someone without an account picks a
  username and gets an account linked to that identity, within the server's signup mode.

An identity is the provider's issuer and subject (`iss`, `sub`), never the email: an email that
matches an existing account does not sign in to it. Such a login answers "No account here is
linked to that sign-in" and the user logs in another way and links the provider in Settings.

The web does all of it. The [Android app](#in-the-android-app) signs in to an account that is
already linked; creating the account and linking are done on the web.

## Admin setup

**Admin settings → SSO providers (OpenID Connect)** lists the providers and shows the **redirect
URI**, the one URL to register with every provider:

```
<API_BASE_URL>/auth/oidc/callback      e.g. https://aurboda.example.com/api/auth/oidc/callback
```

**Add Google** prefills Google's issuer and name; **Add other provider** takes any issuer. Each
provider has:

| Field                 | What it is                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Id                    | A short name used in URLs (`google`, `work`); lowercase letters, digits, `-` and `_`. It cannot change later.                                           |
| Display name          | On the buttons.                                                                                                                                         |
| Issuer URL            | The OpenID Connect issuer. Must be `https`. Saving fetches its `/.well-known/openid-configuration` and refuses an issuer that does not answer.          |
| Client id and secret  | From the provider's app registration. The secret is write-only: it is never shown again, and leaving it empty on an edit keeps it.                      |
| Allowed email domains | Empty allows anyone. Otherwise only an ID token with `email_verified: true` and an email in one of the domains may log in, link or sign up.             |
| Allow new accounts    | Whether someone without an account may sign up through this provider. The server's signup mode still applies: closed refuses, invite-only needs a link. |
| Enabled               | A disabled provider is not offered and its links do not sign in.                                                                                        |

Links are keyed on the issuer, so changing a provider's issuer is refused (409, with the number of
linked accounts) while any account is linked to it: those accounts would lose their sign-in through
it. Unlink them, or delete the provider and add a new one.

Deleting a provider deletes every link to it. When a linked user would be left with no way to log
in (no usable password, no passkey, no other link), the delete is refused with the count, and
the admin can delete anyway.

The same is available over REST (`/admin/oidc-providers`) and MCP (`list_oidc_providers`,
`add_oidc_provider`, `update_oidc_provider`, `delete_oidc_provider`), admin-only.

### Google

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project.
2. **APIs & Services → OAuth consent screen**: set it up (app name, support email, the
   `openid`, `email` and `profile` scopes; publish it when you want anyone with a Google account
   to be able to log in, not just test users).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web
   application**. Under **Authorized redirect URIs** add the redirect URI from the admin page.
4. Copy the client id and secret into **Add Google** and save.

To limit it to a Google Workspace, list the Workspace's domain under allowed email domains.

### Microsoft Entra ID

Register an app under **Microsoft Entra ID → App registrations**, platform **Web**, with the
redirect URI. Create a client secret under **Certificates & secrets**. The issuer is
`https://login.microsoftonline.com/<tenant id>/v2.0` for one tenant (the `common` endpoint's issuer
varies per tenant and does not validate).

### GitLab

**User settings (or Admin area) → Applications**: add one with the redirect URI and the `openid`,
`email` and `profile` scopes. The issuer is `https://gitlab.com` or your own GitLab's URL.

### Keycloak and Authentik

- **Keycloak**: create an OpenID Connect client with client authentication on and the redirect URI
  as a valid redirect URI. The issuer is `https://<host>/realms/<realm>`.
- **Authentik**: create an OAuth2/OpenID provider and an application for it, with the redirect URI.
  The issuer is `https://<host>/application/o/<application slug>/`, trailing slash included.

### Testing against a local provider

The issuer must be `https`. For a local Keycloak or a test issuer on plain `http`, start the
backend with `OIDC_ALLOW_HTTP_ISSUER=true`. Never set it in production.

## For users

- **Link**: Settings → **Linked sign-in providers** → **Link …** (or **Link with Google**). After the
  provider's sign-in you are back in Settings with the provider listed. Finish it in the browser you
  started it in.
- **Unlink**: the **Unlink** button. It is disabled for the last way into the account.
- **Sign up**: on the signup page, **Sign up with Google** or **Continue with …**, then pick a
  username (prefilled from the email when it is free). The provider's email becomes the account's
  email, verified when the provider says it is; otherwise a confirmation link is sent.

If the identity cannot be linked once the account exists (it was linked to another account in the
meantime), the new account is removed again and the sign-up answers "Could not finish the sign-up;
try again". Should that removal fail, the account is kept for the admin and the failure is written to
its audit log.

An account created through a provider has a password nobody knows. Setting one through the emailed
[password reset](account-recovery.md) makes the password a way in again.

## The last login method

The ways into an account are its password (unless the account was created through a provider and
no password was set since), each passkey and each provider link. Unlinking a provider and deleting
a passkey are refused while it is the last one. `GET /account/oidc/links` returns the count as
`login_methods`.

## How it works

Authorization Code with PKCE, a `state` and a `nonce`, all kept on the server (the central
`oidc_flows` table, for ten minutes; only a hash of the state is stored). The ID token's signature
is checked against the provider's published keys, with its issuer, audience, expiry and nonce, by
[`openid-client`](https://github.com/panva/openid-client). A provider's discovery document is
cached for an hour.

The provider redirects to `GET /auth/oidc/callback`, which always answers with a redirect to the
web, never with a session:

| Outcome                           | Goes to                                             |
| --------------------------------- | --------------------------------------------------- |
| A linked identity logs in         | `/login/oidc#code=…` (the code lasts 60 s)          |
| A new identity may sign up        | `/signup/oidc#code=…` (the code lasts 5 min)        |
| A link flow got its identity      | `/settings/oidc-link#code=…` (the code lasts 5 min) |
| Anything failed (login or signup) | `/login?oidc_error=<code>`                          |
| Anything failed (link)            | `/settings?oidc_error=<code>#sign-in-providers`     |

A sign-in the Android app started goes back to the app instead (see
[In the Android app](#in-the-android-app)).

The page trades the one-time code, with the verifier (below), for what it stands for:
`POST /auth/oidc/exchange` for the session token (so the token never appears in a URL),
`POST /auth/oidc/signup` with the username for a new account, and `POST /account/oidc/link/complete`
from the signed-in account for a link, which then lands on `/settings?oidc=linked#sign-in-providers`.
Error codes: `failed`, `expired`, `domain_not_allowed`, `not_linked`, `signup_closed`,
`already_linked`.

### How a sign-in is tied to your browser

Without a tie, someone could start a sign-in, log in at the provider as themselves and send the
redirect link to somebody else, whose browser would then sign up an account the sender can log in
to, or be signed in to the sender's account. So the start (`POST /auth/oidc/:provider/start` or
`POST /account/oidc/:provider/link/start`) answers with a random **verifier** besides the provider's
URL. The web keeps it in the browser's local storage (not a cookie: the API may live on another
origin). The server keeps only its hash, on the flow and then on the one-time code, and the
exchange, the signup and the link completion each need it: a code with any other verifier, or none,
is refused like an expired one and is used up. A page that finds no verifier says the sign-in was
not started in this browser.

A link is completed by the signed-in page, not at the callback, for the same reason: the callback
cannot tell whose browser it is talking to, so a provider's authorization URL sent to someone else
would otherwise link their identity to the sender's account. Only the account that started the link
can complete it.

The start, exchange, callback and link completion endpoints share the per-IP limit of `POST /login`,
and the signup the limit of `POST /signup` (see [admin.md](admin.md#rate-limits)). Deleting an
account removes its links.

## In the Android app

The app's login screen asks the server typed in for its providers and shows one button per
provider under **Sign in with passkey**: "Continue with …", or Google's **Sign in with Google**
with the "G" mark. A tap starts the sign-in with `{"client": "app"}`, keeps the verifier the start
answered with in memory, and opens the provider's page in a browser tab (a Custom Tab, or the
default browser; Google refuses OAuth inside an app's WebView). No Google sign-in SDK or Play
services are involved, so it works the same in every build.

The callback sends an app flow to `net.aurboda.oidc://callback` rather than to the web:

| Outcome                                                       | Goes to                                        |
| ------------------------------------------------------------- | ---------------------------------------------- |
| A linked identity logs in                                     | `net.aurboda.oidc://callback?code=…` (60 s)    |
| No account is linked, whether or not signup is allowed        | `net.aurboda.oidc://callback?error=not_linked` |
| Anything else failed                                          | `net.aurboda.oidc://callback?error=<code>`     |
| The flow expired or is unknown (nothing says it is the app's) | the web's `/login?oidc_error=expired`          |

The app trades the code, with its verifier, at `POST /auth/oidc/exchange` and is signed in. The
target is a fixed constant on the server, never taken from the request.

A custom scheme rather than a verified App Link, because a self-hosted server can have any host and
the app cannot declare them all. Any app can claim the same scheme and so may see the code, but a
code is useless without the verifier, which only the app that called start has
([How a sign-in is tied to your browser](#how-a-sign-in-is-tied-to-your-browser)). If Android
stopped the app while the browser was open, the verifier is gone with it and the app says "The
sign-in could not be completed. Try again."

- **A first-time user creates the account on the web** (the signup page needs the verifier in the
  browser's storage, and for an app sign-in the app holds it), then signs in in the app. An unlinked
  identity gets: "No Aurboda account is linked to this sign-in. Sign in another way and link it
  under Settings on the web, or create the account on the web."
- **Linking is done from a browser.** The app's embedded Settings page lists the linked providers
  and can unlink them, but has no **Link** buttons: the provider's page would open in the system
  browser, which has neither the app's session nor the verifier to complete the link. It says
  "To link a sign-in provider, open Aurboda in a browser and go to Settings."

## REST and MCP

| Endpoint                                  | Auth   | MCP twin                         |
| ----------------------------------------- | ------ | -------------------------------- |
| `GET /auth/oidc/providers`                | public | —                                |
| `POST /auth/oidc/:provider/start`         | public | —                                |
| `GET /auth/oidc/callback`                 | public | —                                |
| `POST /auth/oidc/exchange`                | public | —                                |
| `GET /auth/oidc/signup-info`              | public | —                                |
| `POST /auth/oidc/signup`                  | public | —                                |
| `POST /account/oidc/:provider/link/start` | user   | —                                |
| `POST /account/oidc/link/complete`        | user   | —                                |
| `GET /account/oidc/links`                 | user   | —                                |
| `DELETE /account/oidc/links/:id`          | user   | —                                |
| `GET`/`POST /admin/oidc-providers`        | admin  | `list_`/`add_oidc_provider`      |
| `PUT`/`DELETE /admin/oidc-providers/:id`  | admin  | `update_`/`delete_oidc_provider` |

Signing in, signing up, linking and unlinking have no MCP tool: they run through the browser, like
`/login` and the passkey ceremonies.
