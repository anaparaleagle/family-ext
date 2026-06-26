// ===========================================================================
// HARVESTED from paraleagle-ext src/lib/firebase.ts (origin/main).
// Shared Firebase project paraleagle-f3a7f — the same project the family
// backend authenticates against, so one login token works here too.
// ===========================================================================

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDbYyP1B8maFoTVdgnnoludMfl_vp1ff_4",
  authDomain: "paraleagle-f3a7f.firebaseapp.com",
  projectId: "paraleagle-f3a7f",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
