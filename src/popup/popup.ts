// Popup: Firebase login (project paraleagle-family), case picker from the
// family backend, and "Load case" -> GET /forms/myuscis-preview/ -> stored
// payload. Single-path: there is no manual-paste / dual-shape duality here.

import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "../engine/firebase";
import { STORAGE_KEYS, MyuscisPayload } from "../runner/payload";
import { FORM_CONFIGS } from "../runner/registry";
import { ALLOWED_API_ORIGINS, migrateApiBaseUrl } from "./api-config";

/** Shown whenever the backend rejects our Firebase token. */
const SESSION_EXPIRED = "Session expired — reopen the popup and Load case.";

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const errorEl = $("error");
const statusEl = $("status");
const loginForm = $("login-form");
const loggedIn = $("logged-in");
const loginEmail = $<HTMLInputElement>("login-email");
const loginPassword = $<HTMLInputElement>("login-password");
const loginBtn = $<HTMLButtonElement>("login-btn");
const logoutBtn = $<HTMLButtonElement>("logout-btn");
const userEmailEl = $("user-email");
const caseList = $("case-list");
const caseSearch = $<HTMLInputElement>("case-search");
const loadBtn = $<HTMLButtonElement>("load-btn");
const apiEnvSelect = $<HTMLSelectElement>("api-env");
const formTypeSelect = $<HTMLSelectElement>("form-type");

// ── Helpers ──────────────────────────────────────────────────────────────
function showError(msg: string): void {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}
function hideError(): void {
  errorEl.style.display = "none";
}
function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

async function getApiUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.apiBaseUrl);
  // Heal a stale persisted value (the retired prod host) so requests always
  // resolve to the live backend, even if storage still holds the dead one.
  return migrateApiBaseUrl(stored[STORAGE_KEYS.apiBaseUrl] as string | undefined);
}

/**
 * Get a Firebase ID token and mirror it into storage for the content script +
 * download proxy.
 *
 * `forceRefresh` is used on "Load case": the mirrored token is what the content
 * script uses for doc downloads for the rest of the session, so it must be as
 * fresh as possible at the moment we hand it over — otherwise a popup left open
 * past the token's hour hands out a token that 401s on the first attachment.
 */
async function getToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken(forceRefresh);
  await chrome.storage.local.set({ [STORAGE_KEYS.accessToken]: token });
  return token;
}

async function apiRequest(path: string, forceRefresh = false): Promise<Response> {
  const baseUrl = await getApiUrl();
  const url = `${baseUrl}${path}`;
  if (!ALLOWED_API_ORIGINS.some((o) => url.startsWith(o))) {
    throw new Error("API URL not in allowlist");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getToken(forceRefresh);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers });
}

/**
 * Turn a DRF error body into something a paralegal can act on. DRF reports a
 * failed guard as {"<field>": ["message"]}, NOT {"detail": ...} — reading only
 * `detail` is how you end up showing a bare "[400] Failed to load data." and
 * hiding the one sentence that says what went wrong (e.g. "I-539 has no online
 * myUSCIS map").
 */
function describeApiError(status: number, data: unknown): string {
  if (status === 401 || status === 403) return SESSION_EXPIRED;
  const body = data as Record<string, unknown> | null;
  if (body && typeof body === "object") {
    if (typeof body.detail === "string") return `[${status}] ${body.detail}`;
    // First field-keyed error wins; that's the guard that actually rejected us.
    for (const value of Object.values(body)) {
      if (typeof value === "string") return `[${status}] ${value}`;
      if (Array.isArray(value) && typeof value[0] === "string") return `[${status}] ${value[0]}`;
    }
  }
  return `[${status}] Request failed.`;
}

// ── Auth ────────────────────────────────────────────────────────────────
async function handleLogin(): Promise<void> {
  hideError();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) return showError("Enter email and password.");

  loginBtn.textContent = "Signing in…";
  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showLoggedIn(email);
    await loadCases();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      showError("Invalid email or password.");
    } else if (code === "auth/too-many-requests") {
      showError("Too many attempts. Try again later.");
    } else {
      showError("Login failed.");
    }
  } finally {
    loginBtn.textContent = "Sign in";
    loginBtn.disabled = false;
  }
}

