import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { adminFirestore, isFirebaseAdminConfigured } from './firebaseAdmin';
import { resolveRecipientUser } from './firestoreTransactions';
import { persistCustomerNotification, maskAccountNumber } from './services/notificationStore';
import { db } from './db';
import {
  BalanceMetrics,
  BankAccount,
  IssuedCheckRecord,
  Transaction,
} from '../src/types';

export interface AdminCheckServiceDeps {
  firestore?: Firestore;
  resolveCustomer?: (identifier: string) => Promise<{ success: boolean; uid?: string; data?: any; error?: string }>;
  persistNotification?: typeof persistCustomerNotification;
  recordAuditLog?: (entry: {
    adminId: string;
    adminEmail: string;
    targetUserId: string;
    targetAccountNumber: string;
    amount: number;
    checkNumber: string;
    referenceNumber: string;
    checkId: string;
  }) => void;
}

export interface IssueAdminCheckParams {
  customerIdentifier: string;
  sourceAccountType: 'CHECKING' | 'SAVINGS';
  checkNumber: string;
  payeeName: string;
  amount: number;
  memo?: string;
  idempotencyKey?: string;
  adminUid: string;
  adminEmail: string;
}

export interface IssueAdminCheckResult {
  success: boolean;
  statusCode: number;
  check?: IssuedCheckRecord;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  warnings?: string[];
  errorCode?: string;
  error?: string;
}

export interface ListIssuedChecksResult {
  success: boolean;
  checks: IssuedCheckRecord[];
  error?: string;
}

