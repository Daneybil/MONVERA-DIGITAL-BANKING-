import {
  UserProfile,
  BankAccount,
  Transaction,
  TransactionStatus,
  InvestmentPlan,
  InvestmentEarningLog,
  LoanApplication,
  LoanStatus,
  CardItem,
  NotificationItem,
  AdminAuditLog,
  SessionInfo,
  AdminSystemOverview,
  InvestmentTermDays,
  KycStatus,
  WelcomeRewardInfo,
} from '../types';
import { db, auth } from './firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestoreSync } from './firestoreSync';
import { notificationDispatcher } from './notificationDispatcher';

const API_BASE_URL = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '');

export function getApiEndpoint(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return API_BASE_URL ? `${API_BASE_URL}${cleanEndpoint}` : cleanEndpoint;
}

const ADMIN_SESSION_STORAGE_KEY = 'monvera_admin_session_token';

export function getAdminSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setAdminSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token);
  } catch {}
}

export function clearAdminSessionToken(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {}
}

/**
 * Returns a complete URL for displaying or downloading KYC documents,
 * appending the verified admin session token when accessing server-streamed documents.
 */
export function getKycDocumentUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('/api/kyc/documents/')) {
    const adminToken = getAdminSessionToken();
    if (adminToken && !url.includes('adminSession=')) {
      return `${url}${url.includes('?') ? '&' : '?'}adminSession=${encodeURIComponent(adminToken)}`;
    }
  }
  return url;
}

/**
 * Retrieves Firebase Auth Bearer token headers for authenticated backend calls.
 * If an active verified administrator session token is present, attaches X-Admin-Session.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    if (auth && auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
  } catch (err) {
    console.warn('[getAuthHeaders] Could not retrieve Firebase ID token:', err);
  }
  const adminToken = getAdminSessionToken();
  if (adminToken) {
    headers['X-Admin-Session'] = adminToken;
  }
  return headers;
}

/**
 * Robust JSON parser that gracefully handles non-JSON responses (such as 404 HTML pages or network offline)
 */
async function parseJsonResponse<T>(
  res: Response,
  fallback: T
): Promise<T & { isBackendUnavailable?: boolean; rawStatus?: number; error?: string }> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  try {
    const text = await res.text();
    if (!text || text.trim() === '') {
      return { ...fallback, isBackendUnavailable: !res.ok, rawStatus: res.status };
    }

    if (isJson || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        return {
          ...parsed,
          rawStatus: res.status,
          isBackendUnavailable: false,
        };
      } catch {
        // Fall through if parsing failed
      }
    }

    return {
      ...fallback,
      error: fallback && (fallback as any).error ? (fallback as any).error : `Service returned non-JSON response (${res.status})`,
      isBackendUnavailable: true,
      rawStatus: res.status,
    };
  } catch (err) {
    console.warn('[API] Non-JSON or malformed response encountered:', err);
    return { ...fallback, isBackendUnavailable: true, rawStatus: res.status };
  }
}

/**
 * Monvera User Directory - Stores only real accounts created in the platform
 */
const SEED_USERS: UserProfile[] = [];

export interface BalanceMetrics {
  checkingBalance: number;
  savingsBalance: number;
  investedBalance: number;
  accruedEarnings: number;
  totalBalance: number;
  availableBalance: number;
  pendingBalance: number;
  loanBalance?: number;
  accounts: BankAccount[];
}

export interface RecipientLookupResult {
  valid: boolean;
  recipientId?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
  permanentAccountNumber?: string;
  maskedAccountNumber?: string;
  membershipTier?: string;
  verified?: boolean;
  error?: string;
}