async function handleLogout(): Promise<void> {
  await signOut(auth);
  await chrome.storage.local.remove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.fieldValues,
    STORAGE_KEYS.uploadPages,
    STORAGE_KEYS.caseId,
    STORAGE_KEYS.formType,
    STORAGE_KEYS.loadedAt,
  ]);
  showLogin();
}

function showLogin(): void {
  loginForm.style.display = "block";
  loggedIn.style.display = "none";
  loginEmail.value = "";
  loginPassword.value = "";
}
function showLoggedIn(email: string): void {
  loginForm.style.display = "none";
  loggedIn.style.display = "block";
  userEmailEl.textContent = email;
}

// ── Cases ──────────────────────────────────────────────────────────────
interface CaseRow {
  id: string;
  case_number?: string;
  case_type?: string;
  status?: string;
  petitioner_name?: string;
  applicant_name?: string;
}

let cases: CaseRow[] = [];
let selectedCaseId = "";

function caseLabel(c: CaseRow): string {
  const num = c.case_number || c.id.slice(0, 8);
  const pet = c.petitioner_name?.trim() || "Petitioner?";
  const app = c.applicant_name?.trim() || "Applicant?";
  const type = c.case_type ? ` (${c.case_type})` : "";
  return `${num} · ${pet} → ${app}${type}`;
}

function setEmpty(msg: string): void {
  caseList.innerHTML = `<div class="empty">${msg}</div>`;
}

function renderCases(query: string): void {
  const q = query.trim().toLowerCase();
  caseList.innerHTML = "";
  let shown = 0;
  for (const c of cases) {
    const label = caseLabel(c);
    if (q && !label.toLowerCase().includes(q)) continue;
    shown++;
    const row = document.createElement("div");
    row.className = "case-row" + (c.id === selectedCaseId ? " selected" : "");
    row.dataset.id = c.id;
    row.textContent = label;
    caseList.appendChild(row);
  }
  if (cases.length === 0) setEmpty("No cases");
  else if (shown === 0) setEmpty("No matching cases");
}

async function loadCases(): Promise<void> {
  selectedCaseId = "";
  setEmpty("Loading…");
  try {
    // The family list returns every case in the firm; which form we resolve is
    // chosen separately (the form picker). No status filter — a draft can be
    // filled at any stage.
    const res = await apiRequest("/cases/?page_size=500");
    if (!res.ok) {
      cases = [];
      return setEmpty(res.status === 401 ? SESSION_EXPIRED : `Failed to load cases (${res.status})`);
    }
    const data = await res.json();
    cases = (data.results || data) as CaseRow[];
    renderCases(caseSearch.value || "");
  } catch {
    cases = [];
    setEmpty("Error loading cases");
  }
}

