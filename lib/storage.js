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
