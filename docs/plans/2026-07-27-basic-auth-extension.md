# Basic Auth Autofill Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that attaches `Authorization: Basic` headers to user-configured origins, so HTTP Basic auth sites never show the browser sign-in dialog.

**Architecture:** `chrome.storage.local` is the source of truth for a list of site records. A service worker observes storage changes and rebuilds the entire `declarativeNetRequest` dynamic rule set from scratch on every change. Rule construction lives in a pure, browser-free module so it can be unit tested under plain `node --test`. An options page (a tab, not a popup) manages the site list and requests per-site host permissions.

**Tech Stack:** Chrome Manifest V3, `declarativeNetRequest`, `chrome.permissions` (optional host permissions), ES modules, `node --test` for unit tests, Python 3 for one-time icon generation. No runtime dependencies, no build step.

**Spec:** `browser-ext/docs/2026-07-27-basic-auth-extension-design.md`

## Global Constraints

- Manifest V3 only. Blocking `webRequest` is unavailable; `declarativeNetRequest` is the only mechanism for attaching the header.
- No runtime dependencies and no build step. The unpacked directory must load directly in Chrome.
- `lib/rules.js` must import nothing and reference no `chrome.*` API. This is what makes it testable under Node.
- No credentials in the repository or the packaged extension, ever.
- Host permissions are declared as `optional_host_permissions`, never `host_permissions`.
- `chrome.permissions.request()` must be the first async operation in a click handler. Any `await` before it discards the user gesture and Chrome rejects the call.
- Rule `urlFilter` values are always `|`-anchored (`|https://host/`) so a configured host never matches its own subdomains.
- Base64 encoding goes through UTF-8 first, per RFC 7617. `btoa` alone throws on code points above U+00FF.
- Target directory is `browser-ext/` inside `/Users/dinhquy/Developer/mapedu`.
- Node 20 and Python 3 are available on this machine and are the assumed toolchain.

---

### Task 1: Pure rule builder with unit tests

**Files:**
- Create: `browser-ext/package.json`
- Create: `browser-ext/.gitignore`
- Create: `browser-ext/lib/rules.js`
- Test: `browser-ext/test/rules.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RESOURCE_TYPES: string[]`
  - `encodeCredentials(username: string, password: string): string` — returns the base64 token only, without the `Basic ` prefix.
  - `normalizeOrigin(input: string): string` — returns an origin like `https://dev.mapedu.com`; throws `Error` with a user-facing message on invalid input.
  - `buildRules(sites: Site[]): object[]` — DNR dynamic rule objects.
  - `Site` shape: `{ id, origin, username, password, enabled }`.

- [ ] **Step 1: Create the package manifest and gitignore**

`browser-ext/package.json`:

```json
{
  "name": "basic-auth-autofill",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Chrome MV3 extension that attaches HTTP Basic credentials to configured origins.",
  "scripts": {
    "test": "node --test test/"
  }
}
```

`browser-ext/.gitignore`:

```
node_modules/
*.zip
*.crx
*.pem
```

- [ ] **Step 2: Write the failing tests**

