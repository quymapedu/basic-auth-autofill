import { buildRules, encodeCredentials } from "./lib/rules.js";
import { createSerialQueue } from "./lib/queue.js";
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
  // Remove the ids we are about to add as well as the ones already installed.
  // Removals are applied before additions, and unknown ids are ignored, so this
  // update is self-consistent even if `existing` were read stale.
  const removeRuleIds = [
    ...new Set([...existing.map((rule) => rule.id), ...rules.map((rule) => rule.id)]),
  ];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
}

// Adding a site fires permissions.onAdded and storage.onChanged almost
// simultaneously. syncRules is a read-modify-write, so overlapping runs used to
// read the same rule set and then collide adding the same id.
const enqueueSync = createSerialQueue();

/**
 * A silent sync failure is indistinguishable from success until a 401 shows
 * up, so the message is persisted for the options page to surface.
 */
function syncRulesSafe() {
  return enqueueSync(async () => {
    try {
      await syncRules();
      await setRuleError(null);
    } catch (error) {
      await setRuleError(String(error?.message ?? error));
    }
  });
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
