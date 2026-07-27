import { describe, it, expect } from "vitest";
import {
  DEFAULT_API_URL,
  PROD_API_URL,
  LEGACY_PROD_API_URL,
  ALLOWED_API_ORIGINS,
  migrateApiBaseUrl,
} from "../src/popup/api-config";

describe("migrateApiBaseUrl", () => {
  it("rewrites the retired prod host to the live one", () => {
    expect(migrateApiBaseUrl(LEGACY_PROD_API_URL)).toBe(PROD_API_URL);
  });

  it("leaves the live prod host unchanged", () => {
    expect(migrateApiBaseUrl(PROD_API_URL)).toBe(PROD_API_URL);
  });

  it("leaves a localhost value unchanged", () => {
    expect(migrateApiBaseUrl(DEFAULT_API_URL)).toBe(DEFAULT_API_URL);
  });

  it("falls back to the default when the stored value is undefined", () => {
    expect(migrateApiBaseUrl(undefined)).toBe(DEFAULT_API_URL);
  });

  it("falls back to the default when the stored value is empty", () => {
    expect(migrateApiBaseUrl("")).toBe(DEFAULT_API_URL);
  });
});

describe("ALLOWED_API_ORIGINS", () => {
  it("no longer contains the retired host", () => {
    expect(ALLOWED_API_ORIGINS.some((o) => o.includes("api.family.paraleagle.ai"))).toBe(false);
  });
});
