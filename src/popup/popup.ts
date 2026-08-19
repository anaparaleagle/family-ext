// Popup: Firebase login (project paraleagle-family), case picker from the
// family backend, and "Load case" -> GET /forms/myuscis-preview/ -> stored
// payload. Single-path: there is no manual-paste / dual-shape duality here.

// /web-extension entry point — see the note in ../engine/firebase.ts.
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth/web-extension";
import { authFor, projectForApi } from "../engine/firebase";
import {
  FLAG_CONFIGS,
  FLAG_KEYS,
  autofillPath,
  caseTypeMatchesForm,
  caseTypesForForm,
  isFlagForm,
} from "../flag/registry";
import { STORAGE_KEYS, MyuscisPayload } from "../runner/payload";
import { FORM_CONFIGS } from "../runner/registry";
import { apiEnvOptions, allowedApiOrigins, resolveApiBaseUrl } from "../engine/api-config";

/** Shown whenever the backend rejects our Firebase token. */
const SESSION_EXPIRED = "Session expired — reopen the popup and Load case.";

/**
 * What this build is permitted to fetch. Read once from the manifest, and the
 * single input to every backend-choice decision below — so the popup can never
 * offer, store or request an origin the build has no permission for. A store
 * build has no localhost entry; `npm run watch` puts one back.
 */
const HOST_PERMISSIONS = chrome.runtime.getManifest().host_permissions ?? [];

/**
 * Auth for the backend currently selected, not for a fixed project.
 *
 * The backend only accepts tokens from the one Firebase project it verifies
 * against, so which project we sign into is a property of which backend is
 * picked — see engine/firebase. Re-pointed by `useApi`, never read before init()
 * has set the selector from storage.
 */
let auth = authFor(undefined);

/**
 * Point auth at the project this backend verifies against, and re-render.
 *
 * Sessions do NOT carry across projects: a user signed into paraleagle-family is
 * simply not signed in as far as the dev project is concerned. So the login form
 * comes back on a switch, which is honest — the alternative is showing a signed-in
 * email beside a case list that 401s.
 */
function useApi(apiBaseUrl: string): void {
  auth = authFor(apiBaseUrl);
  onAuthStateChanged(auth, (user) => {
    if (user) {
      showLoggedIn(user.email || "");
      loadCases();
    } else {
      showLogin();
      setEmpty(`Sign in to ${projectForApi(apiBaseUrl).projectId} for this backend.`);
    }
  });
}

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
  // Heal a stale persisted value — the retired prod host, or a localhost host
  // this build can no longer reach — so requests always resolve to a backend we
  // actually have permission to fetch.
  return resolveApiBaseUrl(stored[STORAGE_KEYS.apiBaseUrl] as string | undefined, HOST_PERMISSIONS);
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
  if (!allowedApiOrigins(HOST_PERMISSIONS).some((o) => url.startsWith(o))) {
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
  const formType = formTypeSelect.value;
  caseList.innerHTML = "";

  // Cases this form can actually be filled for. The ETA-9141 is PERM-only, so
  // listing the firm's I-130s and I-140s under it offers a choice whose only
  // outcome is a 400 from the backend — which reads as the extension being
  // broken rather than as the wrong case.
  const eligible = cases.filter((c) => caseTypeMatchesForm(c.case_type, formType));

  // A case selected under one form may not exist under the next. Dropping it
  // here stops Load case firing against a case no longer on screen.
  if (selectedCaseId && !eligible.some((c) => c.id === selectedCaseId)) {
    selectedCaseId = "";
  }

  let shown = 0;
  for (const c of eligible) {
    const label = caseLabel(c);
    if (q && !label.toLowerCase().includes(q)) continue;
    shown++;
    const row = document.createElement("div");
    row.className = "case-row" + (c.id === selectedCaseId ? " selected" : "");
    row.dataset.id = c.id;
    row.textContent = label;
    caseList.appendChild(row);
  }

  if (shown > 0) return;
  const allowed = caseTypesForForm(formType);
  if (cases.length === 0) setEmpty("No cases");
  else if (eligible.length === 0 && allowed) {
    // Say WHICH type is missing. "No matching cases" under a form the firm has
    // no cases for looks like a broken search box.
    setEmpty(`No ${allowed.join("/")} cases — ${formType} is filed on ${allowed.join("/")} cases only.`);
  } else setEmpty("No matching cases");
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

/**
 * Load a DOL form's values (ETA-9141) from the eta-autofill feed.
 *
 * A separate path from the myUSCIS one because the contract differs in the parts
 * that matter: the case id is in the URL rather than a query parameter, there are
 * no upload pages, and the response carries an `autofill_report` saying which
 * boxes the extension is deliberately NOT filling. That report is the reason to
 * load from the popup at all rather than only at fill time — a caseworker should
 * know before they start that, say, eight of the wage-source questions are theirs
 * to answer.
 */
async function loadFlagCase(formType: string): Promise<void> {
  const res = await apiRequest(autofillPath(selectedCaseId, formType), true);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return showError(describeApiError(res.status, data));
  }
  const payload = (await res.json()) as {
    field_values?: Record<string, string>;
    autofill_report?: {
      typed_count?: number;
      typed_needs_confirming?: string[];
      refused_fields?: { id: string }[];
      unmapped_fields?: { id: string }[];
    };
  };
  const fieldValues = payload.field_values;
  if (!fieldValues || typeof fieldValues !== "object") {
    return showError(`No field values in the ${formType} response.`);
  }
  await chrome.storage.local.set({
    [FLAG_KEYS.fieldValues]: fieldValues,
    [FLAG_KEYS.caseId]: selectedCaseId,
    [FLAG_KEYS.formType]: formType,
    [FLAG_KEYS.loadedAt]: Date.now(),
  });
  const report = payload.autofill_report ?? {};
  const confirm = report.typed_needs_confirming?.length ?? 0;
  const refused = report.refused_fields?.length ?? 0;
  setStatus(
    `Loaded ${Object.keys(fieldValues).length} ${formType} fields.` +
      (confirm ? ` ${confirm} standing answer(s) to check before you save.` : "") +
      (refused ? ` ${refused} you must tick yourself.` : ""),
  );
  loadBtn.textContent = "Loaded!";
  setTimeout(() => (loadBtn.textContent = "Load case"), 1500);
}

