import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { adminFirestore, isFirebaseAdminConfigured } from './firebaseAdmin';
import { persistCustomerNotification, maskAccountNumber } from './services/notificationStore';
import {
  prepareNotificationOutboxBatch,
  writePreparedNotificationOutboxBatchInTransaction,
  type WrittenOutboxBatchResult,
} from './services/notificationOutbox';
import { db } from './db';
import {
  BalanceMetrics,
  BankAccount,
  Transaction,
  WireCheckDeliveryAudit,
  WireCheckRequestRecord,
} from '../src/types';

function reportOutboxPreparationIssues(
  context: string,
  txId: string,
  outboxWrite: WrittenOutboxBatchResult | null
): void {
  if (!outboxWrite || outboxWrite.invalidItems.length === 0) return;
  console.warn(
    `[Outbox][${context}] Skipped ${outboxWrite.invalidItems.length} invalid outbox item(s) for transaction ${txId}:`,
    JSON.stringify(
      outboxWrite.invalidItems.map((item) => ({
        userId: item.userId,
        eventKey: item.eventKey,
        dispatchType: item.dispatchType,
        error: item.error,
      }))
    )
  );
}

function formatSafeOutboxAccountLabel(accountNumber?: string | null, label?: string | null): string {
  const masked = maskAccountNumber(accountNumber);
  const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 36) : '';
  return cleanLabel ? `${cleanLabel} (${masked})` : masked;
}

/**
 * Curated United States destination banks supported for Wire Check withdrawals
 * (prominently featuring Regions Bank alongside custom bank support).
 */
export const SUPPORTED_WIRE_CHECK_US_BANKS: readonly string[] = [
  'Regions Bank',
  'JPMorgan Chase Bank',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'U.S. Bank',
  'PNC Bank',
  'Truist Bank',
  'Capital One',
  'TD Bank',
  'Citizens Bank',
  'KeyBank',
  'Fifth Third Bank',
  'Huntington National Bank',
  'BMO Bank',
  'M&T Bank',
  'Ally Bank',
  'Charles Schwab Bank',
];

export interface WireCheckServiceDeps {
  firestore?: Firestore;
  persistNotification?: typeof persistCustomerNotification;
  recordAuditLog?: (entry: {
    action: string;
    adminId: string;
    adminName: string;
    targetUserId: string;
    targetAccountNumber: string;
    amount: number;
    referenceNumber: string;
    requestId: string;
    reason: string;
  }) => void;
}

export interface ExecuteWireCheckParams {
  userId: string;
  bankName: string;
  destinationBankAccountNumber: string;
  destinationBankRoutingNumber: string;
  fullLegalName: string;
  residentialAddress: string;
  email: string;
  phoneNumber: string;
  amount: number;
  sourceAccountType: 'CHECKING' | 'SAVINGS';
  idempotencyKey: string;
}

export interface ExecuteWireCheckResult {
  success: boolean;
  statusCode: number;
  request?: WireCheckRequestRecord;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  warnings?: string[];
  errorCode?: string;
  error?: string;
}

export interface ListWireCheckRequestsResult {
  success: boolean;
  requests: WireCheckRequestRecord[];
  error?: string;
}

export interface MarkWireCheckDeliveredParams {
  requestId: string;
  targetStatus: string;
  adminUid: string;
  adminEmail: string;
}

export interface MarkWireCheckDeliveredResult {
  success: boolean;
  statusCode: number;
  request?: WireCheckRequestRecord;
  transaction?: Transaction;
  warnings?: string[];
  errorCode?: string;
  error?: string;
}

class WireCheckError extends Error {
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

function buildCustomerIdempotencyDocId(userId: string, idempotencyKey: string): string {
  return crypto.createHash('sha256').update(`${userId}\0${idempotencyKey}`).digest('hex');
}

function normalizeBankName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const matchedKnown = SUPPORTED_WIRE_CHECK_US_BANKS.find(
    (b) => b.toLowerCase() === cleaned.toLowerCase()
  );
  return matchedKnown || cleaned;
}

function validateEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function validatePhoneNumber(phone: string): { valid: boolean; digits: string } {
  if (!phone || phone.length > 32) return { valid: false, digits: '' };
  if (!/^[+\d().\-\s]+$/.test(phone)) return { valid: false, digits: '' };
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return { valid: false, digits };
  }
  return { valid: true, digits };
}

function hasControlChars(val: string): boolean {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(val);
}

export function validateDestinationBankAccountNumber(raw: unknown): {
  valid: boolean;
  value: string;
  error?: string;
} {
  if (typeof raw !== 'string') {
    return { valid: false, value: '', error: 'Destination bank account number is required.' };
  }
  const trimmed = raw.trim();
  if (!trimmed || hasControlChars(trimmed)) {
    return { valid: false, value: '', error: 'Destination bank account number is required.' };
  }
  if (!/^[0-9][0-9\-\s]{2,23}$/.test(trimmed)) {
    return {
      valid: false,
      value: '',
      error: 'Destination bank account number must contain only digits (4 to 17 digits).',
    };
  }
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 4 || digitsOnly.length > 17) {
    return {
      valid: false,
      value: '',
      error: 'Destination bank account number must be between 4 and 17 digits.',
    };
  }
  return { valid: true, value: trimmed };
}

