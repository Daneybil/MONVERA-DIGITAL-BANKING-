import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'monvera-digital-banking';
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

let rawApp: App | undefined;
let rawFirestore: Firestore | undefined;
let rawAuth: Auth | undefined;
let isConfigured = false;

try {
  if (getApps().length > 0) {
    rawApp = getApp();
    rawFirestore = getFirestore(rawApp);
    rawFirestore.settings({ ignoreUndefinedProperties: true });
    rawAuth = getAuth(rawApp);
    isConfigured = true;
  } else {
    // 1. Service account JSON via FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      try {
        const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Parsed credential is not an object.');
        }
        rawApp = initializeApp({
          credential: cert(parsed),
          projectId: parsed.project_id || FIREBASE_PROJECT_ID,
        });
        rawFirestore = getFirestore(rawApp);
        rawFirestore.settings({ ignoreUndefinedProperties: true });
        rawAuth = getAuth(rawApp);
        isConfigured = true;
        console.log(`[FirebaseAdmin] Successfully initialized for project "${parsed.project_id || FIREBASE_PROJECT_ID}" via service account JSON.`);
      } catch (parseErr) {
        console.error('[FirebaseAdmin] CRITICAL: Failed to parse or initialize with FIREBASE_SERVICE_ACCOUNT_KEY JSON. Check JSON syntax.');
        isConfigured = false;
        // In production, never fall back to ADC
      }
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      // 2. Service account individual fields via FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY
      try {
        const cleanPrivateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        rawApp = initializeApp({
          credential: cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: cleanPrivateKey,
          }),
          projectId: FIREBASE_PROJECT_ID,
        });
        rawFirestore = getFirestore(rawApp);
        rawFirestore.settings({ ignoreUndefinedProperties: true });
        rawAuth = getAuth(rawApp);
        isConfigured = true;
        console.log(`[FirebaseAdmin] Successfully initialized for project "${FIREBASE_PROJECT_ID}" via FIREBASE_CLIENT_EMAIL/KEY.`);
      } catch (keyErr) {
        console.error('[FirebaseAdmin] CRITICAL: Failed to initialize Firebase Admin with FIREBASE_CLIENT_EMAIL/KEY.');
        isConfigured = false;
      }
    } else if (isProduction) {
      // In production (Railway / Vercel), do NOT fall back to ADC
      console.error(`[FirebaseAdmin] CRITICAL CONFIGURATION ERROR: No Firebase Admin credentials found in production environment.`);
      console.error(`[FirebaseAdmin] Railway must be configured with FIREBASE_SERVICE_ACCOUNT_KEY (complete service account JSON string) or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.`);
      isConfigured = false;
    } else {
      // 3. Ambient Google Application Default Credentials (AI Studio preview / GCP Cloud Run environment only)
      try {
        rawApp = initializeApp({
          projectId: FIREBASE_PROJECT_ID,
        });
        rawFirestore = getFirestore(rawApp);
        rawFirestore.settings({ ignoreUndefinedProperties: true });
        rawAuth = getAuth(rawApp);
        isConfigured = true;
        console.log(`[FirebaseAdmin] Initialized for development project "${FIREBASE_PROJECT_ID}" via Application Default Credentials.`);
      } catch (adcErr) {
        console.warn('[FirebaseAdmin] Application Default Credentials unavailable:', adcErr);
        isConfigured = false;
      }
    }
  }
} catch (err) {
  console.error('[FirebaseAdmin] Initialization error:', err);
  isConfigured = false;
}

export function isFirebaseAdminConfigured(): boolean {
  return isConfigured && !!rawFirestore && !!rawAuth;
}

export const adminFirestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    if (!rawFirestore) {
      throw new Error('[FirebaseAdmin] Firestore is unavailable: Firebase Admin SDK is not configured with valid service account credentials.');
    }
    const val = (rawFirestore as any)[prop];
    return typeof val === 'function' ? val.bind(rawFirestore) : val;
  },
});

export const adminAuth = new Proxy({} as Auth, {
  get(_target, prop) {
    if (!rawAuth) {
      throw new Error('[FirebaseAdmin] Firebase Auth is unavailable: Firebase Admin SDK is not configured with valid service account credentials.');
    }
    const val = (rawAuth as any)[prop];
    return typeof val === 'function' ? val.bind(rawAuth) : val;
  },
});

export const adminApp = new Proxy({} as App, {
  get(_target, prop) {
    if (!rawApp) {
      throw new Error('[FirebaseAdmin] Firebase App is unavailable: Firebase Admin SDK is not configured with valid service account credentials.');
    }
    const val = (rawApp as any)[prop];
    return typeof val === 'function' ? val.bind(rawApp) : val;
  },
});

