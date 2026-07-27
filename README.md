# Basic Auth Autofill

A Chrome extension that attaches `Authorization: Basic` headers to sites you configure, so
the browser stops showing its sign-in dialog. Add as many sites as you like, each with its
own credentials.

Built for MapEDU's protected environments (`dev.mapedu.com`, `staging.mapedu.com`), but
nothing in it is MapEDU-specific — it works against any host behind HTTP Basic auth.

## Why this exists

HTTP Basic is stateless: every request must carry the header. Chrome keeps credentials in
memory only, keyed by origin and realm, and drops them on restart, in a new profile, and in
incognito — so the dialog comes back constantly.

Chrome's password manager cannot fix this. It keys HTTP-auth entries by `origin + realm`
(e.g. `https://dev.mapedu.com/Login`), while its "Add password" UI can only create a plain
`https://dev.mapedu.com/` entry, which never matches. Third-party password managers cannot
help either — the dialog is browser chrome, not page DOM, so they cannot reach it.

Manifest V3 removed blocking `webRequest`, which means an extension can no longer *answer*
the auth prompt. This one prevents it instead, pre-attaching the header via
`declarativeNetRequest` so the 401 never happens.

## Install

```bash
git clone git@mapedu.com:quymapedu/basic-auth-autofill.git
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the cloned directory.
3. Click the toolbar icon to open the manager.

There is no build step and there are no dependencies — the cloned directory loads directly.

Chrome tracks unpacked extensions by filesystem path, so if you move or rename the
directory later, remove and re-load it.

## Usage

Enter a site address, username and password, then click **Add site**. Chrome asks for
access to that one host — allow it. The site then loads with no sign-in dialog.

Each row has:

- **On** — toggles the header off without deleting the credentials.
- **Test** — sends one request and reports `ok`, `401 rejected`, or `unreachable`.
- **Edit** — change the username or password. The address is fixed; to change it, delete
  the row and add a new one.
- **Delete** — removes the record and revokes the host permission.

Because the header is always attached, a rotated password gives a bare 401 page rather than
a fresh login prompt. Use **Test** to confirm a credential, then **Edit** to update it.

> **Unverified:** Test is intended to check unsaved values typed into an open edit form, so
> a password can be confirmed before saving. Chrome's `declarativeNetRequest` rules may
> override the header on the extension's own request, which would make it report on the
> *saved* credential instead. Until that is confirmed in a browser, save before testing.

## Security

Credentials are stored **unencrypted** in `chrome.storage.local`. Anyone with read access to
your Chrome profile directory can recover them. This is fine for shared non-production
environment passwords and is not fine for anything else.

The header is attached to every request matching a configured origin, subresources included.
Origins are exact-matched, so `dev.mapedu.com` never leaks credentials to
`assets.dev.mapedu.com`.

Host access is requested per site at runtime, so installing the extension grants it nothing
— it never asks for access to all sites.

No credentials exist anywhere in this repository.

## Development

```bash
npm test                         # unit tests for lib/rules.js, no dependencies
python3 scripts/make-icons.py    # regenerate placeholder icons
node --check options.js          # syntax check
```

| Path | Responsibility |
|---|---|
| `manifest.json` | MV3 declaration; `optional_host_permissions` only |
| `lib/rules.js` | pure: site records → declarativeNetRequest rules |
| `lib/storage.js` | typed accessors over `chrome.storage.local` |
| `background.js` | rebuilds the rule set on change; handles the Test request |
| `options.html/.js/.css` | the manager UI |
| `test/rules.test.js` | unit tests, run by `node --test` |

`lib/rules.js` is pure — it imports nothing and touches no `chrome.*` API, which is what
lets Node test it directly. Everything browser-coupled is verified by the checklist below
rather than by automated tests.

Design notes and the implementation plan:

- [`docs/2026-07-27-basic-auth-extension-design.md`](docs/2026-07-27-basic-auth-extension-design.md)
- [`docs/plans/2026-07-27-basic-auth-extension.md`](docs/plans/2026-07-27-basic-auth-extension.md)

## Manual test checklist

Run this after any change to `background.js` or `options.js`. Substitute your own host for
`https://dev.mapedu.com`.

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
