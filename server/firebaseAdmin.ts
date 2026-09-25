import { initializeApp, getApps, getApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'monvera-digital-banking';

let adminApp: App;
let adminFirestore: Firestore;
let adminAuth: Auth;

try {
  if (getApps().length > 0) {
    adminApp = getApp();
  } else {
    // Uses Google Application Default Credentials (ADC) from runtime environment
    adminApp = initializeApp({
      projectId: FIREBASE_PROJECT_ID,
    });
  }

  adminFirestore = getFirestore(adminApp);
  adminFirestore.settings({ ignoreUndefinedProperties: true });
  adminAuth = getAuth(adminApp);

  console.log(`[FirebaseAdmin] Initialized for project "${FIREBASE_PROJECT_ID}" via Application Default Credentials.`);
} catch (err) {
  console.error('[FirebaseAdmin] Failed to initialize Firebase Admin SDK:', err);
  throw err;
}

export { adminApp, adminFirestore, adminAuth };