`browser-ext/test/rules.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCE_TYPES,
  encodeCredentials,
  normalizeOrigin,
  buildRules,
} from "../lib/rules.js";

const site = (over = {}) => ({
  id: "id-1",
  origin: "https://dev.mapedu.com",
  username: "quy",
  password: "secret",
  enabled: true,
  ...over,
});

test("encodeCredentials produces standard base64 for ASCII", () => {
  assert.equal(encodeCredentials("quy", "secret"), "cXV5OnNlY3JldA==");
});

test("encodeCredentials encodes non-Latin-1 passwords as UTF-8", () => {
  // btoa() alone throws InvalidCharacterError on these code points.
  const token = encodeCredentials("quy", "mật-khẩu");
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
  assert.equal(Buffer.from(token, "base64").toString("utf8"), "quy:mật-khẩu");
});

test("normalizeOrigin accepts a bare host and defaults to https", () => {
  assert.equal(normalizeOrigin("dev.mapedu.com"), "https://dev.mapedu.com");
});

test("normalizeOrigin strips path, query and hash", () => {
  assert.equal(
    normalizeOrigin("https://dev.mapedu.com/courses/625?tab=1#x"),
    "https://dev.mapedu.com",
  );
});

test("normalizeOrigin preserves an explicit http scheme and port", () => {
  assert.equal(normalizeOrigin("http://localhost:3000/app"), "http://localhost:3000");
});

test("normalizeOrigin trims surrounding whitespace", () => {
  assert.equal(normalizeOrigin("  dev.mapedu.com  "), "https://dev.mapedu.com");
});

test("normalizeOrigin rejects empty input", () => {
  assert.throws(() => normalizeOrigin("   "), /Enter a site address/);
});

test("normalizeOrigin rejects a hostname with no dot that is not localhost", () => {
  assert.throws(() => normalizeOrigin("notahost"), /not a valid address/);
});

test("buildRules returns an empty array for no sites", () => {
  assert.deepEqual(buildRules([]), []);
});

test("buildRules excludes disabled sites", () => {
  assert.deepEqual(buildRules([site({ enabled: false })]), []);
});

test("buildRules excludes sites with an empty username", () => {
  assert.deepEqual(buildRules([site({ username: "" })]), []);
});

test("buildRules assigns sequential ids starting at 1", () => {
  const rules = buildRules([
    site({ id: "a", origin: "https://a.example.com" }),
    site({ id: "b", origin: "https://b.example.com" }),
  ]);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
});

test("buildRules renumbers so filtered-out sites leave no gaps", () => {
  const rules = buildRules([
    site({ origin: "https://a.example.com", enabled: false }),
    site({ origin: "https://b.example.com" }),
  ]);
  assert.deepEqual(rules.map((r) => r.id), [1]);
});

test("buildRules anchors urlFilter to the exact origin", () => {
  const [rule] = buildRules([site()]);
  assert.equal(rule.condition.urlFilter, "|https://dev.mapedu.com/");
});

test("buildRules sets the Authorization header with a Basic prefix", () => {
  const [rule] = buildRules([site()]);
  assert.equal(rule.action.type, "modifyHeaders");
  assert.deepEqual(rule.action.requestHeaders, [
    { header: "Authorization", operation: "set", value: "Basic cXV5OnNlY3JldA==" },
  ]);
});

test("buildRules includes main_frame in resource types", () => {
  const [rule] = buildRules([site()]);
  assert.ok(rule.condition.resourceTypes.includes("main_frame"));
  assert.deepEqual(rule.condition.resourceTypes, RESOURCE_TYPES);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: FAIL — `Cannot find module '.../lib/rules.js'`.

- [ ] **Step 4: Implement the pure module**

`browser-ext/lib/rules.js`:

```js
// Pure helpers. This module must not import anything and must not touch any
// chrome.* API — that is what lets `node --test` exercise it directly.

export const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other",
];

/**
 * RFC 7617 specifies UTF-8 for Basic credentials. btoa() throws on any code
 * point above U+00FF, so the string is encoded to bytes first.
 */
export function encodeCredentials(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Collapses any user input for a site down to a bare origin.
 * Throws an Error whose message is safe to show in the UI.
 */
export function normalizeOrigin(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) throw new Error("Enter a site address.");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${trimmed}" is not a valid address.`);
  }

  const host = url.hostname;
  const looksLikeHost = host.includes(".") || host === "localhost";
  if (!looksLikeHost) throw new Error(`"${trimmed}" is not a valid address.`);

  return url.origin;
}

/**
 * Maps site records to declarativeNetRequest dynamic rules.
 * Permission filtering happens in background.js, not here — this module
 * cannot call chrome.permissions.
 */
export function buildRules(sites) {
  return sites
    .filter((site) => site.enabled && site.username)
    .map((site, index) => ({
      id: index + 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Authorization",
            operation: "set",
            value: `Basic ${encodeCredentials(site.username, site.password)}`,
          },
        ],
      },
      condition: {
        urlFilter: `|${site.origin}/`,
        resourceTypes: RESOURCE_TYPES,
      },
    }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/package.json browser-ext/.gitignore browser-ext/lib/rules.js browser-ext/test/rules.test.js
