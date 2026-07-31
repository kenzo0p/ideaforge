"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup } from "firebase/auth";

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

function getFirebaseApp(): FirebaseApp {
  if (!config.apiKey || !config.projectId) {
    throw new Error("Firebase is not configured (NEXT_PUBLIC_FIREBASE_* missing).");
  }
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return app;
}

/** Run the Google popup and return the Firebase ID token for our server. */
export async function signInWithGoogle(): Promise<string> {
  const auth = getAuth(getFirebaseApp());
  const provider = new GoogleAuthProvider();
  // Always show the chooser: without this, a signed-in Google user is silently
  // reused, which is confusing on a shared machine.
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await signInWithPopup(auth, provider);
  const idToken = await credential.user.getIdToken();

  // Our cookie is the session from here on; Firebase's own client session is
  // just a means to get the token, so drop it.
  await auth.signOut().catch(() => {});
  return idToken;
}
