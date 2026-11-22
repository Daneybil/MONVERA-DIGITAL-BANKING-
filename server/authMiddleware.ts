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

function resolveAdminSessionHeaderOrClaim(
  rawHeader: string | string[] | undefined,
  claimToken: unknown
): string | undefined {
  if (rawHeader !== undefined) {
    const headerVal = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    return typeof headerVal === 'string' ? headerVal.trim() : '';
  }
  return typeof claimToken === 'string' ? claimToken.trim() : undefined;
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
    const sessionToken = resolveAdminSessionHeaderOrClaim(
      req.headers['x-admin-session'],
      decodedToken.adminSessionToken
    );
    req.auth = {
      ...decodedToken,
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      adminSessionToken: sessionToken,
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
 * Optional helper for endpoints that allow anonymous fallback for non-sensitive flows
 * while attaching verified Firebase ID token context when present.
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
        const sessionToken = resolveAdminSessionHeaderOrClaim(
          req.headers['x-admin-session'],
          decodedToken.adminSessionToken
        );
        req.auth = {
          ...decodedToken,
          uid: decodedToken.uid,
          email: decodedToken.email,
          email_verified: decodedToken.email_verified,
          adminSessionToken: sessionToken,
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
 * Fails closed (returns empty array) if not explicitly configured in server environment.
 */
export function getConfiguredAdminEmails(): string[] {
  const envEmails = [process.env.ADMIN_EMAILS, process.env.ADMIN_EMAIL].filter(Boolean).join(',');
  return envEmails
    .split(/[,;\s]+/)
    .map((e) => e.replace(/^["']|["']$/g, '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Reads configured administrator UIDs from server environment variables.
 * Fails closed (returns empty array) if not explicitly configured in server environment.
 */
export function getConfiguredAdminUids(): string[] {
  const envUids = [process.env.ADMIN_UIDS, process.env.ADMIN_UID].filter(Boolean).join(',');
  return envUids
    .split(/[,;\s]+/)
    .map((u) => u.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

/**
 * Checks whether a verified Firebase Auth identity explicitly belongs to the configured
 * server administrator allowlist (UID allowlist, or verified-email allowlist).
 * Persistent custom claims alone never bypass the configured allowlist.
 */
export function isIdentityInAdminAllowlist(
  uid?: string,
  email?: string,
  decodedClaims?: Record<string, any>
): { allowed: boolean; isConfiguredUid: boolean; isConfiguredVerifiedEmail: boolean } {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    return { allowed: false, isConfiguredUid: false, isConfiguredVerifiedEmail: false };
  }

  const configuredEmails = getConfiguredAdminEmails();
  const configuredUids = getConfiguredAdminUids();
  if (configuredEmails.length === 0 && configuredUids.length === 0) {
    return { allowed: false, isConfiguredUid: false, isConfiguredVerifiedEmail: false };
  }

  const cleanUid = uid.trim();
  const normalizedEmail = (email || '').toLowerCase().trim();
  const isEmailVerified = decodedClaims?.email_verified === true;

  const isConfiguredUid = configuredUids.includes(cleanUid);
  const isConfiguredVerifiedEmail =
    Boolean(normalizedEmail) && isEmailVerified && configuredEmails.includes(normalizedEmail);

  return {
    allowed: isConfiguredUid || isConfiguredVerifiedEmail,
    isConfiguredUid,
    isConfiguredVerifiedEmail,
  };
}

/**
 * Verifies if a verified Firebase Auth caller has active administrator authorization:
 * 1. Verified non-empty Firebase UID and configured ADMIN_PASSWORD secret.
 * 2. Explicit membership in ADMIN_UIDS or verified-email membership in ADMIN_EMAILS.
 * 3. Valid, non-expired HMAC administrator session token bound to caller UID and email.
 */
export async function isCallerAdministrator(
  uid?: string,
  email?: string,
  decodedClaims?: Record<string, any>,
  sessionToken?: string
): Promise<boolean> {
  if (!uid || typeof uid !== 'string' || !uid.trim()) return false;
  if (!getAdminSessionSecret()) return false;

  const allowlist = isIdentityInAdminAllowlist(uid, email, decodedClaims);
  if (!allowlist.allowed) {
    return false;
  }

  const tokenToVerify =
    sessionToken !== undefined
      ? sessionToken
      : ((decodedClaims?.adminSessionToken as string | undefined) ||
         (decodedClaims?.adminSessionSignature as string | undefined));

  if (!tokenToVerify || typeof tokenToVerify !== 'string' || !tokenToVerify.trim()) {
    return false;
  }

  const normalizedEmail = (email || '').toLowerCase().trim();
  const verification = verifyAdminSessionToken(tokenToVerify.trim(), uid.trim(), normalizedEmail || undefined);
  return verification.valid;
}

export interface RequireAdminAuthDeps {
  isFirebaseConfiguredFn?: () => boolean;
  verifyIdTokenFn?: (token: string) => Promise<Record<string, any>>;
}

export async function evaluateRequireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  deps?: RequireAdminAuthDeps
) {
  const isFbConfigured = deps?.isFirebaseConfiguredFn
    ? deps.isFirebaseConfiguredFn()
    : isFirebaseAdminConfigured();
  if (!isFbConfigured) {
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
    const verifyFn = deps?.verifyIdTokenFn || ((t: string) => adminAuth.verifyIdToken(t));
    const decodedToken = await verifyFn(token);
    const configuredEmails = getConfiguredAdminEmails();
    const configuredUids = getConfiguredAdminUids();
    if (configuredEmails.length === 0 && configuredUids.length === 0) {
      return res.status(403).json({
        error: 'FORBIDDEN: Administrator allowlist is not configured on the server.',
        errorCode: 'ADMIN_ALLOWLIST_UNCONFIGURED',
      });
    }

    const sessionToken = resolveAdminSessionHeaderOrClaim(
      req.headers['x-admin-session'],
      decodedToken.adminSessionToken
    );

    req.auth = {
      ...decodedToken,
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      adminSessionToken: sessionToken,
    };

    const email = (decodedToken.email || '').toLowerCase().trim();
    const uid = decodedToken.uid;

    const allowlist = isIdentityInAdminAllowlist(uid, email, req.auth);
    if (!allowlist.allowed) {
      return res.status(403).json({
        error: 'FORBIDDEN: Administrative privileges required to perform this action.',
        errorCode: 'FORBIDDEN',
      });
    }

    const sessionCheck = verifyAdminSessionToken(sessionToken, uid, email || undefined);
    if (!sessionCheck.valid) {
      const isExpired = sessionCheck.reason === 'Admin session expired';
      return res.status(401).json({
        success: false,
        isAdmin: false,
        hasAdminIdentity: true,
        sessionExpired: isExpired,
        errorCode: 'ADMIN_SESSION_INVALID',
        error: `UNAUTHORIZED: ${sessionCheck.reason || 'Valid non-expired administrator session is required.'}`,
      });
    }

    return next();
  } catch (err: any) {
    console.warn('[requireAdminAuth] Token verification failed:', err?.message || err);
    return res.status(401).json({
      error: 'UNAUTHORIZED: Invalid or expired authentication token. Please re-authenticate.',
      details: err?.code || err?.message,
    });
  }
}

/**
 * Express middleware (strictly 3-argument arity) to authenticate and authorize administrator requests.
 * Requires a valid Firebase Bearer token, explicit allowlist membership, and a valid
 * non-expired administrator session token bound to the verified Firebase identity.
 */
export function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return evaluateRequireAdminAuth(req, res, next);
}