git commit -m "feat(browser-ext): add pure DNR rule builder with unit tests"
```

---

### Task 2: Manifest, icons, storage accessor, and rule sync

**Files:**
- Create: `browser-ext/manifest.json`
- Create: `browser-ext/lib/storage.js`
- Create: `browser-ext/background.js`
- Create: `browser-ext/icons/16.png`, `browser-ext/icons/48.png`, `browser-ext/icons/128.png`
- Create: `browser-ext/options.html` (placeholder, fleshed out in Task 3)
- Create: `browser-ext/scripts/make-icons.py`

**Interfaces:**
- Consumes: `buildRules`, `encodeCredentials` from `lib/rules.js`.
- Produces:
  - `lib/storage.js`: `getSites(): Promise<Site[]>`, `setSites(sites: Site[]): Promise<void>`, `getRuleError(): Promise<string|null>`, `setRuleError(message: string|null): Promise<void>`.
  - Storage keys: `sites` (array of `Site`), `ruleError` (string or null).
  - `background.js` message contract: `{ type: "test-site", origin, username, password }` → `{ state: "ok" | "rejected" | "unreachable" | "other", status?: number }`.

- [ ] **Step 1: Generate the icons**

`browser-ext/scripts/make-icons.py`:

```python
#!/usr/bin/env python3
"""Writes three solid-colour PNG icons. Replace with real artwork any time."""
import os
import struct
import zlib

COLOR = (30, 58, 95)  # navy
OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size, rgb):
    scanline = b"\x00" + bytes(rgb) * size
    raw = scanline * size
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


os.makedirs(OUT, exist_ok=True)
for size in (16, 48, 128):
    write_png(os.path.join(OUT, f"{size}.png"), size, COLOR)
    print(f"wrote icons/{size}.png")
```

Run it:

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && python3 scripts/make-icons.py
```

Expected output:

```
wrote icons/16.png
wrote icons/48.png
wrote icons/128.png
```

- [ ] **Step 2: Verify the PNGs are valid**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && file icons/*.png
```

Expected: each line reports `PNG image data`, with dimensions `16 x 16`, `48 x 48`, `128 x 128`.

- [ ] **Step 3: Write the manifest**

`browser-ext/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Basic Auth Autofill",
  "version": "1.0.0",
  "description": "Attaches HTTP Basic credentials to sites you configure, so the browser stops showing its sign-in dialog.",
  "permissions": ["declarativeNetRequestWithHostAccess", "storage"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "options_page": "options.html",
  "action": {
    "default_title": "Basic Auth Autofill"
  },
  "icons": {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  }
}
```

- [ ] **Step 4: Write the storage accessor**

`browser-ext/lib/storage.js`:

```js
const SITES_KEY = "sites";
const ERROR_KEY = "ruleError";

export async function getSites() {
  const data = await chrome.storage.local.get(SITES_KEY);
  return Array.isArray(data[SITES_KEY]) ? data[SITES_KEY] : [];
}

export async function setSites(sites) {
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

export async function getRuleError() {
  const data = await chrome.storage.local.get(ERROR_KEY);
  return data[ERROR_KEY] ?? null;
}

export async function setRuleError(message) {
  await chrome.storage.local.set({ [ERROR_KEY]: message });
}

export { SITES_KEY, ERROR_KEY };
```

- [ ] **Step 5: Write the service worker**

`browser-ext/background.js`:

```js
import { buildRules, encodeCredentials } from "./lib/rules.js";
import { getSites, setRuleError, SITES_KEY } from "./lib/storage.js";

/** Drops sites whose host permission is not currently granted. */
async function withGrantedPermission(sites) {
  const checks = await Promise.all(
    sites.map((site) =>
      chrome.permissions
        .contains({ origins: [`${site.origin}/*`] })
        .catch(() => false),
    ),
  );
  return sites.filter((_, index) => checks[index]);
}

/**
 * Replaces the entire dynamic rule set. Never patches individual rules —
 * treating the rule set as a pure function of storage is what keeps the two
 * from drifting apart.
 */
async function syncRules() {
  const sites = await getSites();
  const rules = buildRules(await withGrantedPermission(sites));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules,
  });
}

/**
 * A silent sync failure is indistinguishable from success until a 401 shows
 * up, so the message is persisted for the options page to surface.
 */
async function syncRulesSafe() {
  try {
    await syncRules();
    await setRuleError(null);
  } catch (error) {
    await setRuleError(String(error?.message ?? error));
  }
}

async function testSite(origin, username, password) {
  try {
    const response = await fetch(`${origin}/`, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: { Authorization: `Basic ${encodeCredentials(username, password)}` },
    });
    // redirect:"manual" yields an opaqueredirect response with status 0.
    // A rejected credential returns 401 outright rather than redirecting,
    // so a redirect means auth succeeded.
    if (response.status === 0) return { state: "ok" };
    if (response.status === 401) return { state: "rejected" };
    if (response.status >= 200 && response.status < 400) return { state: "ok" };
    return { state: "other", status: response.status };
  } catch {
    return { state: "unreachable" };
  }
}

