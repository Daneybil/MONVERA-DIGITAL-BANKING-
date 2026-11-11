import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

const EXPECTED_FIREBASE_PROJECT_ID = 'monvera-digital-banking';
const ENV_FIREBASE_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || '').trim();
const FIREBASE_PROJECT_ID = ENV_FIREBASE_PROJECT_ID || EXPECTED_FIREBASE_PROJECT_ID;
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

let rawApp: App | undefined;
let rawFirestore: Firestore | undefined;
let rawAuth: Auth | undefined;
let isConfigured = false;
let resolvedProjectId = FIREBASE_PROJECT_ID;
let configDiagnosticError: string | undefined;

function extractServiceAccountProject(clientEmail?: string): string | null {
  if (!clientEmail || typeof clientEmail !== 'string') return null;
  const iamMatch = clientEmail.trim().match(/@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/i);
  if (iamMatch && iamMatch[1]) return iamMatch[1].toLowerCase();
  const appspotMatch = clientEmail.trim().match(/^([a-z0-9-]+)@appspot\.gserviceaccount\.com$/i);
  if (appspotMatch && appspotMatch[1]) return appspotMatch[1].toLowerCase();
  return null;
}

function validateProjectAlignment(effectiveProjectId: string, clientEmail?: string): string | null {
  if (ENV_FIREBASE_PROJECT_ID && ENV_FIREBASE_PROJECT_ID !== EXPECTED_FIREBASE_PROJECT_ID) {
    return `FIREBASE_PROJECT_ID ("${ENV_FIREBASE_PROJECT_ID}") does not match frontend project "${EXPECTED_FIREBASE_PROJECT_ID}".`;
  }
  if (!effectiveProjectId || effectiveProjectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    return `Firebase Admin service account project ("${effectiveProjectId || 'unknown'}") does not match frontend project "${EXPECTED_FIREBASE_PROJECT_ID}".`;
  }
  const saProject = extractServiceAccountProject(clientEmail);
  if (saProject && saProject !== EXPECTED_FIREBASE_PROJECT_ID) {
    return `Firebase Admin service account belongs to project "${saProject}" instead of "${EXPECTED_FIREBASE_PROJECT_ID}".`;
  }
  return null;
}

try {
  if (getApps().length > 0) {
    rawApp = getApp();
    resolvedProjectId = String(rawApp.options?.projectId || FIREBASE_PROJECT_ID);
    const mismatchErr = validateProjectAlignment(resolvedProjectId);
    if (mismatchErr) {
      configDiagnosticError = mismatchErr;
      console.error(`[FirebaseAdmin] CRITICAL PROJECT MISMATCH: ${mismatchErr}`);
      isConfigured = false;
    } else {
      rawFirestore = getFirestore(rawApp);
      rawFirestore.settings({ ignoreUndefinedProperties: true });
      rawAuth = getAuth(rawApp);
      isConfigured = true;
    }
  } else {
    // 1. Service account JSON via FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      try {
        const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Parsed credential is not an object.');
        }
        const effectiveProjectId = String(parsed.project_id || FIREBASE_PROJECT_ID).trim();
        resolvedProjectId = effectiveProjectId;
        const mismatchErr = validateProjectAlignment(effectiveProjectId, parsed.client_email);
        if (mismatchErr) {
          configDiagnosticError = mismatchErr;
          console.error(`[FirebaseAdmin] CRITICAL PROJECT MISMATCH: ${mismatchErr}`);
          isConfigured = false;
        } else {
          rawApp = initializeApp({
            credential: cert(parsed),
            projectId: effectiveProjectId,
          });
          rawFirestore = getFirestore(rawApp);
          rawFirestore.settings({ ignoreUndefinedProperties: true });
          rawAuth = getAuth(rawApp);
          isConfigured = true;
          console.log(`[FirebaseAdmin] Successfully initialized for project "${effectiveProjectId}" via service account JSON.`);
        }
      } catch (parseErr) {
        configDiagnosticError = 'Failed to parse or initialize with FIREBASE_SERVICE_ACCOUNT_KEY JSON. Verify JSON syntax on Railway.';
        console.error(`[FirebaseAdmin] CRITICAL: ${configDiagnosticError}`);
        isConfigured = false;
        // In production, never fall back to ADC
      }
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      // 2. Service account individual fields via FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY
      try {
        resolvedProjectId = FIREBASE_PROJECT_ID;
        const mismatchErr = validateProjectAlignment(FIREBASE_PROJECT_ID, process.env.FIREBASE_CLIENT_EMAIL);
        if (mismatchErr) {
          configDiagnosticError = mismatchErr;
          console.error(`[FirebaseAdmin] CRITICAL PROJECT MISMATCH: ${mismatchErr}`);
          isConfigured = false;
        } else {
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
        }
      } catch (keyErr) {
        configDiagnosticError = 'Failed to initialize Firebase Admin with FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.';
        console.error(`[FirebaseAdmin] CRITICAL: ${configDiagnosticError}`);
        isConfigured = false;
      }
    } else if (isProduction) {
      // In production (Railway / Vercel), do NOT fall back to ADC
      configDiagnosticError = 'No Firebase Admin service account credentials configured in production environment.';
      console.error(`[FirebaseAdmin] CRITICAL CONFIGURATION ERROR: No Firebase Admin credentials found in production environment.`);
      console.error(`[FirebaseAdmin] Railway must be configured with FIREBASE_SERVICE_ACCOUNT_KEY (complete service account JSON string) or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.`);
      isConfigured = false;
    } else {
      // 3. Ambient Google Application Default Credentials (AI Studio preview / GCP Cloud Run environment only)
      try {
        resolvedProjectId = FIREBASE_PROJECT_ID;
        const mismatchErr = validateProjectAlignment(FIREBASE_PROJECT_ID);
        if (mismatchErr) {
          configDiagnosticError = mismatchErr;
          console.error(`[FirebaseAdmin] CRITICAL PROJECT MISMATCH: ${mismatchErr}`);
          isConfigured = false;
        } else {
          rawApp = initializeApp({
            projectId: FIREBASE_PROJECT_ID,
          });
          rawFirestore = getFirestore(rawApp);
          rawFirestore.settings({ ignoreUndefinedProperties: true });
          rawAuth = getAuth(rawApp);
          isConfigured = true;
          console.log(`[FirebaseAdmin] Initialized for development project "${FIREBASE_PROJECT_ID}" via Application Default Credentials.`);
        }
      } catch (adcErr) {
        configDiagnosticError = 'Application Default Credentials unavailable in development environment.';
        console.warn('[FirebaseAdmin] Application Default Credentials unavailable:', adcErr);
        isConfigured = false;
      }
    }
  }
} catch (err) {
  configDiagnosticError = 'Unexpected Firebase Admin initialization failure.';
  console.error('[FirebaseAdmin] Initialization error:', err);
  isConfigured = false;
}

export function isFirebaseAdminConfigured(): boolean {
  return isConfigured && !!rawFirestore && !!rawAuth;
}

export function getFirebaseAdminDiagnostics(): {
  configured: boolean;
  projectId: string;
  expectedProjectId: string;
  error?: string;
} {
  return {
    configured: isFirebaseAdminConfigured(),
    projectId: resolvedProjectId,
    expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    error: configDiagnosticError,
  };
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

