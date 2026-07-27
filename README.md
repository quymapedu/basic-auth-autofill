# Basic Auth Autofill

A Chrome extension that attaches `Authorization: Basic` headers to sites you configure,
so the browser stops showing its sign-in dialog on HTTP Basic auth environments such as
`dev.mapedu.com` and `staging.mapedu.com`.

## Why this exists

HTTP Basic is stateless — every request must carry the header. Chrome keeps credentials
in memory only, keyed by origin and realm, and drops them on restart, in a new profile,
and in incognito. Chrome's password manager cannot help: it keys HTTP-auth entries by
`origin + realm` (e.g. `https://dev.mapedu.com/Login`), while the "Add password" UI can
only create a plain `https://dev.mapedu.com/` entry, which never matches.

Design notes: [`docs/2026-07-27-basic-auth-extension-design.md`](docs/2026-07-27-basic-auth-extension-design.md)

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this directory.
3. Click the toolbar icon to open the manager.

## Usage

Enter a site address, username and password, then click **Add site**. Chrome asks for
access to that one host — allow it. The site then loads with no sign-in dialog.

Each row has:

- **On** — toggles the header off without deleting the credentials.
- **Test** — sends one request and reports `ok`, `401 rejected`, or `unreachable`. With
  an edit form open it tests the unsaved values, so a password can be checked before
  saving.
- **Edit** — change the username or password. The address is fixed; to change it, delete
  the row and add a new one.
- **Delete** — removes the record and revokes the host permission.

## Security

Credentials are stored **unencrypted** in `chrome.storage.local`. Anyone with read access
to your Chrome profile directory can recover them. This is fine for shared
non-production environment passwords and is not fine for anything else.

The header is attached to every request matching a configured origin, subresources
included. Origins are exact-matched, so `dev.mapedu.com` never leaks credentials to
`assets.dev.mapedu.com`.

No credentials exist anywhere in this repository.

## Development

```bash
npm test              # unit tests for lib/rules.js, no dependencies
python3 scripts/make-icons.py   # regenerate placeholder icons
```

`lib/rules.js` is pure — it imports nothing and touches no `chrome.*` API, which is what
lets Node test it directly. Everything browser-coupled is verified by the checklist
below.

## Manual test checklist

Run this after any change to `background.js` or `options.js`.

- [ ] Load unpacked; install shows **no** "read and change all your data on all websites"
      warning.
- [ ] Add `https://dev.mapedu.com`; Chrome prompts for that host only.
- [ ] Load the site; no auth dialog appears.
- [ ] Change the password to a wrong value; **Test** reports `401 rejected`.
- [ ] Restore the password; **Test** reports `ok`.
- [ ] Toggle the site off; the auth dialog returns.
- [ ] Toggle it back on; the dialog is gone.
- [ ] Revoke site access from `chrome://extensions`; the row shows `no access` and a
      **Grant access** button.
- [ ] Delete the site; the host disappears from **Site access**.
- [ ] Restart Chrome; remaining sites still work with no prompt.
- [ ] Add a second site with different credentials; both work independently.