chrome.runtime.onInstalled.addListener(syncRulesSafe);
chrome.runtime.onStartup.addListener(syncRulesSafe);
chrome.permissions.onAdded.addListener(syncRulesSafe);
chrome.permissions.onRemoved.addListener(syncRulesSafe);

// Only react to `sites`. Reacting to every key would loop forever, because
// syncRulesSafe writes `ruleError` on completion.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SITES_KEY]) syncRulesSafe();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "test-site") return false;
  testSite(message.origin, message.username, message.password).then(sendResponse);
  return true; // keeps the message channel open for the async response
});
```

- [ ] **Step 6: Add a placeholder options page**

The manifest references `options.html`, so it must exist before Chrome will load the extension. Task 3 replaces this entirely.

`browser-ext/options.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Basic Auth Autofill</title>
  </head>
  <body>
    <h1>Basic Auth Autofill</h1>
  </body>
</html>
```

- [ ] **Step 7: Confirm the unit tests still pass**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: PASS — 16 tests, 0 failures. (Task 2 added no pure logic; this guards against an accidental edit to `lib/rules.js`.)

- [ ] **Step 8: Load the extension and verify a clean start**

Manual, in Chrome:

1. Open `chrome://extensions`, enable **Developer mode**.
2. If the old `mapedu-dev-auth` extension is loaded, leave it for now — Task 7 removes it.
3. Click **Load unpacked** and select `/Users/dinhquy/Developer/mapedu/browser-ext`.
4. Confirm the card appears with **no** errors and **no** "Read and change all your data on all websites" warning.
5. Click **service worker** on the card to open its console. Confirm no exceptions.
6. Click the toolbar icon. Confirm the placeholder options page opens in a new tab.

- [ ] **Step 9: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/manifest.json browser-ext/lib/storage.js browser-ext/background.js \
        browser-ext/options.html browser-ext/icons browser-ext/scripts/make-icons.py
git commit -m "feat(browser-ext): add manifest, icons, storage accessor and rule sync worker"
```

---

### Task 3: Options page — render the list and add a site

**Files:**
- Modify: `browser-ext/options.html` (replace placeholder in full)
- Create: `browser-ext/options.css`
- Create: `browser-ext/options.js`

**Interfaces:**
- Consumes: `normalizeOrigin` from `lib/rules.js`; `getSites`, `setSites`, `getRuleError` from `lib/storage.js`.
- Produces: DOM contract used by Tasks 4–6 — each site row is `<li class="site-row" data-id="{site.id}">` containing `.js-toggle` (checkbox), `.js-test`, `.js-edit`, `.js-delete`, `.js-grant` (buttons), and `.js-status` (span).

- [ ] **Step 1: Write the options page markup**

`browser-ext/options.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Basic Auth Autofill</title>
    <link rel="stylesheet" href="options.css" />
  </head>
  <body>
    <main>
      <h1>Basic Auth Autofill</h1>
      <p class="lede">
        Sites listed here receive an <code>Authorization: Basic</code> header on every
        request, so the browser never shows its sign-in dialog.
      </p>

      <p id="banner" class="banner" hidden></p>

      <ul id="site-list" class="site-list"></ul>
      <p id="empty-state" class="empty" hidden>No sites configured yet.</p>

      <form id="add-form" class="add-form" autocomplete="off">
        <h2>Add a site</h2>
        <label>
          Address
          <input id="origin-input" type="text" placeholder="dev.mapedu.com" />
        </label>
        <label>
          Username
          <input id="username-input" type="text" />
        </label>
        <label>
          Password
          <input id="password-input" type="password" autocomplete="new-password" />
        </label>
        <p id="form-error" class="error" hidden></p>
        <button type="submit">Add site</button>
      </form>

      <p class="footnote">
        Credentials are stored unencrypted in this browser profile. Use this for shared
        non-production environment passwords only.
      </p>
    </main>
    <script type="module" src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the stylesheet**

`browser-ext/options.css`:

