// What the Chrome Web Store build is allowed to reach, and what the popup is
// therefore allowed to offer.
//
// The bug this guards: the checked-in manifest asked for `http://localhost:8001/*`
// and the popup's env dropdown DEFAULTED to it. That is right on a laptop and
// wrong in a published build — a paralegal who installs from the store opens the
// popup, it points at a backend on their own machine, and nothing loads until
// they find the dropdown. It also makes a reviewer ask why a published extension
// wants access to localhost.
//
// The fix keeps ONE source of truth: the manifest the build is running under.
// The checked-in manifest is the STORE manifest (no localhost); `npm run watch`
// adds `http://localhost/*` back for dev (see esbuild.config.mjs — a match
// pattern has no port, so that one entry covers :8001). The popup then derives
// its dropdown, its default and its allowlist from `host_permissions` at runtime,
// so the two can never disagree: a build that cannot reach localhost cannot offer
// it either.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import * as esbuild from "esbuild";
import {
  DEFAULT_API_URL,
  STAGING_API_URL,
  PROD_API_URL,
  LEGACY_PROD_API_URL,
  DEV_ONLY_OPTIONS,
  apiEnvOptions,
  resolveApiBaseUrl,
  allowedApiOrigins,
} from "../src/engine/api-config";

const REPO = resolve(__dirname, "..");
const MANIFEST = join(REPO, "manifest.json");

function manifestHostPermissions(): string[] {
  return JSON.parse(readFileSync(MANIFEST, "utf-8")).host_permissions as string[];
}

function manifestPermissions(): string[] {
  return (JSON.parse(readFileSync(MANIFEST, "utf-8")).permissions as string[]) ?? [];
}

