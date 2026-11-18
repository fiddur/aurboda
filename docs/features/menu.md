# Choosing which pages show in the menu

Settings → **Menu** has one switch per page in the menus, with a line on what the page is for. Turn
off the pages you never use and the menus get shorter: someone who only cares about sleep and meals
can hide the rest, and someone who uses everything keeps it all. Every switch saves at once, and
**Show all pages** turns them all back on.

## What hiding does

- **It removes the menu link, nothing else.** The page still opens from its address and from links
  on other pages, its data stays, syncs keep running, and the REST API and MCP tools are unchanged.
- **The menus that follow it:** the web sidebar (expanded and collapsed), the phone menu (☰), and in
  the [Android app](../android-app.md#navigation) the More tab and the bottom bar.
- **Groups go when they are empty.** Hiding Feed, Dashboards and Challenges removes the whole
  **Sharing** group; hiding every data source, the overview included, removes **Data sources**.
- **While the settings load** the full menu shows, never an empty one.

## Pages that are never hidden

Home (`/`), Settings (`/settings`), Help & support (`/help`), Notifications (`/notifications`) and
the admin pages (`/admin` and everything under it) always show, whatever the list says, and get no
switch. So do the app's native screens: Live sensors, Account & server, and the Sync and More tabs.
The list is `MENU_ALWAYS_SHOWN` in `apps/web/src/components/nav-links.ts`, with its twin in the
app's `ui/screens/MoreScreen.kt`.

## Which pages get a switch

The switches come from the same lists the menus are built from (`nav-links.ts`), so a new menu page
gets a switch, and its one-line `description`, with no extra registry. They are grouped as the
menus show them: **Main**, **Sharing**, **More** and **Data sources**, plus **Only in the Android
app** for the pages that only the app's More tab lists (Reminders and the audit log).

## For API users

The setting is `hidden_pages` in the user settings: `GET /user/settings` returns it (an empty list
when nothing is hidden) and `PATCH /user/settings { "hidden_pages": ["/meals", "/strength"] }`
replaces it; `null` or `[]` shows every page again. The MCP tools `get_user_settings` and
`update_user_settings` carry the same field. Each entry is a menu path starting with `/`, at most 200
characters, and the list holds at most 200. The server keeps the list as given, unknown paths
included, so a page that is renamed or added later never loses a choice; the clients ignore paths
they do not know and the never-hidden ones.
