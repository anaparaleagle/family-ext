// ===========================================================================
// HARVESTED from paraleagle-ext src/lib/firebase.ts (origin/main).
// Firebase project paraleagle-family — the same project the family backend
// authenticates against, so one login token works here too.
// ===========================================================================

import { initializeApp } from "firebase/app";
// Must be the /web-extension entry point, never plain "firebase/auth". The plain
// build bundles loaders for apis.google.com/js/api.js and the two reCAPTCHA
// scripts (phone auth + OAuth popup flows we don't use), which Chrome Web Store
// review rejects as remotely-hosted code under MV3 — that is what got the H-1B
// extension rejected on 2026-08-13. Guarded by test/store-build.test.ts.
import { getAuth } from "firebase/auth/web-extension";

const firebaseConfig = {
  apiKey: "AIzaSyBtKvG69941G6T7zep_7T2_RbiY4dD14uk",
  authDomain: "paraleagle-family.firebaseapp.com",
  projectId: "paraleagle-family",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