async function handleLoadCase(): Promise<void> {
  hideError();
  if (!selectedCaseId) return showError("Select a case first.");
  const formType = formTypeSelect.value;
  loadBtn.textContent = "Loading…";
  loadBtn.disabled = true;
  try {
    // forceRefresh: this is the token the content script will reuse for doc
    // downloads for the rest of the session — hand it over fresh.
    const res = await apiRequest(
      `/forms/myuscis-preview/?case=${encodeURIComponent(selectedCaseId)}` +
        `&form_type=${encodeURIComponent(formType)}`,
      true,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return showError(describeApiError(res.status, data));
    }
    const payload = (await res.json()) as MyuscisPayload;
    const fieldValues = payload.field_values;
    if (!fieldValues || typeof fieldValues !== "object") {
      return showError(`No field values in the ${formType} response.`);
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.fieldValues]: fieldValues,
      [STORAGE_KEYS.uploadPages]: payload.documents?.upload_pages ?? [],
      [STORAGE_KEYS.caseId]: selectedCaseId,
      [STORAGE_KEYS.formType]: formType,
      [STORAGE_KEYS.loadedAt]: Date.now(),
    });
    const n = Object.keys(fieldValues).length;
    const u = payload.documents?.upload_pages?.length ?? 0;
    setStatus(`Loaded ${n} ${formType} fields + ${u} upload pages`);
    loadBtn.textContent = "Loaded!";
    setTimeout(() => (loadBtn.textContent = "Load case"), 1500);
  } catch {
    showError(`Connection error loading ${formType} data.`);
  } finally {
    loadBtn.disabled = false;
    if (loadBtn.textContent === "Loading…") loadBtn.textContent = "Load case";
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────
loginBtn.addEventListener("click", handleLogin);
loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});
logoutBtn.addEventListener("click", handleLogout);
loadBtn.addEventListener("click", handleLoadCase);
caseSearch.addEventListener("input", () => renderCases(caseSearch.value));
caseList.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(".case-row");
  if (!row?.dataset.id) return;
  selectedCaseId = row.dataset.id;
  caseList.querySelectorAll(".case-row.selected").forEach((r) => r.classList.remove("selected"));
  row.classList.add("selected");
});
apiEnvSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.apiBaseUrl]: apiEnvSelect.value });
  if (auth.currentUser) loadCases();
});
formTypeSelect.addEventListener("change", () => {
  // The stored payload belongs to the previously chosen form; loading is what
  // makes the new choice real, so nudge rather than silently disagree.
  hideError();
  setStatus(`Load the case to fill ${formTypeSelect.value}.`);
});

// ── Init ────────────────────────────────────────────────────────────────

/** Populate the form picker from the registry — the forms we can actually drive. */
function renderFormTypes(selected: string): void {
  formTypeSelect.innerHTML = "";
  for (const config of FORM_CONFIGS) {
    const opt = document.createElement("option");
    opt.value = config.formType;
    opt.textContent = config.formType;
    formTypeSelect.appendChild(opt);
  }
  formTypeSelect.value = FORM_CONFIGS.some((c) => c.formType === selected)
    ? selected
    : FORM_CONFIGS[0].formType;
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiBaseUrl,
    STORAGE_KEYS.fieldValues,
    STORAGE_KEYS.formType,
    STORAGE_KEYS.loadedAt,
  ]);
  // Migrate a stale persisted host (the retired prod URL) up front: persist the
  // healed value and select it in the dropdown, so a tester who previously chose
  // Production sees "Production" rather than a blank <select> pointing at a dead
  // host.
  const storedApi = stored[STORAGE_KEYS.apiBaseUrl] as string | undefined;
  const migratedApi = migrateApiBaseUrl(storedApi);
  if (migratedApi !== storedApi) {
    await chrome.storage.local.set({ [STORAGE_KEYS.apiBaseUrl]: migratedApi });
  }
  apiEnvSelect.value = migratedApi;
  renderFormTypes((stored[STORAGE_KEYS.formType] as string) || FORM_CONFIGS[0].formType);

  onAuthStateChanged(auth, (user) => {
    if (user) {
      showLoggedIn(user.email || "");
      loadCases();
    } else {
      showLogin();
    }
  });

  // Expire stale loaded data after 30 minutes.
  const loadedAt = stored[STORAGE_KEYS.loadedAt] as number | undefined;
  const fv = stored[STORAGE_KEYS.fieldValues] as Record<string, string> | undefined;
  if (loadedAt && Date.now() - loadedAt > 30 * 60 * 1000) {
    await chrome.storage.local.remove([
      STORAGE_KEYS.fieldValues,
      STORAGE_KEYS.uploadPages,
      STORAGE_KEYS.caseId,
      STORAGE_KEYS.formType,
      STORAGE_KEYS.loadedAt,
    ]);
  } else if (fv && Object.keys(fv).length > 0) {
    const ft = (stored[STORAGE_KEYS.formType] as string) || "";
    setStatus(`${Object.keys(fv).length} ${ft} fields ready`.replace("  ", " "));
  }
}

init();
