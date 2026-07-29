import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests the service worker (engine/download-proxy) — the ONLY place in the
 * extension privileged to fetch cross-origin. Two things it must get right:
 *
 *  1. It answers API_GET, so content scripts never fetch the family API
 *     directly (MV3 subjects a content script to the page's CORS; that refusal
 *     is what silently broke doc upload).
 *  2. It attaches the firm's Firebase bearer token to the family API and to
 *     NOTHING ELSE. Prod file_urls are presigned S3 URLs — already
 *     self-authenticating — so signing our token into a bucket request would
 *     leak a firm credential to storage for no benefit.
 */

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void,
) => boolean | undefined;

let listener!: Listener;
let isApiUrl!: (url: string) => boolean;
let isMediaUrl!: (url: string) => boolean;

beforeAll(async () => {
  const addListener = vi.fn((fn: Listener) => {
    listener = fn;
  });
  (globalThis as any).chrome = { runtime: { onMessage: { addListener } } };
  const mod = await import("../src/engine/download-proxy");
  isApiUrl = mod.isApiUrl;
  isMediaUrl = mod.isMediaUrl;
  expect(listener).toBeTypeOf("function");
});

describe("download-proxy: origin classification", () => {
  it("recognizes the family API origins and nothing else", () => {
    expect(isApiUrl("https://family-api.paraleagle.io/api/v1/documents/")).toBe(true);
    expect(isApiUrl("http://localhost:8001/api/v1/documents/")).toBe(true);
    // The retired host must NOT be treated as ours.
    expect(isApiUrl("https://api.family.paraleagle.ai/api/v1/documents/")).toBe(false);
    expect(isApiUrl("https://family-api.paraleagle.io.evil.example/")).toBe(false);
  });

  it("recognizes S3 media hosts without matching lookalikes", () => {
    expect(isMediaUrl("https://bucket.s3.amazonaws.com/k.pdf")).toBe(true);
    expect(isMediaUrl("https://bucket.s3.us-east-1.amazonaws.com/k.pdf")).toBe(true);
    expect(isMediaUrl("https://s3.amazonaws.com/bucket/k.pdf")).toBe(true);
    expect(isMediaUrl("https://s3.amazonaws.com.evil.example/k.pdf")).toBe(false);
    expect(isMediaUrl("http://bucket.s3.amazonaws.com/k.pdf")).toBe(false); // http, not https
  });
});

/** Send a message to the worker and await whatever it responds. */
function send(message: unknown): Promise<any> {
  return new Promise((resolve) => {
    const kept = listener(message, {}, resolve);
    // Every handled type must keep the channel open for the async response.
    if (kept !== true) resolve({ success: false, error: "listener did not handle message" });
  });
}

let fetchMock: any;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/pdf" },
    json: async () => ({ results: [] }),
    blob: async () => ({
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** The headers the worker passed on its Nth fetch. */
function headersOfCall(n = 0): Record<string, string> {
  return (fetchMock.mock.calls[n]?.[1] as any)?.headers ?? {};
}

describe("download-proxy: API_GET", () => {
  it("GETs the API path with the bearer token and returns the parsed body", async () => {
    const res = await send({
      type: "API_GET",
      apiBaseUrl: "https://family-api.paraleagle.io/api/v1",
      path: "/documents/?case=abc",
      accessToken: "tok",
    });
    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://family-api.paraleagle.io/api/v1/documents/?case=abc",
    );
    expect(headersOfCall().Authorization).toBe("Bearer tok");
  });

  it("refuses an API base outside the allowlist", async () => {
    const res = await send({
      type: "API_GET",
      apiBaseUrl: "https://evil.example/api/v1",
      path: "/documents/",
      accessToken: "tok",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a path that would escape onto another host", async () => {
    for (const path of ["//evil.example/steal", "/https://evil.example"]) {
      const res = await send({
        type: "API_GET",
        apiBaseUrl: "https://family-api.paraleagle.io/api/v1",
        path,
        accessToken: "tok",
      });
      expect(res.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("reports a non-2xx as a failure carrying the status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ detail: "no" }),
    } as any);
    const res = await send({
      type: "API_GET",
      apiBaseUrl: "https://family-api.paraleagle.io/api/v1",
      path: "/documents/",
      accessToken: "tok",
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe(401);
  });

  it("resolves a failure (never rejects) when the fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    const res = await send({
      type: "API_GET",
      apiBaseUrl: "https://family-api.paraleagle.io/api/v1",
      path: "/documents/",
      accessToken: "tok",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/failed to fetch/i);
  });
});

describe("download-proxy: DOWNLOAD_FILE", () => {
  it("sends the bearer token to the family API", async () => {
    const res = await send({
      type: "DOWNLOAD_FILE",
      url: "https://family-api.paraleagle.io/media/x.pdf",
      accessToken: "tok",
    });
    expect(res.success).toBe(true);
    expect(headersOfCall().Authorization).toBe("Bearer tok");
  });

  it("allows presigned S3 media but does NOT send the bearer token", async () => {
    const res = await send({
      type: "DOWNLOAD_FILE",
      url: "https://paraleagle-family.s3.amazonaws.com/docs/x.pdf?X-Amz-Signature=abc",
      accessToken: "tok",
    });
    expect(res.success).toBe(true);
    expect(headersOfCall().Authorization).toBeUndefined();
  });

  it("allows region-scoped and path-style S3 hosts", async () => {
    for (const url of [
      "https://bucket.s3.us-east-1.amazonaws.com/x.pdf?X-Amz-Signature=a",
      "https://s3.us-east-1.amazonaws.com/bucket/x.pdf?X-Amz-Signature=a",
      "https://s3.amazonaws.com/bucket/x.pdf?X-Amz-Signature=a",
    ]) {
      const res = await send({ type: "DOWNLOAD_FILE", url, accessToken: "tok" });
      expect(res.success, url).toBe(true);
    }
  });

  it("blocks an unknown origin and names it so the gap is obvious", async () => {
    const res = await send({
      type: "DOWNLOAD_FILE",
      url: "https://cdn.evil.example/x.pdf",
      accessToken: "tok",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/allowlist/i);
    expect(res.error).toMatch(/cdn\.evil\.example/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat an amazonaws-lookalike host as S3", async () => {
    const res = await send({
      type: "DOWNLOAD_FILE",
      url: "https://s3.amazonaws.com.evil.example/x.pdf",
      accessToken: "tok",
    });
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