class CheckIssuanceError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export function toCents(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function fromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function normalizeCheckNumber(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sanitizeDocId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/g, '_');
  if (cleaned.length <= 128) return cleaned;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildRequestFingerprint(input: {
  customerUid: string;
  sourceAccountType: 'CHECKING' | 'SAVINGS';
  normalizedCheckNumber: string;
  payeeName: string;
  amountCents: number;
  memo: string;
}): string {
  const canonical = JSON.stringify({
    customerUid: input.customerUid,
    sourceAccountType: input.sourceAccountType,
    normalizedCheckNumber: input.normalizedCheckNumber,
    payeeName: input.payeeName.trim().toLowerCase(),
    amountCents: input.amountCents,
    memo: input.memo.trim(),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function isBalanceFieldPresent(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function parseValidatedBalanceCents(raw: unknown, fieldLabel: string): number {
  if (typeof raw === 'boolean' || typeof raw === 'object') {
    throw new CheckIssuanceError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      `Customer ${fieldLabel} balance data is invalid.`
    );
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num < 0) {
    throw new CheckIssuanceError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      `Customer ${fieldLabel} balance is invalid or negative.`
    );
  }
  const cents = Math.round(num * 100);
  if (cents < 0 || Math.abs(num * 100 - cents) > 1e-4) {
    throw new CheckIssuanceError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      `Customer ${fieldLabel} balance has invalid monetary precision.`
    );
  }
  return cents;
}

function resolveSubAccountEntryCents(
  accountsList: BankAccount[],
  targetType: 'CHECKING' | 'SAVINGS' | 'INVESTMENT',
  label: string
): { found: boolean; cents: number } {
  const matches = accountsList.filter(
    (a) => String(a?.type || '').trim().toUpperCase() === targetType
  );
  if (matches.length === 0) {
    return { found: false, cents: 0 };
  }
  if (matches.length > 1) {
    throw new CheckIssuanceError(
      422,
      'AMBIGUOUS_ACCOUNT_BALANCE',
      `Multiple ${label} entries exist in accounts[] without an authoritative top-level balance.`
    );
  }

  const entry: any = matches[0];
  const hasBalance = isBalanceFieldPresent(entry?.balance);
  const hasAvailable = isBalanceFieldPresent(entry?.availableBalance);

  if (!hasBalance && !hasAvailable) {
    throw new CheckIssuanceError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      `${label} sub-account entry is missing a valid balance value.`
    );
  }

  const balanceCents = hasBalance ? parseValidatedBalanceCents(entry.balance, `${label} sub-account`) : 0;
  const availableCents = hasAvailable
    ? parseValidatedBalanceCents(entry.availableBalance, `${label} sub-account availableBalance`)
    : 0;

  if (hasBalance && hasAvailable && balanceCents !== availableCents) {
    throw new CheckIssuanceError(
      422,
      'AMBIGUOUS_ACCOUNT_BALANCE',
      `${label} sub-account balance and availableBalance disagree without an authoritative top-level balance.`
    );
  }

  return {
    found: true,
    cents: hasBalance ? balanceCents : availableCents,
  };
}

function resolveAuthoritativeAccountBalances(
  aData: Record<string, any>
): {
  accountsList: BankAccount[];
  hasChecking: boolean;
  hasSavings: boolean;
  checkingCents: number;
  savingsCents: number;
  investedCents: number;
  accruedCents: number;
  preservedPending: number;
  preservedLoan: number;
} {
  if (aData.accounts !== undefined && !Array.isArray(aData.accounts)) {
    throw new CheckIssuanceError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      'Customer accounts[] record is malformed.'
    );
  }

  const accountsList: BankAccount[] = Array.isArray(aData.accounts) ? aData.accounts : [];

  // 1. Resolve CHECKING: authoritative top-level checkingBalance -> matching CHECKING subaccount -> legacy availableBalance (when accounts[] does not list subaccounts)
  let hasChecking = false;
  let checkingCents = 0;
  if (isBalanceFieldPresent(aData.checkingBalance)) {
    hasChecking = true;
    checkingCents = parseValidatedBalanceCents(aData.checkingBalance, 'Checking');
  } else {
    const subChecking = resolveSubAccountEntryCents(accountsList, 'CHECKING', 'Checking');
    if (subChecking.found) {
      hasChecking = true;
      checkingCents = subChecking.cents;
    } else if (accountsList.length === 0 && isBalanceFieldPresent(aData.availableBalance)) {
      hasChecking = true;
      checkingCents = parseValidatedBalanceCents(aData.availableBalance, 'Checking available');
    }
  }

  // 2. Resolve SAVINGS: authoritative top-level savingsBalance -> legacy top-level savings -> matching SAVINGS subaccount
  let hasSavings = false;
  let savingsCents = 0;
  if (isBalanceFieldPresent(aData.savingsBalance)) {
    hasSavings = true;
    savingsCents = parseValidatedBalanceCents(aData.savingsBalance, 'Savings');
  } else if (isBalanceFieldPresent(aData.savings)) {
    hasSavings = true;
    savingsCents = parseValidatedBalanceCents(aData.savings, 'Savings');
  } else {
    const subSavings = resolveSubAccountEntryCents(accountsList, 'SAVINGS', 'Savings');
    if (subSavings.found) {
      hasSavings = true;
      savingsCents = subSavings.cents;
    }
  }

  // 3. Resolve investedBalance & accruedEarnings without altering them
  let investedCents = 0;
  if (isBalanceFieldPresent(aData.investedBalance)) {
    investedCents = parseValidatedBalanceCents(aData.investedBalance, 'Invested');
  } else if (isBalanceFieldPresent(aData.investmentBalance)) {
    investedCents = parseValidatedBalanceCents(aData.investmentBalance, 'Invested');
  } else {
    const subInv = resolveSubAccountEntryCents(accountsList, 'INVESTMENT', 'Investment');
    if (subInv.found) {
      investedCents = subInv.cents;
    }
  }

  const accruedCents = isBalanceFieldPresent(aData.accruedEarnings)
    ? parseValidatedBalanceCents(aData.accruedEarnings, 'Accrued earnings')
    : 0;

  const preservedPending = Number(aData.pendingBalance ?? 0);
  const preservedLoan = Number(aData.loanBalance ?? 0);

  return {
    accountsList,
    hasChecking,
    hasSavings,
    checkingCents,
    savingsCents,
    investedCents,
    accruedCents,
    preservedPending,
    preservedLoan,
  };
}

function buildDefaultAccountsForCheck(
  userId: string,
  checking: number,
  savings: number,
  userAcc: string
): BankAccount[] {
  return [
    {
      id: `acc_chk_${userId}`,
      userId,
      type: 'CHECKING',
      accountNumber: userAcc,
      routingNumber: '021000021',
      currency: 'USD',
      balance: checking,
      availableBalance: checking,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 1.25,
      status: 'ACTIVE',
      nickname: 'Monvera Premier Checking',
    },
    {
      id: `acc_sav_${userId}`,
      userId,
      type: 'SAVINGS',
      accountNumber: userAcc.length >= 7 ? `10${userAcc.slice(2, -3)}991` : '1000000991',
      routingNumber: '021000021',
      currency: 'USD',
      balance: savings,
      availableBalance: savings,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 4.85,
      status: 'ACTIVE',
      nickname: 'Monvera High-Yield Treasury',
    },
  ];
}