```css
:root {
  color-scheme: light dark;
  --border: color-mix(in srgb, currentColor 18%, transparent);
  --muted: color-mix(in srgb, currentColor 60%, transparent);
}

body {
  margin: 0;
  padding: 2.5rem 1.5rem;
  font: 15px/1.5 system-ui, -apple-system, sans-serif;
}

main {
  max-width: 46rem;
  margin: 0 auto;
}

h1 {
  margin: 0 0 0.25rem;
  font-size: 1.4rem;
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.lede,
.footnote {
  color: var(--muted);
  font-size: 0.875rem;
}

.footnote {
  margin-top: 2rem;
}

.site-list {
  list-style: none;
  margin: 1.5rem 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

.site-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.site-identity {
  flex: 1 1 14rem;
  min-width: 0;
}

.site-origin {
  font-weight: 600;
  word-break: break-all;
}

.site-username {
  display: block;
  color: var(--muted);
  font-size: 0.875rem;
}

.js-status {
  font-size: 0.8125rem;
  min-width: 6.5rem;
}

.status-ok { color: #1a7f37; }
.status-bad { color: #b3261e; }
.status-muted { color: var(--muted); }

button {
  font: inherit;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

button:hover { border-color: currentColor; }

.add-form {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  display: grid;
  gap: 0.75rem;
  max-width: 26rem;
}

.add-form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.875rem;
}

.add-form input {
  font: inherit;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}

.add-form button { justify-self: start; }

.error { color: #b3261e; font-size: 0.875rem; margin: 0; }

.banner {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: #b3261e;
  color: #fff;
  font-size: 0.875rem;
}

.empty { color: var(--muted); font-style: italic; }

.edit-form {
  flex: 1 1 100%;
  display: grid;
  gap: 0.5rem;
  max-width: 26rem;
  padding: 0.5rem 0 0.25rem;
}

.edit-form input {
  font: inherit;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}

.edit-actions { display: flex; gap: 0.5rem; }
```

- [ ] **Step 3: Write the options controller**

`browser-ext/options.js`:

```js
import { normalizeOrigin } from "./lib/rules.js";
import { getSites, setSites, getRuleError } from "./lib/storage.js";

const listEl = document.getElementById("site-list");
const emptyEl = document.getElementById("empty-state");
const bannerEl = document.getElementById("banner");
const formEl = document.getElementById("add-form");
const originInput = document.getElementById("origin-input");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const formErrorEl = document.getElementById("form-error");

/** In-memory mirror of storage, so click handlers can validate synchronously. */
let sites = [];

function showFormError(message) {
  formErrorEl.textContent = message;
  formErrorEl.hidden = false;
}

function clearFormError() {
  formErrorEl.textContent = "";
  formErrorEl.hidden = true;
}

function permissionPattern(origin) {
  return `${origin}/*`;
}

function render() {
  listEl.replaceChildren();
  emptyEl.hidden = sites.length > 0;

  for (const site of sites) {
    const row = document.createElement("li");
    row.className = "site-row";
    row.dataset.id = site.id;

    const identity = document.createElement("div");
    identity.className = "site-identity";
    const origin = document.createElement("div");
    origin.className = "site-origin";
    origin.textContent = site.origin;
    const username = document.createElement("span");
    username.className = "site-username";
    username.textContent = site.username;
    identity.append(origin, username);

    const status = document.createElement("span");
    status.className = "js-status status-muted";

    const toggleLabel = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "js-toggle";
    toggle.checked = site.enabled;
    toggleLabel.append(toggle, document.createTextNode(" On"));

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "js-test";
    testBtn.textContent = "Test";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "js-edit";
    editBtn.textContent = "Edit";

    const grantBtn = document.createElement("button");
    grantBtn.type = "button";
    grantBtn.className = "js-grant";
    grantBtn.textContent = "Grant access";
    grantBtn.hidden = true;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "js-delete";
    deleteBtn.textContent = "Delete";

    row.append(identity, status, toggleLabel, testBtn, editBtn, grantBtn, deleteBtn);
    listEl.append(row);
  }

  refreshPermissionStates();
}

/**
 * A permission can be revoked from chrome://extensions at any time, which
 * would otherwise leave a row looking active while no rule is installed.
 */
async function refreshPermissionStates() {
  for (const site of sites) {
    const row = listEl.querySelector(`[data-id="${CSS.escape(site.id)}"]`);
    if (!row) continue;
    const granted = await chrome.permissions.contains({
      origins: [permissionPattern(site.origin)],
    });
    row.querySelector(".js-grant").hidden = granted;
    if (!granted) {
      const status = row.querySelector(".js-status");
      status.textContent = "no access";
      status.className = "js-status status-bad";
    }
  }
}

