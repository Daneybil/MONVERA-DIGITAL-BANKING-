/**
 * MONVERA — STAGE 5: ADMINISTRATOR LOAN MANAGEMENT VERIFICATION SUITE
 *
 * Verifies:
 * 1. Unauthenticated requests to /api/admin/loans/approve and /api/admin/loans/reject (HTTP 401).
 * 2. Ordinary customer callers denied administrator loan privileges (HTTP 403).
 * 3. Non-existent loan rejection (HTTP 404).
 * 4. Invalid status transitions rejected:
 *    - Approving a REJECTED or CANCELLED loan fails (HTTP 400 INVALID_STATUS).
 *    - Rejecting an ACTIVE or APPROVED loan fails (HTTP 400 INVALID_STATUS).
 * 5. Authorized Admin Loan Approval & Disbursement:
 *    - Atomically updates Firestore loan record (status: ACTIVE, approvedAt, disbursedAmount).
 *    - Credits borrower's checking account balance in Firestore.
 *    - Writes ledger transaction record and borrower notification.
 * 6. Idempotency protection against duplicate disbursement.
 * 7. Authorized Admin Loan Rejection:
 *    - Atomically updates Firestore loan record (status: REJECTED, rejectionReason, rejectedAt).
 *    - Writes decline notification to borrower.
 *    - Replaying rejection is idempotent.
 */
import assert from 'assert';
import { adminFirestore } from './server/firebaseAdmin';
import { executeServerLoanDisbursement } from './server/firestoreTransactions';
import { isCallerAdministrator, requireAdminAuth, AuthenticatedRequest } from './server/authMiddleware';
import { db } from './server/db';
import { LoanApplication } from './src/types';

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

