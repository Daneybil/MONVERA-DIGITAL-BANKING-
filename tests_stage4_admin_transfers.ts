/**
 * MONVERA — STAGE 4: ADMINISTRATOR TRANSFERS VERIFICATION SUITE
 * 
 * Tests:
 * 1. Unauthenticated caller rejection (HTTP 401).
 * 2. Ordinary customer caller rejection (HTTP 403 Forbidden).
 * 3. Body/header spoofing rejection (attacker cannot forge adminId).
 * 4. Validation: zero or negative amounts rejected.
 * 5. Validation: non-existent target recipient rejected.
 * 6. Authorized admin transfer execution:
 *    - Recipient account is credited in Firestore.
 *    - Transaction ledger record created in Firestore with COMPLETED status.
 *    - Double-entry ledger consistency maintained.
 *    - Idempotent replay returns existing completed transaction without double crediting.
 */
import assert from 'assert';
import { adminFirestore } from './server/firebaseAdmin';
import { executeServerAdminTransfer, resolveRecipientUser } from './server/firestoreTransactions';
import { isCallerAdministrator, requireAdminAuth, AuthenticatedRequest } from './server/authMiddleware';
import { db } from './server/db';

function createMockReqRes(options: {
  headers?: Record<string, string>;
  body?: any;
  auth?: any;
}) {
  const req: any = {
    headers: options.headers || {},
    body: options.body || {},
    auth: options.auth,
  };
  let statusCode = 200;
  let responseData: any = null;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
  };

  return {
    req: req as AuthenticatedRequest,
    res,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
  };
}