async function showRuleErrorBanner() {
  const message = await getRuleError();
  if (message) {
    bannerEl.textContent = `Could not install rules: ${message}`;
    bannerEl.hidden = false;
  } else {
    bannerEl.hidden = true;
  }
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  clearFormError();

  // Everything before chrome.permissions.request() must stay synchronous,
  // otherwise the user gesture is lost and Chrome rejects the request.
  let origin;
  try {
    origin = normalizeOrigin(originInput.value);
  } catch (error) {
    showFormError(error.message);
    return;
  }

  const username = usernameInput.value.trim();
  if (!username) {
    showFormError("Enter a username.");
    return;
  }

  if (sites.some((site) => site.origin === origin)) {
    showFormError(`${origin} is already configured.`);
    return;
  }

  const password = passwordInput.value;

  chrome.permissions
    .request({ origins: [permissionPattern(origin)] })
    .then(async (granted) => {
      if (!granted) {
        showFormError(`Chrome denied access to ${origin}. Nothing was saved.`);
        return;
      }
      sites = [
        ...sites,
        {
          id: crypto.randomUUID(),
          origin,
          username,
          password,
          enabled: true,
        },
      ];
      await setSites(sites);
      formEl.reset();
      render();
    })
    .catch((error) => showFormError(error.message));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.ruleError) showRuleErrorBanner();
});

async function init() {
  sites = await getSites();
  render();
  await showRuleErrorBanner();
}

init();
```

- [ ] **Step 4: Verify the add flow manually**

1. Reload the extension at `chrome://extensions`.
2. Click the toolbar icon to open the options tab.
3. Type `dev.mapedu.com`, your username and password, click **Add site**.
4. Confirm Chrome prompts for access to `dev.mapedu.com` **only** — not all sites.
5. Click **Allow**. Confirm the row appears with the origin and username.
6. Open `https://dev.mapedu.com` in a new tab. Confirm **no** sign-in dialog appears.
7. Submit the form again with the same address. Confirm the inline error reads
   `https://dev.mapedu.com is already configured.` and nothing is added.
8. Submit with an empty address. Confirm the error reads `Enter a site address.`

- [ ] **Step 5: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/options.html browser-ext/options.css browser-ext/options.js
git commit -m "feat(browser-ext): add options page with site list and add flow"
```

---

### Task 4: Enable toggle, delete, and grant

**Files:**
- Modify: `browser-ext/options.js` (append handlers, extend `init`)

**Interfaces:**
- Consumes: the DOM contract from Task 3 (`.js-toggle`, `.js-delete`, `.js-grant`, `data-id`), `setSites` from `lib/storage.js`.
- Produces: `findSite(id): Site | undefined` and `persist(): Promise<void>` helpers reused by Tasks 5 and 6.

- [ ] **Step 1: Add the shared row helpers**

Insert into `browser-ext/options.js`, immediately after the `render()` function definition:

```js
function findSite(id) {
  return sites.find((site) => site.id === id);
}

async function persist() {
  await setSites(sites);
}

function rowFor(target) {
  const row = target.closest(".site-row");
  return row ? { row, site: findSite(row.dataset.id) } : { row: null, site: undefined };
}

function setStatus(row, text, tone = "muted") {
  const status = row.querySelector(".js-status");
  status.textContent = text;
  status.className = `js-status status-${tone}`;
}
```

- [ ] **Step 2: Add the click and change delegation**

Append to `browser-ext/options.js`, before the `chrome.storage.onChanged` listener:

```js
listEl.addEventListener("change", async (event) => {
  if (!event.target.classList.contains("js-toggle")) return;
  const { site } = rowFor(event.target);
  if (!site) return;
  site.enabled = event.target.checked;
  await persist();
});