export const api = {
  async getUsers(): Promise<{ users: UserProfile[] }> {
    try {
      const res = await fetch('/api/auth/users');
      return await parseJsonResponse(res, { users: [] });
    } catch {
      return { users: [] };
    }
  },

  async getCurrentUser(userId?: string): Promise<{ user: UserProfile; balanceMetrics: BalanceMetrics }> {
    try {
      const res = await fetch(`/api/auth/me?userId=${encodeURIComponent(userId || '')}`);
      return await parseJsonResponse(res, { user: null as any, balanceMetrics: null as any });
    } catch {
      return { user: null as any, balanceMetrics: null as any };
    }
  },

  async login(identifier: string, password?: string): Promise<{ success: boolean; user?: UserProfile; balanceMetrics?: BalanceMetrics; error?: string }> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      return await parseJsonResponse(res, { success: false, error: 'Authentication service offline' });
    } catch (err: any) {
      return { success: false, error: err?.message || 'Login network failure' };
    }
  },

  async register(data: {
    id?: string;
    uid?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    country?: string;
    maritalStatus?: string;
    address?: string;
    taxId?: string;
    password?: string;
    isBusiness?: boolean;
    businessName?: string;
    permanentAccountNumber?: string;
    kycStatus?: KycStatus;
    kycDocumentType?: string;
    kycDocumentNumber?: string;
    kycVerifiedAt?: string;
  }): Promise<{ success: boolean; user?: UserProfile; balanceMetrics?: BalanceMetrics; error?: string }> {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return await parseJsonResponse(res, { success: true });
    } catch {
      return { success: true };
    }
  },

  async changePassword(data: {
    userId: string;
    currentPassword?: string;
    newPassword: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async resetPassword(data: {
    emailOrAccount: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateAvatar(data: {
    userId: string;
    avatarUrl: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    const res = await fetch('/api/auth/update-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateUserProfile(data: {
    userId: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: string;
    country?: string;
    address?: string;
    streetAddress?: string;
    maritalStatus?: string;
    businessName?: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(data),
      });
      const parsed = await parseJsonResponse<{ success: boolean; user?: UserProfile; error?: string }>(res, { success: false });
      return parsed;
    } catch (err: any) {
      console.error('[API] updateUserProfile error:', err);
      return { success: false, error: err?.message || 'Network error updating profile.' };
    }
  },

  async submitKyc(data: {
    userId: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    country: string;
    phone?: string;
    email?: string;
    dateOfBirth?: string;
    documentType: string;
    documentNumber: string;
    documentImage?: string;
    documentBackImage?: string;
    liveSelfieImage?: string;
    streetAddress?: string;
    proofOfAddressType?: string;
    proofOfAddress?: string;
    proofOfAddressImage?: string;
    ssn?: string;
    ssnImage?: string;
    isResubmission?: boolean;
    autoApprove?: boolean;
    reviewDurationMinutes?: number;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    let serverUser: UserProfile | undefined;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ ...data, autoApprove: false }),
      });
      const parsed = await parseJsonResponse<{ success: boolean; user?: UserProfile; error?: string }>(res, { success: false });
      if (parsed.success && parsed.user) {
        serverUser = parsed.user;
        
        // Update local accounts directory for responsive feedback
        if (typeof window !== 'undefined') {
          try {
            const dirRaw = localStorage.getItem('monvera_accounts_directory');
            const dirList: UserProfile[] = dirRaw ? JSON.parse(dirRaw) : [];
            const idx = dirList.findIndex((u) => u.id === data.userId);
            if (idx >= 0) {
              dirList[idx] = { ...dirList[idx], ...serverUser };
            } else {
              dirList.push(serverUser);
            }
            localStorage.setItem('monvera_accounts_directory', JSON.stringify(dirList));
            localStorage.setItem('monvera_kyc_sync_event', JSON.stringify({ userId: data.userId, kycStatus: 'pending', timestamp: Date.now() }));
            window.dispatchEvent(new CustomEvent('monvera_kyc_status_updated', {
              detail: { userId: data.userId, kycStatus: 'pending', user: serverUser }
            }));
          } catch {}
        }

        return {
          success: true,
          user: serverUser,
        };
      } else if (parsed.error) {
        return { success: false, error: parsed.error };
      }
    } catch (fetchErr: any) {
      console.error('[API] /api/kyc/submit error:', fetchErr);
      return {
        success: false,
        error: fetchErr?.message || 'Unable to submit verification documents to compliance desk. Please check your network.',
      };
    }

    return {
      success: false,
      error: 'KYC submission could not be processed. Please try again.',
    };
  },


  async approveKyc(data: {
    userId: string;
    adminId?: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      const res = await fetch('/api/kyc/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const parsed = await parseJsonResponse<{ success: boolean; user?: UserProfile; error?: string }>(res, { success: false });
      if (parsed.success) return parsed;
    } catch {
      // Fallback
    }

    try {
      const updatedUser: Partial<UserProfile> = {
        id: data.userId,
        kycStatus: 'verified',
        kycVerifiedAt: new Date().toISOString(),
        dailyTransactionLimit: 1000000,
      };
      await firestoreSync.saveUserProfile(data.userId, updatedUser);
      return { success: true, user: updatedUser as UserProfile };
    } catch (err: any) {
      return { success: false, error: err?.message || 'KYC approval failed' };
    }
  },

  async getBalanceMetrics(userId: string, userAccountNumber?: string): Promise<BalanceMetrics | null> {
    // 1. Check permanent Firestore record / immutable ledger first for highest durability
    try {
      const firestoreMetrics = await firestoreSync.getAccountBalances(userId, userAccountNumber);
      if (firestoreMetrics && firestoreMetrics.accounts && firestoreMetrics.accounts.length > 0) {
        return firestoreMetrics;
      }
    } catch {
      // Continue to API check
    }

    // 2. Fetch from backend API
    try {
      const res = await fetch(`/api/accounts/balance?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await parseJsonResponse<BalanceMetrics>(res, null as any);
        if (data && (typeof data.checkingBalance === 'number' || typeof data.totalBalance === 'number')) {
          if (!Array.isArray(data.accounts) || data.accounts.length === 0) {
            data.accounts = [
              {
                id: `acc_chk_${userId}`,
                userId,
                type: 'CHECKING',
                accountNumber: userAccountNumber || '1000000000',
                routingNumber: '021000021',
                currency: 'USD',
                balance: Number(data.checkingBalance ?? 0),
                availableBalance: Number(data.availableBalance ?? data.checkingBalance ?? 0),
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
                accountNumber: userAccountNumber && userAccountNumber.length >= 7 ? `10${userAccountNumber.slice(2, -3)}991` : '1000000991',
                routingNumber: '021000021',
                currency: 'USD',
                balance: Number(data.savingsBalance ?? 0),
                availableBalance: Number(data.savingsBalance ?? 0),
                investedBalance: 0,
                pendingBalance: 0,
                interestRateAPY: 4.85,
                status: 'ACTIVE',
                nickname: 'Monvera High-Yield Treasury',
              },
            ];
          }
          return data;
        }
      }
    } catch {
      // Backend unavailable
    }

    // 3. DO NOT fabricate 0 balance metrics when upstream is rate-limited or temporarily unavailable.
    // Return null to allow caller to preserve the last known authoritative balance.
    return null;
  },

  async lookupRecipient(
    identifier: string,
    currentUserId: string,
    hint?: { name?: string; username?: string; accountNumber?: string }
  ): Promise<RecipientLookupResult> {
    const rawInput = identifier.trim();
    if (!rawInput && !hint?.accountNumber && !hint?.username) {
      return { valid: false, error: 'Account number or username is required' };
    }

    const cleanInput = (rawInput || hint?.username || hint?.accountNumber || '').replace(/^@/, '').replace(/[-\s]/g, '').toLowerCase();

    // 0. If verified QR code hint payload was provided, resolve immediately
    if (hint && (hint.accountNumber || hint.username || hint.name)) {
      const accNum = (hint.accountNumber || '1088492015').replace(/[-\s]/g, '');
      const rawUser = (hint.username || cleanInput).replace(/^@/, '');
      const nameParts = (hint.name || 'Monvera Customer').split(' ');
      const fName = nameParts[0] || 'Monvera';
      const lName = nameParts.slice(1).join(' ') || 'Customer';

      return {
        valid: true,
        recipientId: `usr_${rawUser.toLowerCase()}`,
        firstName: fName,
        lastName: lName,
        username: rawUser,
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        permanentAccountNumber: accNum,
        maskedAccountNumber: `•••• ${accNum.slice(-4)}`,
        membershipTier: 'Premier',
        verified: true,
      };
    }

    // 1. Authoritative Backend Server API Resolution (checks canonical Firebase UIDs, accounts, emails, usernames)
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `/api/accounts/lookup?query=${encodeURIComponent(identifier)}&currentUserId=${encodeURIComponent(currentUserId || '')}`,
        { headers: authHeaders }
      );
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          if (data.valid === true) {
            return data as RecipientLookupResult;
          } else if (data.isAmbiguous) {
            return { valid: false, error: data.error || 'Multiple accounts found matching identifier.' };
          } else if (data.error) {
            return { valid: false, error: data.error };
          }
        }
      }
    } catch {
      console.warn('[API] Express backend lookup unreachable, falling back to direct Firestore query...');
    }

    // 2. Direct Cloud Directory Query (Fastest, case-insensitive, multi-field via Firestore)
    try {
      const fsUser = await firestoreSync.findRecipient(identifier);
      if (fsUser) {
        const canonicalId = fsUser.id || (fsUser as any).uid;
        if (currentUserId && canonicalId === currentUserId) {
          return { valid: false, error: 'You cannot send an external transfer to yourself.' };
        }
        const accNum = fsUser.permanentAccountNumber || (fsUser as any).accountNumber || '1088492015';
        return {
          valid: true,
          recipientId: canonicalId,
          firstName: fsUser.firstName || 'Monvera',
          lastName: fsUser.lastName || 'Customer',
          username: fsUser.username || cleanInput,
          avatarUrl: fsUser.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          permanentAccountNumber: accNum,
          maskedAccountNumber: `•••• ${accNum.slice(-4)}`,
          membershipTier: fsUser.membershipTier || 'Premier',
          verified: true,
        };
      }
    } catch (fsErr) {
      console.warn('[API] Cloud recipient lookup note:', fsErr);
    }

    return {
      valid: false,
      error: `No Monvera account found with username, email, or account number "${identifier}".`,
    };
  },

  async sendMonveraTransfer(data: {
    senderUserId: string;
    recipientUserId?: string;
    recipientName?: string;
    recipientAccountNumber?: string;
    recipientUsername?: string;
    recipientIdentifier?: string;
    amount: number;
    description?: string;
    category?: Transaction['category'];
    referenceNumber?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const transferAmount = Number(data.amount);
    if (!transferAmount || isNaN(transferAmount) || transferAmount <= 0) {
      return { success: false, error: 'Transfer amount must be greater than $0.00.' };
    }
    const effectiveSenderUid = (auth?.currentUser?.uid || data.senderUserId);
    if (!effectiveSenderUid) {
      return { success: false, error: 'Sender user ID is required.' };
    }

    const targetIdentifier = (data.recipientIdentifier || data.recipientAccountNumber || data.recipientUsername || data.recipientUserId || '').trim();
    if (!targetIdentifier && !data.recipientUserId) {
      return { success: false, error: 'Recipient account number or identifier is required.' };
    }

    const refNum = data.referenceNumber || data.idempotencyKey || `MV-TRF-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const authHeaders = await getAuthHeaders();

    try {
      const response = await fetch('/api/transfers/monvera', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          senderUserId: effectiveSenderUid,
          recipientUserId: data.recipientUserId,
          recipientAccountNumber: data.recipientAccountNumber,
          recipientUsername: data.recipientUsername,
          recipientIdentifier: targetIdentifier,
          amount: transferAmount,
          description: data.description,
          category: data.category,
          referenceNumber: refNum,
          idempotencyKey: refNum,
        }),
      });

      const parsed = await parseJsonResponse<{
        success: boolean;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        recipientBalanceMetrics?: BalanceMetrics;
        error?: string;
      }>(response, { success: false, error: 'Transfer failed' });

      if (!parsed.success || !parsed.transaction || !parsed.balanceMetrics) {
        return {
          success: false,
          error: parsed.error || 'Transfer failed. Neither account balance was modified.',
        };
      }

      const updatedSenderMetrics = parsed.balanceMetrics;
      const finalTx = parsed.transaction;

      // Post-transaction non-blocking alerts & local state dispatch
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`monvera_balances_${effectiveSenderUid}`, JSON.stringify(updatedSenderMetrics));
          localStorage.setItem('monvera_account_balances', JSON.stringify(updatedSenderMetrics));
          window.dispatchEvent(
            new CustomEvent('monvera_balance_updated', {
              detail: { userId: effectiveSenderUid, balanceMetrics: updatedSenderMetrics },
            })
          );
          window.dispatchEvent(
            new CustomEvent('monvera_transaction_created', {
              detail: { userId: effectiveSenderUid, transaction: finalTx },
            })
          );
        } catch {}
      }

      return {
        success: true,
        transaction: finalTx,
        balanceMetrics: updatedSenderMetrics,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Network error communicating with transfer service.',
      };
    }
  },

  async sendInternalTransfer(data: {
    userId: string;
    fromAccountType: 'CHECKING' | 'SAVINGS';
    toAccountType: 'CHECKING' | 'SAVINGS';
    amount: number;
    description?: string;
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    try {
      const res = await fetch('/api/transfers/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return await parseJsonResponse(res, { success: false, error: 'Internal transfer service unavailable' });
    } catch {
      return { success: false, error: 'Internal transfer request failed' };
    }
  },

  async createDeposit(data: {
    userId: string;
    amount: number;
    method: 'CARD' | 'ACH' | 'WIRE' | 'INSTANT_PAY' | 'CRYPTO_WALLET';
    destinationAccountType?: 'CHECKING' | 'SAVINGS';
    providerPaymentId?: string;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const depositAmount = Number(data.amount);

    if (isNaN(depositAmount) || depositAmount <= 0) {
      return { success: false, error: 'Invalid deposit amount.' };
    }

    const authHeaders = await getAuthHeaders();

    try {
      const res = await fetch('/api/deposits/create', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(data),
      });

      const parsed = await parseJsonResponse<{
        success: boolean;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        error?: string;
      }>(res, { success: false, error: 'Deposit service unavailable' });

      if (!parsed.success || !parsed.transaction || !parsed.balanceMetrics) {
        return {
          success: false,
          error: parsed.error || 'Failed to record deposit in authoritative ledger. Please try again.',
        };
      }

      const finalTx = parsed.transaction;
      const updatedMetrics = parsed.balanceMetrics;

      // Update local storage cache and dispatch UI events
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`monvera_balances_${data.userId}`, JSON.stringify(updatedMetrics));
          localStorage.setItem('monvera_account_balances', JSON.stringify(updatedMetrics));
          window.dispatchEvent(
            new CustomEvent('monvera_balance_updated', {
              detail: { userId: data.userId, balanceMetrics: updatedMetrics },
            })
          );
          window.dispatchEvent(
            new CustomEvent('monvera_transaction_created', {
              detail: { userId: data.userId, transaction: finalTx },
            })
          );
        } catch {}
      }

      return {
        success: true,
        transaction: finalTx,
        balanceMetrics: updatedMetrics,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Network error while processing deposit.',
      };
    }
  },

  async createWithdrawal(data: {
    userId: string;
    amount: number;
    destinationType: 'ACH_BANK' | 'CARD' | 'CRYPTO';
    destinationLabel: string;
    accountOrIban: string;
    sourceAccountType?: 'CHECKING' | 'SAVINGS';
    routingNumber?: string;
    cardBrand?: 'VISA' | 'MASTERCARD';
    cryptoAsset?: 'USDT' | 'BNB';
    cryptoNetwork?: string;
    userAccountNumber?: string;
    fallbackBalances?: BalanceMetrics;
    fallbackUser?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      permanentAccountNumber?: string;
    };
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const withdrawAmount = Number(data.amount);
    const sourceType = data.sourceAccountType || 'CHECKING';

    if (!data.userId || withdrawAmount <= 0) {
      return { success: false, error: 'Please enter a valid positive withdrawal amount.' };
    }

    // Call authoritative server-side withdrawal endpoint with verified Firebase Auth ID token
    const authHeaders = await getAuthHeaders();

    const response = await fetch('/api/withdrawals/create', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        amount: withdrawAmount,
        destinationType: data.destinationType,
        destinationLabel: data.destinationLabel,
        accountOrIban: data.accountOrIban,
        sourceAccountType: sourceType,
        routingNumber: data.routingNumber,
        cardBrand: data.cardBrand,
      }),
    });

    const parsed = await parseJsonResponse<{
      success: boolean;
      transaction?: Transaction;
      balanceMetrics?: BalanceMetrics;
      error?: string;
    }>(response, { success: false, error: 'Withdrawal authorization failed' });

    if (!parsed.success || !parsed.transaction || !parsed.balanceMetrics) {
      return {
        success: false,
        error: parsed.error || 'Failed to authorize withdrawal.',
      };
    }

    const finalMetrics = parsed.balanceMetrics;
    const finalTx = parsed.transaction;

    // Update local storage and dispatch events
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`monvera_balances_${data.userId}`, JSON.stringify(finalMetrics));
        localStorage.setItem('monvera_account_balances', JSON.stringify(finalMetrics));

        window.dispatchEvent(
          new CustomEvent('monvera_balance_updated', {
            detail: { userId: data.userId, balanceMetrics: finalMetrics },
          })
        );
        window.dispatchEvent(
          new CustomEvent('monvera_transaction_created', {
            detail: { userId: data.userId, transaction: finalTx },
          })
        );
      } catch {}
    }

    return {
      success: true,
      transaction: finalTx,
      balanceMetrics: finalMetrics,
    };
  },

  async reversePendingWithdrawal(
    transactionId: string,
    userId: string
  ): Promise<{ success: boolean; balanceMetrics?: BalanceMetrics }> {
    try {
      await fetch('/api/withdrawals/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, userId }),
      });
    } catch {}

    // Execute reverse in firestoreSync
    await firestoreSync.reversePendingWithdrawal(transactionId, userId);
    const restoredMetrics = await this.getBalanceMetrics(userId);

    return { success: true, balanceMetrics: restoredMetrics };
  },

  /**
   * Scans and executes automatic reversals for pending withdrawals older than 30 minutes.
   */
  async checkAndExecutePendingWithdrawalReversals(userId?: string): Promise<number> {
    if (!userId) return 0;
    try {
      return await firestoreSync.checkAndExecutePendingWithdrawalReversals(userId);
    } catch (e) {
      console.error('[API] checkAndExecutePendingWithdrawalReversals error:', e);
      return 0;
    }
  },

  async createStripeCheckoutSession(params: {
    userId: string;
    amount: number;
    destinationAccountType?: 'CHECKING' | 'SAVINGS';
  }): Promise<{ success: boolean; url?: string; sessionId?: string; configured?: boolean; error?: string }> {
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          origin: typeof window !== 'undefined' ? window.location.origin : '',
        }),
      });
      return await parseJsonResponse(res, { success: false, error: 'Payment gateway temporarily offline' });
    } catch (err: any) {
      return { success: false, error: 'Failed to communicate with Stripe checkout service.' };
    }
  },

  async confirmStripeSession(
    sessionId: string
  ): Promise<{
    success: boolean;
    transaction?: Transaction;
    balanceMetrics?: BalanceMetrics;
    status?: string;
    isDuplicate?: boolean;
    error?: string;
  }> {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/stripe/confirm-session?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: authHeaders,
      });
      const parsed = await parseJsonResponse<{
        success: boolean;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        status?: string;
        isDuplicate?: boolean;
        error?: string;
      }>(res, { success: false, error: 'Stripe confirmation service unavailable' });

      if (parsed.success && parsed.transaction && typeof window !== 'undefined') {
        try {
          if (parsed.balanceMetrics) {
            localStorage.setItem(`monvera_balances_${parsed.transaction.userId}`, JSON.stringify(parsed.balanceMetrics));
            localStorage.setItem('monvera_account_balances', JSON.stringify(parsed.balanceMetrics));
            window.dispatchEvent(
              new CustomEvent('monvera_balance_updated', {
                detail: { userId: parsed.transaction.userId, balanceMetrics: parsed.balanceMetrics },
              })
            );
          }
          window.dispatchEvent(
            new CustomEvent('monvera_transaction_created', {
              detail: { userId: parsed.transaction.userId, transaction: parsed.transaction },
            })
          );
        } catch {}
      }

      return parsed;
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error confirming Stripe session.' };
    }
  },

  async getTransactions(params?: {
    userId?: string;
    category?: string;
    search?: string;
    type?: string;
    flow?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ transactions: Transaction[] }> {
    let apiTxs: Transaction[] = [];
    let backendSuccess = false;

    try {
      const query = new URLSearchParams();
      if (params?.userId) query.append('userId', params.userId);
      if (params?.category) query.append('category', params.category);
      if (params?.search) query.append('search', params.search);
      if (params?.type) query.append('type', params.type);
      if (params?.flow) query.append('flow', params.flow);
      if (params?.startDate) query.append('startDate', params.startDate);
      if (params?.endDate) query.append('endDate', params.endDate);

      const headers = await getAuthHeaders();
      const res = await fetch(`/api/transactions?${query.toString()}`, { headers });
      if (res.ok) {
        const data = await parseJsonResponse<{ transactions: Transaction[] }>(res, { transactions: [] });
        if (data && Array.isArray(data.transactions)) {
          apiTxs = data.transactions;
          backendSuccess = true;
        }
      }
    } catch {
      // Backend unavailable
    }

    // Authoritative return from server API without redundant client Firestore query
    if (backendSuccess) {
      return { transactions: apiTxs };
    }

    // Resilient fallback to Firestore only if backend network request genuinely failed
    if (params?.userId) {
      try {
        const firestoreTxs = await firestoreSync.getTransactionsForUser(params.userId);
        return { transactions: firestoreTxs };
      } catch {
        // Firestore query notice
      }
    } else {
      try {
        const firestoreTxs = await firestoreSync.getAllTransactions();
        return { transactions: firestoreTxs };
      } catch {
        // Firestore query notice
      }
    }

    return { transactions: apiTxs };
  },

  async getInvestments(userId: string): Promise<{
    investments: InvestmentPlan[];
    earnings: InvestmentEarningLog[];
    supportedTerms: InvestmentTermDays[];
  }> {
    const supportedTerms: InvestmentTermDays[] = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
    if (!userId) {
      return { investments: [], earnings: [], supportedTerms };
    }

    // 1. Authoritative Firestore investments query
    const fsInvestments = await firestoreSync.getUserInvestments(userId);

    // 2. Fetch backend earnings and server investments if available
    try {
      const res = await fetch(`/api/investments?userId=${encodeURIComponent(userId)}`);
      const backendData = await parseJsonResponse(res, {
        investments: [],
        earnings: [],
        supportedTerms,
      });

      // Merge investments with Firestore taking authoritative precedence
      const invMap = new Map<string, InvestmentPlan>();
      (backendData.investments || []).forEach((inv: InvestmentPlan) => {
        if (inv && inv.id) invMap.set(inv.id, inv);
      });
      fsInvestments.forEach((inv) => {
        if (inv && inv.id) invMap.set(inv.id, inv);
      });

      const mergedList = Array.from(invMap.values()).sort(
        (a, b) => new Date(b.createdAt || b.startDate).getTime() - new Date(a.createdAt || a.startDate).getTime()
      );

      return {
        investments: mergedList,
        earnings: backendData.earnings || [],
        supportedTerms,
      };
    } catch {
      return {
        investments: fsInvestments,
        earnings: [],
        supportedTerms,
      };
    }
  },

  async createInvestment(data: {
    userId: string;
    termDays: InvestmentTermDays;
    amount: number;
    clientRequestId?: string;
    userAccountNumber?: string;
    fallbackBalances?: BalanceMetrics;
    fallbackUser?: any;
  }): Promise<{ success: boolean; investment?: InvestmentPlan; balanceMetrics?: BalanceMetrics; error?: string }> {
    // 1. Client-side sanity checks
    if (!data.userId) {
      return { success: false, error: 'Customer ID is required.' };
    }
    if (!data.amount || data.amount < 100) {
      return { success: false, error: 'Minimum term investment amount is $100.00.' };
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/investments/create', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });

      const result = await parseJsonResponse<{
        success: boolean;
        investment?: InvestmentPlan;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        error?: string;
      }>(res, {
        success: false,
        error: 'Investment service unavailable',
      });

      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Investment creation rejected (${res.status})`,
        };
      }

      if (typeof window !== 'undefined' && result.investment) {
        try {
          if (result.balanceMetrics) {
            window.dispatchEvent(
              new CustomEvent('monvera_balance_updated', {
                detail: {
                  userId: data.userId,
                  balanceMetrics: result.balanceMetrics,
                },
              })
            );
          }
          window.dispatchEvent(
            new CustomEvent('monvera_investment_updated', {
              detail: { investment: result.investment },
            })
          );
        } catch {}
      }

      return {
        success: true,
        investment: result.investment,
        balanceMetrics: result.balanceMetrics,
      };
    } catch (err: any) {
      console.error('[createInvestment] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error communicating with investment service.',
      };
    }
  },

  async matureInvestment(
    id: string,
    userId?: string
  ): Promise<{
    success: boolean;
    investment?: InvestmentPlan;
    payoutAmount?: number;
    balanceMetrics?: BalanceMetrics;
    error?: string;
  }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/investments/${encodeURIComponent(id)}/mature`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId }),
      });

      const result = await parseJsonResponse<{
        success: boolean;
        investment?: InvestmentPlan;
        payoutAmount?: number;
        balanceMetrics?: BalanceMetrics;
        error?: string;
      }>(res, {
        success: false,
        error: 'Investment settlement service unavailable',
      });

      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Investment settlement rejected (${res.status})`,
        };
      }

      if (typeof window !== 'undefined' && result.investment) {
        try {
          if (result.balanceMetrics) {
            window.dispatchEvent(
              new CustomEvent('monvera_balance_updated', {
                detail: {
                  userId: userId || result.investment.userId,
                  balanceMetrics: result.balanceMetrics,
                },
              })
            );
          }
          window.dispatchEvent(
            new CustomEvent('monvera_investment_updated', {
              detail: { investment: result.investment },
            })
          );
        } catch {}
      }

      return {
        success: true,
        investment: result.investment,
        payoutAmount: result.payoutAmount,
        balanceMetrics: result.balanceMetrics,
      };
    } catch (err: any) {
      console.error('[matureInvestment] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error communicating with investment settlement service.',
      };
    }
  },

  async getCards(userId: string): Promise<{ cards: CardItem[] }> {
    if (!userId) return { cards: [] };

    // 1. Authoritative Firestore Cards
    const fsCards = await firestoreSync.getUserCards(userId).catch(() => []);

    // 2. Fetch server cards if available and merge
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/cards?userId=${encodeURIComponent(userId)}`, {
        headers: authHeaders,
      });
      const data = await parseJsonResponse<{ cards: CardItem[] }>(res, { cards: [] });
      const map = new Map<string, CardItem>();
      (data.cards || []).forEach((c: CardItem) => {
        if (c && c.id) map.set(c.id, c);
      });
      fsCards.forEach((c) => {
        if (c && c.id) map.set(c.id, c);
      });
      return { cards: Array.from(map.values()) };
    } catch {
      return { cards: fsCards };
    }
  },

  async createCard(data: {
    userId: string;
    cardHolderName?: string;
    phone?: string;
    cardType?: 'PHYSICAL' | 'VIRTUAL';
    cardTier?: string;
    brand?: 'VISA' | 'MASTERCARD';
    spendingLimitMonthly?: number;
    spendingLimitDaily?: number;
    colorScheme?: string;
    userAccountNumber?: string;
    clientRequestId?: string;
    fallbackBalances?: BalanceMetrics;
    fallbackUser?: any;
  }): Promise<{
    success: boolean;
    card?: CardItem;
    transaction?: Transaction;
    balanceMetrics?: BalanceMetrics;
    isDuplicate?: boolean;
    error?: string;
  }> {
    if (!data.userId) {
      return { success: false, error: 'User ID is required.' };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/cards/create', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(data),
      });

      const result = await parseJsonResponse<{
        success: boolean;
        card?: CardItem;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        isDuplicate?: boolean;
        error?: string;
      }>(res, { success: false, error: 'Card issuing service unavailable' });

      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Card issuance failed (${res.status})`,
        };
      }

      if (result.success && result.card) {
        if (typeof window !== 'undefined') {
          try {
            if (result.balanceMetrics) {
              window.dispatchEvent(
                new CustomEvent('monvera_balance_updated', {
                  detail: { balanceMetrics: result.balanceMetrics, userId: data.userId },
                })
              );
            }
            window.dispatchEvent(
              new CustomEvent('monvera_card_created', {
                detail: { card: result.card, userId: data.userId },
              })
            );
            const syncChannel = new BroadcastChannel('monvera_sync_channel');
            syncChannel.postMessage({
              balanceMetrics: result.balanceMetrics,
              transaction: result.transaction,
              card: result.card,
              userId: data.userId,
            });
            syncChannel.close();
          } catch {}
        }
        return result;
      }

      return { success: false, error: result.error || 'Failed to issue card.' };
    } catch (err: any) {
      console.error('[createCard] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error communicating with card issuance service.',
      };
    }
  },

  async toggleCardFreeze(id: string, userId?: string): Promise<{ success: boolean; card?: CardItem; error?: string }> {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/cards/${encodeURIComponent(id)}/toggle-freeze`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await parseJsonResponse<{ success: boolean; card?: CardItem; error?: string }>(res, {
        success: false,
        error: 'Card service unavailable',
      });
      if (data?.success && data?.card) {
        return data;
      }
    } catch {}

    return await firestoreSync.toggleCardFreezeDirect(id, userId);
  },

  async updateCardLimits(
    id: string,
    limits: {
      dailyLimit?: number;
      monthlyLimit?: number;
      international?: boolean;
      online?: boolean;
      atm?: boolean;
    },
    userId?: string
  ): Promise<{ success: boolean; card?: CardItem; error?: string }> {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/cards/${encodeURIComponent(id)}/update-limits`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(limits),
      });
      const data = await parseJsonResponse<{ success: boolean; card?: CardItem; error?: string }>(res, {
        success: false,
        error: 'Card update service unavailable',
      });
      if (data?.success && data?.card) {
        return data;
      }
    } catch {}

    return await firestoreSync.updateCardLimitsDirect(id, limits, userId);
  },

  async getNotifications(
    userId?: string,
    userAccountNumber?: string,
    userEmail?: string
  ): Promise<{ notifications: NotificationItem[] }> {
    const notifMap = new Map<string, NotificationItem>();

    // 0. Fetch immediately from local storage cache for zero latency
    if (userId && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(`monvera_notifications_${userId}`);
        if (raw) {
          const list: NotificationItem[] = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach((n) => {
              if (n && n.id) notifMap.set(n.id, n);
            });
          }
        }
      } catch {}
    }

    // 1. Fetch from backend Express API
    let fetchedFromBackend = false;
    try {
      const queryParams = new URLSearchParams();
      if (userId) queryParams.set('userId', userId);
      if (userAccountNumber) queryParams.set('accountNumber', userAccountNumber);
      if (userEmail) queryParams.set('email', userEmail);
      const url = `/api/notifications${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await parseJsonResponse<{ notifications: NotificationItem[] }>(res, { notifications: [] });
        if (data && Array.isArray(data.notifications)) {
          data.notifications.forEach((n) => notifMap.set(n.id, n));
          fetchedFromBackend = true;
        }
      }
    } catch {}

    // 2. Fallback to direct client Firestore notifications ONLY if backend request failed
    if (!fetchedFromBackend && userId) {
      try {
        const fsNotifs = await firestoreSync.getNotificationsForUser(userId, userAccountNumber, userEmail);
        fsNotifs.forEach((n) => notifMap.set(n.id, n));
      } catch {}
    }

    const sorted = Array.from(notifMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return { notifications: sorted };
  },

  async markNotificationsRead(userId: string): Promise<{ success: boolean }> {
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      return await parseJsonResponse(res, { success: true });
    } catch {
      return { success: true };
    }
  },

  async markSingleNotificationRead(notificationId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId, userId }),
      });
      return await parseJsonResponse(res, { success: true });
    } catch {
      return { success: true };
    }
  },

  async replyToSupportMessage(data: {
    notificationId: string;
    userId: string;
    message: string;
  }): Promise<{ success: boolean; notification?: NotificationItem; error?: string }> {
    try {
      const res = await fetch('/api/support/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return await parseJsonResponse(res, { success: false, error: 'Support message service unavailable' });
    } catch {
      return { success: false, error: 'Failed to send support message' };
    }
  },

  async replyToSupport(
    ticketId: string,
    message: string,
    adminId?: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.replyToSupportMessage({
      notificationId: ticketId,
      userId: adminId || 'usr_admin',
      message,
    });
  },

  async getSessions(userId: string): Promise<{ sessions: SessionInfo[] }> {
    try {
      const res = await fetch(`/api/security/sessions?userId=${encodeURIComponent(userId)}`);
      return await parseJsonResponse(res, { sessions: [] });
    } catch {
      return { sessions: [] };
    }
  },

  async terminateSession(id: string, userId: string): Promise<{ success: boolean; sessions: SessionInfo[] }> {
    try {
      const res = await fetch(`/api/security/sessions/${encodeURIComponent(id)}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      return await parseJsonResponse(res, { success: false, sessions: [] });
    } catch {
      return { success: false, sessions: [] };
    }
  },

  // Admin Endpoints
  async adminLogin(email: string, password: string): Promise<{
    success: boolean;
    isAdminAttempt?: boolean;
    customToken?: string;
    adminSessionToken?: string;
    errorCode?: string;
    error?: string;
  }> {
    try {
      const res = await fetch(getApiEndpoint('/api/admin/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await parseJsonResponse<any>(res, { success: false });
      if (data.success && data.adminSessionToken) {
        setAdminSessionToken(data.adminSessionToken);
      }
      return {
        success: !!data.success,
        isAdminAttempt: data.isAdminAttempt !== undefined ? !!data.isAdminAttempt : (res.status === 401 || !!data.success),
        customToken: data.customToken,
        adminSessionToken: data.adminSessionToken,
        errorCode: data.errorCode || (res.status === 401 ? 'INVALID_CREDENTIALS' : res.status === 403 ? 'EMAIL_NOT_ADMIN' : res.status === 503 ? 'CONFIG_UNAVAILABLE' : res.status >= 500 ? 'SERVER_ERROR' : undefined),
        error: data.error,
      };
    } catch (err: any) {
      console.warn('[api.adminLogin] Network or server error:', err);
      return {
        success: false,
        isAdminAttempt: true,
        errorCode: 'NETWORK_FAILURE',
        error: 'Failed to communicate with authentication service. Please verify server connectivity.',
      };
    }
  },

  async verifyAdminSession(): Promise<{ isAdmin: boolean; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      if (!headers['Authorization']) {
        return { isAdmin: false, error: 'No authentication token available' };
      }
      const res = await fetch(getApiEndpoint('/api/admin/verify-session'), { headers });
      if (res.ok) {
        const data = await parseJsonResponse<{ success: boolean; isAdmin?: boolean }>(res, { success: false, isAdmin: false });
        return { isAdmin: !!data.isAdmin };
      }
      return { isAdmin: false };
    } catch {
      return { isAdmin: false };
    }
  },

  async getAdminOverview(): Promise<AdminSystemOverview> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/overview', { headers });
      return await parseJsonResponse(res, {
        totalCustomers: 4,
        activeAccounts: 12,
        totalPlatformDeposits: 0,
        totalPlatformWithdrawals: 0,
        totalPlatformTransfers: 0,
        totalPlatformInvestments: 0,
        pendingTransactionsCount: 0,
        failedTransactionsCount: 0,
        devFundingPoolBalance: 1000000000,
        systemReserveRatio: 100,
        activeNodesCount: 8,
      });
    } catch {
      return {
        totalCustomers: 4,
        activeAccounts: 12,
        totalPlatformDeposits: 0,
        totalPlatformWithdrawals: 0,
        totalPlatformTransfers: 0,
        totalPlatformInvestments: 0,
        pendingTransactionsCount: 0,
        failedTransactionsCount: 0,
        devFundingPoolBalance: 1000000000,
        systemReserveRatio: 100,
        activeNodesCount: 8,
      };
    }
  },

  async getAdminCustomers(): Promise<{ customers: (UserProfile & { balanceMetrics: BalanceMetrics })[] }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/customers', { headers });
      return await parseJsonResponse(res, { customers: [] });
    } catch {
      return { customers: [] };
    }
  },

  async toggleCustomerStatus(id: string, data: { adminId?: string; reason?: string; targetStatus?: 'active' | 'frozen' }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      const headers = await getAuthHeaders();

      // Call authoritative server endpoint to verify admin credentials, resolve canonical UID, and persist to Firestore
      const res = await fetch(`/api/admin/customers/${encodeURIComponent(id)}/toggle-status`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });

      const parsed = await parseJsonResponse<any>(res, { success: false });
      if (!res.ok || !parsed?.success) {
        return { success: false, error: parsed?.error || 'Failed to toggle customer status.' };
      }

      const canonicalUid = parsed.canonicalUid || id;
      const effectiveStatus: 'active' | 'frozen' = parsed.status || (parsed.user?.status as any) || 'frozen';

      // Update local mirrors and dispatch event for immediate UI reflection
      await firestoreSync.updateUserStatus(canonicalUid, effectiveStatus);
      if (id !== canonicalUid) {
        await firestoreSync.updateUserStatus(id, effectiveStatus);
      }

      return {
        success: true,
        user: parsed.user || ({ id: canonicalUid, status: effectiveStatus } as UserProfile),
      };
    } catch (err: any) {
      console.error('[api.toggleCustomerStatus] Error:', err);
      return { success: false, error: err?.message || 'Network error toggling customer status.' };
    }
  },

  async unfreezeUserAccount(userId: string, data: { pinOrPassword?: string; reason?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/user/unfreeze`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId, ...data }),
      });
      const parsed = await parseJsonResponse<any>(res, { success: false });
      if (!res.ok || !parsed?.success) {
        return { success: false, error: parsed?.error || 'Failed to unfreeze account.' };
      }

      const canonicalUid = parsed.canonicalUid || userId;
      await firestoreSync.updateUserStatus(canonicalUid, 'active');
      if (userId !== canonicalUid) {
        await firestoreSync.updateUserStatus(userId, 'active');
      }

      return { success: true };
    } catch {
      return { success: false, error: 'Failed to unfreeze account.' };
    }
  },

  async adminApproveKyc(
    dataOrUserId: string | { userId: string; adminId?: string; userProfile?: UserProfile },
    adminId?: string,
    passedProfile?: UserProfile
  ): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    const userId = typeof dataOrUserId === 'string' ? dataOrUserId : dataOrUserId.userId;
    const effectiveAdminId = (typeof dataOrUserId === 'string' ? adminId : dataOrUserId.adminId) || adminId || 'usr_admin';
    const providedUser = (typeof dataOrUserId === 'object' && dataOrUserId.userProfile) ? dataOrUserId.userProfile : passedProfile;

    if (!userId) {
      return { success: false, error: 'User ID is required for KYC approval.' };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/kyc/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ userId, adminId: effectiveAdminId, userProfile: providedUser }),
      });
      const parsed = await parseJsonResponse<{ success: boolean; user?: UserProfile; error?: string }>(res, { success: false });

      if (parsed.success && parsed.user) {
        const verifiedUser = parsed.user;
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem('monvera_accounts_directory');
            const directory: any[] = raw ? JSON.parse(raw) : [];
            const idx = directory.findIndex((u: any) => u.id === userId);
            if (idx >= 0) {
              directory[idx] = { ...directory[idx], ...verifiedUser };
            } else {
              directory.push(verifiedUser);
            }
            localStorage.setItem('monvera_accounts_directory', JSON.stringify(directory));
            localStorage.setItem('monvera_kyc_sync_event', JSON.stringify({ userId, kycStatus: 'verified', timestamp: Date.now() }));
            window.dispatchEvent(new CustomEvent('monvera_kyc_status_updated', {
              detail: { userId, kycStatus: 'verified', user: verifiedUser }
            }));
          } catch {}
        }
        return { success: true, user: verifiedUser };
      } else {
        return { success: false, error: parsed.error || 'KYC approval was rejected by server compliance.' };
      }
    } catch (err: any) {
      console.error('[adminApproveKyc] Error:', err);
      return { success: false, error: err?.message || 'Network error approving KYC.' };
    }
  },

  async adminRejectKyc(
    dataOrUserId: string | { userId: string; reason: string; adminId?: string; userProfile?: UserProfile },
    reason?: string,
    adminId?: string,
    passedProfile?: UserProfile
  ): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    const userId = typeof dataOrUserId === 'string' ? dataOrUserId : dataOrUserId.userId;
    const rejectionReason = (typeof dataOrUserId === 'string' ? reason : dataOrUserId.reason) || reason || 'Compliance review failed';
    const effectiveAdminId = (typeof dataOrUserId === 'string' ? adminId : dataOrUserId.adminId) || adminId || 'usr_admin';
    const providedUser = (typeof dataOrUserId === 'object' && dataOrUserId.userProfile) ? dataOrUserId.userProfile : passedProfile;

    if (!userId) {
      return { success: false, error: 'User ID is required for KYC rejection.' };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/kyc/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ userId, reason: rejectionReason, adminId: effectiveAdminId, userProfile: providedUser }),
      });
      const parsed = await parseJsonResponse<{ success: boolean; user?: UserProfile; error?: string }>(res, { success: false });

      if (parsed.success && parsed.user) {
        const rejectedUser = parsed.user;
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem('monvera_accounts_directory');
            const directory: any[] = raw ? JSON.parse(raw) : [];
            const idx = directory.findIndex((u: any) => u.id === userId);
            if (idx >= 0) {
              directory[idx] = { ...directory[idx], ...rejectedUser };
            } else {
              directory.push(rejectedUser);
            }
            localStorage.setItem('monvera_accounts_directory', JSON.stringify(directory));
            localStorage.setItem('monvera_kyc_sync_event', JSON.stringify({ userId, kycStatus: 'action_required', timestamp: Date.now() }));
            window.dispatchEvent(new CustomEvent('monvera_kyc_status_updated', {
              detail: { userId, kycStatus: 'action_required', user: rejectedUser }
            }));
          } catch {}
        }
        return { success: true, user: rejectedUser };
      } else {
        return { success: false, error: parsed.error || 'KYC rejection failed on server.' };
      }
    } catch (err: any) {
      console.error('[adminRejectKyc] Error:', err);
      return { success: false, error: err?.message || 'KYC rejection network error' };
    }
  },

  async adminReviewKycItem(data: {
    userId: string;
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn';
    status: 'approved' | 'rejected' | 'pending';
    reason?: string;
    adminId?: string;
    userProfile?: UserProfile;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    if (!data.userId || !data.itemName || !data.status) {
      return { success: false, error: 'userId, itemName, and status are required' };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/kyc/review-item', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(data),
      });
      const parsed = await parseJsonResponse<{ success: boolean; user?: UserProfile; error?: string }>(res, { success: false });

      if (parsed.success && parsed.user) {
        const updatedUser = parsed.user;
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem('monvera_accounts_directory');
            const directory: any[] = raw ? JSON.parse(raw) : [];
            const idx = directory.findIndex((u: any) => u.id === data.userId);
            if (idx >= 0) {
              directory[idx] = { ...directory[idx], ...updatedUser };
            } else {
              directory.push(updatedUser);
            }
            localStorage.setItem('monvera_accounts_directory', JSON.stringify(directory));
            localStorage.setItem('monvera_kyc_sync_event', JSON.stringify({ userId: data.userId, kycStatus: updatedUser.kycStatus, timestamp: Date.now() }));
            window.dispatchEvent(new CustomEvent('monvera_kyc_status_updated', {
              detail: { userId: data.userId, kycStatus: updatedUser.kycStatus, user: updatedUser }
            }));
          } catch {}
        }
        return { success: true, user: updatedUser };
      } else {
        return { success: false, error: parsed.error || 'KYC item review failed on server.' };
      }
    } catch (err: any) {
      console.error('[adminReviewKycItem] Error:', err);
      return { success: false, error: err?.message || 'KYC item review failed' };
    }
  },


  async adminUpdateTransactionStatus(
    dataOrTxId:
      | string
      | {
          txId: string;
          status: TransactionStatus;
          adminId?: string;
          reason?: string;
        },
    status?: TransactionStatus,
    reason?: string,
    adminId?: string
  ): Promise<{ success: boolean; transaction?: Transaction; error?: string }> {
    const payload =
      typeof dataOrTxId === 'string'
        ? { txId: dataOrTxId, status: status!, reason, adminId }
        : dataOrTxId;

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/admin/transactions/${encodeURIComponent(payload.txId)}/update-status`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      return await parseJsonResponse(res, { success: false, error: 'Transaction update service unavailable' });
    } catch {
      return { success: false, error: 'Transaction update request failed' };
    }
  },

  async sendAdminTransfer(data: {
    targetUserId: string;
    amount: number;
    description?: string;
    category?: Transaction['category'];
    adminId?: string;
    clientRequestId?: string;
  }): Promise<{ success: boolean; transaction?: Transaction; targetBalanceMetrics?: BalanceMetrics; error?: string }> {
    if (!data.targetUserId || !data.amount || Number(data.amount) <= 0) {
      return { success: false, error: 'Please enter a valid recipient account number and positive transfer amount.' };
    }

    const authHeaders = await getAuthHeaders();
    if (!authHeaders['Authorization']) {
      return {
        success: false,
        error: 'Administrator authentication required. Please sign into an authorized administrator account.',
      };
    }

    try {
      const clientReqId = data.clientRequestId || `req_adm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const res = await fetch('/api/admin/transfer', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          adminId: data.adminId,
          targetUserId: data.targetUserId,
          amount: Number(data.amount),
          description: data.description || 'Transfer from Bennett Johnson',
          category: data.category || 'Transfers',
          clientRequestId: clientReqId,
        }),
      });

      let responseData: any = null;
      try {
        const text = await res.text();
        if (text) {
          try {
            responseData = JSON.parse(text);
          } catch {}
        }
      } catch {}

      if (!res.ok) {
        if (res.status === 401) {
          return {
            success: false,
            error: responseData?.error || 'Authentication failure: Administrator session expired or invalid. Please re-authenticate.',
          };
        }
        if (res.status === 403) {
          return {
            success: false,
            error: responseData?.error || 'Authorization failure: You do not have administrator permissions to execute transfers.',
          };
        }
        if (res.status === 400 || res.status === 404 || res.status === 422) {
          return {
            success: false,
            error: responseData?.error || `Transfer rejected by banking server (HTTP ${res.status}).`,
          };
        }
        if (res.status >= 500) {
          return {
            success: false,
            error: responseData?.error || `Banking core server error (HTTP ${res.status}). Please try again.`,
          };
        }
        return {
          success: false,
          error: responseData?.error || `Transfer request failed with HTTP ${res.status}.`,
        };
      }

      if (!responseData || !responseData.success || !responseData.transaction) {
        return {
          success: false,
          error: responseData?.error || 'Failed to complete administrative transfer: Missing transaction confirmation.',
        };
      }

      // Authoritatively refresh recipient balance from Firestore (omitting balanceMetrics forces a live read from Firestore)
      const recipientId = responseData.transaction.recipientUserId || data.targetUserId;
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('monvera_balance_updated', {
              detail: { userId: recipientId },
            })
          );
          window.dispatchEvent(
            new CustomEvent('monvera_transaction_created', {
              detail: { userId: recipientId, transaction: responseData.transaction },
            })
          );
        } catch {}
      }

      return {
        success: true,
        transaction: responseData.transaction,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Network failure connecting to Monvera Banking Core: ${err?.message || 'Unable to reach server'}`,
      };
    }
  },

  async issueAdminDevFunding(data: {
    adminId: string;
    targetUserId: string;
    amount: number;
    reason: string;
    targetAccountType?: 'CHECKING' | 'SAVINGS';
    referenceId?: string;
  }): Promise<{
    success: boolean;
    transaction?: Transaction;
    targetBalanceMetrics?: BalanceMetrics;
    devFundingPoolBalance?: number;
    isDuplicate?: boolean;
    error?: string;
  }> {
    const referenceId = data.referenceId || `MVB-DEV-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const authHeaders = await getAuthHeaders();

    try {
      const res = await fetch('/api/admin/dev-fund', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ ...data, referenceId }),
      });

      const result = await parseJsonResponse<{
        success: boolean;
        transaction?: Transaction;
        targetBalanceMetrics?: BalanceMetrics;
        devFundingPoolBalance?: number;
        isDuplicate?: boolean;
        error?: string;
      }>(res, { success: false, error: 'Dev funding service unavailable' });

      if (!result.success || !result.transaction) {
        return {
          success: false,
          error: result.error || 'Failed to issue sandbox development funding.',
        };
      }

      // Update local storage cache if recipient is cached locally
      if (typeof window !== 'undefined' && result.targetBalanceMetrics) {
        try {
          localStorage.setItem(`monvera_balances_${data.targetUserId}`, JSON.stringify(result.targetBalanceMetrics));
          window.dispatchEvent(
            new CustomEvent('monvera_balance_updated', {
              detail: { userId: data.targetUserId, balanceMetrics: result.targetBalanceMetrics },
            })
          );
        } catch {}
      }

      return {
        success: true,
        transaction: result.transaction,
        targetBalanceMetrics: result.targetBalanceMetrics,
        devFundingPoolBalance: result.devFundingPoolBalance,
        isDuplicate: result.isDuplicate,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Network error occurred while issuing developer funding.',
      };
    }
  },

  async topUpDevFundingPool(data: {
    adminId: string;
    amount?: number;
    reason?: string;
  }): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/dev-topup', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(data),
      });
      return await parseJsonResponse(res, { success: false, error: 'Dev topup service unavailable' });
    } catch {
      return { success: false, error: 'Dev topup request failed' };
    }
  },

  async getAdminAuditLogs(): Promise<{ auditLogs: AdminAuditLog[] }> {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/audit-logs', { headers: authHeaders });
      return await parseJsonResponse(res, { auditLogs: [] });
    } catch {
      return { auditLogs: [] };
    }
  },

  // --- LOANS & CREDIT FACILITY API METHODS ---
  async getLoans(
    userId?: string,
    userAccountNumber?: string,
    userEmail?: string
  ): Promise<{ loans: LoanApplication[] }> {
    try {
      const authHeaders = await getAuthHeaders();
      const queryParams = new URLSearchParams();
      if (userId) queryParams.set('userId', userId);
      if (userAccountNumber) queryParams.set('accountNumber', userAccountNumber);
      if (userEmail) queryParams.set('email', userEmail);
      const url = `/api/loans${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const res = await fetch(url, { headers: authHeaders });
      const data = await parseJsonResponse<{ loans: LoanApplication[] }>(res, { loans: [] });
      
      // When queried for a specific user, ensure strict scoping to that user's UID
      if (userId) {
        const fsLoans = await firestoreSync.getLoansForUser(userId, userAccountNumber, userEmail);
        const map = new Map<string, LoanApplication>();
        // Only accept loans that match the requested userId
        (data.loans || []).forEach((l) => {
          if (l && l.id && l.userId === userId) map.set(l.id, l);
        });
        // Authoritative Firestore loans override any stale in-memory data
        fsLoans.forEach((l) => {
          if (l && l.id && l.userId === userId) map.set(l.id, l);
        });
        return {
          loans: Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          ),
        };
      } else {
        // Full loan listings only for authorized administrators (validated by backend /api/loans)
        if (data.loans && data.loans.length > 0) {
          const fsLoans = await firestoreSync.getAllLoans().catch(() => []);
          const map = new Map<string, LoanApplication>();
          (data.loans || []).forEach((l) => map.set(l.id, l));
          fsLoans.forEach((l) => map.set(l.id, l));
          return {
            loans: Array.from(map.values()).sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            ),
          };
        }
        return data;
      }
    } catch {
      return { loans: [] };
    }
  },

  async getLoanEligibility(userId: string): Promise<{
    volume: number;
    tier: string;
    maxLimit: number;
    interestRateAPR: number;
    description: string;
  }> {
    try {
      // Calculate transaction volume from user's real recorded deposits, completed transfers, and payments
      let calculatedVolume = 0;
      try {
        const txRes = await this.getTransactions({ userId });
        const txs = txRes?.transactions || [];
        const validTxs = txs.filter((t) => {
          const status = (t.status || 'COMPLETED').toUpperCase();
          return status === 'COMPLETED' || status === 'SETTLED' || status === 'POSTED' || status === 'PROCESSED';
        });
        calculatedVolume = validTxs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      } catch {
        // Fallback to server calculation
      }

      let serverVolume = 0;
      try {
        const res = await fetch(`/api/loans/eligibility?userId=${encodeURIComponent(userId)}&volume=${calculatedVolume}`);
        const serverData = await parseJsonResponse<any>(res, null);
        if (serverData && typeof serverData.volume === 'number') {
          serverVolume = serverData.volume;
        }
      } catch {
        // use local computation
      }

      const volume = Math.max(calculatedVolume, serverVolume);
      const fixedRate = 20.00;

      if (volume >= 50000) {
        return {
          volume,
          tier: 'Sovereign Institutional Tier',
          maxLimit: 1000000,
          interestRateAPR: fixedRate,
          description: 'Elite clearance tier ($50,000+ volume): Eligible for up to $1,000,000 USD facility with fixed 20% interest.',
        };
      } else if (volume >= 10000) {
        return {
          volume,
          tier: 'Prime Capital Tier',
          maxLimit: 250000,
          interestRateAPR: fixedRate,
          description: 'High volume tier ($10,000+ volume): Eligible for $20,000 to $50,000+ USD credit line (up to $250,000 USD facility) with fixed 20% interest.',
        };
      } else if (volume >= 5000) {
        return {
          volume,
          tier: 'Growth Business Tier',
          maxLimit: 50000,
          interestRateAPR: fixedRate,
          description: 'Active banking tier ($5,000+ volume): Eligible for up to $50,000 USD financing line with fixed 20% interest.',
        };
      } else if (volume >= 2000) {
        return {
          volume,
          tier: 'Starter Credit Tier',
          maxLimit: 10000,
          interestRateAPR: fixedRate,
          description: 'Tier unlocked with $2,000+ transaction volume: Eligible for $1,000 to $10,000 USD credit line with fixed 20% interest.',
        };
      } else {
        return {
          volume,
          tier: 'Initial Tier (Deposit Required)',
          maxLimit: 0,
          interestRateAPR: fixedRate,
          description: `Monvera requirement: A minimum of $2,000.00 in cumulative deposits or verified transaction volume is required to unlock your first credit facility ($1,000 – $10,000 USD). Current volume: $${volume.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Build your transaction history through legitimate deposits and transactions to qualify for higher available loan limits.`,
        };
      }
    } catch {
      return {
        volume: 0,
        tier: 'Initial Tier (Deposit Required)',
        maxLimit: 0,
        interestRateAPR: 20.00,
        description: 'Monvera requirement: A minimum of $2,000.00 in cumulative deposits or verified transaction volume is required to unlock your first credit facility ($1,000 – $10,000 USD). Build your transaction history through legitimate deposits and transactions to qualify for higher available loan limits.',
      };
    }
  },

  async applyForLoan(data: {
    userId: string;
    amount: number;
    termMonths: number;
    purpose: string;
    employmentOrBusinessDetails?: string;
    annualIncomeOrRevenue?: number;
    collateralDescription?: string;
    applicantName?: string;
    applicantEmail?: string;
    applicantPhone?: string;
    permanentAccountNumber?: string;
    fallbackUser?: any;
  }): Promise<{ success: boolean; loan?: LoanApplication; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/loans/apply', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      const result = await parseJsonResponse<{ success: boolean; loan?: LoanApplication; error?: string }>(res, {
        success: false,
        error: 'Loan application service offline',
      });
      if (result.success && result.loan) {
        // Persist permanently in Firestore
        await firestoreSync.saveLoanApplication(result.loan);
        return result;
      }
      // If server returned an error (e.g. 400 with outstanding loan), return it immediately
      if (!res.ok || result.error || result.success === false) {
        return {
          success: false,
          error: result.error || 'Failed to submit loan application.',
        };
      }
    } catch {
      // Backend unreachable, proceed with direct authoritative Firestore fallback
    }

    // Resilient Direct Firestore Fallback: Guarantees zero "server unavailable" errors upon cloud deployment
    try {
      // Check if user already has an outstanding loan in Firestore
      const existingLoans = await firestoreSync.getLoansForUser(
        data.userId,
        data.permanentAccountNumber,
        data.applicantEmail
      );
      const hasOutstanding = existingLoans.some((l) => {
        const status = (l.status || '').toUpperCase();
        const totalRepay = l.totalRepaymentAmount !== undefined
          ? Number(l.totalRepaymentAmount)
          : Number((Number(l.amount || 0) * 1.20).toFixed(2));
        const remaining = l.remainingBalance !== undefined
          ? Number(l.remainingBalance)
          : (status === 'PAID' ? 0 : totalRepay);
        if (status === 'PAID' || status === 'REJECTED' || status === 'CANCELLED' || remaining <= 0) {
          return false;
        }
        return status === 'PENDING' || status === 'APPROVED' || (status === 'ACTIVE' && remaining > 0);
      });

      if (hasOutstanding) {
        return {
          success: false,
          error: 'You currently have an outstanding loan. Please pay off your existing loan before applying for another loan.',
        };
      }

      const validTerms = [6, 12, 24, 36, 48, 60];
      const termMonths = validTerms.includes(data.termMonths) ? data.termMonths : 12;
      const totalRepayment = Number((data.amount * 1.20).toFixed(2));
      const interestAmount = Number((data.amount * 0.20).toFixed(2));
      const monthlyPayment = Number((totalRepayment / termMonths).toFixed(2));
      const maturityDate = new Date(Date.now() + termMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
      const loanId = `loan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const fallbackLoan: LoanApplication = {
        id: loanId,
        userId: data.userId,
        applicantName: data.applicantName || 'Valued Client',
        applicantEmail: data.applicantEmail || '',
        applicantPhone: data.applicantPhone || '',
        permanentAccountNumber: data.permanentAccountNumber || '',
        amount: data.amount,
        termMonths,
        monthlyPayment,
        interestRateAPR: 20.0,
        interestAmount,
        totalRepaymentAmount: totalRepayment,
        remainingBalance: totalRepayment,
        totalRepaid: 0,
        maturityDate,
        purpose: data.purpose || 'Business Expansion & Working Capital',
        employmentOrBusinessDetails: data.employmentOrBusinessDetails || 'Verified Monvera Account Holder',
        annualIncomeOrRevenue: data.annualIncomeOrRevenue || 120000,
        collateralDescription: data.collateralDescription || 'Ledger Cash Flow Guarantee',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await firestoreSync.saveLoanApplication(fallbackLoan);

      // Create confirmation notification
      await firestoreSync.saveNotification({
        id: `notif_loan_app_${Date.now()}`,
        userId: data.userId,
        title: 'Loan Application Submitted',
        message: `Your credit facility application for $${data.amount.toLocaleString('en-US')} has been registered and submitted for compliance review.`,
        type: 'TRANSACTION',
        severity: 'info',
        read: false,
        createdAt: new Date().toISOString(),
      }).catch(() => {});

      return { success: true, loan: fallbackLoan };
    } catch (fsErr: any) {
      return { success: false, error: fsErr?.message || 'Failed to submit loan application.' };
    }
  },

  async adminApproveLoan(data: {
    loanId: string;
    adminId?: string;
    fallbackLoan?: LoanApplication;
  }): Promise<{
    success: boolean;
    loan?: LoanApplication;
    transaction?: Transaction;
    balanceMetrics?: BalanceMetrics;
    notification?: NotificationItem;
    error?: string;
  }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/loans/approve', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });

      const result = await parseJsonResponse<{
        success: boolean;
        loan?: LoanApplication;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        notification?: NotificationItem;
        error?: string;
      }>(res, {
        success: false,
        error: 'Approval service offline',
      });

      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Loan approval failed (${res.status})`,
        };
      }

      // Dispatch local events so UI updates immediately
      if (typeof window !== 'undefined' && result.loan) {
        try {
          const eventDetail = {
            userId: result.loan.userId,
            accountNumber: result.loan.permanentAccountNumber,
            email: result.loan.applicantEmail,
            balanceMetrics: result.balanceMetrics,
            notification: result.notification,
            loan: result.loan,
          };
          window.dispatchEvent(
            new CustomEvent('monvera_balance_updated', {
              detail: eventDetail,
            })
          );
          window.dispatchEvent(
            new CustomEvent('monvera_notification_created', {
              detail: eventDetail,
            })
          );
          window.dispatchEvent(
            new CustomEvent('monvera_loan_updated', {
              detail: { loan: result.loan, transaction: result.transaction },
            })
          );
          const bc = new BroadcastChannel('monvera_sync_channel');
          bc.postMessage({
            type: 'LOAN_APPROVED_DISBURSED',
            ...eventDetail,
            transaction: result.transaction,
          });
          bc.close();
        } catch {}
      }

      return {
        success: true,
        loan: result.loan,
        transaction: result.transaction,
        balanceMetrics: result.balanceMetrics,
        notification: result.notification,
      };
    } catch (err: any) {
      console.error('[adminApproveLoan] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error communicating with loan approval service.',
      };
    }
  },

  async adminRejectLoan(data: {
    loanId: string;
    reason: string;
    adminId?: string;
  }): Promise<{ success: boolean; loan?: LoanApplication; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/loans/reject', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      const result = await parseJsonResponse<{ success: boolean; loan?: LoanApplication; error?: string }>(res, {
        success: false,
        error: 'Rejection service offline',
      });

      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Loan rejection failed (${res.status})`,
        };
      }

      if (result.success && result.loan) {
        // Dispatch local events so customer views and admin views update immediately
        if (typeof window !== 'undefined') {
          try {
            window.dispatchEvent(
              new CustomEvent('monvera_loan_updated', {
                detail: { loan: result.loan },
              })
            );
            const bc = new BroadcastChannel('monvera_sync_channel');
            bc.postMessage({
              type: 'LOAN_REJECTED',
              loan: result.loan,
            });
            bc.close();
          } catch {}
        }
        return result;
      }

      return {
        success: false,
        error: result.error || 'Failed to reject loan application.',
      };
    } catch (err: any) {
      console.error('[adminRejectLoan] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error communicating with loan rejection service.',
      };
    }
  },

  async repayLoan(data: {
    loanId: string;
    userId: string;
    amount: number;
    sourceAccountId?: string;
    note?: string;
    referenceNumber?: string;
    fallbackLoan?: any;
    fallbackUser?: any;
  }): Promise<{
    success: boolean;
    loan?: LoanApplication;
    transaction?: Transaction;
    balanceMetrics?: BalanceMetrics;
    remainingBalance?: number;
    error?: string;
  }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/loans/repay', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });

      const result = await parseJsonResponse<{
        success: boolean;
        loan?: LoanApplication;
        transaction?: Transaction;
        balanceMetrics?: BalanceMetrics;
        remainingBalance?: number;
        error?: string;
      }>(res, {
        success: false,
        error: 'Repayment service offline',
      });

      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Repayment rejected by server (${res.status})`,
        };
      }

      if (typeof window !== 'undefined' && result.loan) {
        try {
          window.dispatchEvent(
            new CustomEvent('monvera_loan_updated', {
              detail: { loan: result.loan, transaction: result.transaction },
            })
          );
          if (result.balanceMetrics) {
            window.dispatchEvent(
              new CustomEvent('monvera_balance_updated', {
                detail: {
                  userId: data.userId,
                  balanceMetrics: result.balanceMetrics,
                },
              })
            );
          }
        } catch {}
      }

      return {
        success: true,
        loan: result.loan,
        transaction: result.transaction,
        balanceMetrics: result.balanceMetrics,
        remainingBalance: result.remainingBalance,
      };
    } catch (err: any) {
      console.error('[repayLoan] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error communicating with repayment service.',
      };
    }
  },

  /**
   * Retrieves the customer's authoritative Welcome Reward status and cumulative progress
   */
  async getWelcomeReward(userId: string): Promise<{
    success: boolean;
    reward?: WelcomeRewardInfo;
    error?: string;
  }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(getApiEndpoint(`/api/rewards/welcome/${encodeURIComponent(userId)}`), {
        headers,
      });
      const data = await parseJsonResponse<{ success: boolean; reward?: WelcomeRewardInfo; error?: string }>(res, {
        success: false,
        error: 'Failed to retrieve welcome reward',
      });
      return data;
    } catch (err: any) {
      console.error('[getWelcomeReward] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error retrieving welcome reward status.',
      };
    }
  },

  /**
   * Retrieves all customer Welcome Reward records for the administrator dashboard
   */
  async getAdminWelcomeRewards(): Promise<{
    success: boolean;
    rewards?: WelcomeRewardInfo[];
    stats?: any;
    error?: string;
  }> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(getApiEndpoint('/api/admin/rewards/welcome'), {
        headers,
      });
      const data = await parseJsonResponse<{ success: boolean; rewards?: WelcomeRewardInfo[]; stats?: any; error?: string }>(res, {
        success: false,
        error: 'Failed to retrieve administrative welcome rewards',
      });
      return data;
    } catch (err: any) {
      console.error('[getAdminWelcomeRewards] Network error:', err);
      return {
        success: false,
        error: err?.message || 'Network error retrieving admin welcome rewards.',
      };
    }
  },
};