export interface AdminPreviewBalanceMetrics {
  checkingBalance: number | null;
  savingsBalance: number | null;
  authoritativeCheckingBalance: number | null;
  authoritativeSavingsBalance: number | null;
  hasAuthoritativeChecking: boolean;
  hasAuthoritativeSavings: boolean;
  checkingBalanceSource: 'top_level' | 'accounts_subaccount' | 'available_fallback' | 'missing' | 'error';
  savingsBalanceSource: 'top_level' | 'legacy_top_level' | 'accounts_subaccount' | 'missing' | 'error';
  investedBalance: number | null;
  accruedEarnings: number | null;
  totalBalance: number | null;
  availableBalance: number | null;
  pendingBalance: number | null;
  loanBalance: number | null;
  accounts: BankAccount[];
  balanceResolutionError: string | null;
  balanceResolutionErrorCode: string | null;
}

/**
 * Read-only balance preview resolver for Admin Dashboard customer listings.
 * Reuses the exact authoritative Stage 7 checking/savings resolution rules
 * (top-level fields first, including authoritative 0; accounts[] fallback only when absent)
 * and fails safely without inventing balances if account data is invalid or ambiguous.
 */
export function resolveCustomerPreviewBalanceMetrics(
  ad: Record<string, any>,
  options: { userId: string; accountNumber?: string }
): AdminPreviewBalanceMetrics {
  const userId = String(options.userId || '').trim();
  const cleanAcc = String(options.accountNumber || ad?.permanentAccountNumber || '').replace(/[-\s]/g, '');

  try {
    if (!ad || typeof ad !== 'object') {
      throw new CheckIssuanceError(
        422,
        'INVALID_ACCOUNT_BALANCE',
        'Customer account document is missing or malformed.'
      );
    }

    const resolved = resolveAuthoritativeAccountBalances(ad);

    const checking = resolved.hasChecking ? fromCents(resolved.checkingCents) : 0;
    const savings = resolved.hasSavings ? fromCents(resolved.savingsCents) : 0;
    const invested = fromCents(resolved.investedCents);
    const accrued = fromCents(resolved.accruedCents);

    const checkingBalanceSource: AdminPreviewBalanceMetrics['checkingBalanceSource'] =
      isBalanceFieldPresent(ad.checkingBalance)
        ? 'top_level'
        : resolved.hasChecking
          ? resolved.accountsList.length === 0 && isBalanceFieldPresent(ad.availableBalance)
            ? 'available_fallback'
            : 'accounts_subaccount'
          : 'missing';

    const savingsBalanceSource: AdminPreviewBalanceMetrics['savingsBalanceSource'] =
      isBalanceFieldPresent(ad.savingsBalance)
        ? 'top_level'
        : isBalanceFieldPresent(ad.savings)
          ? 'legacy_top_level'
          : resolved.hasSavings
            ? 'accounts_subaccount'
            : 'missing';

    const total = isBalanceFieldPresent(ad.totalBalance)
      ? fromCents(parseValidatedBalanceCents(ad.totalBalance, 'Total'))
      : fromCents(
          resolved.checkingCents +
            resolved.savingsCents +
            resolved.investedCents +
            resolved.accruedCents
        );

    const available = isBalanceFieldPresent(ad.availableBalance)
      ? fromCents(parseValidatedBalanceCents(ad.availableBalance, 'Available'))
      : checking;

    const pending = isBalanceFieldPresent(ad.pendingBalance)
      ? fromCents(parseValidatedBalanceCents(ad.pendingBalance, 'Pending'))
      : 0;

    const loanBal = isBalanceFieldPresent(ad.loanBalance)
      ? fromCents(parseValidatedBalanceCents(ad.loanBalance, 'Loan'))
      : 0;

    const accountsList: BankAccount[] =
      resolved.accountsList.length > 0
        ? resolved.accountsList
        : [
            {
              id: `acc_chk_${userId}`,
              userId,
              type: 'CHECKING',
              accountNumber: cleanAcc || '1000000000',
              routingNumber: '021000021',
              currency: 'USD',
              balance: checking,
              availableBalance: available,
              investedBalance: invested,
              pendingBalance: pending,
              interestRateAPY: 1.25,
              status: 'ACTIVE',
              nickname: 'Monvera Premier Checking',
            },
            {
              id: `acc_sav_${userId}`,
              userId,
              type: 'SAVINGS',
              accountNumber: cleanAcc ? `10${cleanAcc.slice(2, -3)}991` : '1000000991',
              routingNumber: '021000021',
              currency: 'USD',
              balance: savings,
              availableBalance: savings,
              investedBalance: 0,
              pendingBalance: 0,
              interestRateAPY: 4.85,
              status: 'ACTIVE',
              nickname: 'Monvera High-Yield Treasury',
            },
          ];

    return {
      checkingBalance: checking,
      savingsBalance: savings,
      authoritativeCheckingBalance: checking,
      authoritativeSavingsBalance: savings,
      hasAuthoritativeChecking: resolved.hasChecking,
      hasAuthoritativeSavings: resolved.hasSavings,
      checkingBalanceSource,
      savingsBalanceSource,
      investedBalance: invested,
      accruedEarnings: accrued,
      totalBalance: total,
      availableBalance: available,
      pendingBalance: pending,
      loanBalance: loanBal,
      accounts: accountsList,
      balanceResolutionError: null,
      balanceResolutionErrorCode: null,
    };
  } catch (err: any) {
    const errorCode = err instanceof CheckIssuanceError ? err.errorCode : 'INVALID_ACCOUNT_BALANCE';
    const errorMessage = err?.message || 'Customer account balance data is invalid or ambiguous.';
    console.warn(`[resolveCustomerPreviewBalanceMetrics] Unsafe account data for "${userId}" (${errorCode}): ${errorMessage}`);
    return {
      checkingBalance: null,
      savingsBalance: null,
      authoritativeCheckingBalance: null,
      authoritativeSavingsBalance: null,
      hasAuthoritativeChecking: false,
      hasAuthoritativeSavings: false,
      checkingBalanceSource: 'error',
      savingsBalanceSource: 'error',
      investedBalance: null,
      accruedEarnings: null,
      totalBalance: null,
      availableBalance: null,
      pendingBalance: null,
      loanBalance: null,
      accounts: Array.isArray(ad?.accounts) ? ad.accounts : [],
      balanceResolutionError: errorMessage,
      balanceResolutionErrorCode: errorCode,
    };
  }
}