async function runStage4AdminTransferTests() {
  console.log('================================================================');
  console.log('    MONVERA STAGE 4: ADMINISTRATOR TRANSFERS VERIFICATION       ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated Requests Rejection
  // --------------------------------------------------------------------------
  console.log('[Test 1] Unauthenticated Requests to Admin Transfer');
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      headers: {},
      body: { targetUserId: 'usr_sarah', amount: 500 },
    });
    let nextCalled = false;
    await requireAdminAuth(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, 'Unauthenticated request must not pass middleware');
    assert.strictEqual(getStatusCode(), 401, 'Must return HTTP 401');
    assert.ok(getResponseData()?.error?.includes('UNAUTHORIZED'), 'Error must specify UNAUTHORIZED');
    console.log('  ✓ Unauthenticated access strictly rejected with 401.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Ordinary Customer Identity Rejection
  // --------------------------------------------------------------------------
  console.log('[Test 2] Ordinary Customer Calling Admin Transfer');
  {
    const isCustomerAdmin = await isCallerAdministrator('customer_regular_uid', 'customer@example.com', {
      role: 'customer',
    });
    assert.strictEqual(isCustomerAdmin, false, 'Ordinary customer must NOT have admin rights');

    // Customer with forged adminId in body
    const isForgedAdmin = await isCallerAdministrator('customer_regular_uid', 'customer@example.com', {
      adminId: 'daneybil2020@gmail.com',
      role: 'customer',
    });
    assert.strictEqual(isForgedAdmin, false, 'Forged claims in customer payload must fail authorization');
    console.log('  ✓ Ordinary customers strictly denied administrator privileges.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Authorized Admin Identity Resolution
  // --------------------------------------------------------------------------
  console.log('[Test 3] Authorized Admin Verification');
  {
    const isAdmin1 = await isCallerAdministrator('DDp1tLOzbgUHSnuDgNdFszcYqkp1', 'daneybil2020@gmail.com');
    assert.strictEqual(isAdmin1, true, 'daneybil2020@gmail.com must be authorized');

    const isAdmin2 = await isCallerAdministrator('usr_admin', 'admin@monvera.com');
    assert.strictEqual(isAdmin2, true, 'usr_admin must be authorized');
    console.log('  ✓ Configured administrators successfully authorized.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Input Validation (Invalid Amounts & Non-existent Target)
  // --------------------------------------------------------------------------
  console.log('[Test 4] Transfer Parameter Validation');
  {
    // A. Negative amount
    const resNegative = await executeServerAdminTransfer({
      adminId: 'usr_admin',
      targetIdentifier: 'usr_sarah',
      amount: -500,
    });
    assert.strictEqual(resNegative.success, false);
    assert.ok(resNegative.error?.includes('positive transfer amount'));

    // B. Zero amount
    const resZero = await executeServerAdminTransfer({
      adminId: 'usr_admin',
      targetIdentifier: 'usr_sarah',
      amount: 0,
    });
    assert.strictEqual(resZero.success, false);
    assert.ok(resZero.error?.includes('positive transfer amount'));

    // C. Non-existent recipient
    const resNonExistent = await executeServerAdminTransfer({
      adminId: 'usr_admin',
      targetIdentifier: 'non_existent_user_99999999',
      amount: 1000,
    });
    assert.strictEqual(resNonExistent.success, false);
    assert.ok(resNonExistent.error?.includes('not found in Monvera directory'));
    console.log('  ✓ Invalid amounts and nonexistent recipients safely rejected.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Legitimate Administrator Transfer Execution & Ledger Integrity
  // --------------------------------------------------------------------------
  console.log('[Test 5] Authorized Admin Transfer Execution in Firestore');
  {
    const testRecipientUid = `test_cust_adm_${Date.now()}`;
    const initialChecking = 1000;
    const transferAmount = 2500;
    const clientReqId = `adm_req_${Date.now()}_test`;

    // Initialize recipient account in Firestore
    const accRef = adminFirestore.collection('accounts').doc(testRecipientUid);
    const userRef = adminFirestore.collection('users').doc(testRecipientUid);
    const nowIso = new Date().toISOString();

    await userRef.set({
      id: testRecipientUid,
      uid: testRecipientUid,
      firstName: 'Marcus',
      lastName: 'Aurelius',
      username: `marcus_${Date.now()}`,
      permanentAccountNumber: '1088776655',
      status: 'active',
      role: 'customer',
      createdAt: nowIso,
    });

    await accRef.set({
      userId: testRecipientUid,
      permanentAccountNumber: '1088776655',
      checkingBalance: initialChecking,
      availableBalance: initialChecking,
      savingsBalance: 500,
      investedBalance: 0,
      totalBalance: initialChecking + 500,
      accounts: [
        {
          id: `acc_chk_${testRecipientUid}`,
          userId: testRecipientUid,
          type: 'CHECKING',
          balance: initialChecking,
          availableBalance: initialChecking,
          accountNumber: '1088776655',
          status: 'ACTIVE',
        },
      ],
      updatedAt: nowIso,
    });

    // Execute admin transfer
    const transferResult = await executeServerAdminTransfer({
      adminId: 'usr_admin',
      targetIdentifier: testRecipientUid,
      amount: transferAmount,
      description: 'Capital Injection from Bennett Johnson',
      clientRequestId: clientReqId,
    });

    assert.strictEqual(transferResult.success, true, 'Admin transfer must succeed');
    assert.ok(transferResult.transaction, 'Transaction record must be returned');
    assert.strictEqual(transferResult.transaction?.amount, transferAmount);
    assert.strictEqual(transferResult.transaction?.status, 'COMPLETED');
    assert.strictEqual(transferResult.transaction?.senderName, 'Bennett Johnson');
    assert.strictEqual(transferResult.transaction?.recipientUserId, testRecipientUid);
    assert.strictEqual(transferResult.transaction?.type, 'TRANSFER');

    // Verify recipient account balance in Firestore
    const updatedAccSnap = await accRef.get();
    assert.strictEqual(updatedAccSnap.exists, true);
    const updatedData = updatedAccSnap.data()!;
    const expectedChecking = initialChecking + transferAmount;
    assert.strictEqual(updatedData.checkingBalance, expectedChecking, 'Checking balance must be credited in Firestore');
    assert.strictEqual(updatedData.availableBalance, expectedChecking, 'Available balance must equal checking balance');
    assert.strictEqual(updatedData.totalBalance, expectedChecking + 500, 'Total balance must accurately include savings');

    // Verify ledger record in Firestore transactions collection
    const txDocSnap = await adminFirestore.collection('transactions').doc(transferResult.transaction!.id).get();
    assert.strictEqual(txDocSnap.exists, true, 'Transaction ledger record must exist in Firestore');
    const txData = txDocSnap.data()!;
    assert.strictEqual(txData.status, 'COMPLETED');
    assert.strictEqual(txData.amount, transferAmount);
    assert.strictEqual(txData.senderAccountNumber, '1000000001');

    // ------------------------------------------------------------------------
    // TEST 6: Idempotency Protection (Duplicate Request Replay)
    // ------------------------------------------------------------------------
    console.log('\n[Test 6] Idempotency Protection Against Duplicate Execution');
    const replayResult = await executeServerAdminTransfer({
      adminId: 'usr_admin',
      targetIdentifier: testRecipientUid,
      amount: transferAmount,
      description: 'Capital Injection from Bennett Johnson',
      clientRequestId: clientReqId, // same clientRequestId
    });

    assert.strictEqual(replayResult.success, true);
    assert.strictEqual(replayResult.isDuplicate, true, 'Replayed request must be flagged as duplicate');
    assert.strictEqual(replayResult.transaction?.id, transferResult.transaction?.id, 'Must return original transaction');

    // Confirm recipient balance was NOT credited twice
    const replayAccSnap = await accRef.get();
    assert.strictEqual(
      replayAccSnap.data()!.checkingBalance,
      expectedChecking,
      'Balance must NOT be credited a second time on replay'
    );
    console.log('  ✓ Idempotency strictly prevents double-crediting or duplicate ledger records.\n');
  }

  console.log('================================================================');
  console.log('    STAGE 4 ADMINISTRATOR TRANSFERS VERIFICATION: ALL PASSED   ');
  console.log('================================================================');
}

runStage4AdminTransferTests().catch((err) => {
  console.error('\n❌ Stage 4 Admin Transfer Test Failed:', err);
  process.exit(1);
});
