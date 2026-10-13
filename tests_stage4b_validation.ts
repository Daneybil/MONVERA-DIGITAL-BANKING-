/**
 * Stage 4B Security Validation Suite:
 * 1. Admin authorization checks for unauthenticated access.
 * 2. Role escalation safeguards.
 * 3. Environment configuration parsing and administrator resolution.
 * 4. Password security verification in memory seed data.
 */
import assert from 'assert';
import { isCallerAdministrator, getConfiguredAdminEmails, getConfiguredAdminUids } from './server/authMiddleware';
import { db } from './server/db';

async function runStage4bTests() {
  console.log('--- Starting Stage 4B Admin Authentication & Security Tests ---');

  // Test 1: Configured Admin Emails & UIDs
  console.log('Test 1: Verify environment-based and built-in administrator configuration...');
  const emails = getConfiguredAdminEmails();
  const uids = getConfiguredAdminUids();
  assert.ok(emails.includes('daneybil2020@gmail.com'), 'Default admin email must be authorized');
  assert.ok(emails.includes('admin@monvera.com'), 'Internal admin email must be authorized');
  assert.ok(uids.includes('usr_admin'), 'usr_admin UID must be authorized');

  // Test 2: Reject non-admin caller
  console.log('Test 2: Reject ordinary customer identity from acquiring admin privileges...');
  const regularCustomerAdminCheck = await isCallerAdministrator('customer_12345', 'customer@example.com');
  assert.strictEqual(regularCustomerAdminCheck, false, 'Ordinary customer must NOT be recognized as administrator');

  const unauthenticatedCheck = await isCallerAdministrator(undefined, undefined);
  assert.strictEqual(unauthenticatedCheck, false, 'Unauthenticated caller must NOT be recognized as administrator');

  // Test 3: Authorized admin caller
  console.log('Test 3: Confirm authorized administrator credentials pass authorization...');
  const adminCheck1 = await isCallerAdministrator('DDp1tLOzbgUHSnuDgNdFszcYqkp1', 'daneybil2020@gmail.com');
  assert.strictEqual(adminCheck1, true, 'Configured administrator email must be authorized');

  const adminCheck2 = await isCallerAdministrator('usr_admin', 'admin@monvera.com');
  assert.strictEqual(adminCheck2, true, 'Configured administrator UID/email must be authorized');

  // Test 4: Verify plaintext password removed from db seed data
  console.log('Test 4: Verify no plaintext administrator password stored in memory seed...');
  const adminPassword = db.userPasswords.get('usr_admin');
  assert.strictEqual(adminPassword, undefined, 'Plaintext admin password must NOT exist in userPasswords map');

  console.log('--- All Stage 4B Security Validation Tests Passed Successfully! ---');
}

runStage4bTests().catch((err) => {
  console.error('Stage 4B Test Failed:', err);
  process.exit(1);
});
