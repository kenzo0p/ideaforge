"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  type Auth,
} from "firebase/auth";

// ---------------------------------------------------------------------------
// Firebase in the browser — used only to run the Google popup and obtain an ID
// token. The token is then posted to /api/auth/google, which verifies it and
// issues *our* session cookie. Firebase never becomes the session authority.
//
// These NEXT_PUBLIC_* values are meant to be public: they identify the project,
// they are not secrets. Access is controlled by Firebase Auth settings and by
// our own server-side verification.
// ---------------------------------------------------------------------------

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!config.apiKey || !config.projectId) {
    throw new Error("Firebase is not configured (NEXT_PUBLIC_FIREBASE_* missing).");
  }
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return app;
}

/**
 * Auth configured with **in-memory persistence only**.
 *
 * By default Firebase stores its session in IndexedDB, which fails with errors
 * like "Database is closing" in private windows, with storage blocked, or when
 * the popup steals focus and the browser tears the IDB connection down. We have
 * no use for that persistence — the ID token is exchanged for our own cookie
 * within milliseconds — so opting out removes a whole class of failure.
 *
 * `initializeAuth` (rather than `getAuth`) is what allows the persistence and
 * resolver to be chosen before anything touches storage.
 */
function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  try {
    auth = initializeAuth(firebaseApp, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Already initialised — happens on a dev HMR reload, where the module state
    // resets but the Firebase app instance survives. Reuse what's there.
    auth = getAuth(firebaseApp);
  }
  return auth;
}

/** Run the Google popup and return the Firebase ID token for our server. */
export async function signInWithGoogle(): Promise<string> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  // Always show the chooser: without this, a signed-in Google user is silently
  // reused, which is confusing on a shared machine.
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await signInWithPopup(auth, provider);
  const idToken = await credential.user.getIdToken();

  // Nothing to clean up with in-memory persistence, but drop the client-side
  // user anyway so a stray reference can't be mistaken for a session.
  await auth.signOut().catch(() => {});
  return idToken;
}
