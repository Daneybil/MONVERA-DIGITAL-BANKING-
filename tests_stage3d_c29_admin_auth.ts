/**
 * MONVERA — STAGE 3D-C2.9: FINAL ADMINISTRATOR AUTHORIZATION & READINESS TESTS
 *
 * Strictly offline test suite verifying Part A security remediations:
 * 1. Removal of all hardcoded administrator email/UID fallbacks (server/authMiddleware.ts & firestore.rules).
 * 2. Strict allowlist enforcement (no bypass via persistent custom claims alone).
 * 3. Mandatory email_verified === true when matching via ADMIN_EMAILS.
 * 4. Mandatory non-expired, UID/email-bound HMAC admin session token validation across
 *    isCallerAdministrator, requireAdminAuth, GET /api/admin/verify-session, and
 *    GET /api/admin/withdrawal-support-records.
 * 5. Secure GET /api/admin/withdrawal-support-records (no ?adminSession= query bypass,
 *    no fail-open !isFirebaseAdminConfigured bypass, rejects customers 403 / bad session 401).
 * 6. Preserved legitimate configured admin authentication & dashboard access flow.
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

import {
  createAdminSessionToken,
  evaluateRequireAdminAuth,
  getConfiguredAdminEmails,
  getConfiguredAdminUids,
  isCallerAdministrator,
  isIdentityInAdminAllowlist,
  requireAdminAuth,
  verifyAdminSessionToken,
} from './server/authMiddleware';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function createExpiredToken(uid: string, email: string, password: string): string {
  const salt = process.env.ADMIN_SESSION_SALT || 'monvera-admin-auth-secure-hmac-salt-v1';
  const secret = crypto.createHmac('sha256', salt).update(password).digest('hex');
  const payloadB64 = Buffer.from(
    JSON.stringify({
      uid,
      email: email.toLowerCase().trim(),
      iat: Date.now() - 9 * 60 * 60 * 1000,
      exp: Date.now() - 60 * 1000,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

async function runTests() {
  process.env.VERCEL = '1';
  const { app, handleGetWithdrawalSupportRecords } = await import('./server');

  const prevEnv = {
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_UIDS: process.env.ADMIN_UIDS,
    ADMIN_UID: process.env.ADMIN_UID,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  };

  console.log('\n=== STAGE 3D-C2.9: ADMINISTRATOR AUTH & SECURITY REMEDIATION TESTS ===\n');

  try {
    // -----------------------------------------------------------------------
    // 1. Hardcoded Fallbacks Removed (authMiddleware & firestore.rules)
    // -----------------------------------------------------------------------
    {
      delete process.env.ADMIN_EMAILS;
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_UIDS;
      delete process.env.ADMIN_UID;
      process.env.ADMIN_PASSWORD = 'Stage3dC29TestAdminSecret!2026';

      assert.deepStrictEqual(getConfiguredAdminEmails(), [], 'getConfiguredAdminEmails() must return [] when unset');
      assert.deepStrictEqual(getConfiguredAdminUids(), [], 'getConfiguredAdminUids() must return [] when unset');

      const rulesSrc = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
      const isAdminBlock = rulesSrc.slice(rulesSrc.indexOf('function isAdmin()'), rulesSrc.indexOf('match /users/{userId}'));
      assert.strictEqual(
        isAdminBlock.includes('daneybil2020@gmail.com'),
        false,
        'firestore.rules isAdmin() must not hardcode daneybil2020@gmail.com'
      );
      assert.strictEqual(
        isAdminBlock.includes('admin@monvera.com'),
        false,
        'firestore.rules isAdmin() must not hardcode admin@monvera.com'
      );

      // Even if a caller holds custom claims and a valid-format UID/email from legacy defaults, fail closed!
      const legacyCheck1 = await isCallerAdministrator('usr_admin', 'admin@monvera.com', {
        admin: true,
        role: 'super_admin',
        email_verified: true,
      });
      const legacyCheck2 = await isCallerAdministrator('DDp1tLOzbgUHSnuDgNdFszcYqkp1', 'daneybil2020@gmail.com', {
        admin: true,
        role: 'admin',
        email_verified: true,
      });
      assert.strictEqual(legacyCheck1, false, 'Legacy fallback admin@monvera.com / usr_admin must fail closed');
      assert.strictEqual(legacyCheck2, false, 'Legacy fallback daneybil2020@gmail.com must fail closed');

      console.log('✓ 1. Hardcoded administrator fallbacks removed & fail closed verified');
    }

    // -----------------------------------------------------------------------
    // 2. Allowlist, email_verified, No Custom-Claim Bypass, Session Enforcement
    // -----------------------------------------------------------------------
    {
      process.env.ADMIN_EMAILS = 'ops.admin@monvera.test';
      process.env.ADMIN_UIDS = 'uid_ops_uid_only';
      const testPass = 'Stage3dC29TestAdminSecret!2026';
      process.env.ADMIN_PASSWORD = testPass;

      const validEmailAdminSession = createAdminSessionToken('uid_email_admin', 'ops.admin@monvera.test')!;
      const validUidAdminSession = createAdminSessionToken('uid_ops_uid_only', 'uid.admin@monvera.test')!;
      assert.ok(validEmailAdminSession && validUidAdminSession);

      // 2a. Unverified email matching ADMIN_EMAILS -> REJECTED
      assert.strictEqual(
        isIdentityInAdminAllowlist('uid_email_admin', 'ops.admin@monvera.test', { email_verified: false }).allowed,
        false
      );
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_email_admin',
          'ops.admin@monvera.test',
          { email_verified: false, admin: true, role: 'admin' },
          validEmailAdminSession
        ),
        false,
        'Unverified email matching ADMIN_EMAILS must be rejected'
      );
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_email_admin',
          'ops.admin@monvera.test',
          undefined,
          validEmailAdminSession
        ),
        false,
        'Missing email_verified claim for email-matched admin must be rejected'
      );

      // 2b. Persistent custom claims alone WITHOUT allowlist membership -> REJECTED
      const nonAllowlistClaimToken = createAdminSessionToken('uid_ex_admin', 'ex.admin@monvera.test');
      assert.strictEqual(nonAllowlistClaimToken !== null, true);
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_ex_admin',
          'ex.admin@monvera.test',
          { admin: true, role: 'super_admin', email_verified: true, adminSessionToken: nonAllowlistClaimToken },
          nonAllowlistClaimToken!
        ),
        false,
        'Persistent custom claims alone must NEVER bypass configured allowlist'
      );

      // 2c. Missing / empty / expired / tampered / mismatched admin session token -> REJECTED even for allowlisted admin
      assert.strictEqual(
        await isCallerAdministrator('uid_email_admin', 'ops.admin@monvera.test', { email_verified: true }),
        false,
        'Missing session token must be rejected'
      );
      assert.strictEqual(
        await isCallerAdministrator('uid_email_admin', 'ops.admin@monvera.test', {
          email_verified: true,
          adminSessionToken: validEmailAdminSession,
        }, ''),
        false,
        'Explicit blank session token must override claim and fail closed'
      );
      const expiredToken = createExpiredToken('uid_email_admin', 'ops.admin@monvera.test', testPass);
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_email_admin',
          'ops.admin@monvera.test',
          { email_verified: true },
          expiredToken
        ),
        false,
        'Expired admin session token must be rejected'
      );
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_email_admin',
          'ops.admin@monvera.test',
          { email_verified: true },
          `${validEmailAdminSession.split('.')[0]}.bad_signature`
        ),
        false,
        'Tampered admin session signature must be rejected'
      );
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_ops_uid_only',
          'uid.admin@monvera.test',
          { email_verified: true },
          validEmailAdminSession
        ),
        false,
        'Cross-UID/email admin session token mismatch must be rejected'
      );

      // 2d. Missing UID (even with valid email) -> REJECTED
      assert.strictEqual(
        await isCallerAdministrator(undefined, 'ops.admin@monvera.test', { email_verified: true }, validEmailAdminSession),
        false,
        'Caller without verified Firebase UID must be rejected'
      );

      // 2e. Legitimate verified-email admin + valid bound session -> AUTHORIZED
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_email_admin',
          'ops.admin@monvera.test',
          { email_verified: true },
          validEmailAdminSession
        ),
        true,
        'Verified allowlisted email admin with valid session token must succeed'
      );

      // 2f. Legitimate UID-allowlisted admin + valid bound session -> AUTHORIZED
      assert.strictEqual(
        await isCallerAdministrator(
          'uid_ops_uid_only',
          'uid.admin@monvera.test',
          { email_verified: true },
          validUidAdminSession
        ),
        true,
        'UID-allowlisted admin with valid session token must succeed'
      );

      console.log('✓ 2. Allowlist, verified email, custom-claim non-bypass, and session binding verified');
    }

    // -----------------------------------------------------------------------
    // 3. requireAdminAuth Middleware Enforcement (Mocked verifyIdToken + Loopback)
    // -----------------------------------------------------------------------
    {
      assert.strictEqual(requireAdminAuth.length, 3, 'requireAdminAuth must preserve 3-argument Express middleware arity');
      process.env.ADMIN_EMAILS = 'ops.admin@monvera.test';
      process.env.ADMIN_UIDS = '';
      process.env.ADMIN_PASSWORD = 'Stage3dC29TestAdminSecret!2026';

      const validSession = createAdminSessionToken('uid_admin_live', 'ops.admin@monvera.test')!;
      const expiredSession = createExpiredToken('uid_admin_live', 'ops.admin@monvera.test', process.env.ADMIN_PASSWORD);

      let mockDecodedToken: any = null;
      const mockAuthDeps = {
        isFirebaseConfiguredFn: () => true,
        verifyIdTokenFn: async (tok: string) => {
          if (tok === 'valid_tok' && mockDecodedToken) return mockDecodedToken;
          throw new Error('auth/invalid-id-token');
        },
      };

      // 3a. Unverified email -> 403 FORBIDDEN
      mockDecodedToken = {
        uid: 'uid_admin_live',
        email: 'ops.admin@monvera.test',
        email_verified: false,
        admin: true,
      };
      {
        const req: any = {
          headers: { authorization: 'Bearer valid_tok', 'x-admin-session': validSession },
        };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 403);
      }

      // 3b. Custom claims without allowlist membership -> 403 FORBIDDEN
      mockDecodedToken = {
        uid: 'uid_not_allowlisted',
        email: 'removed.admin@monvera.test',
        email_verified: true,
        admin: true,
        role: 'super_admin',
      };
      {
        const req: any = {
          headers: { authorization: 'Bearer valid_tok', 'x-admin-session': validSession },
        };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 403);
      }

      // 3c. Allowlisted verified admin with MISSING session -> 401 ADMIN_SESSION_INVALID
      mockDecodedToken = {
        uid: 'uid_admin_live',
        email: 'ops.admin@monvera.test',
        email_verified: true,
      };
      {
        const req: any = { headers: { authorization: 'Bearer valid_tok' } };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.body.errorCode, 'ADMIN_SESSION_INVALID');
      }

      // 3d. Allowlisted verified admin with EXPIRED header overriding valid claim -> 401 ADMIN_SESSION_INVALID
      mockDecodedToken = {
        uid: 'uid_admin_live',
        email: 'ops.admin@monvera.test',
        email_verified: true,
        adminSessionToken: validSession,
      };
      {
        const req: any = {
          headers: { authorization: 'Bearer valid_tok', 'x-admin-session': expiredSession },
        };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.body.errorCode, 'ADMIN_SESSION_INVALID');
        assert.strictEqual(res.body.sessionExpired, true);
      }

      // 3e. Legitimate verified admin with valid header session -> passes!
      {
        const req: any = {
          headers: { authorization: 'Bearer valid_tok', 'x-admin-session': validSession },
        };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, true, 'Legitimate configured admin must pass requireAdminAuth');
      }

      // 3f. Legitimate verified admin authenticating via /api/admin/login custom token claim -> passes!
      mockDecodedToken = {
        uid: 'uid_admin_live',
        email: 'ops.admin@monvera.test',
        email_verified: true,
        adminSessionToken: validSession,
      };
      {
        const req: any = { headers: { authorization: 'Bearer valid_tok' } };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, true, 'Verified admin with claim-bound session token from /api/admin/login must pass');
      }

      // 3g. Empty allowlist -> fails closed with 403
      process.env.ADMIN_EMAILS = '';
      process.env.ADMIN_UIDS = '';
      {
        const req: any = {
          headers: { authorization: 'Bearer valid_tok', 'x-admin-session': validSession },
        };
        const res = createMockRes();
        let nextCalled = false;
        await evaluateRequireAdminAuth(req, res, () => { nextCalled = true; }, mockAuthDeps);
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 403);
      }

      console.log('✓ 3. requireAdminAuth enforces fail-closed allowlist, verified email, and bound session tokens');
    }

    // -----------------------------------------------------------------------
    // 4. GET /api/admin/withdrawal-support-records Endpoint Hardening
    // -----------------------------------------------------------------------
    {
      process.env.ADMIN_EMAILS = 'ops.admin@monvera.test';
      process.env.ADMIN_PASSWORD = 'Stage3dC29TestAdminSecret!2026';
      const validSession = createAdminSessionToken('uid_admin_live', 'ops.admin@monvera.test')!;

      // 4a. Unconfigured Firebase Admin MUST fail closed via real HTTP loopback (never fail-open!)
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        const unauthRes = await fetch(`${baseUrl}/api/admin/withdrawal-support-records`);
        assert(
          unauthRes.status === 401 || unauthRes.status === 403 || unauthRes.status === 503,
          `Unauthenticated call when Firebase Admin unconfigured must fail closed, got ${unauthRes.status}`
        );

        // Attempt legacy query-string ?adminSession= bypass with a REAL HMAC token -> MUST STILL FAIL CLOSED!
        const queryBypassRes = await fetch(
          `${baseUrl}/api/admin/withdrawal-support-records?adminSession=${encodeURIComponent(validSession)}`
        );
        assert(
          queryBypassRes.status === 401 || queryBypassRes.status === 403 || queryBypassRes.status === 503,
          `Query-string ?adminSession= bypass must be rejected, got ${queryBypassRes.status}`
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      // 4b. Handler-level checks
      const mockRecords = [{ id: 'rec_1', referenceNumber: 'MV-WTH-100', amount: 250 }];

      // Unauthenticated -> 401
      {
        const res = createMockRes();
        await handleGetWithdrawalSupportRecords(
          { query: { adminSession: validSession }, headers: {} } as any,
          res,
          { getRecordsFn: async () => mockRecords as any }
        );
        assert.strictEqual(res.statusCode, 401);
      }

      // Customer with valid-looking Bearer context -> 401 (no admin session) or 403 (with someone else's session)
      {
        const resNoSess = createMockRes();
        await handleGetWithdrawalSupportRecords(
          { auth: { uid: 'cust_1', email: 'cust@monvera.test', email_verified: true }, headers: {}, query: {} } as any,
          resNoSess,
          { getRecordsFn: async () => mockRecords as any }
        );
        assert(resNoSess.statusCode === 401 || resNoSess.statusCode === 403);

        const resWithStolenSess = createMockRes();
        await handleGetWithdrawalSupportRecords(
          {
            auth: { uid: 'cust_1', email: 'cust@monvera.test', email_verified: true },
            headers: { 'x-admin-session': validSession },
            query: {},
          } as any,
          resWithStolenSess,
          { getRecordsFn: async () => mockRecords as any }
        );
        assert.strictEqual(resWithStolenSess.statusCode, 401, 'Stolen admin session bound to another UID must be rejected');
      }

      // Query-string ?adminSession= ignored even for allowlisted admin when X-Admin-Session is missing
      {
        const resQueryOnly = createMockRes();
        await handleGetWithdrawalSupportRecords(
          {
            auth: { uid: 'uid_admin_live', email: 'ops.admin@monvera.test', email_verified: true },
            headers: {},
            query: { adminSession: validSession },
          } as any,
          resQueryOnly,
          { getRecordsFn: async () => mockRecords as any }
        );
        assert.strictEqual(resQueryOnly.statusCode, 401, 'Query-string ?adminSession= must not satisfy session auth');
      }

      // Verified allowlisted admin with valid X-Admin-Session -> 200 & preserved payload
      {
        const resOk = createMockRes();
        await handleGetWithdrawalSupportRecords(
          {
            auth: { uid: 'uid_admin_live', email: 'ops.admin@monvera.test', email_verified: true },
            headers: { 'x-admin-session': validSession },
            query: {},
          } as any,
          resOk,
          { getRecordsFn: async () => mockRecords as any }
        );
        assert.strictEqual(resOk.statusCode, 200);
        assert.strictEqual(resOk.body.success, true);
        assert.deepStrictEqual(resOk.body.records, mockRecords);
      }

      console.log('✓ 4. GET /api/admin/withdrawal-support-records fails closed & enforces admin session');
    }

    // -----------------------------------------------------------------------
    // 5. Verify Notification Worker Default-OFF & Notification/Support Auth Hardening
    // -----------------------------------------------------------------------
    {
      const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf-8');
      assert.strictEqual(
        serverSrc.includes('const adminSess = verifyAdminSessionToken'),
        false,
        'server.ts must not allow standalone X-Admin-Session without verified Firebase callerUid'
      );
      assert.ok(
        serverSrc.includes("process.env.NOTIFICATION_WORKER_ENABLED === 'true'") &&
          serverSrc.includes("process.env.DISABLE_OUTBOUND_NOTIFICATIONS !== 'true'"),
        'Notification worker startup must remain gated by default-OFF flags'
      );
      console.log('✓ 5. Notification/support callerUid binding & worker default-OFF guard verified');
    }

    console.log('\nALL STAGE 3D-C2.9 ADMIN AUTH & READINESS REGRESSION TESTS PASSED.\n');
  } finally {
    Object.entries(prevEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
}

runTests().catch((err) => {
  console.error('Stage 3D-C2.9 test suite failed:', err);
  process.exit(1);
});
