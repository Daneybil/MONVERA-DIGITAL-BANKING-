import type { BankAccount, BalanceMetrics } from '../types';

export interface AccountBalanceSelectionResult {
  source: 'uid' | 'legacy' | 'none';
  data: Record<string, any> | null;
}

export interface SnapshotCoordinatorState {
  uidReceived: boolean;
  uidExists: boolean;
  uidData: Record<string, any> | null;
  uidErrored: boolean;
  legacyReceived: boolean;
  legacyExists: boolean;
  legacyData: Record<string, any> | null;
  legacyErrored: boolean;
  legacyPermissionDenied: boolean;
}

export function isFirestorePermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' && err.toLowerCase().includes('permission-denied');
  }
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || '').toLowerCase();
  return code === 'permission-denied' || code === '7' || msg.includes('permission-denied') || msg.includes('missing or insufficient permissions');
}

/**
 * Normalize an account number by removing whitespace/dashes and rejecting sentinel placeholders.
 */
export function sanitizeAccountNumber(accountNumber?: string | null): string {
  if (typeof accountNumber !== 'string') return '';
  const cleaned = accountNumber.replace(/[-\s]/g, '').trim();
  if (!cleaned || cleaned === '0000000000') return '';
  return cleaned;
}

/**
 * Determine whether a Firestore account document holds any positive balance
 * across Checking, Savings, Invested, Accrued Earnings, Available, Pending, or sub-accounts.
 */
