import { FirebaseError, getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  initializeAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Ported verbatim from lib/firebase_options.dart (web target only).
const firebaseConfig = {
  apiKey: 'AIzaSyA91tLind0pZnfs3DgiWudZa0uZ5BTtV9c',
  authDomain: 'aarambh-20a47.firebaseapp.com',
  projectId: 'aarambh-20a47',
  storageBucket: 'aarambh-20a47.firebasestorage.app',
  messagingSenderId: '585314416132',
  appId: '1:585314416132:web:af0599ad7315b6baaca751',
  measurementId: 'G-9QX7QEEPBX',
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/// Auth 12.17's default IndexedDB persistence closes the DB on
/// `visibilitychange` (hidden tab, Google popup taking focus, password-manager
/// overlay). The write after sign-in then throws "Database is closing/hidden".
/// localStorage does not have that listener. The already-initialized catch is
/// for Vite HMR, which re-runs this module against an existing Auth instance.
function authForApp() {
  try {
    return initializeAuth(app, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (e) {
    if (e instanceof FirebaseError && e.code === 'auth/already-initialized') {
      return getAuth(app);
    }
    throw e;
  }
}

export const auth = authForApp();
export const db = getFirestore(app);
export const storage = getStorage(app);