async function resolveTargetCustomerFromFirestore(
  firestore: Firestore,
  identifier: string
): Promise<{ success: boolean; uid?: string; data?: any; error?: string }> {
  const target = identifier.trim();
  if (!target) {
    return { success: false, error: 'Customer identifier is required.' };
  }

  const usersCol = firestore.collection('users');

  // 1. Direct UID lookup
  const directSnap = await usersCol.doc(target).get();
  if (directSnap.exists) {
    return { success: true, uid: directSnap.id, data: directSnap.data() || {} };
  }

  // 2. Permanent account number lookup
  const cleanDigits = target.replace(/[-\s]/g, '');
  if (/^\d{6,14}$/.test(cleanDigits)) {
    const qAcc = await usersCol.where('permanentAccountNumber', '==', cleanDigits).limit(2).get();
    if (qAcc.docs.length > 1) {
      return { success: false, error: 'Multiple customer profiles match this account number.' };
    }
    if (qAcc.docs.length === 1) {
      const doc = qAcc.docs[0];
      return { success: true, uid: doc.id, data: doc.data() || {} };
    }
  }

  // 3. Email lookup
  if (target.includes('@')) {
    const qEmail = await usersCol.where('email', '==', target.toLowerCase()).limit(2).get();
    if (qEmail.docs.length > 1) {
      return { success: false, error: 'Multiple customer profiles match this email.' };
    }
    if (qEmail.docs.length === 1) {
      const doc = qEmail.docs[0];
      return { success: true, uid: doc.id, data: doc.data() || {} };
    }
  }

  return { success: false, error: `Customer "${target}" was not found.` };
}

/**
 * Server-authoritative Admin Check Issuance with permanent atomic customer account debit.
 * Completely isolated from executeServerWithdrawal and the 30-minute withdrawal reversal workflow.
 */
