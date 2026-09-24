# Aurboda watch app

A Connect IQ watch app that records sessions for your own Aurboda activity types on a Garmin
watch. It shows the types you picked in Aurboda as a menu; selecting one records an ordinary
Garmin activity with that type's Garmin sport and session name, and writes two developer fields
on every record: the type's `code` (field 40) and the live stress score (field 41). Garmin Connect
syncs the activity as usual, and Aurboda's Garmin import recognises it by field 40 and retypes it.
The types, their order, names and Garmin sports are configured in the Aurboda web app under
**Data Sources → Garmin Connect → Watch app**. See [docs/garmin-watch-app.md](../../docs/garmin-watch-app.md)
for the whole picture.

Supported device: Forerunner 255 (`fr255`).

## Build

1. Download the Connect IQ SDK for Linux from
   [developer.garmin.com/connect-iq/sdk](https://developer.garmin.com/connect-iq/sdk/) (the SDK
   Manager), and use it to install the SDK and the device files for the Forerunner 255. The device
   files land in `~/.Garmin/ConnectIQ/Devices/`; `monkeyc` cannot build for a device without them.
2. Generate a developer key once, and keep it: an app signed with a different key cannot update
   the installed one.

   ```sh
   openssl genrsa -out developer_key.pem 4096
   openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
   ```

3. Build from the repository root:

   ```sh
   CIQ_SDK=~/.Garmin/ConnectIQ/Sdks/connectiq-sdk-lin-<version> \
   CIQ_DEVELOPER_KEY=/path/to/developer_key.der \
   pnpm build:garmin
   ```

   The result is `apps/garmin/bin/aurboda-fr255.prg`. `apps/garmin/build.sh <device>` builds for
   another device id. The build uses the strict type checker (`-l 3`).

## Install (sideload)

1. Connect the watch over USB and copy `bin/aurboda-fr255.prg` into `GARMIN/APPS/` on it. On
   Linux the watch is an MTP device; mount it with, for example, `jmtpfs` or `gio mount`.
2. Disconnect. The app appears as **Aurboda** in the watch's activity list.
3. In the Garmin Connect phone app, open the watch's page → **Activities & Apps** → **Aurboda** →
   **Settings**, and set:
   - **API URL**: your server's API base, `https://aurboda.net/api` by default.
   - **API token**: the token from **Generate API Token** on the Aurboda settings page.

The app fetches the types from `<API URL>/garmin-watch/config` through the phone, and keeps the
last list it got for when the phone is out of reach. **Refresh types** at the bottom of the menu
fetches them again.

## Use

Pick a type to start recording. The screen shows the elapsed time, heart rate and stress. Press
Start or Back to stop, then choose **Resume**, **Save** or **Discard**.
