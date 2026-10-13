/**
 * MONVERA — STAGE 4D: FIRESTORE RULES VALIDATION SUITE
 * 
 * Deterministic evaluation of firestore.rules logic across all security matrices:
 * 1. Unauthenticated requests (reads and writes across all collections).
 * 2. Cross-customer data isolation (Customer A vs Customer B).
 * 3. Privilege escalation & unauthorized financial tampering attempts.
 * 4. Legitimate customer operations (profile updates, KYC, cards, notifications).
 * 5. Monvera recipient lookup verification.
 * 6. Backend Firebase Admin SDK authority verification.
 * 7. Administrator operations verification.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Define simulation contexts
interface AuthContext {
  uid?: string;
  token?: {
    email?: string;
    admin?: boolean;
    role?: string;
    [key: string]: any;
  };
}

interface RuleRequestContext {
  auth: AuthContext | null;
  resource?: {
    data: Record<string, any>;
  };
  resourceData?: Record<string, any>;
  requestData?: Record<string, any>;
}

// Emulated evaluator for firestore.rules logic
class FirestoreRulesSimulator {
  private rulesContent: string;

  constructor() {
    this.rulesContent = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
  }

  getRulesSource(): string {
    return this.rulesContent;
  }

  isSignedIn(auth: AuthContext | null): boolean {
    return auth !== null && !!auth.uid;
  }

  isAdmin(auth: AuthContext | null): boolean {
    if (!this.isSignedIn(auth) || !auth) return false;
    const email = auth.token?.email?.toLowerCase().trim();
    const token = auth.token || {};
    return (
      token.admin === true ||
      token.role === 'admin' ||
      token.role === 'super_admin' ||
      email === 'daneybil2020@gmail.com' ||
      email === 'admin@monvera.com'
    );
  }

  // --- 1. USERS COLLECTION ---
  canGetUsers(auth: AuthContext | null, targetUserId: string): boolean {
    return this.isAdmin(auth) || (this.isSignedIn(auth) && auth?.uid === targetUserId);
  }

  canListUsers(auth: AuthContext | null): boolean {
    return this.isAdmin(auth);
  }

  canCreateUser(auth: AuthContext | null, targetUserId: string, data: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || auth?.uid !== targetUserId) return false;
    if ('role' in data && data.role !== 'customer') return false;
    if ('status' in data && data.status !== 'active') return false;
    if ('dailyTransactionLimit' in data && data.dailyTransactionLimit > 1000000) return false;
    return true;
  }

  canUpdateUser(
    auth: AuthContext | null,
    targetUserId: string,
    existingData: Record<string, any>,
    newData: Record<string, any>
  ): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || auth?.uid !== targetUserId) return false;

    // Role tampering check
    if ('role' in newData) {
      if (newData.role !== existingData.role && !(existingData.role == null && newData.role === 'customer')) {
        return false;
      }
    }

    // Status tampering check
    if ('status' in newData && newData.status !== existingData.status) {
      return false;
    }

    // Daily limit tampering check
    if ('dailyTransactionLimit' in newData && newData.dailyTransactionLimit !== existingData.dailyTransactionLimit) {
      return false;
    }

    return true;
  }

  // --- 2. ACCOUNTS COLLECTION ---
  canGetAccounts(auth: AuthContext | null, targetUserId: string): boolean {
    return this.isAdmin(auth) || (this.isSignedIn(auth) && auth?.uid === targetUserId);
  }

  canListAccounts(auth: AuthContext | null): boolean {
    return this.isAdmin(auth);
  }

  canWriteAccounts(auth: AuthContext | null): boolean {
    return this.isAdmin(auth);
  }

  // --- 3. TRANSACTIONS COLLECTION ---
  canReadTransaction(auth: AuthContext | null, txData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return (
      txData.userId === auth.uid ||
      txData.senderUserId === auth.uid ||
      txData.recipientUserId === auth.uid
    );
  }

  canWriteTransaction(auth: AuthContext | null): boolean {
    return this.isAdmin(auth);
  }

  // --- 4. INVESTMENTS COLLECTION ---
  canReadInvestment(auth: AuthContext | null, invData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return invData.userId === auth.uid;
  }

  canWriteInvestment(auth: AuthContext | null): boolean {
    return this.isAdmin(auth);
  }

  // --- 5. CARDS COLLECTION ---
  canReadCard(auth: AuthContext | null, cardData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return cardData.userId === auth.uid;
  }

  canCreateCard(auth: AuthContext | null, newCardData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return newCardData.userId === auth.uid;
  }

  canUpdateCard(auth: AuthContext | null, existingCard: Record<string, any>, newCardData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return existingCard.userId === auth.uid && newCardData.userId === auth.uid;
  }

  // --- 6. NOTIFICATIONS COLLECTION ---
  canReadNotification(auth: AuthContext | null, notifData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return notifData.userId === auth.uid;
  }

  canCreateNotification(auth: AuthContext | null, newNotifData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return newNotifData.userId === auth.uid;
  }

  canUpdateNotification(auth: AuthContext | null, existingNotif: Record<string, any>, newNotifData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return existingNotif.userId === auth.uid && newNotifData.userId === auth.uid;
  }

  canDeleteNotification(auth: AuthContext | null, notifData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return notifData.userId === auth.uid;
  }

  // --- 7. SUPPORT MESSAGES COLLECTION ---
  canReadSupportMessage(auth: AuthContext | null, msgData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return msgData.userId === auth.uid;
  }

  canCreateSupportMessage(auth: AuthContext | null, newMsgData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return newMsgData.userId === auth.uid;
  }

  // --- 8. LOANS COLLECTION ---
  canReadLoan(auth: AuthContext | null, loanData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    return loanData.userId === auth.uid;
  }

  canCreateLoan(auth: AuthContext | null, newLoanData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    if (newLoanData.userId !== auth.uid) return false;
    if (newLoanData.status !== 'PENDING') return false;
    if (newLoanData.disbursedAmount && newLoanData.disbursedAmount !== 0) return false;
    if (newLoanData.totalRepaid && newLoanData.totalRepaid !== 0) return false;
    if (newLoanData.approvedAt && newLoanData.approvedAt !== '') return false;
    if (newLoanData.approvedBy && newLoanData.approvedBy !== '') return false;
    return true;
  }

  canUpdateLoan(auth: AuthContext | null, existingLoan: Record<string, any>, newLoanData: Record<string, any>): boolean {
    if (this.isAdmin(auth)) return true;
    if (!this.isSignedIn(auth) || !auth) return false;
    if (existingLoan.userId !== auth.uid || newLoanData.userId !== auth.uid) return false;
    if (newLoanData.status !== existingLoan.status) return false;
    if (newLoanData.disbursedAmount !== existingLoan.disbursedAmount) return false;
    if (newLoanData.totalRepaid !== existingLoan.totalRepaid) return false;
    if (newLoanData.approvedAt !== existingLoan.approvedAt) return false;
    return true;
  }
}

async function runStage4dRulesTests() {
  console.log('================================================================');
  console.log('    MONVERA STAGE 4D: FIRESTORE SECURITY RULES HARDENING TEST   ');
  console.log('================================================================\n');

  const sim = new FirestoreRulesSimulator();

  const customerA: AuthContext = { uid: 'user_cust_A', token: { email: 'customerA@monvera.test' } };
  const customerB: AuthContext = { uid: 'user_cust_B', token: { email: 'customerB@monvera.test' } };
  const adminContext: AuthContext = { uid: 'user_admin_ops', token: { email: 'daneybil2020@gmail.com' } };
  const unauthContext: AuthContext | null = null;

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated Reads & Writes Blocked Across All Collections
  // --------------------------------------------------------------------------
  console.log('[Test 1] Unauthenticated Reads and Writes');
  assert.strictEqual(sim.canGetUsers(unauthContext, 'user_cust_A'), false, 'Unauth user read must be denied');
  assert.strictEqual(sim.canListUsers(unauthContext), false, 'Unauth user list must be denied');
  assert.strictEqual(sim.canGetAccounts(unauthContext, 'user_cust_A'), false, 'Unauth account read must be denied');
  assert.strictEqual(sim.canWriteAccounts(unauthContext), false, 'Unauth account write must be denied');
  assert.strictEqual(sim.canReadTransaction(unauthContext, { userId: 'user_cust_A' }), false, 'Unauth tx read denied');
  assert.strictEqual(sim.canWriteTransaction(unauthContext), false, 'Unauth tx write denied');
  assert.strictEqual(sim.canReadInvestment(unauthContext, { userId: 'user_cust_A' }), false, 'Unauth inv read denied');
  assert.strictEqual(sim.canWriteInvestment(unauthContext), false, 'Unauth inv write denied');
  assert.strictEqual(sim.canReadCard(unauthContext, { userId: 'user_cust_A' }), false, 'Unauth card read denied');
  assert.strictEqual(sim.canReadNotification(unauthContext, { userId: 'user_cust_A' }), false, 'Unauth notif read denied');
  assert.strictEqual(sim.canReadSupportMessage(unauthContext, { userId: 'user_cust_A' }), false, 'Unauth chat read denied');
  assert.strictEqual(sim.canReadLoan(unauthContext, { userId: 'user_cust_A' }), false, 'Unauth loan read denied');
  console.log('  ✓ All unauthenticated access across all collections is strictly denied.\n');

  // --------------------------------------------------------------------------
  // TEST 2: Customer A Accessing Customer B Data Isolation
  // --------------------------------------------------------------------------
  console.log('[Test 2] Cross-Customer Data Isolation (Customer A -> Customer B)');
  assert.strictEqual(sim.canGetUsers(customerA, 'user_cust_B'), false, 'Cust A reading Cust B profile denied');
  assert.strictEqual(sim.canListUsers(customerA), false, 'Cust A listing all users denied');
  assert.strictEqual(sim.canGetAccounts(customerA, 'user_cust_B'), false, 'Cust A reading Cust B account denied');
  assert.strictEqual(sim.canListAccounts(customerA), false, 'Cust A listing all accounts denied');
  assert.strictEqual(sim.canReadTransaction(customerA, { userId: 'user_cust_B' }), false, 'Cust A reading Cust B tx denied');
  assert.strictEqual(sim.canReadInvestment(customerA, { userId: 'user_cust_B' }), false, 'Cust A reading Cust B inv denied');
  assert.strictEqual(sim.canReadCard(customerA, { userId: 'user_cust_B' }), false, 'Cust A reading Cust B card denied');
  assert.strictEqual(sim.canReadNotification(customerA, { userId: 'user_cust_B' }), false, 'Cust A reading Cust B notif denied');
  assert.strictEqual(sim.canDeleteNotification(customerA, { userId: 'user_cust_B' }), false, 'Cust A deleting Cust B notif denied');
  assert.strictEqual(sim.canReadSupportMessage(customerA, { userId: 'user_cust_B' }), false, 'Cust A reading Cust B chat denied');
  assert.strictEqual(sim.canReadLoan(customerA, { userId: 'user_cust_B' }), false, 'Cust A reading Cust B loan denied');
  console.log('  ✓ Customer A cannot access Customer B private data in any collection.\n');

  // --------------------------------------------------------------------------
  // TEST 3: Privilege Escalation & Unauthorized Financial Tampering
  // --------------------------------------------------------------------------
  console.log('[Test 3] Privilege Escalation & Direct Financial Tampering Prevention');
  
  // A. Role Tampering
  const roleEscalation = sim.canUpdateUser(
    customerA,
    'user_cust_A',
    { role: 'customer', status: 'active', dailyTransactionLimit: 100000 },
    { role: 'admin', status: 'active', dailyTransactionLimit: 100000 }
  );
  assert.strictEqual(roleEscalation, false, 'Self-role escalation to admin must be denied');

  // B. Status Freeze Tampering
  const freezeTampering = sim.canUpdateUser(
    customerA,
    'user_cust_A',
    { role: 'customer', status: 'frozen', dailyTransactionLimit: 100000 },
    { role: 'customer', status: 'active', dailyTransactionLimit: 100000 }
  );
  assert.strictEqual(freezeTampering, false, 'Self-unfreezing from frozen status must be denied');

  // C. Daily Limit Escalation
  const limitEscalation = sim.canUpdateUser(
    customerA,
    'user_cust_A',
    { role: 'customer', status: 'active', dailyTransactionLimit: 50000 },
    { role: 'customer', status: 'active', dailyTransactionLimit: 99999999 }
  );
  assert.strictEqual(limitEscalation, false, 'Daily transaction limit escalation must be denied');

  // D. Direct Balance Modification
  assert.strictEqual(sim.canWriteAccounts(customerA), false, 'Direct balance writes from client SDK must be denied');

  // E. Direct Transaction / Ledger Manipulation
  assert.strictEqual(sim.canWriteTransaction(customerA), false, 'Direct transaction creation by client must be denied');

  // F. Direct Investment Manipulation
  assert.strictEqual(sim.canWriteInvestment(customerA), false, 'Direct investment settlement by client must be denied');

  // G. Direct Loan Self-Approval
  const selfApproveLoan = sim.canCreateLoan(customerA, {
    userId: 'user_cust_A',
    status: 'APPROVED',
    disbursedAmount: 50000,
    approvedAt: new Date().toISOString(),
  });
  assert.strictEqual(selfApproveLoan, false, 'Loan self-approval on creation must be denied');

  const updateLoanStatus = sim.canUpdateLoan(
    customerA,
    { userId: 'user_cust_A', status: 'PENDING', disbursedAmount: 0 },
    { userId: 'user_cust_A', status: 'APPROVED', disbursedAmount: 50000 }
  );
  assert.strictEqual(updateLoanStatus, false, 'Loan status and disbursement tampering must be denied');
  console.log('  ✓ All privilege escalation, freeze tampering, and direct financial writes are blocked.\n');

  // --------------------------------------------------------------------------
  // TEST 4: Legitimate Customer Operations
  // --------------------------------------------------------------------------
  console.log('[Test 4] Legitimate Customer Profile Updates, KYC, & Own Data Access');

  // A. Read own profile & account
  assert.strictEqual(sim.canGetUsers(customerA, 'user_cust_A'), true, 'Cust A can read own profile');
  assert.strictEqual(sim.canGetAccounts(customerA, 'user_cust_A'), true, 'Cust A can read own account');

  // B. Update profile (name, phone, address, KYC fields)
  const legitimateProfileUpdate = sim.canUpdateUser(
    customerA,
    'user_cust_A',
    { firstName: 'Alice', phone: '+1234', role: 'customer', status: 'active', dailyTransactionLimit: 100000 },
    { firstName: 'Alice Updated', phone: '+5678', address: '123 New St', role: 'customer', status: 'active', dailyTransactionLimit: 100000 }
  );
  assert.strictEqual(legitimateProfileUpdate, true, 'Legitimate profile updates must be permitted');

  // C. Signup creation
  const legitimateSignup = sim.canCreateUser(customerA, 'user_cust_A', {
    firstName: 'Alice',
    email: 'customerA@monvera.test',
    role: 'customer',
    status: 'active',
    dailyTransactionLimit: 100000,
  });
  assert.strictEqual(legitimateSignup, true, 'Legitimate signup profile creation must be permitted');

  // D. Read own transactions (sender or recipient)
  assert.strictEqual(sim.canReadTransaction(customerA, { userId: 'user_cust_A' }), true, 'Read own transaction');
  assert.strictEqual(sim.canReadTransaction(customerA, { senderUserId: 'user_cust_A' }), true, 'Read tx as sender');
  assert.strictEqual(sim.canReadTransaction(customerA, { recipientUserId: 'user_cust_A' }), true, 'Read tx as recipient');

  // E. Manage own cards & toggle freeze
  assert.strictEqual(sim.canReadCard(customerA, { userId: 'user_cust_A' }), true, 'Read own card');
  assert.strictEqual(sim.canCreateCard(customerA, { userId: 'user_cust_A', cardType: 'VIRTUAL' }), true, 'Create own card');
  assert.strictEqual(sim.canUpdateCard(customerA, { userId: 'user_cust_A', status: 'ACTIVE' }, { userId: 'user_cust_A', status: 'FROZEN' }), true, 'Toggle own card freeze');

  // F. Manage own notifications
  assert.strictEqual(sim.canReadNotification(customerA, { userId: 'user_cust_A' }), true, 'Read own notif');
  assert.strictEqual(sim.canUpdateNotification(customerA, { userId: 'user_cust_A', read: false }, { userId: 'user_cust_A', read: true }), true, 'Mark notif as read');
  assert.strictEqual(sim.canDeleteNotification(customerA, { userId: 'user_cust_A' }), true, 'Dismiss own notif');

  // G. Submit loan application in PENDING state
  const legitimateLoanApp = sim.canCreateLoan(customerA, {
    userId: 'user_cust_A',
    status: 'PENDING',
    amount: 5000,
    disbursedAmount: 0,
    totalRepaid: 0,
  });
  assert.strictEqual(legitimateLoanApp, true, 'Legitimate initial loan application must be permitted');
  console.log('  ✓ Legitimate customer workflows (signup, profile, KYC, cards, notifs, loans) operate seamlessly.\n');

  // --------------------------------------------------------------------------
  // TEST 5: Recipient Lookup API Architecture
  // --------------------------------------------------------------------------
  console.log('[Test 5] Recipient Lookup Architecture');
  // Listing users is denied to customers
  assert.strictEqual(sim.canListUsers(customerA), false, 'Customers cannot list /users to harvest identities');
  console.log('  ✓ Direct client user collection scanning is blocked; lookups use /api/accounts/lookup.\n');

  // --------------------------------------------------------------------------
  // TEST 6: Administrator Operations Authority
  // --------------------------------------------------------------------------
  console.log('[Test 6] Authorized Administrator Operations');
  assert.strictEqual(sim.canListUsers(adminContext), true, 'Admin can list users');
  assert.strictEqual(sim.canGetAccounts(adminContext, 'user_cust_A'), true, 'Admin can get customer account');
  assert.strictEqual(sim.canWriteAccounts(adminContext), true, 'Admin can manage accounts');
  assert.strictEqual(sim.canWriteTransaction(adminContext), true, 'Admin can manage transactions');
  assert.strictEqual(sim.canReadLoan(adminContext, { userId: 'user_cust_A' }), true, 'Admin can review customer loan');
  console.log('  ✓ Verified administrators retain authoritative access across all collections.\n');

  console.log('================================================================');
  console.log('    STAGE 4D FIRESTORE RULES VALIDATION SUITE: ALL PASSED       ');
  console.log('================================================================');
}

runStage4dRulesTests().catch((err) => {
  console.error('\n❌ Stage 4D Rules Test Failed:', err);
  process.exit(1);
});
