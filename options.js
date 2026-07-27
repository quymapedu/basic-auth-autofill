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