async function handleLoadCase(): Promise<void> {
  hideError();
  if (!selectedCaseId) return showError("Select a case first.");
  const formType = formTypeSelect.value;
  loadBtn.textContent = "Loading…";
  loadBtn.disabled = true;
  try {
    if (isFlagForm(formType)) {
      return await loadFlagCase(formType);
    }
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
  hideError();
  // Switching backend can switch Firebase project, so re-point auth rather than
  // reusing a session the new backend would reject on every request.
  useApi(apiEnvSelect.value);
});
formTypeSelect.addEventListener("change", () => {
  // The stored payload belongs to the previously chosen form; loading is what
  // makes the new choice real, so nudge rather than silently disagree.
  hideError();
  // Re-filter: which cases the list may offer depends on the form (the ETA-9141
  // is PERM-only). Without this the list still shows the previous form's cases
  // and the first click is on one the new form cannot fill.
  renderCases(caseSearch.value || "");
  setStatus(`Load the case to fill ${formTypeSelect.value}.`);
});

// ── Init ────────────────────────────────────────────────────────────────

/**
 * Populate the Backend picker from the manifest — the backends we can actually
 * fetch. A published build offers one, so the control is disabled: it still says
 * which backend is in use, without inviting a click that can change nothing.
 */
function renderApiEnvs(selected: string): void {
  const options = apiEnvOptions(HOST_PERMISSIONS);
  apiEnvSelect.innerHTML = "";
  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option.url;
    opt.textContent = option.label;
    apiEnvSelect.appendChild(opt);
  }
  apiEnvSelect.value = selected;
  apiEnvSelect.disabled = options.length < 2;
}

/** Populate the form picker from the registry — the forms we can actually drive. */
/**
 * Every form the extension can drive: the myUSCIS ones, then the DOL ones.
 *
 * Grouped in the dropdown because the two sets are filled on different websites,
 * and a caseworker picking "ETA-9141" while sitting on myUSCIS should be able to
 * see from the list why nothing happens there.
 */
const FORM_GROUPS: { label: string; formTypes: string[] }[] = [
  { label: "myUSCIS (my.uscis.gov)", formTypes: FORM_CONFIGS.map((c) => c.formType) },
  { label: "DOL FLAG (flag.dol.gov)", formTypes: FLAG_CONFIGS.map((c) => c.formType) },
];

const ALL_FORM_TYPES = FORM_GROUPS.flatMap((g) => g.formTypes);

function renderFormTypes(selected: string): void {
  formTypeSelect.innerHTML = "";
  for (const group of FORM_GROUPS) {
    if (!group.formTypes.length) continue;
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const formType of group.formTypes) {
      const opt = document.createElement("option");
      opt.value = formType;
      opt.textContent = formType;
      optgroup.appendChild(opt);
    }
    formTypeSelect.appendChild(optgroup);
  }
  formTypeSelect.value = ALL_FORM_TYPES.includes(selected) ? selected : ALL_FORM_TYPES[0];
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiBaseUrl,
    STORAGE_KEYS.fieldValues,
    STORAGE_KEYS.formType,
    STORAGE_KEYS.loadedAt,
  ]);
  // Resolve the persisted host up front — a retired URL, or a localhost one this
  // build no longer has permission for — then persist the healed value and select
  // it, so the dropdown shows the backend actually in use rather than sitting
  // blank on a host we cannot fetch.
  const storedApi = stored[STORAGE_KEYS.apiBaseUrl] as string | undefined;
  const resolvedApi = resolveApiBaseUrl(storedApi, HOST_PERMISSIONS);
  if (resolvedApi !== storedApi) {
    await chrome.storage.local.set({ [STORAGE_KEYS.apiBaseUrl]: resolvedApi });
  }
  renderApiEnvs(resolvedApi);
  renderFormTypes((stored[STORAGE_KEYS.formType] as string) || FORM_CONFIGS[0].formType);

  useApi(migratedApi);

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
