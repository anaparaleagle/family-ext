// Which Firebase project the popup signs into.
//
// The bug this prevents has no error message worth reading: the backend accepts
// tokens from exactly ONE project, so signing into the wrong one produces a
// perfectly successful Firebase login followed by a 401 on every request. The
// popup renders that as "Session expired", which sends you looking at the
// password. Pairing the project to the selected backend is the fix; these tests
// are what stop the pairing drifting back.

import { describe, it, expect } from "vitest";
import {
  DEV_PROJECT,
  FAMILY_PROJECT,
  projectForApi,
} from "../src/engine/firebase";
import { ALLOWED_API_ORIGINS, DEFAULT_API_URL, PROD_API_URL } from "../src/engine/api-config";

describe("pairing the Firebase project to the backend", () => {
  it("uses the dev project for the local backend", () => {
    // docker-compose.dev.yml defaults FIREBASE_PROJECT_ID to paraleagle-f3a7f,
    // and its own comment says dev logins must match the frontend's .env.local.
    expect(projectForApi(DEFAULT_API_URL).projectId).toBe("paraleagle-f3a7f");
    expect(projectForApi("http://localhost:8001/api/v1")).toEqual(DEV_PROJECT);
    expect(projectForApi("http://127.0.0.1:8001/api/v1")).toEqual(DEV_PROJECT);
  });

  it("uses the family project for the deployed backend", () => {
    expect(projectForApi(PROD_API_URL).projectId).toBe("paraleagle-family");
  });

  it("defaults an unknown host to the family project", () => {
    // Being wrong about a deployed backend is the case a real user is in, so
    // that is the safer way to be wrong.
    expect(projectForApi(undefined)).toEqual(FAMILY_PROJECT);
    expect(projectForApi("https://something-new.paraleagle.io/api/v1")).toEqual(FAMILY_PROJECT);
  });

  it("does not treat a host merely CONTAINING localhost as local", () => {
    // "https://localhost.evil.example" must not select the dev project.
    expect(projectForApi("https://localhost.evil.example/api/v1")).toEqual(FAMILY_PROJECT);
    expect(projectForApi("https://my-localhost-proxy.io/api/v1")).toEqual(FAMILY_PROJECT);
  });

  it("covers every backend the popup can actually select", () => {
    // A new allowed origin added without a project decision would silently take
    // the family default and 401 on every request against a dev stack.
    for (const origin of ALLOWED_API_ORIGINS) {
      expect(projectForApi(`${origin}/api/v1`).projectId).toMatch(
        /^paraleagle-(family|f3a7f)$/,
      );
    }
  });

  it("keeps the two projects distinct", () => {
    expect(DEV_PROJECT.projectId).not.toBe(FAMILY_PROJECT.projectId);
    expect(DEV_PROJECT.apiKey).not.toBe(FAMILY_PROJECT.apiKey);
    // authDomain must belong to its own project, or the sign-in popup goes to
    // the wrong tenant and the token is issued by the wrong one.
    expect(DEV_PROJECT.authDomain).toContain(DEV_PROJECT.projectId);
    expect(FAMILY_PROJECT.authDomain).toContain(FAMILY_PROJECT.projectId);
  });
});
