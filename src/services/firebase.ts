import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

// Web app's Firebase configuration provided for Monvera Digital Banking
export const firebaseConfig = {
  apiKey: "AIzaSyDpD41fq8guo0gLojjkawsjMnBbFfy42VU",
  authDomain: "monvera-digital-banking.firebaseapp.com",
  projectId: "monvera-digital-banking",
  storageBucket: "monvera-digital-banking.firebasestorage.app",
  messagingSenderId: "1097022690812",
  appId: "1:1097022690812:web:c7848faac29d4226c84e79",
  measurementId: "G-WXMCH5PMDT"
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }

  auth = getAuth(app);
  db = getFirestore(app);

  if (typeof window !== 'undefined') {
    isSupported().then((supported) => {
      if (supported) {
        try {
          getAnalytics(app);
        } catch {
          // Analytics initialized where available
        }
      }
    });
  }
} catch (error) {
  console.error('[Firebase Init Error]', error);
}

export { app, auth, db };