export async function executeServerAdminCheckWithdrawal(
  params: IssueAdminCheckParams,
  deps?: AdminCheckServiceDeps
): Promise<IssueAdminCheckResult> {
  const firestore = deps?.firestore || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!firestore) {
    return {
      success: false,
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      error: 'Firebase Admin Firestore is unavailable. Check issuance requires authoritative database access.',
    };
  }

  const adminUid = String(params.adminUid || '').trim();
  const adminEmail = String(params.adminEmail || '').trim().toLowerCase();
  if (!adminUid || !adminEmail) {
    return {
      success: false,
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
      error: 'Verified server administrator identity is required.',
    };
  }

  const customerIdentifier = String(params.customerIdentifier || '').trim();
  if (!customerIdentifier) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_CUSTOMER',
      error: 'Please select an existing customer.',
    };
  }

  const rawSourceType = String(params.sourceAccountType || '').trim().toUpperCase();
  if (rawSourceType !== 'CHECKING' && rawSourceType !== 'SAVINGS') {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_SOURCE_ACCOUNT',
      error: 'Source account must be CHECKING or SAVINGS.',
    };
  }
  const sourceAccountType: 'CHECKING' | 'SAVINGS' = rawSourceType;

  const displayCheckNumber = String(params.checkNumber || '').trim();
  const normalizedCheckNumber = normalizeCheckNumber(displayCheckNumber);
  if (!displayCheckNumber || !normalizedCheckNumber) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'MISSING_CHECK_NUMBER',
      error: 'Check number is required and must contain alphanumeric characters.',
    };
  }
  if (displayCheckNumber.length > 64) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_CHECK_NUMBER',
      error: 'Check number must be 64 characters or fewer.',
    };
  }

  const payeeName = String(params.payeeName || '').trim();
  if (!payeeName) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'MISSING_PAYEE',
      error: 'Payee name is required.',
    };
  }
  if (payeeName.length > 150) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_PAYEE',
      error: 'Payee name must be 150 characters or fewer.',
    };
  }

  const memo = String(params.memo || '').trim();
  if (memo.length > 240) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_MEMO',
      error: 'Memo must be 240 characters or fewer.',
    };
  }

  const rawAmount = Number(params.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_AMOUNT',
      error: 'Check amount must be a valid positive number.',
    };
  }

  const amountCents = Math.round(rawAmount * 100);
  if (amountCents <= 0 || Math.abs(rawAmount * 100 - amountCents) > 1e-4) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_AMOUNT_PRECISION',
      error: 'Check amount must be positive and have at most 2 decimal places.',
    };
  }
  const amountDollars = fromCents(amountCents);

  const rawIdempKey = String(params.idempotencyKey || '').trim();
  if (rawIdempKey && rawIdempKey.length > 256) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
      error: 'Idempotency key is invalid.',
    };
  }
  const effectiveIdempotencyKey = rawIdempKey || `chk_idemp_${crypto.randomUUID()}`;
  const safeIdempDocId = sanitizeDocId(effectiveIdempotencyKey);

  // Resolve target customer UID
  let resolvedCustomer: { success: boolean; uid?: string; data?: any; error?: string };
  if (deps?.resolveCustomer) {
    resolvedCustomer = await deps.resolveCustomer(customerIdentifier);
  } else if (deps?.firestore) {
    resolvedCustomer = await resolveTargetCustomerFromFirestore(deps.firestore, customerIdentifier);
  } else {
    resolvedCustomer = await resolveRecipientUser(customerIdentifier);
  }

  if (!resolvedCustomer.success || !resolvedCustomer.uid) {
    return {
      success: false,
      statusCode: 404,
      errorCode: 'CUSTOMER_NOT_FOUND',
      error: resolvedCustomer.error || `Customer "${customerIdentifier}" does not exist.`,
    };
  }

  const customerUid = resolvedCustomer.uid;
  if (customerUid === 'usr_admin' || resolvedCustomer.data?.role === 'super_admin') {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_CUSTOMER',
      error: 'Cannot issue a customer check debit against an executive administrator account.',
    };
  }

  const requestFingerprint = buildRequestFingerprint({
    customerUid,
    sourceAccountType,
    normalizedCheckNumber,
    payeeName,
    amountCents,
    memo,
  });

  const userRef = firestore.collection('users').doc(customerUid);
  const accRef = firestore.collection('accounts').doc(customerUid);
  const idempRef = firestore.collection('check_idempotency').doc(safeIdempDocId);
  const checkNumLockRef = firestore.collection('check_number_locks').doc(normalizedCheckNumber);

  const checkId = `chk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const txId = `tx_chk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const referenceNumber = `MV-CHK-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`;

  const issuedCheckRef = firestore.collection('issued_checks').doc(checkId);
  const txRef = firestore.collection('transactions').doc(txId);

  let finalCheck: IssuedCheckRecord | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;

  try {
    await firestore.runTransaction(async (transaction) => {
      // ALL READS MUST PRECEDE ALL WRITES
      const [idempSnap, checkNumSnap, userSnap, accSnap] = await Promise.all([
        transaction.get(idempRef),
        transaction.get(checkNumLockRef),
        transaction.get(userRef),
        transaction.get(accRef),
      ]);

      // 1. Idempotency evaluation inside transaction
      if (idempSnap.exists) {
        const idempData = idempSnap.data() || {};
        if (idempData.requestFingerprint !== requestFingerprint) {
          throw new CheckIssuanceError(
            409,
            'IDEMPOTENCY_MISMATCH',
            'This idempotency key was already used with different check issuance details.'
          );
        }

        isDuplicate = true;
        finalCheck = (idempData.checkRecord as IssuedCheckRecord) || null;
        finalTx = (idempData.transaction as Transaction) || null;

        if (accSnap.exists) {
          const ad = accSnap.data()!;
          const resolvedReplay = resolveAuthoritativeAccountBalances(ad);
          const replayChecking = fromCents(resolvedReplay.checkingCents);
          const replaySavings = fromCents(resolvedReplay.savingsCents);
          const replayInvested = fromCents(resolvedReplay.investedCents);
          const replayAccrued = fromCents(resolvedReplay.accruedCents);
          const replayTotal =
            isBalanceFieldPresent(ad.totalBalance)
              ? Number(ad.totalBalance)
              : fromCents(
                  resolvedReplay.checkingCents +
                    resolvedReplay.savingsCents +
                    resolvedReplay.investedCents +
                    resolvedReplay.accruedCents
                );
          finalMetrics = {
            checkingBalance: replayChecking,
            savingsBalance: replaySavings,
            investedBalance: replayInvested,
            accruedEarnings: replayAccrued,
            totalBalance: replayTotal,
            availableBalance: isBalanceFieldPresent(ad.availableBalance) ? Number(ad.availableBalance) : replayChecking,
            pendingBalance: resolvedReplay.preservedPending,
            loanBalance: resolvedReplay.preservedLoan,
            accounts: resolvedReplay.accountsList,
          };
        }
        return;
      }

      // 2. Duplicate check number guard inside transaction
      if (checkNumSnap.exists) {
        throw new CheckIssuanceError(
          409,
          'DUPLICATE_CHECK_NUMBER',
          `Check number "${displayCheckNumber}" has already been issued.`
        );
      }

      // 3. Validate customer record exists in Firestore
      if (!userSnap.exists) {
        throw new CheckIssuanceError(
          404,
          'CUSTOMER_NOT_FOUND',
          `Customer record "${customerUid}" was not found.`
        );
      }

      const uData = userSnap.data() || {};
      if (uData.role === 'super_admin') {
        throw new CheckIssuanceError(
          400,
          'INVALID_CUSTOMER',
          'Cannot issue a check withdrawal against an administrator account.'
        );
      }

      // 4. Validate customer account & source sub-account exist
      if (!accSnap.exists) {
        throw new CheckIssuanceError(
          404,
          'ACCOUNT_NOT_FOUND',
          'Selected customer account does not exist or has not been initialized.'
        );
      }

      const aData = accSnap.data() || {};
      const {
        accountsList,
        hasChecking,
        hasSavings,
        checkingCents,
        savingsCents,
        investedCents,
        accruedCents,
        preservedPending,
        preservedLoan,
      } = resolveAuthoritativeAccountBalances(aData);

      if (sourceAccountType === 'CHECKING' && !hasChecking) {
        throw new CheckIssuanceError(
          404,
          'SOURCE_ACCOUNT_NOT_FOUND',
          'Selected Checking account does not exist for this customer.'
        );
      }
      if (sourceAccountType === 'SAVINGS' && !hasSavings) {
        throw new CheckIssuanceError(
          404,
          'SOURCE_ACCOUNT_NOT_FOUND',
          'Selected Savings account does not exist for this customer.'
        );
      }

      const sourceCents = sourceAccountType === 'CHECKING' ? checkingCents : savingsCents;
      if (sourceCents < amountCents) {
        throw new CheckIssuanceError(
          400,
          'INSUFFICIENT_FUNDS',
          `Insufficient available ${sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'} funds. Available balance is $${fromCents(sourceCents).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}.`
        );
      }

      // 5. Compute permanent debit using exact integer cents
      const newCheckingCents = sourceAccountType === 'CHECKING' ? checkingCents - amountCents : checkingCents;
      const newSavingsCents = sourceAccountType === 'SAVINGS' ? savingsCents - amountCents : savingsCents;
      const newTotalCents = newCheckingCents + newSavingsCents + investedCents + accruedCents;

      const newChecking = fromCents(newCheckingCents);
      const newSavings = fromCents(newSavingsCents);
      const currentInvested = fromCents(investedCents);
      const currentAccrued = fromCents(accruedCents);
      const newTotal = fromCents(newTotalCents);
      const newAvailable = newChecking;

      const customerFullName =
        `${uData.firstName || ''} ${uData.lastName || ''}`.trim() ||
        uData.kycFullName ||
        uData.fullName ||
        uData.username ||
        'Monvera Client';

      const customerAccountNumber = String(
        uData.permanentAccountNumber ||
          uData.accountNumber ||
          aData.permanentAccountNumber ||
          '1000000000'
      ).trim();

      const updatedAccounts: BankAccount[] =
        accountsList.length > 0
          ? accountsList.map((acc) => {
              if (String(acc?.type || '').trim().toUpperCase() === sourceAccountType) {
                const updatedBal = sourceAccountType === 'CHECKING' ? newChecking : newSavings;
                return {
                  ...acc,
                  balance: updatedBal,
                  availableBalance: updatedBal,
                };
              }
              return acc;
            })
          : buildDefaultAccountsForCheck(customerUid, newChecking, newSavings, customerAccountNumber);

      const matchedSourceAccount = updatedAccounts.find(
        (a) => String(a?.type || '').trim().toUpperCase() === sourceAccountType
      );
      const sourceAccountId =
        matchedSourceAccount?.id ||
        (sourceAccountType === 'CHECKING' ? `acc_chk_${customerUid}` : `acc_sav_${customerUid}`);
      const sourceAccountNumber = matchedSourceAccount?.accountNumber || customerAccountNumber;

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: newSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: preservedPending,
        loanBalance: preservedLoan,
        accounts: updatedAccounts,
      };

      const nowIso = new Date().toISOString();

      // Guarantee recipientAccountNumber NEVER equals customer's account number
      const syntheticCheckAccountRef = `CHK-${normalizedCheckNumber}`;

      finalTx = {
        id: txId,
        referenceNumber,
        clientRequestId: effectiveIdempotencyKey,
        type: 'CHECK_WITHDRAWAL',
        amount: amountDollars,
        currency: 'USD',
        status: 'COMPLETED',
        userId: customerUid,
        senderUserId: customerUid,
        senderAccountId: sourceAccountId,
        senderName: customerFullName,
        senderAccountNumber: sourceAccountNumber,
        recipientName: payeeName,
        recipientAccountNumber: syntheticCheckAccountRef,
        fee: 0.0,
        description: memo
          ? `Admin-Issued Check Withdrawal (#${displayCheckNumber}) — ${memo}`
          : `Admin-Issued Check Withdrawal (#${displayCheckNumber})`,
        category: 'Checks',
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          permanentDebit: true,
          autoReverse: false,
          disbursementType: 'ADMIN_CHECK_WITHDRAWAL',
          checkId,
          checkNumber: displayCheckNumber,
          normalizedCheckNumber,
          payeeName,
          memo: memo || undefined,
          sourceAccountType,
          sourceAccountId,
          sourceAccountNumber,
          issuedByAdminUid: adminUid,
          issuedByAdminEmail: adminEmail,
          idempotencyKey: effectiveIdempotencyKey,
        },
      };

      finalCheck = {
        checkId,
        checkNumber: displayCheckNumber,
        normalizedCheckNumber,
        userId: customerUid,
        customerName: customerFullName,
        customerAccountNumber,
        customerEmail: uData.email || undefined,
        payeeName,
        amount: amountDollars,
        currency: 'USD',
        sourceAccountType,
        sourceAccountId,
        sourceAccountNumber,
        memo: memo || undefined,
        referenceNumber,
        transactionId: txId,
        status: 'ISSUED',
        debitStatus: 'COMPLETED',
        issuedByUid: adminUid,
        issuedByEmail: adminEmail,
        issuedAt: nowIso,
        idempotencyKey: effectiveIdempotencyKey,
      };

      // 6. Commit all financial & issuance writes atomically
      transaction.set(
        accRef,
        {
          userId: customerUid,
          permanentAccountNumber: customerAccountNumber,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      transaction.set(txRef, finalTx);
      transaction.set(issuedCheckRef, finalCheck);
      transaction.set(idempRef, {
        idempotencyKey: effectiveIdempotencyKey,
        requestFingerprint,
        checkId,
        transactionId: txId,
        checkRecord: finalCheck,
        transaction: finalTx,
        createdAt: nowIso,
      });
      transaction.set(checkNumLockRef, {
        normalizedCheckNumber,
        checkNumber: displayCheckNumber,
        checkId,
        transactionId: txId,
        userId: customerUid,
        idempotencyKey: effectiveIdempotencyKey,
        createdAt: nowIso,
      });
    });
  } catch (err: any) {
    if (err instanceof CheckIssuanceError) {
      return {
        success: false,
        statusCode: err.statusCode,
        errorCode: err.errorCode,
        error: err.message,
      };
    }
    console.error('[executeServerAdminCheckWithdrawal] Atomic transaction failed:', err);
    return {
      success: false,
      statusCode: 500,
      errorCode: 'CHECK_TRANSACTION_FAILED',
      error: err?.message || 'Failed to execute atomic check withdrawal transaction.',
    };
  }

  if (!finalCheck || !finalTx) {
    return {
      success: false,
      statusCode: 500,
      errorCode: 'INCOMPLETE_CHECK_RESULT',
      error: 'Check issuance did not produce a confirmed record.',
    };
  }

  const warnings: string[] = [];

  // Post-commit auxiliary notification & audit trail (never causes duplicate debit or fails committed check)
  if (!isDuplicate) {
    const notifyFn = deps?.persistNotification || persistCustomerNotification;
    try {
      await notifyFn({
        id: `notif_chk_${finalCheck.checkId}_${customerUid}`,
        userId: customerUid,
        title: 'Check Withdrawal Issued',
        message: `Check #${finalCheck.checkNumber} payable to ${finalCheck.payeeName} for -$${amountDollars.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} has been permanently debited from your ${sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'} account. Reference: ${finalTx.referenceNumber}.`,
        type: 'TRANSACTION',
        severity: 'info',
        createdAt: finalCheck.issuedAt,
        referenceId: finalTx.referenceNumber,
        actionView: 'transactions',
        actionRecordId: finalTx.id,
        metadata: {
          category: 'TRANSACTION',
          eventType: 'ADMIN_CHECK_WITHDRAWAL',
          customerName: finalCheck.customerName,
          accountNumberMasked: maskAccountNumber(finalCheck.customerAccountNumber),
          transactionType: 'CHECK_WITHDRAWAL',
          direction: 'DEBIT',
          amount: amountDollars,
          currency: 'USD',
          status: 'COMPLETED',
          referenceNumber: finalTx.referenceNumber,
          checkNumber: finalCheck.checkNumber,
          payeeName: finalCheck.payeeName,
          sourceAccountType,
          date: finalCheck.issuedAt,
        },
      });
    } catch (notifErr: any) {
      console.warn('[executeServerAdminCheckWithdrawal] Auxiliary notification failure:', notifErr?.message || notifErr);
      warnings.push(`Customer notification could not be recorded: ${notifErr?.message || 'Unknown notification error'}`);
    }

    try {
      if (deps?.recordAuditLog) {
        deps.recordAuditLog({
          adminId: adminUid,
          adminEmail,
          targetUserId: customerUid,
          targetAccountNumber: finalCheck.customerAccountNumber,
          amount: amountDollars,
          checkNumber: finalCheck.checkNumber,
          referenceNumber: finalCheck.referenceNumber,
          checkId: finalCheck.checkId,
        });
      } else {
        db.auditLogs.unshift({
          id: `aud_chk_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          adminId: adminUid,
          adminName: adminEmail,
          action: 'ADMIN_ISSUE_CHECK_WITHDRAWAL',
          targetUserId: customerUid,
          targetAccountNumber: finalCheck.customerAccountNumber,
          amount: amountDollars,
          reason: `Issued Check #${finalCheck.checkNumber} to payee "${finalCheck.payeeName}" from ${sourceAccountType} (${finalCheck.referenceNumber})`,
          timestamp: finalCheck.issuedAt,
          ipAddress: 'Server Verified Admin Session',
          result: 'SUCCESS',
        });
      }
    } catch (auditErr: any) {
      console.warn('[executeServerAdminCheckWithdrawal] Auxiliary audit log failure:', auditErr?.message || auditErr);
      warnings.push(`Audit log note: ${auditErr?.message || 'Unknown audit log error'}`);
    }
  }

  return {
    success: true,
    statusCode: 200,
    check: finalCheck,
    transaction: finalTx,
    balanceMetrics: finalMetrics || undefined,
    isDuplicate,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Lists all administrator-issued checks from Firestore ordered newest-first.
 */
export async function getAllIssuedChecksAdmin(deps?: { firestore?: Firestore }): Promise<ListIssuedChecksResult> {
  const firestore = deps?.firestore || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!firestore) {
    return {
      success: false,
      checks: [],
      error: 'Firebase Admin Firestore is unavailable.',
    };
  }

  try {
    const snap = await firestore.collection('issued_checks').get();
    const checks: IssuedCheckRecord[] = snap.docs
      .map((doc) => {
        const data = doc.data() as IssuedCheckRecord;
        return {
          ...data,
          checkId: data.checkId || doc.id,
        };
      })
      .sort((a, b) => new Date(b.issuedAt || 0).getTime() - new Date(a.issuedAt || 0).getTime());

    return {
      success: true,
      checks,
    };
  } catch (err: any) {
    console.error('[getAllIssuedChecksAdmin] Error:', err);
    return {
      success: false,
      checks: [],
      error: err?.message || 'Failed to retrieve issued checks from Firestore.',
    };
  }
}
