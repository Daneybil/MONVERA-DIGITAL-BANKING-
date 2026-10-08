import { initializeApp, getApps, getApp, App, cert } from 'firebase-admin/app';
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
    // 1. Service account JSON via FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      try {
        const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        adminApp = initializeApp({
          credential: cert(parsed),
          projectId: parsed.project_id || FIREBASE_PROJECT_ID,
        });
        console.log(`[FirebaseAdmin] Initialized for project "${FIREBASE_PROJECT_ID}" via service account JSON.`);
      } catch (parseErr) {
        console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', parseErr);
        adminApp = initializeApp({ projectId: FIREBASE_PROJECT_ID });
      }
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      // 2. Service account individual fields via FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY
      adminApp = initializeApp({
        credential: cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
        projectId: FIREBASE_PROJECT_ID,
      });
      console.log(`[FirebaseAdmin] Initialized for project "${FIREBASE_PROJECT_ID}" via FIREBASE_CLIENT_EMAIL/KEY.`);
    } else {
      // 3. Ambient Google Application Default Credentials (Cloud Run / AI Studio preview environment)
      adminApp = initializeApp({
        projectId: FIREBASE_PROJECT_ID,
      });
      console.log(`[FirebaseAdmin] Initialized for project "${FIREBASE_PROJECT_ID}" via Application Default Credentials.`);
    }
  }

  adminFirestore = getFirestore(adminApp);
  adminFirestore.settings({ ignoreUndefinedProperties: true });
  adminAuth = getAuth(adminApp);
} catch (err) {
  console.error('[FirebaseAdmin] Failed to initialize Firebase Admin SDK:', err);
  throw err;
}

export { adminApp, adminFirestore, adminAuth };
