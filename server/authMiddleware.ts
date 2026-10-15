import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';
import { adminAuth, isFirebaseAdminConfigured } from './firebaseAdmin';

export interface AuthenticatedRequest extends Request {
  auth?: {
    uid: string;
    email?: string;
    email_verified?: boolean;
    [key: string]: any;
  };
}

/**
 * Express middleware to authenticate Firebase ID tokens from:
 * Authorization: Bearer <Firebase ID token>
 * 
 * Rejects requests without a valid Firebase ID token with 401 Unauthorized.
 */
export async function requireFirebaseAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE: Authentication service is unavailable because Firebase Admin credentials are not configured.',
    });
  }
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED: Missing or invalid Authorization header. A valid Firebase Bearer token is required.',
    });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();

  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED: Bearer token is empty.',
    });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.auth = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      ...decodedToken,
    };
    next();
  } catch (err: any) {
    console.warn('[requireFirebaseAuth] Token verification failed:', err?.message || err);
    return res.status(401).json({
      error: 'UNAUTHORIZED: Invalid or expired authentication token. Please re-authenticate.',
      details: err?.code || err?.message,
    });
  }
}

/**
 * Optional helper for endpoints that allow both Firebase ID token auth AND admin fallback
 */
export async function optionalFirebaseAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  if (!isFirebaseAdminConfigured()) {
    return next();
  }
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1]?.trim();
    if (token) {
      try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        req.auth = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          email_verified: decodedToken.email_verified,
          ...decodedToken,
        };
      } catch (err) {
        // Token provided but invalid
        console.warn('[optionalFirebaseAuth] Optional token verification warning:', err);
      }
    }
  }
  next();
}

/**
 * Reads configured administrator emails from server environment variables.
 * Fails closed if not explicitly configured in server environment.
 */
export function getConfiguredAdminEmails(): string[] {
  const envEmails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  return envEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Reads configured administrator UIDs from server environment variables.
 * Fails closed if not explicitly configured in server environment.
 */
export function getConfiguredAdminUids(): string[] {
  const envUids = process.env.ADMIN_UIDS || process.env.ADMIN_UID || '';
  return envUids
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Verifies if a verified Firebase Auth caller has administrator privileges.
 * Derived strictly from verified token UID/email against server configuration or cryptographic custom claims.
 * Does NOT trust unverified client parameters or mutable Firestore user documents.
 */
export async function isCallerAdministrator(
  uid?: string,
  email?: string,
  decodedClaims?: Record<string, any>
): Promise<boolean> {
  if (!uid && !email) return false;

  const normalizedEmail = (email || '').toLowerCase().trim();
  const configuredEmails = getConfiguredAdminEmails();
  const configuredUids = getConfiguredAdminUids();

  // Fail closed if server has no administrator configuration set and no cryptographic custom claims
  const hasEnvConfig = configuredEmails.length > 0 || configuredUids.length > 0;
  if (!hasEnvConfig && !decodedClaims?.admin && !decodedClaims?.role) {
    console.warn('[isCallerAdministrator] Missing configuration: ADMIN_EMAILS and ADMIN_UIDS are empty. Administrator access is failing closed.');
    return false;
  }

  // 1. Explicit server-side configured administrator emails
  if (normalizedEmail && configuredEmails.includes(normalizedEmail)) {
    return true;
  }

  // 2. Explicit server-side configured administrator UIDs
  if (uid && configuredUids.includes(uid)) {
    return true;
  }

  // 3. Cryptographically verified Firebase Custom Claims on the token (minted only by backend Admin SDK)
  if (decodedClaims) {
    if (decodedClaims.admin === true || decodedClaims.role === 'admin' || decodedClaims.role === 'super_admin') {
      return true;
    }
  }

  return false;
}

/**
 * Express middleware to authenticate and authorize administrator requests.
 * Requires a valid Firebase Bearer token and verifies admin privileges.
 */
export async function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE: Administrator authentication service is unavailable because Firebase Admin credentials are not configured.',
    });
  }
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED: Missing or invalid Authorization header. An authenticated administrator token is required.',
    });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED: Bearer token is empty.',
    });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.auth = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      ...decodedToken,
    };

    const email = (decodedToken.email || '').toLowerCase().trim();
    const uid = decodedToken.uid;

    // Production security enforcement: testing bypass disabled
    const isTestingAdminAuthBypass = false;
    if (isTestingAdminAuthBypass) {
      return next();
    }

    const hasAdminAccess = await isCallerAdministrator(uid, email, decodedToken);
    if (hasAdminAccess) {
      return next();
    }

    return res.status(403).json({
      error: 'FORBIDDEN: Administrative privileges required to perform this action.',
    });
  } catch (err: any) {
    console.warn('[requireAdminAuth] Token verification failed:', err?.message || err);
    return res.status(401).json({
      error: 'UNAUTHORIZED: Invalid or expired authentication token. Please re-authenticate.',
      details: err?.code || err?.message,
    });
  }
}
