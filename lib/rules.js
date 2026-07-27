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
