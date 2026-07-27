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

Manifest V3 removed blocking `webRequest`, so an extension can no longer *answer* the auth
prompt. This one prevents it instead, pre-attaching the header via `declarativeNetRequest`
so the 401 never happens.

## Install

```bash
git clone git@mapedu.com:quymapedu/basic-auth-autofill.git
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the cloned directory.
3. Click the toolbar icon to open the manager.

No build step and no dependencies — the cloned directory loads directly.

Chrome tracks unpacked extensions by filesystem path, so if you move or rename the
directory later, remove and re-load it.

## Usage

Enter a site address, username and password, then click **Add site**. Chrome asks for
access to that one host — allow it. The site then loads with no sign-in dialog.

Each row has:

- **Toggle** — turns the header off without deleting the credentials. A site that is
  off shows its hostname dimmed.
- **Test** — sends one request and reports `ok`, `401 rejected`, or `unreachable`. Save
  before testing; it reports on the saved credential.
- **Edit** — change the username or password. The address is fixed; to change it, delete
  the row and add a new one.
- **Delete** — removes the record and revokes the host permission.

Because the header is always attached, a rotated password gives a bare 401 page rather than
a fresh login prompt. Use **Test** to confirm a credential, then **Edit** to update it.

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
npm test                         # unit tests for lib/rules.js
node --check options.js          # syntax check
python3 scripts/make-icons.py    # regenerate placeholder icons
```

| Path | Responsibility |
|---|---|
| `manifest.json` | MV3 declaration; `optional_host_permissions` only |
| `lib/rules.js` | pure: site records → declarativeNetRequest rules |
| `lib/queue.js` | pure: serializes rule syncs so overlapping runs cannot collide |
| `lib/storage.js` | typed accessors over `chrome.storage.local` |
| `background.js` | rebuilds the rule set on change; handles the Test request |
| `options.html/.js/.css` | the manager UI |
| `test/rules.test.js` | unit tests, run by `node --test` |

`lib/rules.js` is pure — it imports nothing and touches no `chrome.*` API, which is what
lets Node test it directly. Everything else is browser-coupled and needs manual checking in
Chrome after any change to `background.js` or `options.js`.