export function hasAnyPositiveBalance(data: Record<string, any> | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false;

  const numericFields = [
    data.checkingBalance,
    data.savingsBalance,
    data.savings,
    data.investedBalance,
    data.investmentBalance,
    data.accruedEarnings,
    data.totalBalance,
    data.availableBalance,
    data.pendingBalance,
  ];

  for (const val of numericFields) {
    const num = Number(val ?? 0);
    if (Number.isFinite(num) && num > 0) {
      return true;
    }
  }

  if (Array.isArray(data.accounts)) {
    for (const acc of data.accounts) {
      if (!acc || typeof acc !== 'object') continue;
      if (
        (Number.isFinite(Number(acc.balance ?? 0)) && Number(acc.balance ?? 0) > 0) ||
        (Number.isFinite(Number(acc.availableBalance ?? 0)) && Number(acc.availableBalance ?? 0) > 0) ||
        (Number.isFinite(Number(acc.investedBalance ?? 0)) && Number(acc.investedBalance ?? 0) > 0)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Verify that a legacy account document keyed by permanentAccountNumber belongs to the authenticated user.
 * Never rejects legacy docs solely for missing optional metadata fields, but strictly rejects any
 * document whose explicit identity fields (userId/uid/ownerUid/permanentAccountNumber/accountNumber/email)
 * point to a different customer.
 */
export function isLegacyAccountOwnedByUser(params: {
  uid: string;
  cleanAccountNumber: string;
  legacyData: Record<string, any> | null | undefined;
  userEmail?: string | null;
}): boolean {
  const { uid, cleanAccountNumber, legacyData, userEmail } = params;
  if (!uid || !cleanAccountNumber || cleanAccountNumber === uid) return false;
  if (!legacyData || typeof legacyData !== 'object') return false;

  const ownerFields = [legacyData.userId, legacyData.uid, legacyData.ownerUid];
  for (const field of ownerFields) {
    if (typeof field === 'string' && field.trim().length > 0 && field.trim() !== uid) {
      return false;
    }
  }

  const docAccFields = [legacyData.permanentAccountNumber, legacyData.accountNumber];
  for (const accField of docAccFields) {
    if (typeof accField === 'string' && accField.trim().length > 0) {
      const cleanDocAcc = accField.replace(/[-\s]/g, '').trim();
      if (cleanDocAcc && cleanDocAcc !== cleanAccountNumber) {
        return false;
      }
    }
  }

  if (
    typeof userEmail === 'string' &&
    userEmail.trim().length > 0 &&
    typeof legacyData.email === 'string' &&
    legacyData.email.trim().length > 0
  ) {
    if (legacyData.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
      return false;
    }
  }

  return true;
}

/**
 * Authoritative account-source selector shared by client reads, real-time listeners, and backend API.
 * Ensures an empty or zero-valued accounts/{uid} document NEVER overwrites a valid owned legacy
 * accounts/{permanentAccountNumber} balance.
 */
export function selectAuthoritativeAccountDocData(params: {
  uid: string;
  uidExists: boolean;
  uidData: Record<string, any> | null | undefined;
  legacyAccNumber?: string | null;
  legacyExists?: boolean;
  legacyData?: Record<string, any> | null | undefined;
  userEmail?: string | null;
}): AccountBalanceSelectionResult {
  const { uid, uidExists, uidData, legacyAccNumber, legacyExists, legacyData, userEmail } = params;

  const uidUsableData = uidExists && uidData && typeof uidData === 'object' ? uidData : null;
  const uidHasPositive = hasAnyPositiveBalance(uidUsableData);

  if (uidHasPositive && uidUsableData) {
    return { source: 'uid', data: uidUsableData };
  }

  const cleanAcc = sanitizeAccountNumber(legacyAccNumber);
  const legacyOwned = Boolean(
    cleanAcc &&
      cleanAcc !== uid &&
      legacyExists &&
      legacyData &&
      isLegacyAccountOwnedByUser({
        uid,
        cleanAccountNumber: cleanAcc,
        legacyData,
        userEmail,
      })
  );

  if (legacyOwned && legacyData && hasAnyPositiveBalance(legacyData)) {
    return { source: 'legacy', data: legacyData };
  }

  if (uidUsableData) {
    return { source: 'uid', data: uidUsableData };
  }

  if (legacyOwned && legacyData) {
    return { source: 'legacy', data: legacyData };
  }

  return { source: 'none', data: null };
}

/**
 * Normalize a Firestore account document into standard Monvera BalanceMetrics.
 */
export function normalizeBalanceMetricsFromDoc(
  userId: string,
  data: Record<string, any>,
  fallbackAccountNumber?: string
): BalanceMetrics {
  const chk = Number(data.checkingBalance ?? 0);
  const sav = Number(data.savingsBalance ?? data.savings ?? 0);
  const inv = Number(data.investedBalance ?? data.investmentBalance ?? 0);
  const accrued = Number(data.accruedEarnings ?? 0);
  const avail = Number(data.availableBalance ?? chk);
  const total = Number(data.totalBalance ?? chk + sav + inv + accrued);
  const loanBal = Number(data.loanBalance ?? 0);
  const resolvedAccNum =
    sanitizeAccountNumber(fallbackAccountNumber) ||
    sanitizeAccountNumber(data.permanentAccountNumber) ||
    '1000000000';

  const accountsList: BankAccount[] =
    Array.isArray(data.accounts) && data.accounts.length > 0
      ? data.accounts.map((a: any) => {
          if (a.type === 'CHECKING') {
            return { ...a, balance: chk, availableBalance: avail };
          }
          if (a.type === 'SAVINGS') {
            return { ...a, balance: sav, availableBalance: sav };
          }
          if (a.type === 'INVESTMENT') {
            return { ...a, balance: inv, investedBalance: inv };
          }
          return a;
        })
      : [
          {
            id: `acc_chk_${userId}`,
            userId,
            type: 'CHECKING',
            accountNumber: resolvedAccNum,
            routingNumber: '021000021',
            currency: 'USD',
            balance: chk,
            availableBalance: avail,
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
            accountNumber: resolvedAccNum.length >= 7 ? `10${resolvedAccNum.slice(2, -3)}991` : '1000000991',
            routingNumber: '021000021',
            currency: 'USD',
            balance: sav,
            availableBalance: sav,
            investedBalance: 0,
            pendingBalance: 0,
            interestRateAPY: 4.85,
            status: 'ACTIVE',
            nickname: 'Monvera High-Yield Treasury',
          },
        ];

  const metrics: BalanceMetrics = {
    checkingBalance: chk,
    savingsBalance: sav,
    investedBalance: inv,
    accruedEarnings: accrued,
    totalBalance: total,
    availableBalance: avail,
    pendingBalance: Number(data.pendingBalance ?? 0),
    loanBalance: loanBal,
    accounts: accountsList,
  };

  if (data.monthlyIncome !== undefined) {
    (metrics as any).monthlyIncome = Number(data.monthlyIncome);
  }
  if (data.monthlySpending !== undefined) {
    (metrics as any).monthlySpending = Number(data.monthlySpending);
  }

  return metrics;
}

/**
 * Pure two-stream coordinator for real-time balance listeners (`accounts/{uid}` and optional `accounts/{permanentAccountNumber}`).
 * Prevents an empty/zero `accounts/{uid}` snapshot from emitting $0 over a valid legacy balance or firing a $0 flicker
 * before the legacy listener finishes its initial snapshot or when client security rules deny reading legacy accounts directly.
 */
export function createAccountSnapshotCoordinator(params: {
  uid: string;
  legacyAccNumber?: string | null;
  userEmail?: string | null;
  onUpdate: (metrics: BalanceMetrics) => void;
  onError?: (err: unknown) => void;
  onLegacyPermissionDenied?: () => void;
}) {
  const cleanAcc = sanitizeAccountNumber(params.legacyAccNumber);
  const hasLegacyPath = Boolean(cleanAcc && cleanAcc !== params.uid);
  let lastFallbackSignature: string | null = null;

  const state: SnapshotCoordinatorState = {
    uidReceived: false,
    uidExists: false,
    uidData: null,
    uidErrored: false,
    legacyReceived: !hasLegacyPath,
    legacyExists: false,
    legacyData: null,
    legacyErrored: false,
    legacyPermissionDenied: false,
  };

  const buildUidFallbackSignature = () => {
    if (!state.uidExists || !state.uidData) return 'missing';
    return JSON.stringify({
      c: Number(state.uidData.checkingBalance ?? 0),
      s: Number(state.uidData.savingsBalance ?? state.uidData.savings ?? 0),
      i: Number(state.uidData.investedBalance ?? state.uidData.investmentBalance ?? 0),
      a: Number(state.uidData.accruedEarnings ?? 0),
      t: Number(state.uidData.totalBalance ?? 0),
      av: Number(state.uidData.availableBalance ?? 0),
      p: Number(state.uidData.pendingBalance ?? 0),
      u: state.uidData.updatedAt ?? null,
    });
  };

  const evaluateAndEmit = () => {
    const uidHasPositive = hasAnyPositiveBalance(state.uidData);

    if (uidHasPositive && state.uidData) {
      lastFallbackSignature = null;
      params.onUpdate(normalizeBalanceMetricsFromDoc(params.uid, state.uidData, cleanAcc || undefined));
      return;
    }

    // Wait until both streams have settled their initial read unless accounts/{uid} already holds a positive balance.
    if (!state.uidReceived || !state.legacyReceived) {
      return;
    }

    // If UID stream errored and legacy has no positive balance, hold without emitting $0.
    if (state.uidErrored && !hasAnyPositiveBalance(state.legacyData)) {
      return;
    }

    // Under customer Firestore security rules, reading accounts/{permanentAccountNumber} directly fails with permission-denied.
    // Never interpret permission-denied as proof that no legacy balance exists, and never emit an unverified $0 UID snapshot.
    // Request authenticated backend fallback instead and preserve cached/verified balances until resolved.
    if (hasLegacyPath && state.legacyPermissionDenied) {
      const sig = buildUidFallbackSignature();
      if (lastFallbackSignature !== sig) {
        lastFallbackSignature = sig;
        params.onLegacyPermissionDenied?.();
      }
      return;
    }

    // If UID doc is missing or all-zero AND the legacy stream errored transiently,
    // do NOT emit an unverified $0 that could overwrite cached balance displays.
    if (state.legacyErrored && (!state.uidExists || !uidHasPositive)) {
      return;
    }

    const selection = selectAuthoritativeAccountDocData({
      uid: params.uid,
      uidExists: state.uidExists,
      uidData: state.uidData,
      legacyAccNumber: cleanAcc,
      legacyExists: state.legacyExists,
      legacyData: state.legacyData,
      userEmail: params.userEmail,
    });

    if (selection.source !== 'none' && selection.data) {
      params.onUpdate(normalizeBalanceMetricsFromDoc(params.uid, selection.data, cleanAcc || undefined));
    }
  };

  return {
    onUidSnapshot(exists: boolean, data: Record<string, any> | null | undefined) {
      state.uidReceived = true;
      state.uidErrored = false;
      state.uidExists = exists;
      state.uidData = exists && data ? data : null;
      evaluateAndEmit();
    },
    onUidError(err: unknown) {
      state.uidReceived = true;
      state.uidErrored = true;
      evaluateAndEmit();
      params.onError?.(err);
    },
    onLegacySnapshot(exists: boolean, data: Record<string, any> | null | undefined) {
      state.legacyReceived = true;
      state.legacyErrored = false;
      state.legacyPermissionDenied = false;
      state.legacyExists = exists;
      state.legacyData = exists && data ? data : null;
      evaluateAndEmit();
    },
    onLegacyError(err: unknown) {
      state.legacyReceived = true;
      const isPermissionDenied = isFirestorePermissionDeniedError(err);
      state.legacyErrored = !isPermissionDenied;
      state.legacyPermissionDenied = isPermissionDenied;
      evaluateAndEmit();
      if (!isPermissionDenied) {
        params.onError?.(err);
      }
    },
  };
}

/**
 * Pure client-side balance resolution helper shared by firestoreSync.getAccountBalances.
 * Ensures permission-denied or transient errors on the legacy path never convert an unverified $0 UID doc
 * into an authoritative live result; returns null so callers consult authenticated /api/accounts/balance.
 */
export async function resolveClientAccountBalanceRead(params: {
  userId: string;
  userAccountNumber?: string;
  userEmail?: string;
  readAccountDoc: (docId: string) => Promise<{ exists: boolean; data: Record<string, any> | null }>;
}): Promise<BalanceMetrics | null> {
  const { userId, userAccountNumber, userEmail, readAccountDoc } = params;
  if (!userId) return null;

  const uidSnap = await readAccountDoc(userId);
  const uidExists = uidSnap.exists;
  const uidData = uidExists ? uidSnap.data : null;

  if (uidExists && uidData && hasAnyPositiveBalance(uidData)) {
    return normalizeBalanceMetricsFromDoc(userId, uidData, sanitizeAccountNumber(userAccountNumber) || userAccountNumber);
  }

  let legacyExists = false;
  let legacyData: Record<string, any> | null = null;
  let legacyBlockedOrErrored = false;
  const cleanAcc = sanitizeAccountNumber(userAccountNumber);

  if (cleanAcc && cleanAcc !== userId) {
    try {
      const legacySnap = await readAccountDoc(cleanAcc);
      if (legacySnap.exists) {
        legacyExists = true;
        legacyData = legacySnap.data;
      }
    } catch {
      // Both permission-denied and transient errors mean client cannot verify legacy balance:
      // do NOT fall back to returning an unverified $0 UID record as authoritative.
      legacyBlockedOrErrored = true;
    }
  }

  if (legacyBlockedOrErrored) {
    return null;
  }

  const selection = selectAuthoritativeAccountDocData({
    uid: userId,
    uidExists,
    uidData,
    legacyAccNumber: cleanAcc || undefined,
    legacyExists,
    legacyData,
    userEmail,
  });

  if (selection.source !== 'none' && selection.data) {
    return normalizeBalanceMetricsFromDoc(userId, selection.data, cleanAcc || userAccountNumber);
  }

  return null;
}

/**
 * Validate and parse a cached BalanceMetrics JSON string from localStorage.
 */
export function parseCachedBalanceMetrics(raw: string | null | undefined): BalanceMetrics | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.totalBalance !== 'number' || !Number.isFinite(parsed.totalBalance)) return null;
    if (typeof parsed.checkingBalance !== 'number' || !Number.isFinite(parsed.checkingBalance)) return null;
    if (!Array.isArray(parsed.accounts)) return null;
    return parsed as BalanceMetrics;
  } catch {
    return null;
  }
}

export function getCachedBalanceStorageKey(userId: string): string {
  return `monvera_balances_${userId}`;
}

export function getCachedBalanceMetaStorageKey(userId: string): string {
  return `monvera_balances_meta_${userId}`;
}

export function readCachedUserBalances(
  userId: string,
  storage?: Pick<Storage, 'getItem'> | null
): { metrics: BalanceMetrics; cachedAt: string | null } | null {
  if (!userId) return null;
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null;
  if (!targetStorage) return null;
  try {
    const raw = targetStorage.getItem(getCachedBalanceStorageKey(userId));
    const metrics = parseCachedBalanceMetrics(raw);
    if (!metrics) return null;
    let cachedAt: string | null = null;
    try {
      const metaRaw = targetStorage.getItem(getCachedBalanceMetaStorageKey(userId));
      if (metaRaw) {
        const metaParsed = JSON.parse(metaRaw);
        if (typeof metaParsed?.cachedAt === 'string') {
          cachedAt = metaParsed.cachedAt;
        }
      }
    } catch {}
    return { metrics, cachedAt };
  } catch {
    return null;
  }
}

export function writeCachedUserBalances(
  userId: string,
  metrics: BalanceMetrics,
  storage?: Pick<Storage, 'setItem'> | null,
  cachedAt: string = new Date().toISOString()
): void {
  if (!userId || !metrics) return;
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null;
  if (!targetStorage) return;
  try {
    targetStorage.setItem(getCachedBalanceStorageKey(userId), JSON.stringify(metrics));
    targetStorage.setItem(getCachedBalanceMetaStorageKey(userId), JSON.stringify({ cachedAt }));
  } catch {}
}
