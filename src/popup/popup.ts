// Popup: Firebase login (shared project paraleagle-f3a7f), case picker from the
// family backend, and "Load case" -> GET /forms/myuscis-preview/ -> stored
// payload. Single-path: there is no manual-paste / dual-shape duality here.

import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "../engine/firebase";
import { STORAGE_KEYS, I130Payload } from "../i130/payload";

const DEFAULT_API_URL = "http://localhost:8001/api/v1";
const ALLOWED_API_ORIGINS = ["https://api.family.paraleagle.ai", "http://localhost:8001"];

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
  return (stored[STORAGE_KEYS.apiBaseUrl] as string) || DEFAULT_API_URL;
}

async function getToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  await chrome.storage.local.set({ [STORAGE_KEYS.accessToken]: token });
  return token;
}

async function apiRequest(path: string): Promise<Response> {
  const baseUrl = await getApiUrl();
  const url = `${baseUrl}${path}`;
  if (!ALLOWED_API_ORIGINS.some((o) => url.startsWith(o))) {
    throw new Error("API URL not in allowlist");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers });
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
    // I-130 lives on IR-1 (spouse) cases; the family list returns every case in
    // the firm. No status filter — a draft I-130 can be filled at any stage.
    const res = await apiRequest("/cases/?page_size=500");
    if (!res.ok) {
      cases = [];
      return setEmpty(`Failed to load cases (${res.status})`);
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
  loadBtn.textContent = "Loading…";
  loadBtn.disabled = true;
  try {
    const res = await apiRequest(
      `/forms/myuscis-preview/?case=${encodeURIComponent(selectedCaseId)}&form_type=I-130`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return showError(`[${res.status}] ${data.detail || "Failed to load I-130 data."}`);
    }
    const payload = (await res.json()) as I130Payload;
    const fieldValues = payload.field_values;
    if (!fieldValues || typeof fieldValues !== "object") {
      return showError("No field values in response.");
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.fieldValues]: fieldValues,
      [STORAGE_KEYS.uploadPages]: payload.documents?.upload_pages ?? [],
      [STORAGE_KEYS.caseId]: selectedCaseId,
      [STORAGE_KEYS.loadedAt]: Date.now(),
    });
    const n = Object.keys(fieldValues).length;
    const u = payload.documents?.upload_pages?.length ?? 0;
    setStatus(`Loaded ${n} fields + ${u} upload pages`);
    loadBtn.textContent = "Loaded!";
    setTimeout(() => (loadBtn.textContent = "Load case"), 1500);
  } catch {
    showError("Connection error loading I-130 data.");
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

// ── Init ────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.fieldValues, STORAGE_KEYS.loadedAt]);
  apiEnvSelect.value = (stored[STORAGE_KEYS.apiBaseUrl] as string) || DEFAULT_API_URL;

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
    await chrome.storage.local.remove([STORAGE_KEYS.fieldValues, STORAGE_KEYS.uploadPages, STORAGE_KEYS.caseId, STORAGE_KEYS.loadedAt]);
  } else if (fv && Object.keys(fv).length > 0) {
    setStatus(`${Object.keys(fv).length} fields ready`);
  }
}

init();