listEl.addEventListener("click", (event) => {
  const target = event.target;

  if (target.classList.contains("js-delete")) {
    const { site } = rowFor(target);
    if (!site) return;
    // Revoking is fire-and-forget: the record is gone either way, and a
    // leftover permission would otherwise linger in chrome://extensions.
    chrome.permissions
      .remove({ origins: [permissionPattern(site.origin)] })
      .catch(() => {});
    sites = sites.filter((candidate) => candidate.id !== site.id);
    persist().then(render);
    return;
  }

  if (target.classList.contains("js-grant")) {
    const { row, site } = rowFor(target);
    if (!site) return;
    // Called directly in the click handler to preserve the user gesture.
    chrome.permissions
      .request({ origins: [permissionPattern(site.origin)] })
      .then((granted) => {
        if (granted) {
          target.hidden = true;
          setStatus(row, "");
        } else {
          setStatus(row, "access denied", "bad");
        }
      })
      .catch((error) => setStatus(row, error.message, "bad"));
  }
});
```

- [ ] **Step 3: Verify the unit tests still pass**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 4: Verify the row actions manually**

1. Reload the extension, open the options tab.
2. Uncheck **On** for `dev.mapedu.com`. Open the site in a new tab and confirm the
   sign-in dialog **does** appear (the rule was removed). Dismiss it.
3. Re-check **On**. Reload the site and confirm the dialog is gone again.
4. Open `chrome://extensions` → the extension's **Details** → **Site access**, and
   remove `dev.mapedu.com`. Return to the options tab and reload it. Confirm the row
   shows `no access` and a **Grant access** button.
5. Click **Grant access**, allow the prompt, confirm the button disappears.
6. Click **Delete**. Confirm the row disappears and the host is gone from **Site access**.

- [ ] **Step 5: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/options.js
git commit -m "feat(browser-ext): add enable toggle, delete with permission revoke, and grant"
```

---

### Task 5: Edit credentials inline

**Files:**
- Modify: `browser-ext/options.js` (extend the click delegation added in Task 4)

**Interfaces:**
- Consumes: `findSite`, `persist`, `rowFor`, `render` from Tasks 3–4; the `.js-edit` button from the Task 3 DOM contract.
- Produces: an inline `<form class="edit-form">` injected into a row, containing `.js-edit-username`, `.js-edit-password`, `.js-edit-save`, `.js-edit-cancel`.

The origin is deliberately not editable — it is the key the host permission is bound to. Changing an address means deleting the row and adding a new one.

- [ ] **Step 1: Add the edit form builder**

Insert into `browser-ext/options.js`, after the `setStatus` helper from Task 4:

```js
function openEditForm(row, site) {
  if (row.querySelector(".edit-form")) return; // already open

  const form = document.createElement("form");
  form.className = "edit-form";

  const username = document.createElement("input");
  username.type = "text";
  username.className = "js-edit-username";
  username.value = site.username;
  username.placeholder = "Username";

  const password = document.createElement("input");
  password.type = "password";
  password.className = "js-edit-password";
  password.value = site.password;
  password.placeholder = "Password";
  password.autocomplete = "new-password";

  const actions = document.createElement("div");
  actions.className = "edit-actions";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "js-edit-save";
  save.textContent = "Save";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "js-edit-cancel";
  cancel.textContent = "Cancel";

  actions.append(save, cancel);
  form.append(username, password, actions);
  row.append(form);
  username.focus();
}
```

- [ ] **Step 2: Wire the edit, save, and cancel handlers**

In the `listEl` click listener added in Task 4, insert this block immediately after the
`js-delete` block and before the `js-grant` block:

```js
  if (target.classList.contains("js-edit")) {
    const { row, site } = rowFor(target);
    if (site) openEditForm(row, site);
    return;
  }

  if (target.classList.contains("js-edit-cancel")) {
    target.closest(".edit-form")?.remove();
    return;
  }
```

Then append a submit listener to `browser-ext/options.js`, directly after the click listener:

```js
listEl.addEventListener("submit", async (event) => {
  if (!event.target.classList.contains("edit-form")) return;
  event.preventDefault();

  const { row, site } = rowFor(event.target);
  if (!site) return;

  const username = event.target.querySelector(".js-edit-username").value.trim();
  if (!username) {
    setStatus(row, "username required", "bad");
    return;
  }

  site.username = username;
  site.password = event.target.querySelector(".js-edit-password").value;
  await persist();
  render();
});
```

- [ ] **Step 3: Verify the unit tests still pass**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 4: Verify editing manually**

1. Reload the extension, open the options tab.
2. Click **Edit** on `dev.mapedu.com`. Confirm the username and password fields appear
   prefilled.
3. Click **Cancel**. Confirm the form closes with nothing changed.
4. Click **Edit**, clear the username, click **Save**. Confirm the row shows
   `username required` and nothing is saved.
5. Click **Edit**, change the password to a wrong value, click **Save**. Reload
   `https://dev.mapedu.com` and confirm you now get a 401 page (proving the rule
   updated).
6. Click **Edit**, restore the correct password, **Save**, reload the site, confirm
   access works again.

