# Email verification and account recovery

When the server's admin has set up email (Admin Settings → **Email (SMTP)**, see
[admin.md](admin.md#email-smtp)), the account's private email address is used for two things:
confirming that the address is really yours, and recovering the account when you forget the password
or lose your passkeys. While the server sends no email, none of this is offered: the address is
only stored, and the login page shows no recovery link.

## Verifying the address

Set the address at signup or in **Settings → Profile**. A new or changed address is **not
verified**, and a link (valid 24 hours) is mailed to it; opening the link (`/verify-email?token=…`)
confirms it. Settings shows **Verified**, or **Not verified** with **Send the link again** (at most
three verification mails an hour). A link confirms the address only while the account still has
the address it was sent to, and a newer link replaces the older one. Clearing or changing the address
clears the verification; saving the same address again keeps it.

Only a verified address is ever used for account mail: an unverified one never gets a recovery link.

Over the API: `GET /account/email` answers `{ email, verified, email_enabled }`, `PUT /account/email`
sets the address and sends the link, `POST /account/email/verification` sends it again (`200` with
`status` `sent` or `already_verified`; `400` without an address, `409` when the server sends no
email, `429` past three an hour). The MCP twins are `get_my_email`, `set_my_email` and
`send_email_verification`. `POST /account/email/verify` `{ token }`, the link's target, is public
and REST only, like `/login`.

## Resetting a password or recovering a passkey-only account

1. On the login page, choose **Forgot your password or lost your passkey?** (the Android app's login
   screen has the same link; it opens the web page) and enter your **username** or your **email
   address**.
2. The answer is always the same, "If an account with a verified email matches, a link is on its
   way.", so it tells nobody which accounts exist. A username gets a link at that account's verified
   address; an email address gets one link per account that verified it (at most five). Each account
   gets at most three recovery links an hour.
3. The mail names the account and links to `/recover?token=…`. The link works **once**, within **30
   minutes**, and only while the address it went to is still the account's verified email. Asking
   again replaces the earlier link. A new password that fails to save leaves the link unused, so it
   can be tried again.
4. On that page, either
   - **Set a new password** (typed twice), which also clears the account's failed sign-in count and
     makes the password a way in again for an account created through a
     [sign-in provider](sso.md), or
   - **Sign in and add a new passkey**, which changes nothing about the password and takes you to
     **Settings → Passkeys** to register a new one (and delete the lost ones).

   Either way you are signed in. A read-only account (an expired plan) can recover too.

5. A short notice goes to the address afterwards: "Your Aurboda password was reset", or "Your Aurboda
   account was signed in to with a recovery link". It carries no link. The account's audit log records
   "Password reset by email" or "Recovery sign-in", and is trimmed to its retention as on any sign-in.

Over the API, both steps are public and REST only, like `/login`, and limited per client IP like it
(see [admin.md](admin.md#rate-limits)): `POST /account/recovery/request` `{ identifier }` and
`POST /account/recovery/complete` `{ token, new_password? }`, which answers like `/login`
(`{ token, is_admin }`) plus the `username`.

## Existing sessions

Resetting a password does **not** sign out other sessions: Aurboda's session tokens are stateless and
cannot be revoked one user at a time yet, so a browser or app that was signed in stays signed in. If
you reset the password because someone else may know it, also tell the server admin.

## What is never sent or kept

Links are single-use random tokens; the server keeps only their SHA-256 hash, and nothing about a
mail's recipient, content or link is logged beyond the kind of mail sent. The mails carry no images
or tracking. Deleting the account deletes its tokens. A new password reaches the database as a SCRAM-SHA-256 verifier
computed by the server, never in the statement text, so a statement log does not show it.
