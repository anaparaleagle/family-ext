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
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  DEFAULT_API_URL,
  PROD_API_URL,
  LEGACY_PROD_API_URL,
  apiEnvOptions,
  resolveApiBaseUrl,
  allowedApiOrigins,
} from "../src/popup/api-config";

const MANIFEST = resolve(__dirname, "../manifest.json");

function manifestHostPermissions(): string[] {
  return JSON.parse(readFileSync(MANIFEST, "utf-8")).host_permissions as string[];
}

/** What `npm run watch` produces: the store manifest plus the dev origin. */
const DEV_HOST_PERMISSIONS = [...manifestHostPermissions(), "http://localhost/*"];

describe("the checked-in manifest is the store manifest", () => {
  it("asks for no localhost origin", () => {
    const localhost = manifestHostPermissions().filter((p) => p.includes("localhost"));
    expect(localhost).toEqual([]);
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

  it("offers Local as well, in a build that can", () => {
    expect(apiEnvOptions(DEV_HOST_PERMISSIONS).map((o) => o.url)).toEqual([
      DEFAULT_API_URL,
      PROD_API_URL,
    ]);
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

  it("still migrates the retired prod host, in either build", () => {
    expect(resolveApiBaseUrl(LEGACY_PROD_API_URL, manifestHostPermissions())).toBe(PROD_API_URL);
    expect(resolveApiBaseUrl(LEGACY_PROD_API_URL, DEV_HOST_PERMISSIONS)).toBe(PROD_API_URL);
  });
});

describe("allowedApiOrigins", () => {
  it("does not allow localhost in a store build", () => {
    expect(allowedApiOrigins(manifestHostPermissions())).toEqual(["https://family-api.paraleagle.io"]);
  });

  it("allows localhost in a dev build", () => {
    expect(allowedApiOrigins(DEV_HOST_PERMISSIONS)).toContain("http://localhost:8001");
  });

  it("never allows the retired host", () => {
    for (const perms of [manifestHostPermissions(), DEV_HOST_PERMISSIONS]) {
      expect(allowedApiOrigins(perms).some((o) => o.includes("api.family.paraleagle.ai"))).toBe(
        false,
      );
    }
  });
});
