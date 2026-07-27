import { normalizeOrigin } from "./lib/rules.js";
import { getSites, setSites, getRuleError } from "./lib/storage.js";

const listEl = document.getElementById("site-list");
const listHeadEl = document.getElementById("list-head");
const countEl = document.getElementById("site-count");
const emptyEl = document.getElementById("empty-state");
const bannerEl = document.getElementById("banner");
const formEl = document.getElementById("add-form");
const submitBtn = document.getElementById("submit-btn");
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
  listHeadEl.hidden = sites.length === 0;
  countEl.textContent = sites.length === 1 ? "1 site" : `${sites.length} sites`;

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
    status.setAttribute("role", "status");

    // A styled checkbox rather than a custom widget: the switch is pure CSS,
    // so keyboard behaviour and the change event stay native.
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "switch";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "js-toggle";
    toggle.checked = site.enabled;
    toggle.setAttribute("aria-label", `Send credentials to ${site.origin}`);
    toggleLabel.append(toggle);

    // Buttons keep text-only children on purpose. Click delegation reads
    // event.target.classList, so an inner icon or span would become the
    // target and every handler would miss.
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn js-test";
    testBtn.textContent = "Test";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn js-edit";
    editBtn.textContent = "Edit";

    const grantBtn = document.createElement("button");
    grantBtn.type = "button";
    grantBtn.className = "btn btn-accent js-grant";
    grantBtn.textContent = "Grant access";
    grantBtn.hidden = true;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger js-delete";
    deleteBtn.textContent = "Delete";

    const controls = document.createElement("div");
    controls.className = "row-controls";
    controls.append(status, testBtn, editBtn, deleteBtn, grantBtn);

    const main = document.createElement("div");
    main.className = "row-main";
    main.append(toggleLabel, identity, controls);

    row.append(main);
    listEl.append(row);
  }

  refreshPermissionStates();
}

function findSite(id) {
  return sites.find((site) => site.id === id);
}

/**
 * Persist-then-assign: only update the in-memory mirror after the storage
 * write succeeds, so a failed write can never leave `sites` out of sync
 * with what's actually persisted.
 */
async function persist(next) {
  await setSites(next);
  sites = next;
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

function openEditForm(row, site) {
  if (row.querySelector(".edit-form")) return; // already open

  const form = document.createElement("form");
  form.className = "edit-form";

  // A placeholder is not an accessible name, and it disappears once the field
  // has a value — which these always do.
  const username = document.createElement("input");
  username.type = "text";
  username.className = "js-edit-username";
  username.value = site.username;
  username.placeholder = "Username";
  username.setAttribute("aria-label", `Username for ${site.origin}`);

  const password = document.createElement("input");
  password.type = "password";
  password.className = "js-edit-password";
  password.value = site.password;
  password.placeholder = "Password";
  password.autocomplete = "new-password";
  password.setAttribute("aria-label", `Password for ${site.origin}`);

  const actions = document.createElement("div");
  actions.className = "edit-actions";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-accent js-edit-save";
  save.textContent = "Save";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn js-edit-cancel";
  cancel.textContent = "Cancel";

  actions.append(save, cancel);
  form.append(username, password, actions);
  row.append(form);
  username.focus();
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
      const next = [
        ...sites,
        {
          id: crypto.randomUUID(),
          origin,
          username,
          password,
          enabled: true,
        },
      ];
      await persist(next);
      formEl.reset();
      render();
    })
    .catch((error) =>
      showFormError(
        `Access to ${origin} was granted but the site was not saved (${error.message}); retry, or remove the permission from chrome://extensions.`,
      ),
    );
});

listEl.addEventListener("change", async (event) => {
  if (!event.target.classList.contains("js-toggle")) return;
  const { row, site } = rowFor(event.target);
  if (!site) return;
  const next = sites.map((candidate) =>
    candidate.id === site.id ? { ...candidate, enabled: event.target.checked } : candidate,
  );
  try {
    await persist(next);
  } catch (error) {
    // persist() only reassigns `sites` on success, so on failure `site`
    // still holds the true pre-change value — restore the checkbox to it
    // rather than negating, since something else could have changed it.
    event.target.checked = site.enabled;
    setStatus(row, `Failed to save: ${error.message}`, "bad");
  }
});

listEl.addEventListener("click", (event) => {
  const target = event.target;

  if (target.classList.contains("js-delete")) {
    const { row, site } = rowFor(target);
    if (!site) return;
    // Revoking is fire-and-forget: the record is gone either way, and a
    // leftover permission would otherwise linger in chrome://extensions.
    chrome.permissions
      .remove({ origins: [permissionPattern(site.origin)] })
      .catch(() => {});
    const next = sites.filter((candidate) => candidate.id !== site.id);
    persist(next)
      .then(render)
      .catch((error) => {
        // If we get here, the permission may already have been revoked
        // above even though the record itself was NOT deleted (persist
        // only reassigns `sites` on success). Make that explicit so the
        // user knows to re-grant access rather than trusting the row.
        setStatus(
          row,
          `Not deleted: ${error.message}. Access may need to be re-granted — click Grant.`,
          "bad",
        );
      });
    return;
  }

  if (target.classList.contains("js-edit")) {
    const { row, site } = rowFor(target);
    if (site) openEditForm(row, site);
    return;
  }

  if (target.classList.contains("js-edit-cancel")) {
    target.closest(".edit-form")?.remove();
    return;
  }

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

  const password = event.target.querySelector(".js-edit-password").value;
  const next = sites.map((candidate) =>
    candidate.id === site.id ? { ...candidate, username, password } : candidate,
  );

  try {
    await persist(next);
    render();
  } catch (error) {
    setStatus(row, `Failed to save: ${error.message}`, "bad");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.ruleError) showRuleErrorBanner();
});

async function init() {
  sites = await getSites();
  render();
  await showRuleErrorBanner();
  // Only now does `sites` reflect storage; submitting before this point
  // could silently clobber whatever was persisted in an earlier session.
  submitBtn.disabled = false;
}

init();
