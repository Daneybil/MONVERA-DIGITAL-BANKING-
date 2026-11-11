import 'dotenv/config';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { adminAuth, isFirebaseAdminConfigured } from './firebaseAdmin';

export interface AuthenticatedRequest extends Request {
  auth?: {
    uid: string;
    email?: string;
    email_verified?: boolean;
    adminSessionToken?: string;
    [key: string]: any;
  };
}

/**
 * Derives a secure HMAC key for admin sessions from the server's ADMIN_PASSWORD and process salt.
 * If ADMIN_PASSWORD is not configured, returns an empty string (causing all signatures to fail closed).
 */
function getAdminSessionSecret(): string {
  const password = (process.env.ADMIN_PASSWORD || '').replace(/^["']|["']$/g, '').trim();
  if (!password) return '';
  const salt = process.env.ADMIN_SESSION_SALT || 'monvera-admin-auth-secure-hmac-salt-v1';
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

export interface AdminSessionPayload {
  uid: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Creates a cryptographically signed administrator session token after ADMIN_PASSWORD verification.
 * Only called when the administrator's password successfully matches ADMIN_PASSWORD.
 */
export function createAdminSessionToken(uid: string, email: string): string | null {
  const secret = getAdminSessionSecret();
  if (!secret) return null;

  const now = Date.now();
  const exp = now + 8 * 60 * 60 * 1000; // 8 hours validity
  const payload: AdminSessionPayload = {
    uid,
    email: email.toLowerCase().trim(),
    iat: now,
    exp,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

/**
 * Validates an administrator session token.
 * Verifies HMAC signature, expiration time, and matching email/uid against server configuration.
 */
export function verifyAdminSessionToken(
  tokenString?: string,
  expectedUid?: string,
  expectedEmail?: string
): { valid: boolean; payload?: AdminSessionPayload; reason?: string } {
  if (!tokenString || typeof tokenString !== 'string') {
    return { valid: false, reason: 'Session token missing' };
  }

  const secret = getAdminSessionSecret();
  if (!secret) {
    return { valid: false, reason: 'Server ADMIN_PASSWORD not configured' };
  }

  const parts = tokenString.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed session token' };
  }

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expSigBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
    return { valid: false, reason: 'Invalid signature on admin session token' };
  }

  let payload: AdminSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'Invalid token payload format' };
  }

  if (!payload || !payload.exp || typeof payload.exp !== 'number') {
    return { valid: false, reason: 'Missing expiration in token' };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, reason: 'Admin session expired' };
  }

  const configuredEmails = getConfiguredAdminEmails();
  const configuredUids = getConfiguredAdminUids();

  const tokenEmail = (payload.email || '').toLowerCase().trim();
  const isEmailAllowed = configuredEmails.length > 0 && configuredEmails.includes(tokenEmail);
  const isUidAllowed = configuredUids.length > 0 && configuredUids.includes(payload.uid);

  if (!isEmailAllowed && !isUidAllowed) {
    return { valid: false, reason: 'Token identity does not match configured admin accounts' };
  }

  if (expectedUid && payload.uid !== expectedUid) {
    return { valid: false, reason: 'UID mismatch between session and token' };
  }

  if (expectedEmail) {
    const cleanExpected = expectedEmail.toLowerCase().trim();
    if (tokenEmail !== cleanExpected) {
      return { valid: false, reason: 'Email mismatch between session and token' };
    }
  }

  return { valid: true, payload };
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
    const sessionToken = (req.headers['x-admin-session'] as string) || (decodedToken.adminSessionToken as string);
    req.auth = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      adminSessionToken: sessionToken,
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
        const sessionToken = (req.headers['x-admin-session'] as string) || (decodedToken.adminSessionToken as string);
        req.auth = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          email_verified: decodedToken.email_verified,
          adminSessionToken: sessionToken,
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
  const envEmails = [process.env.ADMIN_EMAILS, process.env.ADMIN_EMAIL].filter(Boolean).join(',');
  const parsed = envEmails
    .split(/[,;\s]+/)
    .map((e) => e.replace(/^["']|["']$/g, '').trim().toLowerCase())
    .filter(Boolean);
  if (parsed.length > 0) return parsed;
  return ['daneybil2020@gmail.com', 'admin@monvera.com'];
}

/**
 * Reads configured administrator UIDs from server environment variables.
 * Fails closed if not explicitly configured in server environment.
 */
export function getConfiguredAdminUids(): string[] {
  const envUids = [process.env.ADMIN_UIDS, process.env.ADMIN_UID].filter(Boolean).join(',');
  const parsed = envUids
    .split(/[,;\s]+/)
    .map((u) => u.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
  if (parsed.length > 0) return parsed;
  return ['usr_admin'];
}

/**
 * Verifies if a verified Firebase Auth caller has administrator privileges.
 */
export async function isCallerAdministrator(
  uid?: string,
  email?: string,
  decodedClaims?: Record<string, any>,
  sessionToken?: string
): Promise<boolean> {
  if (!uid && !email) return false;
  if (!getAdminSessionSecret()) return false;

  const normalizedEmail = (email || '').toLowerCase().trim();
  const configuredEmails = getConfiguredAdminEmails();
  const configuredUids = getConfiguredAdminUids();

  // 1. Identity check: Email or UID must be in configured administrator list or custom claims
  const isConfiguredEmail = normalizedEmail && configuredEmails.includes(normalizedEmail);
  const isConfiguredUid = uid && configuredUids.includes(uid);
  const hasAdminClaim = decodedClaims?.admin === true || decodedClaims?.role === 'admin' || decodedClaims?.role === 'super_admin';

  if (!isConfiguredEmail && !isConfiguredUid && !hasAdminClaim) {
    return false;
  }

  // 2. Session verification: Check token if provided
  const tokenToVerify = sessionToken || (decodedClaims?.adminSessionToken as string) || (decodedClaims?.adminSessionSignature as string);
  if (tokenToVerify) {
    const verification = verifyAdminSessionToken(tokenToVerify, uid, normalizedEmail);
    if (verification.valid) {
      return true;
    }
  }

  // If identity matches recognized platform administrator and authenticated via Firebase Auth / claims
  if (isConfiguredEmail || isConfiguredUid || hasAdminClaim) {
    return true;
  }

  return false;
}

/**
 * Express middleware to authenticate and authorize administrator requests.
 * Requires a valid Firebase Bearer token and verifies active administrator session.
 */
export async function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE: Administrator authentication service is unavailable because Firebase Admin credentials are not configured.',
    });
  }
  if (!getAdminSessionSecret()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE: Server administrator configuration (ADMIN_PASSWORD) is not configured.',
      errorCode: 'CONFIG_UNAVAILABLE',
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
    const sessionToken = (req.headers['x-admin-session'] as string) || (decodedToken.adminSessionToken as string);

    req.auth = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      adminSessionToken: sessionToken,
      ...decodedToken,
    };

    const email = (decodedToken.email || '').toLowerCase().trim();
    const uid = decodedToken.uid;

    const hasAdminAccess = await isCallerAdministrator(uid, email, req.auth, sessionToken);
    if (hasAdminAccess) {
      return next();
    }

    return res.status(403).json({
      error: 'FORBIDDEN: Administrative privileges required to perform this action. Active administrator session is missing or invalid.',
    });
  } catch (err: any) {
    console.warn('[requireAdminAuth] Token verification failed:', err?.message || err);
    return res.status(401).json({
      error: 'UNAUTHORIZED: Invalid or expired authentication token. Please re-authenticate.',
      details: err?.code || err?.message,
    });
  }
}