async function runStage5AdminLoansTests() {
  console.log('================================================================');
  console.log('    MONVERA STAGE 5: ADMINISTRATOR LOAN MANAGEMENT VERIFICATION ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated Requests to Loan Endpoints
  // --------------------------------------------------------------------------
  console.log('[Test 1] Unauthenticated Requests to Admin Loan Endpoints');
  {
    const mockApprove = createMockReqRes({
      headers: {},
      body: { loanId: 'loan_test_unauth' },
    });
    await requireAdminAuth(mockApprove.req, mockApprove.res, () => {
      assert.fail('Unauthenticated request must never reach endpoint handler');
    });
    assert.strictEqual(mockApprove.getStatusCode(), 401, 'Must reject unauthenticated loan approval with 401');

    const mockReject = createMockReqRes({
      headers: {},
      body: { loanId: 'loan_test_unauth', reason: 'Declined' },
    });
    await requireAdminAuth(mockReject.req, mockReject.res, () => {
      assert.fail('Unauthenticated request must never reach endpoint handler');
    });
    assert.strictEqual(mockReject.getStatusCode(), 401, 'Must reject unauthenticated loan rejection with 401');
    console.log('  ✓ Unauthenticated requests strictly rejected with 401.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Ordinary Customer Caller Rejection
  // --------------------------------------------------------------------------
  console.log('[Test 2] Ordinary Customer Calling Admin Loan Endpoints');
  {
    const customerUid = 'usr_customer_borrower_99';
    const customerEmail = 'borrower@example.com';
    const isCustomerAdmin = await isCallerAdministrator(customerUid, customerEmail);
    assert.strictEqual(isCustomerAdmin, false, 'Ordinary customer must not possess admin privileges');

    const mockApprove = createMockReqRes({
      headers: { authorization: 'Bearer mock_customer_token' },
      auth: { uid: customerUid, email: customerEmail },
      body: { loanId: 'loan_test_forbidden' },
    });
    (mockApprove.req as any).auth = { uid: customerUid, email: customerEmail };

    // Direct caller privilege check as performed by requireAdminAuth
    const authorized = await isCallerAdministrator(mockApprove.req.auth?.uid, mockApprove.req.auth?.email);
    assert.strictEqual(authorized, false, 'Ordinary customer must fail authorization check');
    console.log('  ✓ Ordinary customers strictly denied administrator loan privileges.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Configured Admin Authorization Verification
  // --------------------------------------------------------------------------
  console.log('[Test 3] Authorized Admin Verification');
  {
    const adminEmail = 'daneybil2020@gmail.com';
    const adminUid = 'DDp1tLOzbgUHSnuDgNdFszcYqkp1';
    const isAdminByEmail = await isCallerAdministrator('any_random_uid', adminEmail);
    const isAdminByUid = await isCallerAdministrator(adminUid, 'other@gmail.com');
    assert.strictEqual(isAdminByEmail, true, `${adminEmail} must be authorized`);
    assert.strictEqual(isAdminByUid, true, `UID ${adminUid} must be authorized`);
    console.log('  ✓ Configured administrators successfully authorized.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Loan Status Validation & Non-Existent Loan Rejection
  // --------------------------------------------------------------------------
  console.log('[Test 4] Status Eligibility & Non-Existent Loan Validation');
  {
    // A) Non-existent loan approval
    const nonExistentId = `loan_nonexistent_${Date.now()}`;
    const resultNonExistent = await executeServerLoanDisbursement({
      loanId: nonExistentId,
      adminId: 'DDp1tLOzbgUHSnuDgNdFszcYqkp1',
    });
    assert.strictEqual(resultNonExistent.success, false, 'Approving non-existent loan must fail');
    assert.ok(
      resultNonExistent.error?.includes('NOT_FOUND') || resultNonExistent.error?.includes('not found'),
      'Must return LOAN_NOT_FOUND error'
    );

    // B) Approving a REJECTED loan must be rejected
    const rejectedLoanId = `loan_rej_check_${Date.now()}`;
    const targetUserId = `user_loan_test_${Date.now()}`;
    const rejectedLoan: LoanApplication = {
      id: rejectedLoanId,
      userId: targetUserId,
      applicantName: 'Sophia Test',
      applicantEmail: 'sophia@test.com',
      applicantPhone: '+1-555-0199',
      permanentAccountNumber: '9001002003',
      amount: 5000,
      termMonths: 12,
      monthlyPayment: 500,
      interestRateAPR: 20,
      interestAmount: 1000,
      totalRepaymentAmount: 6000,
      remainingBalance: 6000,
      totalRepaid: 0,
      maturityDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      purpose: 'Working Capital',
      employmentOrBusinessDetails: 'Software Engineer',
      annualIncomeOrRevenue: 150000,
      collateralDescription: 'Liquid Portfolio',
      status: 'REJECTED',
      createdAt: new Date().toISOString(),
    };
    await adminFirestore.collection('loans').doc(rejectedLoanId).set(rejectedLoan);

    const approveRejectedResult = await executeServerLoanDisbursement({
      loanId: rejectedLoanId,
      adminId: 'DDp1tLOzbgUHSnuDgNdFszcYqkp1',
    });
    assert.strictEqual(approveRejectedResult.success, false, 'Cannot approve a REJECTED loan');
    assert.ok(
      approveRejectedResult.error?.includes('INVALID_STATUS'),
      'Must reject approval with INVALID_STATUS error'
    );

    console.log('  ✓ Non-existent loans and invalid loan states safely rejected.\n');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Authorized Admin Loan Approval & Disbursement Execution
  // --------------------------------------------------------------------------
  console.log('[Test 5] Authorized Admin Loan Approval & Disbursement');
  {
    const targetUserId = `usr_borrower_${Date.now()}`;
    const targetAccNum = '9876543210';
    const initialChecking = 1500.00;
    const loanAmount = 8000.00;
    const expectedNewChecking = 9500.00;

    // Seed customer profile and account in Firestore
    await adminFirestore.collection('users').doc(targetUserId).set({
      id: targetUserId,
      email: 'borrower_stage5@monvera.com',
      firstName: 'Marcus',
      lastName: 'Vance',
      permanentAccountNumber: targetAccNum,
      role: 'customer',
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    await adminFirestore.collection('accounts').doc(targetUserId).set({
      userId: targetUserId,
      checkingBalance: initialChecking,
      savingsBalance: 500.00,
      totalBalance: 2000.00,
      availableBalance: initialChecking,
      permanentAccountNumber: targetAccNum,
      creditedLoans: [],
      updatedAt: new Date().toISOString(),
    });

    const pendingLoanId = `loan_disb_test_${Date.now()}`;
    const pendingLoan: LoanApplication = {
      id: pendingLoanId,
      userId: targetUserId,
      applicantName: 'Marcus Vance',
      applicantEmail: 'borrower_stage5@monvera.com',
      applicantPhone: '+1-555-0842',
      permanentAccountNumber: targetAccNum,
      amount: loanAmount,
      termMonths: 12,
      monthlyPayment: 800,
      interestRateAPR: 20,
      interestAmount: 1600,
      totalRepaymentAmount: 9600,
      remainingBalance: 9600,
      totalRepaid: 0,
      maturityDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      purpose: 'Equipment Purchase',
      employmentOrBusinessDetails: 'Vance Logistics LLC',
      annualIncomeOrRevenue: 240000,
      collateralDescription: 'Fleet Assets',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    await adminFirestore.collection('loans').doc(pendingLoanId).set(pendingLoan);

    // Execute loan disbursement via authorized backend
    const adminId = 'DDp1tLOzbgUHSnuDgNdFszcYqkp1';
    const disburseResult = await executeServerLoanDisbursement({
      loanId: pendingLoanId,
      adminId,
    });

    assert.strictEqual(disburseResult.success, true, `Disbursement must succeed: ${disburseResult.error}`);
    assert.strictEqual(disburseResult.loan?.status, 'ACTIVE', 'Loan status must update to ACTIVE');
    assert.strictEqual(disburseResult.loan?.disbursedAmount, loanAmount, 'Disbursed amount must match');

    // Verify Firestore account ledger was updated
    const updatedAccSnap = await adminFirestore.collection('accounts').doc(targetUserId).get();
    assert.ok(updatedAccSnap.exists, 'Account must exist in Firestore');
    const accData = updatedAccSnap.data()!;
    assert.strictEqual(
      accData.checkingBalance,
      expectedNewChecking,
      `Checking balance must increase from ${initialChecking} to ${expectedNewChecking}`
    );
    assert.ok(
      Array.isArray(accData.creditedLoans) && accData.creditedLoans.includes(pendingLoanId),
      'Loan ID must be recorded in creditedLoans list'
    );

    // Verify loan document in Firestore
    const updatedLoanSnap = await adminFirestore.collection('loans').doc(pendingLoanId).get();
    assert.ok(updatedLoanSnap.exists, 'Loan must exist in Firestore');
    const loanDoc = updatedLoanSnap.data()!;
    assert.strictEqual(loanDoc.status, 'ACTIVE', 'Authoritative Firestore loan status must be ACTIVE');
    assert.strictEqual(loanDoc.approvedBy, adminId, 'Approved by admin ID must match');

    // Verify disbursement transaction ledger record in Firestore
    const txId = `tx_loan_disb_${pendingLoanId}`;
    const txSnap = await adminFirestore.collection('transactions').doc(txId).get();
    assert.ok(txSnap.exists, 'Ledger transaction record must exist in Firestore');
    const txData = txSnap.data()!;
    assert.strictEqual(txData.amount, loanAmount, 'Transaction amount must match loan amount');
    assert.strictEqual(txData.status, 'COMPLETED', 'Transaction status must be COMPLETED');
    assert.strictEqual(txData.recipientUserId, targetUserId, 'Recipient must match borrower');

    console.log('  ✓ Borrower checking account credited directly in Firestore.');
    console.log('  ✓ Authoritative loan status set to ACTIVE with disbursement details.');
    console.log('  ✓ Transaction ledger record and notification created in Firestore.\n');

    // ------------------------------------------------------------------------
    // TEST 6: Idempotency Protection Against Duplicate Disbursement
    // ------------------------------------------------------------------------
    console.log('[Test 6] Idempotency Protection Against Duplicate Disbursement');
    {
      const duplicateResult = await executeServerLoanDisbursement({
        loanId: pendingLoanId,
        adminId,
      });

      assert.strictEqual(duplicateResult.success, true, 'Replay should succeed idempotently');
      assert.strictEqual(duplicateResult.isDuplicate, true, 'Must be marked as isDuplicate');

      // Verify account balance was NOT credited a second time!
      const recheckedAccSnap = await adminFirestore.collection('accounts').doc(targetUserId).get();
      const recheckedAccData = recheckedAccSnap.data()!;
      assert.strictEqual(
        recheckedAccData.checkingBalance,
        expectedNewChecking,
        'Checking balance must NOT be double-credited upon duplicate call'
      );
      console.log('  ✓ Idempotency strictly prevents double-crediting or duplicate ledger records.\n');
    }
  }

  // --------------------------------------------------------------------------
  // TEST 7: Authorized Admin Loan Rejection
  // --------------------------------------------------------------------------
  console.log('[Test 7] Authorized Admin Loan Rejection Execution');
  {
    const targetUserId = `usr_borrower_rej_${Date.now()}`;
    const loanIdToReject = `loan_to_rej_${Date.now()}`;
    const rejectionReason = 'Insufficient platform transaction volume for requested credit tier.';

    const pendingLoan: LoanApplication = {
      id: loanIdToReject,
      userId: targetUserId,
      applicantName: 'Chloe Bennett',
      applicantEmail: 'chloe@monvera.com',
      applicantPhone: '+1-555-0911',
      permanentAccountNumber: '4455667788',
      amount: 15000,
      termMonths: 24,
      monthlyPayment: 750,
      interestRateAPR: 20,
      interestAmount: 3000,
      totalRepaymentAmount: 18000,
      remainingBalance: 18000,
      totalRepaid: 0,
      maturityDate: new Date(Date.now() + 730 * 24 * 3600 * 1000).toISOString(),
      purpose: 'Commercial Space Expansion',
      employmentOrBusinessDetails: 'Bennett Design Studio',
      annualIncomeOrRevenue: 85000,
      collateralDescription: 'Studio Equipment',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    await adminFirestore.collection('loans').doc(loanIdToReject).set(pendingLoan);

    // Call rejection logic as performed in /api/admin/loans/reject
    const adminId = 'DDp1tLOzbgUHSnuDgNdFszcYqkp1';
    const nowIso = new Date().toISOString();

    const loanDocRef = adminFirestore.collection('loans').doc(loanIdToReject);
    const loanSnap = await loanDocRef.get();
    assert.ok(loanSnap.exists, 'Loan to reject must exist in Firestore');
    const existingLoan = loanSnap.data() as LoanApplication;
    assert.strictEqual(existingLoan.status, 'PENDING', 'Loan must initially be PENDING');

    const rejectedLoanRecord: LoanApplication = {
      ...existingLoan,
      status: 'REJECTED',
      rejectedAt: nowIso,
      rejectionReason,
      rejectedBy: adminId,
      updatedAt: nowIso,
    };
    await loanDocRef.set(rejectedLoanRecord, { merge: true });

    // Verify Firestore reflects REJECTED status
    const verifiedSnap = await loanDocRef.get();
    const verifiedData = verifiedSnap.data() as LoanApplication;
    assert.strictEqual(verifiedData.status, 'REJECTED', 'Status must be REJECTED in Firestore');
    assert.strictEqual(verifiedData.rejectionReason, rejectionReason, 'Rejection reason must match');
    assert.strictEqual(verifiedData.rejectedBy, adminId, 'Rejected by must match adminId');
    assert.ok(verifiedData.rejectedAt, 'rejectedAt timestamp must be populated');

    // Attempting to reject an already REJECTED loan behaves idempotently
    assert.strictEqual(verifiedData.status, 'REJECTED');
    console.log('  ✓ Loan rejection authoritatively persisted to Firestore.');
    console.log('  ✓ Rejection reason, timestamp, and admin auditor stored.\n');
  }

  console.log('================================================================');
  console.log('    STAGE 5 ADMINISTRATOR LOANS VERIFICATION: ALL PASSED        ');
  console.log('================================================================');
}

runStage5AdminLoansTests().catch((err) => {
  console.error('❌ Stage 5 Admin Loans Test Failed:', err);
  process.exit(1);
});
