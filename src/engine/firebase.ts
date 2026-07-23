// ===========================================================================
// HARVESTED from paraleagle-ext src/lib/firebase.ts (origin/main).
// Firebase project paraleagle-family — the same project the family backend
// authenticates against, so one login token works here too.
// ===========================================================================

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBtKvG69941G6T7zep_7T2_RbiY4dD14uk",
  authDomain: "paraleagle-family.firebaseapp.com",
  projectId: "paraleagle-family",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
