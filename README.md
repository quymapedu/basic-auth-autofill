# Basic Auth Autofill

**Stop typing the same HTTP Basic password ten times a day.**

Some sites sit behind HTTP Basic auth — staging servers, internal dashboards, protected
previews — and greet you with the browser's sign-in dialog. Chrome forgets those
credentials on restart, in a new profile, and in every incognito window, so the dialog
comes back. Password managers can't help: the dialog is browser chrome, not a web page,
and they can't reach it.

Basic Auth Autofill remembers the credentials for the sites you choose and signs you in
before the dialog can appear. You just load the page.

---

## Features

- **Unlimited sites, separate credentials.** Add as many hosts as you like, each with its
  own username and password.
- **No sign-in dialog, ever.** Credentials are attached ahead of the request, so the site
  never returns a challenge in the first place.
- **Test a credential in one click.** Confirms the saved username and password actually
  work, and tells you plainly if they don't: `ok`, `401 rejected`, or `unreachable`.
- **Turn a site off without losing it.** Flip the toggle to pause a host; flip it back when
  you need it. Nothing to retype.
- **Edit in place.** Passwords rotate. Update one without deleting and re-adding the site.
- **Access one host at a time.** The extension asks for permission per site, as you add it.
  It never requests access to all your browsing.
- **Nothing to build, nothing to configure.** No accounts, no servers, no dependencies, no
  telemetry.

## How it works

1. **Add a site.** Enter the address, username and password.
2. **Allow access.** Chrome asks for permission to that one host. Click Allow.
3. **Browse.** The site loads signed in. No dialog, no typing — now and after every restart.

That's the whole product. Everything else on the page is management: toggle, test, edit,
delete.

## Install

Not yet on the Chrome Web Store — load it directly:

```bash
git clone git@mapedu.com:quymapedu/basic-auth-autofill.git
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the cloned folder.
3. Click the toolbar icon to open the site manager.

There's no build step — the folder you cloned is the extension.

> Chrome tracks unpacked extensions by folder path. If you move or rename the folder,
> remove the extension and load it again.

## Privacy

- **Your credentials never leave your browser.** They're stored in this Chrome profile and
  sent only to the sites you added them for.
- **No analytics, no telemetry, no network calls of our own.** The only requests the
  extension makes are the ones you trigger with the **Test** button.
- **Permissions are yours to grant and revoke.** Access is requested per site when you add
  it, and revoked automatically when you delete it.
- **No credentials are stored in this repository.**

### Read this before you add a password

Credentials are saved **unencrypted** in your Chrome profile — the same way Chrome itself
handles them. Anyone who can read your profile folder can read them.

**Use this for shared non-production environment passwords.** Don't use it for anything
that guards real data, real money, or anyone's personal information.

## Good to know

**Which sites can it handle?** Anything behind standard HTTP Basic auth, `http` or `https`.
Built for protected staging environments (`dev.mapedu.com`, `staging.mapedu.com`), but
there's nothing product-specific in it.

**Does it leak credentials to other hosts?** No. Addresses are matched exactly, so
`dev.example.com` never sends its header to `assets.dev.example.com`.

**A site started showing a blank "401 Unauthorized" page.** That means the saved password
is out of date. Because the header is always sent, the site rejects it outright instead of
prompting you. Hit **Test** to confirm, then **Edit** to fix it.

**Can I change a site's address?** Delete the row and add the new address. Usernames and
passwords are editable; addresses are fixed, so a stale entry can't quietly point at the
wrong host.

**Does it work in incognito?** Yes, once you allow the extension in incognito from
`chrome://extensions`.

**Requirements.** Chrome 92+ or any Chromium browser built on it (Edge, Brave, Arc,
Vivaldi). Not available for Firefox or Safari.

---

## For contributors

```bash
npm test    # unit tests
```

Design notes live in `docs/`. `lib/` holds the pure logic and is covered by tests;
`background.js` and `options.js` talk to Chrome APIs and need a manual pass in the browser
after changes.
