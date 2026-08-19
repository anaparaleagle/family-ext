// ===========================================================================
// FIREBASE AUTH, PAIRED TO THE BACKEND YOU ARE TALKING TO.
//
// The backend does not accept "a Firebase token" — it accepts a token from ONE
// project, `settings.FIREBASE_PROJECT_ID`, and rejects the rest. Deployed family
// backends verify against `paraleagle-family`; the local docker backend defaults
// to `paraleagle-f3a7f`, because that is the project the family frontend's own
// .env.local uses and both have to agree for a dev login to work at all.
//
// This file used to hardcode `paraleagle-family`, so signing in against a local
// backend produced a valid Firebase login followed by a 401 on every request —
// surfaced in the popup as "Session expired", which sends you looking at the
// password. The only workarounds were to keep flipping FIREBASE_PROJECT_ID in
// the backend's .env, which breaks the frontend, or to skip the popup entirely.
//
// So the project is chosen by the API base URL instead. Pick the local backend
// and you authenticate against the project the local backend verifies against;
// pick production and you authenticate against production's.
//
// The API keys are not secrets. A Firebase web API key identifies the project
// and is shipped in the client bundle of every web app that uses one — the
// family frontend has both of these in its own committed .env.example. Access is
// decided by Firebase security rules and by our backend, not by hiding this.
// ===========================================================================

import { FirebaseApp, getApp, initializeApp } from "firebase/app";
// Must be the /web-extension entry point, never plain "firebase/auth". The plain
// build bundles loaders for apis.google.com/js/api.js and the two reCAPTCHA
// scripts (phone auth + OAuth popup flows we don't use), which Chrome Web Store
// review rejects as remotely-hosted code under MV3 — that is what got the H-1B
// extension rejected on 2026-08-13. Guarded by test/store-build.test.ts.
import { Auth, getAuth } from "firebase/auth/web-extension";

interface ProjectConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

/** Deployed family backends (staging, demo and production) verify against this. */
export const FAMILY_PROJECT: ProjectConfig = {
  apiKey: "AIzaSyBtKvG69941G6T7zep_7T2_RbiY4dD14uk",
  authDomain: "paraleagle-family.firebaseapp.com",
  projectId: "paraleagle-family",
};

/**
 * The local docker backend's default, and the family frontend's dev project.
 *
 * Kept in step with `docker-compose.dev.yml`, whose own comment says it plainly:
 * "Dev/test logins must verify against the SAME Firebase project the frontend
 * .env.local uses."
 */
export const DEV_PROJECT: ProjectConfig = {
  apiKey: "AIzaSyDbYyP1B8maFoTVdgnnoludMfl_vp1ff_4",
  authDomain: "paraleagle-f3a7f.firebaseapp.com",
  projectId: "paraleagle-f3a7f",
};

/**
 * Which Firebase project verifies tokens for this backend.
 *
 * Any localhost backend is a developer's docker stack, which defaults to the dev
 * project. Everything else is deployed and uses the family project. A URL we do
 * not recognise gets the family project: the deployed case is the one a real user
 * is in, and it is the safer default to be wrong about.
 */
export function projectForApi(apiBaseUrl: string | undefined): ProjectConfig {
  // The host must END at localhost, not merely start with it. A `\b` here also
  // matched "https://localhost.evil.example", which is a different host
  // entirely — so an attacker-controlled domain would have decided which
  // Firebase project we hand a login to. Port or path or end of string, nothing
  // else.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(apiBaseUrl ?? "")
    ? DEV_PROJECT
    : FAMILY_PROJECT;
}

/**
 * The Auth instance for one project, initialised at most once per project.
 *
 * Firebase allows several named apps in one page, which is what lets the popup
 * switch backends without a reload. Re-initialising the SAME name throws, hence
 * the getApp-first shape.
 */
function appFor(config: ProjectConfig): FirebaseApp {
  try {
    return getApp(config.projectId);
  } catch {
    return initializeApp(config, config.projectId);
  }
}

export function authFor(apiBaseUrl: string | undefined): Auth {
  return getAuth(appFor(projectForApi(apiBaseUrl)));
}