/** The origins `npm run watch` adds, read from the build script, not restated. */
function watchHostPermissions(): string[] {
  const src = readFileSync(join(REPO, "esbuild.config.mjs"), "utf-8");
  const block = src.match(/const DEV_HOST_PERMISSIONS = \[([^\]]*)\]/);
  return [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** What `npm run watch` produces: the store manifest plus the dev origins. */
const DEV_HOST_PERMISSIONS = [...manifestHostPermissions(), ...watchHostPermissions()];

describe("the checked-in manifest is the store manifest", () => {
  it("asks for no localhost origin", () => {
    const localhost = manifestHostPermissions().filter((p) => p.includes("localhost"));
    expect(localhost).toEqual([]);
  });

  it("asks for no staging origin", () => {
    const staging = manifestHostPermissions().filter((p) =>
      p.includes(new URL(STAGING_API_URL).hostname),
    );
    expect(staging).toEqual([]);
  });

  it("is widened by the watch build for every dev-only option", () => {
    for (const option of DEV_ONLY_OPTIONS) {
      const host = new URL(option.url).hostname;
      expect(
        watchHostPermissions().some((p) => p.includes(`://${host}`)),
        `esbuild.config.mjs never grants "${host}", so "${option.label}" is unreachable in dev`,
      ).toBe(true);
    }
  });

  it("still asks for the two origins the extension cannot work without", () => {
    const perms = manifestHostPermissions();
    expect(perms).toContain("https://my.uscis.gov/*");
    expect(perms).toContain("https://family-api.paraleagle.io/*");
  });

  it("still asks for S3, which is where document downloads come from", () => {
    expect(manifestHostPermissions().some((p) => p.includes("s3"))).toBe(true);
  });
});

describe("apiEnvOptions", () => {
  it("offers Production only, in a build that cannot reach localhost", () => {
    expect(apiEnvOptions(manifestHostPermissions()).map((o) => o.url)).toEqual([PROD_API_URL]);
  });

  it("offers Local and Staging as well, in a build that can reach them", () => {
    expect(apiEnvOptions(DEV_HOST_PERMISSIONS).map((o) => o.url)).toEqual([
      DEFAULT_API_URL,
      STAGING_API_URL,
      PROD_API_URL,
    ]);
  });

  it("offers Staging only where the permission is present", () => {
    const localOnly = manifestHostPermissions().concat("http://localhost/*");
    expect(apiEnvOptions(localOnly).map((o) => o.url)).toEqual([DEFAULT_API_URL, PROD_API_URL]);
  });

  it("labels every option, so the dropdown is readable", () => {
    for (const option of apiEnvOptions(DEV_HOST_PERMISSIONS)) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("resolveApiBaseUrl", () => {
  it("defaults a store build to Production, not to a laptop", () => {
    expect(resolveApiBaseUrl(undefined, manifestHostPermissions())).toBe(PROD_API_URL);
  });

  it("still defaults a dev build to Local", () => {
    expect(resolveApiBaseUrl(undefined, DEV_HOST_PERMISSIONS)).toBe(DEFAULT_API_URL);
  });

  // Storage survives an update. Someone who ran a localhost build, then took an
  // update that dropped the permission, must not be left pointing at a host the
  // build can no longer fetch — that fails as an opaque connection error.
  it("heals a stored localhost value in a build that can no longer reach it", () => {
    expect(resolveApiBaseUrl(DEFAULT_API_URL, manifestHostPermissions())).toBe(PROD_API_URL);
  });

  it("keeps a stored localhost value in a build that can reach it", () => {
    expect(resolveApiBaseUrl(DEFAULT_API_URL, DEV_HOST_PERMISSIONS)).toBe(DEFAULT_API_URL);
  });

  it("heals a stored staging value in a build that cannot reach it", () => {
    expect(resolveApiBaseUrl(STAGING_API_URL, manifestHostPermissions())).toBe(PROD_API_URL);
  });

  it("keeps a stored staging value in a build that can reach it", () => {
    expect(resolveApiBaseUrl(STAGING_API_URL, DEV_HOST_PERMISSIONS)).toBe(STAGING_API_URL);
  });

  it("still migrates the retired prod host, in either build", () => {
    expect(resolveApiBaseUrl(LEGACY_PROD_API_URL, manifestHostPermissions())).toBe(PROD_API_URL);
    expect(resolveApiBaseUrl(LEGACY_PROD_API_URL, DEV_HOST_PERMISSIONS)).toBe(PROD_API_URL);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The two things that got the H-1B extension (paraleagle-ext) rejected on
// 2026-08-13, routing FZSL. Both apply here unchanged, so both are guarded
// here before this extension is ever submitted.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every entry point the build ships, read from the build script rather than
 * restated — a fifth entry (the FLAG content script) arrived and this list did
 * not, so the bundle that got added to the package was the one bundle nobody
 * scanned. Derived, it cannot drift again.
 */
function bundleEntries(): string[] {
  const src = readFileSync(join(REPO, "esbuild.config.mjs"), "utf-8");
  const block = src.match(/const entries = \[([\s\S]*?)\];/);
  return [...(block?.[1] ?? "").matchAll(/\bin:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const BUNDLE_ENTRIES = bundleEntries();

async function bundle(entry: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entry],
    absWorkingDir: REPO,
    bundle: true,
    write: false,
    minify: true,
    target: "chrome120",
    format: "iife",
    drop: ["console"],
  });
  return result.outputFiles.map((f) => f.text).join("\n");
}

// Violation "Blue Argon": including remotely-hosted code in a Manifest V3 item.
//
// What made this bite on the H-1B extension is that the URLs were not in our
// source at all — the plain `firebase/auth` entry point bundles script loaders
// for apis.google.com and the two reCAPTCHA scripts, serving phone auth and
// OAuth popup flows neither extension calls. Grepping src/ would have found
// nothing. So this asserts against the BUILT bundle, which is what a reviewer
// actually scans. The fix is to import from `firebase/auth/web-extension`.
describe("no remotely-hosted code in any bundle (MV3)", () => {
  const REMOTE_JS = /https?:\/\/[^\s"'`<>]+?\.js(?:\?[^\s"'`<>]*)?/g;

  for (const entry of BUNDLE_ENTRIES) {
    it(`${entry} pulls in no remote script URL`, async () => {
      const code = await bundle(entry);
      expect([...new Set(code.match(REMOTE_JS) ?? [])]).toEqual([]);
    }, 60_000);
  }
});

// Violation "Purple Potassium": requesting but not using a permission.
//
// activeTab grants nothing by itself — it only widens what the tabs and
// scripting APIs may reach — so declaring it without calling either is exactly
// what the store flags.
describe("every declared permission is actually used", () => {
  const PERMISSION_APIS: Record<string, string[]> = {
    storage: ["chrome.storage"],
    activeTab: ["chrome.tabs", "chrome.scripting"],
    tabs: ["chrome.tabs"],
    scripting: ["chrome.scripting"],
    downloads: ["chrome.downloads"],
    cookies: ["chrome.cookies"],
    alarms: ["chrome.alarms"],
    notifications: ["chrome.notifications"],
    offscreen: ["chrome.offscreen"],
    unlimitedStorage: ["chrome.storage"],
  };

  function sourceText(): string {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) out.push(readFileSync(p, "utf-8"));
      }
    };
    walk(join(REPO, "src"));
    return out.join("\n");
  }

  const src = sourceText();

  for (const perm of manifestPermissions()) {
    it(`"${perm}" has a matching chrome.* call`, () => {
      const apis = PERMISSION_APIS[perm];
      expect(apis, `no usage rule for permission "${perm}" — add one`).toBeDefined();
      expect(
        apis.some((api) => src.includes(api)),
        `manifest declares "${perm}" but nothing in src/ calls ${apis.join(" or ")}`,
      ).toBe(true);
    });
  }
});

describe("allowedApiOrigins", () => {
  it("does not allow localhost in a store build", () => {
    expect(allowedApiOrigins(manifestHostPermissions())).toEqual(["https://family-api.paraleagle.io"]);
  });

  it("does not allow staging in a store build", () => {
    expect(allowedApiOrigins(manifestHostPermissions())).not.toContain(
      new URL(STAGING_API_URL).origin,
    );
  });

  it("allows localhost and staging in a dev build", () => {
    expect(allowedApiOrigins(DEV_HOST_PERMISSIONS)).toContain("http://localhost:8001");
    expect(allowedApiOrigins(DEV_HOST_PERMISSIONS)).toContain(new URL(STAGING_API_URL).origin);
  });

  it("never allows the retired host", () => {
    for (const perms of [manifestHostPermissions(), DEV_HOST_PERMISSIONS]) {
      expect(allowedApiOrigins(perms).some((o) => o.includes("api.family.paraleagle.ai"))).toBe(
        false,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The listing document is what gets pasted into the dashboard, by hand, months
// after anyone read the manifest. It drifted: it still justified `activeTab`
// after the permission was removed to clear "Purple Potassium", and it still
// named the v0.8.1 zip after that package was declared dead. Both are the kind
// of mistake a reviewer sees and we do not.
// ─────────────────────────────────────────────────────────────────────────

const LISTING = join(REPO, "store-assets", "LISTING.md");

function listing(): string {
  return readFileSync(LISTING, "utf-8");
}

function manifestField(name: string): string {
  return JSON.parse(readFileSync(MANIFEST, "utf-8"))[name] as string;
}

/** The block the dashboard's per-permission justification boxes are filled from. */
function justificationBlock(): string {
  return listing().split("**Permission justifications**")[1]?.split("**Remote code**")[0] ?? "";
}

/** What the listing offers a justification for, as opposed to what we declare. */
function justifiedPermissions(): string[] {
  return [...justificationBlock().matchAll(/^`([A-Za-z]+)`$/gm)].map((m) => m[1]);
}

/**
 * Everything a reviewer pastes verbatim: title, summary, description, purpose.
 * Whitespace is collapsed because the markdown wraps these blocks, and a phrase
 * broken across two lines is still the phrase.
 */
function reviewerFacingText(): string {
  const l = listing();
  return l
    .slice(l.indexOf("## 2. Store listing tab"), l.indexOf("**Permission justifications**"))
    .replace(/\s+/g, " ");
}

describe("the listing document matches what we ship", () => {
  it("justifies exactly the permissions the manifest declares", () => {
    expect(justifiedPermissions().sort()).toEqual([...manifestPermissions()].sort());
  });

  it("justifies every host permission the manifest declares", () => {
    const block = justificationBlock();
    for (const host of manifestHostPermissions()) {
      expect(block, `no justification for host permission "${host}"`).toContain(host);
    }
  });

  it("names the package to upload at the version the manifest carries", () => {
    expect(listing()).toContain(`paraleagle-family-ext-v${manifestField("version")}-webstore.zip`);
  });

  it("uses the manifest name as the listing title", () => {
    const title = listing().split("**Title**")[1]?.split("**Summary**")[0]?.trim();
    expect(title).toBe(manifestField("name"));
  });
});

// Store policy forbids implying affiliation with another product, and myUSCIS is
// USCIS's own product name. Naming the site we fill is fine and necessary, so
// the hostname `my.uscis.gov` passes this and the brand token does not.
describe("no government product brand in what a reviewer reads", () => {
  const BRAND = /myuscis/i;

  it("is absent from the item name", () => {
    expect(manifestField("name")).not.toMatch(BRAND);
  });

  it("is absent from the item description", () => {
    expect(manifestField("description")).not.toMatch(BRAND);
  });

  it("is absent from the listing text pasted into the dashboard", () => {
    expect(reviewerFacingText()).not.toMatch(BRAND);
  });

  it("still says we are not affiliated with USCIS", () => {
    expect(reviewerFacingText()).toContain("not affiliated with, or endorsed by");
  });
});

// "package.json, which is kept in step by hand" — it was not.
//
// The lock file is deliberately NOT asserted here, even though it had sat at
// 0.8.0 through two version bumps. `npm install` rewrites its `version` from
// package.json before any test runs, so the assertion was GREEN in CI on the
// commit where the committed lock said 0.8.0 — a guard that cannot go red.
// Bump the lock by hand along with the other two; nothing can check it for you.
describe("one version number, everywhere", () => {
  it("is the same in the manifest and package.json", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf-8"));
    expect(pkg.version).toBe(manifestField("version"));
  });
});
