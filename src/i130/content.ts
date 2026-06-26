// I-130 content script (isolated world). Renders a small toolbar on the online
// Petition-for-a-Relative form, reads the stored payload, and drives the fill.
// All form knowledge lives in the i130 layer; all DOM-setting in the engine.
// This file is glue + UI only.

import { dbg } from "../engine/logger";
import { detectCurrentPage } from "./section-detector";
import { fillAll, fillPage } from "./fill-chain";
import { descriptorForPath, fillUploadPage } from "./doc-flow";
import { STORAGE_KEYS } from "./payload";
import { FormPage } from "./form-descriptor";

const FORM_HOST_PATH = "/forms/petition-for-a-relative/";

function onI130Form(): boolean {
  return window.location.pathname.includes(FORM_HOST_PATH);
}

interface LoadedPayload {
  fieldValues: Record<string, string>;
  uploadPages: import("./payload").UploadPageDescriptor[];
  caseId: string;
  accessToken: string;
  apiBaseUrl: string;
}

async function loadPayload(): Promise<LoadedPayload | null> {
  const s = await chrome.storage.local.get([
    STORAGE_KEYS.fieldValues,
    STORAGE_KEYS.uploadPages,
    STORAGE_KEYS.caseId,
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.apiBaseUrl,
  ]);
  const fieldValues = s[STORAGE_KEYS.fieldValues] as Record<string, string> | undefined;
  if (!fieldValues || Object.keys(fieldValues).length === 0) return null;
  return {
    fieldValues,
    uploadPages: (s[STORAGE_KEYS.uploadPages] as LoadedPayload["uploadPages"]) ?? [],
    caseId: (s[STORAGE_KEYS.caseId] as string) ?? "",
    accessToken: (s[STORAGE_KEYS.accessToken] as string) ?? "",
    apiBaseUrl: (s[STORAGE_KEYS.apiBaseUrl] as string) ?? "http://localhost:8001/api/v1",
  };
}

async function handleUploadPage(page: FormPage, payload: LoadedPayload): Promise<void> {
  const descriptor = descriptorForPath(page.slug, payload.uploadPages);
  if (!descriptor) {
    dbg(`upload: no descriptor for ${page.slug}, skipping`);
    return;
  }
  const result = await fillUploadPage(descriptor, {
    apiBaseUrl: payload.apiBaseUrl,
    accessToken: payload.accessToken,
    caseId: payload.caseId,
  });
  setStatus(`Upload ${page.slug}: ${result.attached} attached`);
  for (const w of result.warnings) dbg(`upload: ${w}`);
}

// ── Toolbar UI ──────────────────────────────────────────────────────────────

let statusEl: HTMLElement | null = null;

function setStatus(msg: string): void {
  if (statusEl) statusEl.textContent = msg;
  dbg(msg);
}

function buildToolbar(): void {
  if (document.getElementById("mk-family-toolbar")) return;

  const bar = document.createElement("div");
  bar.id = "mk-family-toolbar";
  bar.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:2147483647;background:#0b3d91;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:8px 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);" +
    "display:flex;flex-direction:column;gap:6px;min-width:200px;";

  const title = document.createElement("div");
  title.textContent = "ParaLeagle I-130";
  title.style.cssText = "font-weight:600;";
  bar.appendChild(title);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:6px;";
  bar.appendChild(btnRow);

  const fillSection = button("Fill section", onFillSection);
  const fillAllBtn = button("Fill all", onFillAll);
  btnRow.appendChild(fillSection);
  btnRow.appendChild(fillAllBtn);

  statusEl = document.createElement("div");
  statusEl.style.cssText = "font-size:12px;opacity:.9;";
  statusEl.textContent = "Ready";
  bar.appendChild(statusEl);

  document.body.appendChild(bar);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText =
    "flex:1;cursor:pointer;border:0;border-radius:5px;padding:5px 8px;background:#fff;color:#0b3d91;font-weight:600;";
  b.addEventListener("click", onClick);
  return b;
}

async function onFillSection(): Promise<void> {
  const payload = await loadPayload();
  if (!payload) return setStatus("No data loaded — open the popup and load a case.");
  const page = detectCurrentPage();
  if (!page) return setStatus("Not on a recognized I-130 page.");
  if (page.kind === "upload") {
    await handleUploadPage(page, payload);
    return;
  }
  if (page.kind === "review") return setStatus("Review page — nothing to fill.");
  const res = await fillPage(page, payload.fieldValues);
  setStatus(`${page.title}: ${res.filled}/${res.total} filled`);
}

async function onFillAll(): Promise<void> {
  const payload = await loadPayload();
  if (!payload) return setStatus("No data loaded — open the popup and load a case.");
  setStatus("Filling all pages…");
  const summaries = await fillAll(payload.fieldValues, (page) => handleUploadPage(page, payload));
  const filled = summaries.reduce((n, s) => n + s.filled, 0);
  const total = summaries.reduce((n, s) => n + s.total, 0);
  setStatus(`Done — ${filled}/${total} fields across ${summaries.length} pages`);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function boot(): void {
  if (!onI130Form()) return;
  buildToolbar();
}

// myUSCIS is an SPA — re-check on route changes so the toolbar persists.
let lastPath = "";
function watchRoute(): void {
  const path = window.location.pathname;
  if (path !== lastPath) {
    lastPath = path;
    if (onI130Form()) buildToolbar();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
setInterval(watchRoute, 1000);
