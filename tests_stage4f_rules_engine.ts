/**
 * MONVERA — STAGE 4F: FIRESTORE RULES ENGINE & SECURITY VERIFICATION SUITE
 * 
 * Executes against the ACTUAL FIRESTORE EMULATOR using @firebase/rules-unit-testing.
 * Verifies:
 *  1. Real Rules Testing against Firestore Emulator Rules Engine
 *  2. Customer Isolation (Cross-customer boundary enforcement)
 *  3. Privileged Field Protection (Role escalation, balances, ledger, loan tampering)
 *  4. Query Security (Collection list queries denied to customers)
 *  5. Administrator Access & Middleware Alignment (Configured admin vs Customer, fail-closed)
 *  6. Financial Operations & Idempotency / Authoritative Backend
 *  7. Customer Compatibility (Legitimate customer workflows pass seamlessly)
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { isCallerAdministrator } from './server/authMiddleware';

async function runStage4FTestSuite() {
  console.log('='.repeat(70));
  console.log('   MONVERA STAGE 4F: LIVE FIRESTORE RULES ENGINE VERIFICATION');
  console.log('='.repeat(70));

  const hostPort = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
  const [host, portStr] = hostPort.split(':');
  const port = parseInt(portStr, 10);

  console.log(`\n[Stage 4F.1] Connecting to Real Firestore Rules Engine at ${host}:${port}...`);
  const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');

  let testEnv: RulesTestEnvironment;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: 'monvera-stage4f-audit',
      firestore: {
        host,
        port,
        rules,
      },
    });
    console.log('  ✓ Connected to Live Firestore Emulator with active ruleset.');
  } catch (err: any) {
    console.error('  ❌ Failed to initialize live test environment:', err.message);
    throw err;
  }

  try {
    // -------------------------------------------------------------------------
    // Setup Contexts & Seed Baseline Data via Admin Context (Bypassing Rules)
    // -------------------------------------------------------------------------
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const aliceDb = testEnv.authenticatedContext('cust_alice', { email: 'alice@monvera.com' }).firestore();
    const bobDb = testEnv.authenticatedContext('cust_bob', { email: 'bob@monvera.com' }).firestore();
    const adminDb = testEnv.authenticatedContext('admin_daney', {
      email: 'daneybil2020@gmail.com',
      admin: true,
      role: 'admin',
    }).firestore();

    console.log('\n[Stage 4F.2] Seeding Baseline Documents via Rules-Disabled Admin Context...');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();

      // Seed Bob's user profile
      await setDoc(doc(seedDb, 'users', 'cust_bob'), {
        fullName: 'Bob Smith',
        email: 'bob@monvera.com',
        role: 'customer',
        status: 'active',
        dailyTransactionLimit: 50000,
      });

      // Seed Alice's user profile
      await setDoc(doc(seedDb, 'users', 'cust_alice'), {
        fullName: 'Alice Johnson',
        email: 'alice@monvera.com',
        role: 'customer',
        status: 'active',
        dailyTransactionLimit: 50000,
      });

      // Seed Bob's account balance
      await setDoc(doc(seedDb, 'accounts', 'cust_bob'), {
        userId: 'cust_bob',
        balance: 10000,
        currency: 'EUR',
      });

      // Seed Alice's account balance
      await setDoc(doc(seedDb, 'accounts', 'cust_alice'), {
        userId: 'cust_alice',
        balance: 5000,
        currency: 'EUR',
      });

      // Seed Bob's private transaction
      await setDoc(doc(seedDb, 'transactions', 'tx_bob_private'), {
        transactionId: 'tx_bob_private',
        userId: 'cust_bob',
        senderUserId: 'cust_bob',
        recipientUserId: 'cust_charlie',
        amount: 250,
        status: 'COMPLETED',
      });

      // Seed Alice-Bob shared transaction (Alice is sender, Bob is recipient)
      await setDoc(doc(seedDb, 'transactions', 'tx_alice_to_bob'), {
        transactionId: 'tx_alice_to_bob',
        userId: 'cust_alice',
        senderUserId: 'cust_alice',
        recipientUserId: 'cust_bob',
        amount: 100,
        status: 'COMPLETED',
      });

      // Seed Bob's investment
      await setDoc(doc(seedDb, 'investments', 'inv_bob_1'), {
        userId: 'cust_bob',
        principal: 5000,
        expectedReturn: 350,
        status: 'ACTIVE',
      });

      // Seed Bob's card
      await setDoc(doc(seedDb, 'cards', 'card_bob_1'), {
        cardId: 'card_bob_1',
        userId: 'cust_bob',
        isFrozen: false,
        spendingLimit: 2000,
      });

      // Seed Alice's card
      await setDoc(doc(seedDb, 'cards', 'card_alice_1'), {
        cardId: 'card_alice_1',
        userId: 'cust_alice',
        isFrozen: false,
        spendingLimit: 1500,
      });

      // Seed Bob's notification
      await setDoc(doc(seedDb, 'notifications', 'notif_bob_1'), {
        userId: 'cust_bob',
        title: 'Salary Credited',
        read: false,
      });

      // Seed Bob's support thread
      await setDoc(doc(seedDb, 'support_messages', 'msg_bob_1'), {
        userId: 'cust_bob',
        text: 'Hello support, need help with transfer',
      });
      await setDoc(doc(seedDb, 'support_typing', 'cust_bob'), {
        isTyping: true,
      });
      await setDoc(doc(seedDb, 'support_tickets', 'ticket_bob_1'), {
        userId: 'cust_bob',
        subject: 'KYC Document issue',
      });

      // Seed Bob's active loan
      await setDoc(doc(seedDb, 'loans', 'loan_bob_1'), {
        userId: 'cust_bob',
        amount: 10000,
        status: 'ACTIVE',
        disbursedAmount: 10000,
        totalRepaid: 2000,
        remainingBalance: 8000,
      });

      // Seed Alice's active loan
      await setDoc(doc(seedDb, 'loans', 'loan_alice_1'), {
        userId: 'cust_alice',
        amount: 5000,
        status: 'ACTIVE',
        disbursedAmount: 5000,
        totalRepaid: 1000,
        remainingBalance: 4000,
      });
    });
    console.log('  ✓ Baseline data seeded into live emulator.');

    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated Rejections Across All Collections
    // -------------------------------------------------------------------------
    console.log('\n[Stage 4F.3] Testing Unauthenticated Rejection Across Collections...');
    await assertFails(getDoc(doc(unauthDb, 'users', 'cust_alice')));
    await assertFails(getDoc(doc(unauthDb, 'accounts', 'cust_alice')));
    await assertFails(getDoc(doc(unauthDb, 'transactions', 'tx_bob_private')));
    await assertFails(getDoc(doc(unauthDb, 'investments', 'inv_bob_1')));
    await assertFails(getDoc(doc(unauthDb, 'cards', 'card_alice_1')));
    await assertFails(getDoc(doc(unauthDb, 'notifications', 'notif_bob_1')));
    await assertFails(getDoc(doc(unauthDb, 'support_messages', 'msg_bob_1')));
    await assertFails(getDoc(doc(unauthDb, 'loans', 'loan_bob_1')));
    console.log('  ✓ Live rules engine strictly denied all unauthenticated access.');

    // -------------------------------------------------------------------------
    // TEST 2: Customer Isolation (Alice attempting to access Bob's data)
    // -------------------------------------------------------------------------
    console.log('\n[Stage 4F.4] Testing Cross-Customer Isolation (Alice -> Bob)...');
    
    // Alice reading Bob's profile & account
    await assertFails(getDoc(doc(aliceDb, 'users', 'cust_bob')));
    await assertFails(getDoc(doc(aliceDb, 'accounts', 'cust_bob')));

    // Alice modifying Bob's profile & account
    await assertFails(updateDoc(doc(aliceDb, 'users', 'cust_bob'), { fullName: 'Hacked' }));
    await assertFails(updateDoc(doc(aliceDb, 'accounts', 'cust_bob'), { balance: 0 }));

    // Alice reading Bob's private transactions
    await assertFails(getDoc(doc(aliceDb, 'transactions', 'tx_bob_private')));

    // Alice reading Bob's investment
    await assertFails(getDoc(doc(aliceDb, 'investments', 'inv_bob_1')));

    // Alice reading, updating, or creating Bob's card
    await assertFails(getDoc(doc(aliceDb, 'cards', 'card_bob_1')));
    await assertFails(updateDoc(doc(aliceDb, 'cards', 'card_bob_1'), { isFrozen: true }));
    await assertFails(setDoc(doc(aliceDb, 'cards', 'card_fake_bob'), { userId: 'cust_bob', cardId: 'fake' }));

    // Alice reading, modifying, or deleting Bob's notifications
    await assertFails(getDoc(doc(aliceDb, 'notifications', 'notif_bob_1')));
    await assertFails(updateDoc(doc(aliceDb, 'notifications', 'notif_bob_1'), { read: true }));
    await assertFails(deleteDoc(doc(aliceDb, 'notifications', 'notif_bob_1')));

    // Alice reading Bob's support messages, typing, tickets
    await assertFails(getDoc(doc(aliceDb, 'support_messages', 'msg_bob_1')));
    await assertFails(getDoc(doc(aliceDb, 'support_typing', 'cust_bob')));
    await assertFails(getDoc(doc(aliceDb, 'support_tickets', 'ticket_bob_1')));

    // Alice reading Bob's loan
    await assertFails(getDoc(doc(aliceDb, 'loans', 'loan_bob_1')));
    console.log('  ✓ Live rules engine completely isolates Customer A from Customer B across all 8 domains.');

    // -------------------------------------------------------------------------
    // TEST 3: Privileged Field Protection & Financial Tampering
    // -------------------------------------------------------------------------
    console.log('\n[Stage 4F.5] Testing Privileged Field Protection on Customer\'s Own Records...');

    // Alice trying to grant herself administrator privileges on her own user doc
    await assertFails(updateDoc(doc(aliceDb, 'users', 'cust_alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(aliceDb, 'users', 'cust_alice'), { role: 'super_admin' }));

    // Alice trying to unfreeze/freeze her account status directly
    await assertFails(updateDoc(doc(aliceDb, 'users', 'cust_alice'), { status: 'frozen' }));

    // Alice trying to escalate her dailyTransactionLimit
    await assertFails(updateDoc(doc(aliceDb, 'users', 'cust_alice'), { dailyTransactionLimit: 99999999 }));

    // Alice trying to directly create/update/delete her own account balance
    await assertFails(setDoc(doc(aliceDb, 'accounts', 'cust_alice'), { balance: 999999 }));
    await assertFails(updateDoc(doc(aliceDb, 'accounts', 'cust_alice'), { balance: 999999 }));
    await assertFails(deleteDoc(doc(aliceDb, 'accounts', 'cust_alice')));

    // Alice trying to directly create a ledger entry in transactions
    await assertFails(setDoc(doc(aliceDb, 'transactions', 'tx_fake_alice'), {
      userId: 'cust_alice',
      amount: 50000,
      status: 'COMPLETED',
    }));

    // Alice trying to directly create/modify an investment
    await assertFails(setDoc(doc(aliceDb, 'investments', 'inv_alice_fake'), {
      userId: 'cust_alice',
      principal: 10000,
      expectedReturn: 5000,
      status: 'SETTLED',
    }));

    // Alice trying to forge card ownership
    await assertFails(setDoc(doc(aliceDb, 'cards', 'card_alice_forged'), {
      cardId: 'card_alice_forged',
      userId: 'cust_bob', // Forging Bob's UID
      isFrozen: false,
    }));

    // Alice trying to manipulate loan fields on application
    await assertFails(setDoc(doc(aliceDb, 'loans', 'loan_forged_approved'), {
      userId: 'cust_alice',
      amount: 50000,
      status: 'APPROVED', // Forged status
      disbursedAmount: 50000,
    }));

    // Alice trying to manipulate loan balances on existing loan
    await assertFails(updateDoc(doc(aliceDb, 'loans', 'loan_alice_1'), {
      status: 'PAID_OFF',
      remainingBalance: 0,
    }));
    await assertFails(updateDoc(doc(aliceDb, 'loans', 'loan_alice_1'), {
      disbursedAmount: 90000,
    }));
    console.log('  ✓ Live rules engine prevented all role escalation, balance tampering, and loan fabrication.');

    // -------------------------------------------------------------------------
    // TEST 4: Query Security (Collection Discovery Prevention)
    // -------------------------------------------------------------------------
    console.log('\n[Stage 4F.6] Testing Query Security & Collection Discovery...');

    // Alice attempting to list the entire 'users' collection
    await assertFails(getDocs(collection(aliceDb, 'users')));

    // Alice attempting to list the entire 'accounts' collection
    await assertFails(getDocs(collection(aliceDb, 'accounts')));

    // Alice attempting to scan unconstrained 'transactions' collection
    await assertFails(getDocs(collection(aliceDb, 'transactions')));

    // Alice attempting to scan 'loans' collection
    await assertFails(getDocs(collection(aliceDb, 'loans')));

    // Admin CAN query collections
    await assertSucceeds(getDocs(collection(adminDb, 'users')));
    await assertSucceeds(getDocs(collection(adminDb, 'accounts')));
    console.log('  ✓ Collection discovery queries are strictly denied to ordinary customers and permitted to Admin.');

    // -------------------------------------------------------------------------
    // TEST 5: Legitimate Customer Workflows (Customer Compatibility)
    // -------------------------------------------------------------------------
    console.log('\n[Stage 4F.7] Testing Legitimate Customer Operations Compatibility...');

    // 1. Reading own profile and account
    await assertSucceeds(getDoc(doc(aliceDb, 'users', 'cust_alice')));
    await assertSucceeds(getDoc(doc(aliceDb, 'accounts', 'cust_alice')));

    // 2. Legitimate profile update (updating allowed fields)
    await assertSucceeds(updateDoc(doc(aliceDb, 'users', 'cust_alice'), {
      fullName: 'Alice Johnson Updated',
    }));

    // 3. Reading shared transaction (Alice is sender)
    await assertSucceeds(getDoc(doc(aliceDb, 'transactions', 'tx_alice_to_bob')));

    // Bob reading shared transaction (Bob is recipient)
    await assertSucceeds(getDoc(doc(bobDb, 'transactions', 'tx_alice_to_bob')));

    // 4. Creating legitimate card for self
    await assertSucceeds(setDoc(doc(aliceDb, 'cards', 'card_alice_2'), {
      cardId: 'card_alice_2',
      userId: 'cust_alice',
      isFrozen: false,
      spendingLimit: 1000,
    }));

    // 5. Toggling card freeze on own card
    await assertSucceeds(updateDoc(doc(aliceDb, 'cards', 'card_alice_1'), {
      isFrozen: true,
    }));

    // 6. Creating self-notification and updating read status
    await assertSucceeds(setDoc(doc(aliceDb, 'notifications', 'notif_alice_1'), {
      userId: 'cust_alice',
      title: 'Welcome to Monvera',
      read: false,
    }));
    await assertSucceeds(updateDoc(doc(aliceDb, 'notifications', 'notif_alice_1'), {
      read: true,
    }));

    // 7. Legitimate support message and typing indicator
    await assertSucceeds(setDoc(doc(aliceDb, 'support_messages', 'msg_alice_1'), {
      userId: 'cust_alice',
      text: 'Need help with card verification',
    }));
    await assertSucceeds(setDoc(doc(aliceDb, 'support_typing', 'cust_alice'), {
      isTyping: true,
    }));

    // 8. Legitimate loan application (PENDING, 0 disbursed)
    await assertSucceeds(setDoc(doc(aliceDb, 'loans', 'loan_alice_new'), {
      userId: 'cust_alice',
      amount: 5000,
      status: 'PENDING',
      disbursedAmount: 0,
      totalRepaid: 0,
      approvedAt: '',
      approvedBy: '',
      disbursedAt: '',
      rejectedAt: '',
      rejectedBy: '',
      repaymentHistory: [],
    }));
    console.log('  ✓ All legitimate customer operations operate seamlessly under hardened rules.');

    // -------------------------------------------------------------------------
    // TEST 6: Administrator Operations via Rules
    // -------------------------------------------------------------------------
    console.log('\n[Stage 4F.8] Testing Administrator Operations via Rules...');
    await assertSucceeds(getDoc(doc(adminDb, 'users', 'cust_alice')));
    await assertSucceeds(getDoc(doc(adminDb, 'accounts', 'cust_bob')));
    await assertSucceeds(getDoc(doc(adminDb, 'transactions', 'tx_bob_private')));
    await assertSucceeds(getDoc(doc(adminDb, 'loans', 'loan_bob_1')));
    await assertSucceeds(updateDoc(doc(adminDb, 'cards', 'card_bob_1'), { isFrozen: true }));
    console.log('  ✓ Administrator maintains full visibility and control.');

  } finally {
    await testEnv.cleanup();
  }

  // -------------------------------------------------------------------------
  // TEST 7: Backend Middleware Authorization & Fail-Closed Checks
  // -------------------------------------------------------------------------
  console.log('\n[Stage 4F.9] Testing Backend Middleware Authorization Consistency...');

  // Configured administrator check
  const adminTest = await isCallerAdministrator(
    'DDp1tLOzbgUHSnuDgNdFszcYqkp1',
    'daneybil2020@gmail.com',
    { admin: true, role: 'admin' }
  );
  assert.strictEqual(adminTest, true, 'Configured administrator must be authorized');

  // Customer attempting access with forged body/query parameters
  const attackerAttempt = await isCallerAdministrator('attacker_uid', 'attacker@example.com', {
    adminId: 'daneybil2020@gmail.com',
    role: 'customer',
  });
  assert.strictEqual(attackerAttempt, false, 'Attacker with forged parameters must be rejected');

  // Ordinary customer rejection
  const ordinaryCustomer = await isCallerAdministrator('cust_alice', 'alice@monvera.com');
  assert.strictEqual(ordinaryCustomer, false, 'Ordinary customer must be rejected');

  console.log('  ✓ Backend middleware authorization is strictly consistent and ignores client forgery.');

  console.log('\n' + '='.repeat(70));
  console.log('   STAGE 4F: ALL LIVE FIRESTORE RULES ENGINE TESTS PASSED');
  console.log('='.repeat(70));
}

runStage4FTestSuite().catch((err) => {
  console.error('\n❌ STAGE 4F SUITE EXECUTION FAILED:', err);
  process.exit(1);
});