export function validateDestinationBankRoutingNumber(raw: unknown): {
  valid: boolean;
  value: string;
  error?: string;
} {
  if (typeof raw !== 'string') {
    return { valid: false, value: '', error: 'Destination bank routing number is required.' };
  }
  const trimmed = raw.trim();
  if (!/^\d{9}$/.test(trimmed)) {
    return {
      valid: false,
      value: '',
      error: 'Destination bank routing number must be exactly 9 numeric digits.',
    };
  }
  if (trimmed === '000000000') {
    return {
      valid: false,
      value: '',
      error: 'Please enter a valid 9-digit US bank routing number.',
    };
  }
  const d = trimmed.split('').map((ch) => Number(ch));
  const checksum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    (d[2] + d[5] + d[8]);
  if (checksum % 10 !== 0) {
    return {
      valid: false,
      value: '',
      error: 'Invalid US bank routing number (failed ABA routing checksum validation).',
    };
  }
  return { valid: true, value: trimmed };
}

function maskExternalBankAccountNumber(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••• ${digits.slice(-4)}`;
}

function toCustomerSafeWireCheckRequest(req: WireCheckRequestRecord): WireCheckRequestRecord {
  const {
    destinationBankAccountNumber,
    destinationBankRoutingNumber: _omittedRouting,
    ...rest
  } = req;
  return stripUndefined({
    ...rest,
    destinationBankAccountNumberMasked:
      rest.destinationBankAccountNumberMasked ||
      (destinationBankAccountNumber
        ? maskExternalBankAccountNumber(destinationBankAccountNumber)
        : undefined),
  });
}

function buildRequestFingerprint(input: {
  userId: string;
  bankName: string;
  destinationBankAccountNumber: string;
  destinationBankRoutingNumber: string;
  fullLegalName: string;
  residentialAddress: string;
  email: string;
  phoneDigits: string;
  sourceAccountType: 'CHECKING' | 'SAVINGS';
  amountCents: number;
}): string {
  const canonical = JSON.stringify({
    userId: input.userId,
    bankName: input.bankName.toLowerCase(),
    destinationBankAccountNumber: input.destinationBankAccountNumber,
    destinationBankRoutingNumber: input.destinationBankRoutingNumber,
    fullLegalName: input.fullLegalName.toLowerCase(),
    residentialAddress: input.residentialAddress.toLowerCase(),
    email: input.email.toLowerCase(),
    phoneDigits: input.phoneDigits,
    sourceAccountType: input.sourceAccountType,
    amountCents: input.amountCents,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function isBalanceFieldPresent(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function parseValidatedBalanceCents(raw: unknown, fieldLabel: string): number {
  if (typeof raw === 'boolean' || typeof raw === 'object') {
    throw new WireCheckError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      `Customer ${fieldLabel} balance data is invalid.`
    );
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num < 0) {
    throw new WireCheckError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      `Customer ${fieldLabel} balance is invalid or negative.`
    );
  }
  const cents = Math.round(num * 100);
  if (cents < 0 || Math.abs(num * 100 - cents) > 1e-4) {
    throw new WireCheckError(
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
    throw new WireCheckError(
      422,
      'AMBIGUOUS_ACCOUNT_BALANCE',
      `Multiple ${label} entries exist in accounts[] without an authoritative top-level balance.`
    );
  }

  const entry: any = matches[0];
  const hasBalance = isBalanceFieldPresent(entry?.balance);
  const hasAvailable = isBalanceFieldPresent(entry?.availableBalance);

  if (!hasBalance && !hasAvailable) {
    throw new WireCheckError(
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
    throw new WireCheckError(
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

function resolveAuthoritativeAccountBalances(aData: Record<string, any>): {
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
    throw new WireCheckError(
      422,
      'INVALID_ACCOUNT_BALANCE',
      'Customer accounts[] record is malformed.'
    );
  }

  const accountsList: BankAccount[] = Array.isArray(aData.accounts) ? aData.accounts : [];

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

function buildDefaultAccountsForWireCheck(
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

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripUndefined(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Isolated Server-Authoritative Customer Wire Check Withdrawal.
 *
 * Atomically debits Checking or Savings in exact integer cents, preserves pendingBalance
 * unchanged, posts a permanently settled WIRE_CHECK_WITHDRAWAL transaction, creates a
 * backend-only wire_check_requests document, and enforces SHA-256 idempotency protection.
 */
export async function executeServerWireCheckWithdrawal(
  params: ExecuteWireCheckParams,
  deps?: WireCheckServiceDeps
): Promise<ExecuteWireCheckResult> {
  const firestore = deps?.firestore || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!firestore) {
    return {
      success: false,
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      error: 'Firebase Admin Firestore is unavailable. Wire Check withdrawals require authoritative database access.',
    };
  }

  // 1. Authenticated customer UID (never accepted from client payload)
  const customerUid = typeof params.userId === 'string' ? params.userId.trim() : '';
  if (!customerUid) {
    return {
      success: false,
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
      error: 'Authenticated customer identity is required.',
    };
  }

  // 2. Mandatory field validation
  const bankName = normalizeBankName(params.bankName);
  if (!bankName || bankName.length < 2 || bankName.length > 120 || hasControlChars(bankName)) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_BANK_NAME',
      error: 'A valid destination bank name (2 to 120 characters) is required.',
    };
  }

  const destAccountCheck = validateDestinationBankAccountNumber(params.destinationBankAccountNumber);
  if (!destAccountCheck.valid) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_DESTINATION_ACCOUNT_NUMBER',
      error: destAccountCheck.error || 'A valid destination bank account number is required.',
    };
  }
  const destinationBankAccountNumber = destAccountCheck.value;
  const destinationBankAccountNumberMasked = maskExternalBankAccountNumber(destinationBankAccountNumber);

  const destRoutingCheck = validateDestinationBankRoutingNumber(params.destinationBankRoutingNumber);
  if (!destRoutingCheck.valid) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_DESTINATION_ROUTING_NUMBER',
      error: destRoutingCheck.error || 'A valid 9-digit US bank routing number is required.',
    };
  }
  const destinationBankRoutingNumber = destRoutingCheck.value;

  const fullLegalName = typeof params.fullLegalName === 'string'
    ? params.fullLegalName.replace(/\s+/g, ' ').trim()
    : '';
  if (!fullLegalName || fullLegalName.length < 2 || fullLegalName.length > 150 || hasControlChars(fullLegalName)) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_FULL_LEGAL_NAME',
      error: 'Full legal name (2 to 150 characters) is required.',
    };
  }

  const residentialAddress = typeof params.residentialAddress === 'string'
    ? params.residentialAddress.replace(/\s+/g, ' ').trim()
    : '';
  if (!residentialAddress || residentialAddress.length < 5 || residentialAddress.length > 300 || hasControlChars(residentialAddress)) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_RESIDENTIAL_ADDRESS',
      error: 'A complete residential delivery address (5 to 300 characters) is required.',
    };
  }

  const email = typeof params.email === 'string' ? params.email.trim().toLowerCase() : '';
  if (!validateEmail(email)) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_EMAIL',
      error: 'A valid customer email address is required.',
    };
  }

  const phoneNumber = typeof params.phoneNumber === 'string' ? params.phoneNumber.trim() : '';
  const phoneCheck = validatePhoneNumber(phoneNumber);
  if (!phoneCheck.valid) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_PHONE_NUMBER',
      error: 'A valid phone number (7 to 15 digits) is required.',
    };
  }

  const rawSourceType = typeof params.sourceAccountType === 'string'
    ? params.sourceAccountType.trim().toUpperCase()
    : '';
  if (rawSourceType !== 'CHECKING' && rawSourceType !== 'SAVINGS') {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_SOURCE_ACCOUNT',
      error: 'Source account must be CHECKING or SAVINGS.',
    };
  }
  const sourceAccountType: 'CHECKING' | 'SAVINGS' = rawSourceType;

  // Monetary amount validation (reject non-number/boolean/object, <= 0, NaN, Infinity, > 2 decimals)
  const rawAmtInput: unknown = params.amount;
  if (
    rawAmtInput === undefined ||
    rawAmtInput === null ||
    typeof rawAmtInput === 'boolean' ||
    typeof rawAmtInput === 'object' ||
    (typeof rawAmtInput === 'string' && rawAmtInput.trim() === '')
  ) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_AMOUNT',
      error: 'A valid positive Wire Check withdrawal amount is required.',
    };
  }

  const rawAmount = Number(rawAmtInput);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_AMOUNT',
      error: 'Wire Check withdrawal amount must be a positive finite number.',
    };
  }

  const amountCents = Math.round(rawAmount * 100);
  if (amountCents <= 0 || Math.abs(rawAmount * 100 - amountCents) > 1e-4) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_AMOUNT_PRECISION',
      error: 'Wire Check withdrawal amount must be positive and have at most 2 decimal places.',
    };
  }
  const amountDollars = fromCents(amountCents);

  const idempotencyKey = typeof params.idempotencyKey === 'string' ? params.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 256 || hasControlChars(idempotencyKey)) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
      error: 'A valid idempotencyKey (1 to 256 characters) is required.',
    };
  }

  const requestFingerprint = buildRequestFingerprint({
    userId: customerUid,
    bankName,
    destinationBankAccountNumber,
    destinationBankRoutingNumber,
    fullLegalName,
    residentialAddress,
    email,
    phoneDigits: phoneCheck.digits,
    sourceAccountType,
    amountCents,
  });

  const safeIdempDocId = buildCustomerIdempotencyDocId(customerUid, idempotencyKey);
  const requestId = `wchk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const txId = `tx_wchk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const referenceNumber = `MV-WCHK-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`;

  const userRef = firestore.collection('users').doc(customerUid);
  const accRef = firestore.collection('accounts').doc(customerUid);
  const idempRef = firestore.collection('wire_check_idempotency').doc(safeIdempDocId);
  const wireCheckReqRef = firestore.collection('wire_check_requests').doc(requestId);
  const txRef = firestore.collection('transactions').doc(txId);

  let finalRequest: WireCheckRequestRecord | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;
  let outboxWriteResult: WrittenOutboxBatchResult | null = null;

  try {
    await firestore.runTransaction(async (transaction) => {
      isDuplicate = false;
      finalRequest = null;
      finalTx = null;
      finalMetrics = null;
      outboxWriteResult = null;

      // ALL READS MUST PRECEDE ALL WRITES
      const [idempSnap, userSnap, accSnap] = await Promise.all([
        transaction.get(idempRef),
        transaction.get(userRef),
        transaction.get(accRef),
      ]);

      // 1. Customer-scoped idempotency & payload fingerprint verification
      if (idempSnap.exists) {
        const idempData = idempSnap.data() || {};
        if (idempData.userId !== customerUid || idempData.requestFingerprint !== requestFingerprint) {
          throw new WireCheckError(
            409,
            'IDEMPOTENCY_MISMATCH',
            'This idempotencyKey was already used with different Wire Check withdrawal details.'
          );
        }

        isDuplicate = true;
        finalRequest = (idempData.requestRecord as WireCheckRequestRecord) || null;
        finalTx = (idempData.transaction as Transaction) || null;

        if (accSnap.exists) {
          const ad = accSnap.data()!;
          const resolvedReplay = resolveAuthoritativeAccountBalances(ad);
          const replayChecking = fromCents(resolvedReplay.checkingCents);
          const replaySavings = fromCents(resolvedReplay.savingsCents);
          const replayInvested = fromCents(resolvedReplay.investedCents);
          const replayAccrued = fromCents(resolvedReplay.accruedCents);
          const replayTotal = isBalanceFieldPresent(ad.totalBalance)
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
            availableBalance: isBalanceFieldPresent(ad.availableBalance)
              ? Number(ad.availableBalance)
              : replayChecking,
            pendingBalance: resolvedReplay.preservedPending,
            loanBalance: resolvedReplay.preservedLoan,
            accounts: resolvedReplay.accountsList,
          };
        }
        return;
      }

      // 2. Validate authenticated customer profile & account freeze status
      if (!userSnap.exists) {
        throw new WireCheckError(
          404,
          'CUSTOMER_NOT_FOUND',
          'Authenticated customer profile was not found.'
        );
      }

      const uData = userSnap.data() || {};
      if (uData.status === 'frozen') {
        throw new WireCheckError(
          403,
          'ACCOUNT_FROZEN',
          'Your account is currently restricted/frozen. Outgoing transfers and withdrawals are disabled. Please contact compliance support.'
        );
      }
      if (uData.role === 'super_admin' || customerUid === 'usr_admin') {
        throw new WireCheckError(
          400,
          'INVALID_CUSTOMER',
          'Executive administrator accounts cannot submit customer Wire Check withdrawals.'
        );
      }

      // 3. Validate authoritative account & source sub-account exist
      if (!accSnap.exists) {
        throw new WireCheckError(
          404,
          'ACCOUNT_NOT_FOUND',
          'Customer account ledger does not exist or has not been initialized.'
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
        throw new WireCheckError(
          404,
          'SOURCE_ACCOUNT_NOT_FOUND',
          'Selected Checking account does not exist for this customer.'
        );
      }
      if (sourceAccountType === 'SAVINGS' && !hasSavings) {
        throw new WireCheckError(
          404,
          'SOURCE_ACCOUNT_NOT_FOUND',
          'Selected Savings account does not exist for this customer.'
        );
      }

      const sourceCents = sourceAccountType === 'CHECKING' ? checkingCents : savingsCents;
      if (sourceCents < amountCents) {
        throw new WireCheckError(
          400,
          'INSUFFICIENT_FUNDS',
          `Insufficient available ${sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'} funds. Available balance is $${fromCents(sourceCents).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}.`
        );
      }

      // 4. Permanent atomic debit in integer cents (preserving pendingBalance unchanged)
      const newCheckingCents = sourceAccountType === 'CHECKING' ? checkingCents - amountCents : checkingCents;
      const newSavingsCents = sourceAccountType === 'SAVINGS' ? savingsCents - amountCents : savingsCents;
      const newTotalCents = newCheckingCents + newSavingsCents + investedCents + accruedCents;

      const newChecking = fromCents(newCheckingCents);
      const newSavings = fromCents(newSavingsCents);
      const currentInvested = fromCents(investedCents);
      const currentAccrued = fromCents(accruedCents);
      const newTotal = fromCents(newTotalCents);
      const newAvailable = newChecking;

      const customerName =
        `${uData.firstName || ''} ${uData.lastName || ''}`.trim() ||
        uData.kycFullName ||
        uData.fullName ||
        uData.username ||
        fullLegalName;

      const customerAccountNumber = String(
        uData.permanentAccountNumber ||
          uData.accountNumber ||
          aData.permanentAccountNumber ||
          '1000000000'
      ).trim();

      const customerEmail = typeof uData.email === 'string' && uData.email.trim()
        ? uData.email.trim()
        : undefined;
      const customerUsername = typeof uData.username === 'string' && uData.username.trim()
        ? uData.username.trim()
        : undefined;

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
          : buildDefaultAccountsForWireCheck(customerUid, newChecking, newSavings, customerAccountNumber);

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
      const syntheticRecipientRef = `WCHK-${requestId.slice(-8).toUpperCase()}`;

      // 5. Completed permanent WIRE_CHECK_WITHDRAWAL transaction (excluded from 30-min reversal)
      finalTx = stripUndefined({
        id: txId,
        referenceNumber,
        clientRequestId: idempotencyKey,
        type: 'WIRE_CHECK_WITHDRAWAL',
        amount: amountDollars,
        currency: 'USD',
        status: 'COMPLETED',
        userId: customerUid,
        senderUserId: customerUid,
        senderAccountId: sourceAccountId,
        senderName: customerName,
        senderAccountNumber: sourceAccountNumber,
        recipientName: `${fullLegalName} (${bankName})`,
        recipientAccountNumber: syntheticRecipientRef,
        fee: 0.0,
        description: `Wire Check Withdrawal (${bankName})`,
        category: 'Wire Check',
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          permanentDebit: true,
          autoReverse: false,
          disbursementType: 'WIRE_CHECK_WITHDRAWAL',
          wireCheckRequestId: requestId,
          checkProcessingStatus: 'REQUESTED',
          estimatedDeliveryBusinessDays: 5,
          bankName,
          destinationBankAccountNumberMasked,
          sourceAccountType,
          sourceAccountId,
          sourceAccountNumberMasked: maskAccountNumber(sourceAccountNumber),
          idempotencyKey,
        },
      });

      // 6. Backend-only wire_check_requests record (protected collection; complete destination-bank details stored strictly here)
      finalRequest = stripUndefined({
        requestId,
        userId: customerUid,
        customerAccountNumber,
        customerName,
        customerEmail,
        customerUsername,
        bankName,
        destinationBankAccountNumber,
        destinationBankAccountNumberMasked,
        destinationBankRoutingNumber,
        fullLegalName,
        residentialAddress,
        email,
        phoneNumber,
        sourceAccountType,
        amount: amountDollars,
        currency: 'USD',
        referenceNumber,
        transactionId: txId,
        transactionStatus: 'COMPLETED' as const,
        permanentDebit: true as const,
        checkProcessingStatus: 'REQUESTED' as const,
        estimatedDeliveryBusinessDays: 5,
        submittedAt: nowIso,
        updatedAt: nowIso,
      });

      // Transaction read-phase: prepare Wire Check SUBMITTED outbox record strictly BEFORE any writes
      // Never include destination account number, routing number, credentials, address, email, phone, or 8+ digit refs
      const wireCheckAmtFormatted = amountDollars.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const sourceLabel = sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings';
      const safeWireCheckSourceMasked = formatSafeOutboxAccountLabel(sourceAccountNumber, sourceLabel);

      const wireCheckSubmitOutboxBatch = await prepareNotificationOutboxBatch(transaction, firestore, [
        {
          userId: customerUid,
          transactionId: finalTx.id,
          referenceNumber: finalTx.referenceNumber,
          eventKey: `${finalTx.id}:SUBMITTED`,
          lifecycleStage: 'SUBMITTED',
          dispatchType: 'TRANSACTION',
          category: 'TRANSACTION',
          nowIso,
          payload: {
            title: 'Wire Check Request Submitted — Monvera',
            body: `Your Wire Check withdrawal request for $${wireCheckAmtFormatted} from ${safeWireCheckSourceMasked} was submitted successfully.`,
            description: `Wire Check withdrawal from ${safeWireCheckSourceMasked}`.slice(0, 140),
            direction: 'DEBIT',
            actionUrl: '/dashboard?view=transactions',
            amount: amountDollars,
            currency: 'USD',
            accountMasked: safeWireCheckSourceMasked,
          },
        },
      ]);

      // 7. Commit all writes atomically
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
      transaction.set(wireCheckReqRef, finalRequest);
      transaction.set(idempRef, {
        idempotencyKey,
        userId: customerUid,
        requestFingerprint,
        requestId,
        transactionId: txId,
        referenceNumber,
        requestRecord: finalRequest,
        transaction: finalTx,
        createdAt: nowIso,
      });
      outboxWriteResult = writePreparedNotificationOutboxBatchInTransaction(
        transaction,
        wireCheckSubmitOutboxBatch
      );
    });
  } catch (err: any) {
    if (err instanceof WireCheckError) {
      return {
        success: false,
        statusCode: err.statusCode,
        errorCode: err.errorCode,
        error: err.message,
      };
    }
    console.error('[executeServerWireCheckWithdrawal] Atomic transaction failed:', err);
    return {
      success: false,
      statusCode: 500,
      errorCode: 'WIRE_CHECK_TRANSACTION_FAILED',
      error: err?.message || 'Failed to execute atomic Wire Check withdrawal transaction.',
    };
  }

  if (!finalRequest || !finalTx) {
    return {
      success: false,
      statusCode: 500,
      errorCode: 'INCOMPLETE_WIRE_CHECK_RESULT',
      error: 'Wire Check submission did not produce a confirmed record.',
    };
  }

  if (!isDuplicate) {
    reportOutboxPreparationIssues('executeServerWireCheckWithdrawal', finalTx.id, outboxWriteResult);
  }

  const warnings: string[] = [];

  // Post-commit auxiliary notification & audit trail (idempotent, never blocks or reverses debit)
  if (!isDuplicate) {
    const notifyFn = deps?.persistNotification || persistCustomerNotification;
    try {
      await notifyFn({
        id: `notif_wchk_sub_${finalRequest.requestId}_${customerUid}`,
        userId: customerUid,
        title: 'Wire Check Withdrawal Completed',
        message: `Your Wire Check withdrawal for -$${amountDollars.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} (${bankName}) has been permanently debited from your ${sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'} account. Expected delivery to your registered residential address is within 5 business days. Reference: ${finalRequest.referenceNumber}.`,
        type: 'TRANSACTION',
        severity: 'info',
        createdAt: finalRequest.submittedAt,
        referenceId: finalRequest.referenceNumber,
        actionView: 'transactions',
        actionRecordId: finalTx.id,
        metadata: {
          category: 'TRANSACTION',
          eventType: 'WIRE_CHECK_WITHDRAWAL_SUBMITTED',
          customerName: finalRequest.customerName,
          senderName: finalRequest.customerName,
          recipientName: finalRequest.bankName,
          destinationLabel: finalRequest.bankName,
          accountNumberMasked: maskAccountNumber(finalRequest.customerAccountNumber),
          transactionType: 'WIRE_CHECK_WITHDRAWAL',
          direction: 'DEBIT',
          amount: amountDollars,
          currency: 'USD',
          status: 'COMPLETED',
          checkProcessingStatus: 'REQUESTED',
          estimatedDeliveryBusinessDays: 5,
          wireCheckRequestId: finalRequest.requestId,
          bankName: finalRequest.bankName,
          sourceAccountType,
          referenceNumber: finalRequest.referenceNumber,
          description: `Wire Check Withdrawal to ${finalRequest.bankName} (5-day delivery)`,
          descriptionProvided: true,
          date: finalRequest.submittedAt,
        },
      });
    } catch (notifErr: any) {
      console.warn('[executeServerWireCheckWithdrawal] Auxiliary notification failure:', notifErr?.message || notifErr);
      warnings.push(`Customer notification could not be recorded: ${notifErr?.message || 'Unknown notification error'}`);
    }

    try {
      if (deps?.recordAuditLog) {
        deps.recordAuditLog({
          action: 'CUSTOMER_WIRE_CHECK_WITHDRAWAL',
          adminId: customerUid,
          adminName: finalRequest.customerName,
          targetUserId: customerUid,
          targetAccountNumber: finalRequest.customerAccountNumber,
          amount: amountDollars,
          referenceNumber: finalRequest.referenceNumber,
          requestId: finalRequest.requestId,
          reason: `Customer Wire Check withdrawal submitted for ${finalRequest.bankName} from ${sourceAccountType} (${finalRequest.referenceNumber})`,
        });
      } else if (!deps?.firestore) {
        db.auditLogs.unshift({
          id: `aud_wchk_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          adminId: customerUid,
          adminName: finalRequest.customerName,
          action: 'CUSTOMER_WIRE_CHECK_WITHDRAWAL',
          targetUserId: customerUid,
          targetAccountNumber: finalRequest.customerAccountNumber,
          amount: amountDollars,
          reason: `Customer Wire Check withdrawal submitted for ${finalRequest.bankName} from ${sourceAccountType} (${finalRequest.referenceNumber})`,
          timestamp: finalRequest.submittedAt,
          ipAddress: 'Verified Customer Auth Session',
          result: 'SUCCESS',
        });
      }
    } catch (auditErr: any) {
      console.warn('[executeServerWireCheckWithdrawal] Auxiliary audit log failure:', auditErr?.message || auditErr);
      warnings.push(`Audit log note: ${auditErr?.message || 'Unknown audit log error'}`);
    }
  }

  return {
    success: true,
    statusCode: 200,
    request: toCustomerSafeWireCheckRequest(finalRequest),
    transaction: finalTx,
    balanceMetrics: finalMetrics || undefined,
    isDuplicate,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Lists all Wire Check requests from Firestore ordered newest-first for Admin Review.
 */
export async function getAllWireCheckRequestsAdmin(deps?: {
  firestore?: Firestore;
}): Promise<ListWireCheckRequestsResult> {
  const firestore = deps?.firestore || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!firestore) {
    return {
      success: false,
      requests: [],
      error: 'Firebase Admin Firestore is unavailable.',
    };
  }

  try {
    const snap = await firestore.collection('wire_check_requests').get();
    const requests: WireCheckRequestRecord[] = snap.docs
      .map((doc) => {
        const data = doc.data() as WireCheckRequestRecord;
        return {
          ...data,
          requestId: data.requestId || doc.id,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
      );

    return {
      success: true,
      requests,
    };
  } catch (err: any) {
    console.error('[getAllWireCheckRequestsAdmin] Error:', err);
    return {
      success: false,
      requests: [],
      error: err?.message || 'Failed to retrieve Wire Check requests from Firestore.',
    };
  }
}

/**
 * Marks a Wire Check request as DELIVERED (only permitted transition: REQUESTED -> DELIVERED).
 * Never reverses, refunds, alters the transaction amount/status, or touches customer balances.
 */
export async function markWireCheckRequestDeliveredAdmin(
  params: MarkWireCheckDeliveredParams,
  deps?: WireCheckServiceDeps
): Promise<MarkWireCheckDeliveredResult> {
  const firestore = deps?.firestore || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!firestore) {
    return {
      success: false,
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      error: 'Firebase Admin Firestore is unavailable.',
    };
  }

  const adminUid = typeof params.adminUid === 'string' ? params.adminUid.trim() : '';
  const adminEmail = typeof params.adminEmail === 'string' ? params.adminEmail.trim().toLowerCase() : '';
  if (!adminUid || !adminEmail) {
    return {
      success: false,
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
      error: 'Verified server administrator identity is required.',
    };
  }

  const requestId = typeof params.requestId === 'string' ? params.requestId.trim() : '';
  if (!requestId) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_REQUEST_ID',
      error: 'Wire Check request ID is required.',
    };
  }

  const normalizedTargetStatus = typeof params.targetStatus === 'string'
    ? params.targetStatus.trim().toUpperCase()
    : '';
  if (normalizedTargetStatus !== 'DELIVERED') {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'INVALID_DELIVERY_STATUS',
      error: 'Only transition to DELIVERED is permitted for Wire Check requests. Cancellation or reversal is not supported.',
    };
  }

  const wireCheckReqRef = firestore.collection('wire_check_requests').doc(requestId);

  let updatedRequest: WireCheckRequestRecord | null = null;
  let updatedTx: Transaction | null = null;
  let outboxWriteResult: WrittenOutboxBatchResult | null = null;

  try {
    await firestore.runTransaction(async (transaction) => {
      updatedRequest = null;
      updatedTx = null;
      outboxWriteResult = null;

      const reqSnap = await transaction.get(wireCheckReqRef);
      if (!reqSnap.exists) {
        throw new WireCheckError(
          404,
          'WIRE_CHECK_NOT_FOUND',
          `Wire Check request "${requestId}" was not found.`
        );
      }

      const reqData = reqSnap.data() as WireCheckRequestRecord;
      if (reqData.checkProcessingStatus === 'DELIVERED') {
        throw new WireCheckError(
          409,
          'ALREADY_DELIVERED',
          'This Wire Check request has already been marked as DELIVERED.'
        );
      }
      if (reqData.checkProcessingStatus !== 'REQUESTED') {
        throw new WireCheckError(
          409,
          'INVALID_STATUS_TRANSITION',
          `Cannot transition Wire Check request from "${reqData.checkProcessingStatus}" to "DELIVERED".`
        );
      }

      const txId = String(reqData.transactionId || '').trim();
      if (!txId) {
        throw new WireCheckError(
          422,
          'MISSING_LINKED_TRANSACTION',
          'Wire Check request is missing its linked transaction record.'
        );
      }

      const txRef = firestore.collection('transactions').doc(txId);
      const txSnap = await transaction.get(txRef);
      if (!txSnap.exists) {
        throw new WireCheckError(
          404,
          'TRANSACTION_NOT_FOUND',
          'Linked financial transaction record was not found.'
        );
      }

      const txData = txSnap.data() as Transaction;
      if (txData.type !== 'WIRE_CHECK_WITHDRAWAL' || txData.status !== 'COMPLETED') {
        throw new WireCheckError(
          409,
          'INVALID_TRANSACTION_STATE',
          'Wire Check can only be marked delivered when the underlying WIRE_CHECK_WITHDRAWAL transaction is COMPLETED.'
        );
      }

      const nowIso = new Date().toISOString();
      const deliveryAudit: WireCheckDeliveryAudit = {
        previousStatus: 'REQUESTED',
        nextStatus: 'DELIVERED',
        adminUid,
        adminEmail,
        deliveredAt: nowIso,
      };

      updatedRequest = {
        ...reqData,
        requestId: reqData.requestId || requestId,
        checkProcessingStatus: 'DELIVERED',
        updatedAt: nowIso,
        deliveredAt: nowIso,
        deliveredByUid: adminUid,
        deliveredByEmail: adminEmail,
        deliveryAudit,
      };

      const nextTxMeta = {
        ...(txData.metadata || {}),
        checkProcessingStatus: 'DELIVERED',
        deliveredAt: nowIso,
        deliveredByUid: adminUid,
        deliveredByEmail: adminEmail,
      };

      updatedTx = {
        ...txData,
        metadata: nextTxMeta,
      };

      const targetCustomerUid = String(reqData.userId || txData.userId || '').trim();
      const authoritativeAmount = Number(txData.amount ?? reqData.amount ?? 0);
      const delivSourceType = String(
        txData.metadata?.sourceAccountType || reqData.sourceAccountType || ''
      )
        .trim()
        .toUpperCase();
      const delivSourceLabel =
        delivSourceType === 'CHECKING'
          ? 'Checking'
          : delivSourceType === 'SAVINGS'
            ? 'Savings'
            : 'Account';
      const safeDelivAccountMasked = formatSafeOutboxAccountLabel(
        txData.senderAccountNumber || reqData.customerAccountNumber,
        delivSourceLabel
      );
      const hasPositiveDelivAmt = Number.isFinite(authoritativeAmount) && authoritativeAmount > 0;
      const delivAmtFormatted = hasPositiveDelivAmt
        ? authoritativeAmount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '';

      // Transaction read-phase: prepare Wire Check DELIVERED outbox record strictly BEFORE any writes
      // Uses existing authoritative transactionId & `:DELIVERED` lifecycle milestone without destination bank/routing details
      const wireCheckDelivOutboxBatch = await prepareNotificationOutboxBatch(transaction, firestore, [
        {
          userId: targetCustomerUid,
          transactionId: txId,
          referenceNumber: String(reqData.referenceNumber || txData.referenceNumber || txId).trim(),
          eventKey: `${txId}:DELIVERED`,
          lifecycleStage: 'DELIVERED',
          dispatchType: 'TRANSACTION',
          category: 'TRANSACTION',
          nowIso,
          payload: {
            title: 'Wire Check Delivered — Monvera',
            body: hasPositiveDelivAmt
              ? `Your Wire Check of $${delivAmtFormatted} from ${safeDelivAccountMasked} has been marked as delivered.`
              : `Your Wire Check from ${safeDelivAccountMasked} has been marked as delivered.`,
            description: 'Wire Check marked delivered'.slice(0, 140),
            direction: 'INFO',
            actionUrl: '/dashboard?view=transactions',
            ...(hasPositiveDelivAmt ? { amount: authoritativeAmount } : {}),
            currency: String(txData.currency || reqData.currency || 'USD').trim() || 'USD',
            accountMasked: safeDelivAccountMasked,
          },
        },
      ]);

      // Update request status & linked transaction history metadata (NEVER balances, amount, or status)
      transaction.set(
        wireCheckReqRef,
        {
          checkProcessingStatus: 'DELIVERED',
          updatedAt: nowIso,
          deliveredAt: nowIso,
          deliveredByUid: adminUid,
          deliveredByEmail: adminEmail,
          deliveryAudit,
        },
        { merge: true }
      );

      transaction.set(
        txRef,
        {
          updatedAt: nowIso,
          metadata: nextTxMeta,
        },
        { merge: true }
      );

      outboxWriteResult = writePreparedNotificationOutboxBatchInTransaction(
        transaction,
        wireCheckDelivOutboxBatch
      );
    });
  } catch (err: any) {
    if (err instanceof WireCheckError) {
      return {
        success: false,
        statusCode: err.statusCode,
        errorCode: err.errorCode,
        error: err.message,
      };
    }
    console.error('[markWireCheckRequestDeliveredAdmin] Transaction failed:', err);
    return {
      success: false,
      statusCode: 500,
      errorCode: 'WIRE_CHECK_DELIVERY_FAILED',
      error: err?.message || 'Failed to mark Wire Check request as delivered.',
    };
  }

  if (!updatedRequest) {
    return {
      success: false,
      statusCode: 500,
      errorCode: 'INCOMPLETE_DELIVERY_RESULT',
      error: 'Delivery update did not produce a confirmed record.',
    };
  }

  reportOutboxPreparationIssues(
    'markWireCheckRequestDeliveredAdmin',
    updatedRequest.transactionId || updatedRequest.requestId,
    outboxWriteResult
  );

  const warnings: string[] = [];
  const notifyFn = deps?.persistNotification || persistCustomerNotification;

  try {
    await notifyFn({
      id: `notif_wchk_deliv_${updatedRequest.requestId}_${updatedRequest.userId}`,
      userId: updatedRequest.userId,
      title: 'Wire Check Delivered',
      message: 'Your Wire Check has been marked as delivered. Thank you for banking with Monvera Digital Banking.',
      type: 'TRANSACTION',
      severity: 'success',
      createdAt: updatedRequest.deliveredAt,
      referenceId: updatedRequest.referenceNumber,
      actionView: 'transactions',
      actionRecordId: updatedRequest.transactionId,
      metadata: {
        category: 'TRANSACTION',
        eventType: 'WIRE_CHECK_WITHDRAWAL_DELIVERED',
        customerName: updatedRequest.customerName,
        senderName: updatedRequest.customerName,
        recipientName: updatedRequest.bankName,
        destinationLabel: updatedRequest.bankName,
        accountNumberMasked: maskAccountNumber(updatedRequest.customerAccountNumber),
        transactionType: 'WIRE_CHECK_WITHDRAWAL',
        direction: 'DEBIT',
        amount: updatedRequest.amount,
        currency: updatedRequest.currency || 'USD',
        status: 'COMPLETED',
        checkProcessingStatus: 'DELIVERED',
        wireCheckRequestId: updatedRequest.requestId,
        bankName: updatedRequest.bankName,
        sourceAccountType: updatedRequest.sourceAccountType,
        referenceNumber: updatedRequest.referenceNumber,
        deliveredAt: updatedRequest.deliveredAt,
        description: `Wire Check delivered to registered residential address`,
        descriptionProvided: true,
        date: updatedRequest.deliveredAt,
      },
    });
  } catch (notifErr: any) {
    console.warn('[markWireCheckRequestDeliveredAdmin] Auxiliary notification failure:', notifErr?.message || notifErr);
    warnings.push(`Customer delivery notification could not be recorded: ${notifErr?.message || 'Unknown notification error'}`);
  }

  try {
    if (deps?.recordAuditLog) {
      deps.recordAuditLog({
        action: 'ADMIN_MARK_WIRE_CHECK_DELIVERED',
        adminId: adminUid,
        adminName: adminEmail,
        targetUserId: updatedRequest.userId,
        targetAccountNumber: updatedRequest.customerAccountNumber,
        amount: updatedRequest.amount,
        referenceNumber: updatedRequest.referenceNumber,
        requestId: updatedRequest.requestId,
        reason: `Marked Wire Check ${updatedRequest.referenceNumber} as DELIVERED`,
      });
    } else if (!deps?.firestore) {
      db.auditLogs.unshift({
        id: `aud_wchk_deliv_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        adminId: adminUid,
        adminName: adminEmail,
        action: 'ADMIN_MARK_WIRE_CHECK_DELIVERED',
        targetUserId: updatedRequest.userId,
        targetAccountNumber: updatedRequest.customerAccountNumber,
        amount: updatedRequest.amount,
        reason: `Marked Wire Check ${updatedRequest.referenceNumber} as DELIVERED`,
        timestamp: updatedRequest.deliveredAt || updatedRequest.updatedAt,
        ipAddress: 'Server Verified Admin Session',
        result: 'SUCCESS',
      });
    }
  } catch (auditErr: any) {
    console.warn('[markWireCheckRequestDeliveredAdmin] Auxiliary audit log failure:', auditErr?.message || auditErr);
    warnings.push(`Audit log note: ${auditErr?.message || 'Unknown audit log error'}`);
  }

  return {
    success: true,
    statusCode: 200,
    request: updatedRequest,
    transaction: updatedTx || undefined,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