- [ ] **Step 5: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/options.js
git commit -m "feat(browser-ext): add inline credential editing"
```

---

### Task 6: Test button

**Files:**
- Modify: `browser-ext/options.js` (extend the click delegation)

**Interfaces:**
- Consumes: the `background.js` message contract from Task 2 —
  `{ type: "test-site", origin, username, password }` →
  `{ state: "ok" | "rejected" | "unreachable" | "other", status?: number }`.
- Produces: nothing consumed by later tasks.

The test reads credentials from the open edit form when there is one, so a value can be
verified before it is saved.

- [ ] **Step 1: Add the test handler**

In the `listEl` click listener, insert this block immediately after the `js-edit-cancel`
block:

```js
  if (target.classList.contains("js-test")) {
    const { row, site } = rowFor(target);
    if (!site) return;

    // Prefer unsaved values from an open edit form, so a password can be
    // checked before committing it.
    const editForm = row.querySelector(".edit-form");
    const username = editForm
      ? editForm.querySelector(".js-edit-username").value.trim()
      : site.username;
    const password = editForm
      ? editForm.querySelector(".js-edit-password").value
      : site.password;

    target.disabled = true;
    setStatus(row, "testing…");

    chrome.runtime
      .sendMessage({ type: "test-site", origin: site.origin, username, password })
      .then((result) => {
        if (result?.state === "ok") setStatus(row, "ok", "ok");
        else if (result?.state === "rejected") setStatus(row, "401 rejected", "bad");
        else if (result?.state === "unreachable") setStatus(row, "unreachable", "bad");
        else setStatus(row, `HTTP ${result?.status ?? "?"}`, "bad");
      })
      .catch((error) => setStatus(row, error.message, "bad"))
      .finally(() => {
        target.disabled = false;
      });
    return;
  }
```

- [ ] **Step 2: Verify the unit tests still pass**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 3: Verify each Test outcome manually**

1. Reload the extension, open the options tab.
2. Click **Test** on a correctly configured site. Confirm it briefly shows `testing…`
   then `ok` in green.
3. Click **Edit**, type a wrong password (do **not** save), click **Test**. Confirm
   `401 rejected` in red — this proves the test reads the form rather than storage.
4. Click **Cancel** on the edit form. Click **Test** again. Confirm `ok` returns.
5. Add a site for `https://this-host-does-not-exist.mapedu.com` with any credentials,
   allow the permission, click **Test**. Confirm `unreachable`. Delete that row
   afterwards.

- [ ] **Step 4: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/options.js
git commit -m "feat(browser-ext): add per-site credential test button"
```

---

### Task 7: README, full verification, and retiring the old extension

**Files:**
- Create: `browser-ext/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing.

- [ ] **Step 1: Write the README**

`browser-ext/README.md`:

````markdown
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
````

- [ ] **Step 2: Run the full unit suite**

```bash
cd /Users/dinhquy/Developer/mapedu/browser-ext && npm test
```

Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 3: Work the manual checklist end to end**

Run every item in the README checklist above against a freshly reloaded extension.
Do not proceed until all pass. The restart item matters most — it is the one that proves
dynamic rules persist, which is the whole reason dynamic rules were chosen over session
rules.

- [ ] **Step 4: Retire the interim extension**

Only after the checklist passes:

1. Open `chrome://extensions` and remove **MapEDU dev/staging basic auth**.
2. Delete the old directory, which contains live credentials in plaintext:

```bash
rm -rf /Users/dinhquy/Developer/mapedu-dev-auth
```

3. Confirm both `dev.mapedu.com` and `staging.mapedu.com` still load without a prompt,
   proving the new extension is doing the work.

- [ ] **Step 5: Commit**

```bash
cd /Users/dinhquy/Developer/mapedu
git add browser-ext/README.md
git commit -m "docs(browser-ext): add README with usage and manual test checklist"
```

---

## Deferred

Recorded so they are not lost, deliberately out of scope for this plan:

- **Web Store distribution.** One-time $5 developer fee. Private/domain-restricted
  visibility needs a Workspace admin to enable domain-restricted publishing; Unlisted
  needs no setup. Load-unpacked remains the proportionate default until the team wants
  automatic updates.
- **The server-side fix.** A CloudFront Function issuing a signed cookie after a
  successful sign-in would make this extension unnecessary for everyone. Blocked on the
  dev/staging distributions not being managed in `terraform/`.
