import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { UserProfile, Transaction, InvestmentPlan, LoanApplication, CardItem, NotificationItem, ChatMessage } from '../types';
import type { BalanceMetrics } from './api';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error('[Firestore Error]', JSON.stringify(errInfo));
  return errInfo;
}

export const firestoreSync = {
  /**
   * Save or update Customer Profile in Firestore under users/{uid}
   */
  async saveUserProfile(
    uid: string,
    profileData: Partial<UserProfile> & Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    if (!db) {
      const msg = 'Firestore database instance is not available or initialized.';
      console.error(`[Firestore] ${msg}`);
      return { success: false, error: msg };
    }
    if (!uid) {
      const msg = 'Missing authenticated user UID for Firestore profile creation.';
      console.error(`[Firestore] ${msg}`);
      return { success: false, error: msg };
    }

    const path = `users/${uid}`;
    try {
      const userRef = doc(db, 'users', uid);
      
      const rawUsername = profileData.username || (profileData.email ? profileData.email.split('@')[0] : `user_${uid.slice(0, 6)}`);
      const cleanUsername = rawUsername.replace(/^@/, '').trim();
      const rawAcc = profileData.permanentAccountNumber || profileData.accountNumber || '';
      const cleanAcc = rawAcc.replace(/[-\s]/g, '');

      // Clean payload: ensure no undefined fields exist (which cause Firestore setDoc to fail)
      const payload: Record<string, any> = {
        uid: uid,
        id: uid,
        fullName: profileData.fullName || `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim(),
        firstName: profileData.firstName || '',
        lastName: profileData.lastName || '',
        email: (profileData.email || '').toLowerCase().trim(),
        phone: profileData.phone || profileData.phoneNumber || '',
        country: profileData.country || 'United States',
        dateOfBirth: profileData.dateOfBirth || '',
        age: profileData.age || '',
        maritalStatus: profileData.maritalStatus || 'Single',
        address: profileData.address || '',
        permanentAccountNumber: cleanAcc,
        accountNumber: cleanAcc,
        username: cleanUsername,
        usernameLower: cleanUsername.toLowerCase(),
        role: profileData.role || 'customer',
        status: profileData.status || 'active',
        kycStatus: profileData.kycStatus || 'unverified',
        kycFullName: profileData.kycFullName || profileData.fullName || `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim(),
        kycFirstName: profileData.kycFirstName || profileData.firstName || '',
        kycLastName: profileData.kycLastName || profileData.lastName || '',
        kycCountry: profileData.kycCountry || profileData.country || 'United States',
        kycPhone: profileData.kycPhone || profileData.phone || profileData.phoneNumber || '',
        kycEmail: profileData.kycEmail || profileData.email || '',
        kycDateOfBirth: profileData.kycDateOfBirth || profileData.dateOfBirth || '',
        kycDocumentType: profileData.kycDocumentType || '',
        kycDocumentNumber: profileData.kycDocumentNumber || '',
        kycDocumentImage: profileData.kycDocumentImage || '',
        kycDocumentBackImage: profileData.kycDocumentBackImage || '',
        kycLiveSelfieImage: profileData.kycLiveSelfieImage || '',
        kycStreetAddress: profileData.kycStreetAddress || profileData.address || '',
        kycProofOfAddressType: profileData.kycProofOfAddressType || '',
        kycProofOfAddressImage: profileData.kycProofOfAddressImage || '',
        kycSsn: profileData.kycSsn || '',
        kycSsnImage: profileData.kycSsnImage || '',
        kycItemReviews: profileData.kycItemReviews || null,
        kycRejectionReason: profileData.kycRejectionReason || '',
        kycSubmittedAt: profileData.kycSubmittedAt || '',
        kycVerifiedAt: profileData.kycVerifiedAt || '',
        kycReviewDurationMinutes: profileData.kycReviewDurationMinutes || 10,
        emailVerified: profileData.emailVerified ?? false,
        membershipTier: profileData.membershipTier || 'Premier',
        twoFactorEnabled: profileData.twoFactorEnabled ?? false,
        createdAt: profileData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dailyTransactionLimit: profileData.dailyTransactionLimit || 1000000,
      };

      if (profileData.businessName) {
        payload.businessName = profileData.businessName;
      }
      if (profileData.taxId) {
        payload.taxId = profileData.taxId;
      }
      if (profileData.avatarUrl) {
        payload.avatarUrl = profileData.avatarUrl;
      }

      // Strip out any remaining keys that have undefined values
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) {
          delete payload[k];
        }
      });

      await setDoc(userRef, payload, { merge: true });
      return { success: true };
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
      const code = err?.code || 'unknown';
      const message = err?.message || String(err);
      return {
        success: false,
        error: `Firestore error (${code}): ${message}`,
      };
    }
  },

  /**
   * Fetch Customer Profile from Firestore under users/{uid}
   */
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    if (!db) return null;
    const path = `users/${uid}`;
    try {
      const userRef = doc(db, 'users', uid);
      const snapshot = await getDoc(userRef);
      if (snapshot.exists()) {
        const data = snapshot.data();
        return {
          id: data.id || uid,
          username: data.username || data.email?.split('@')[0] || 'customer',
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          email: data.email || '',
          phone: data.phone || '',
          permanentAccountNumber: data.permanentAccountNumber || '1000000000',
          dateOfBirth: data.dateOfBirth,
          country: data.country || 'United States',
          avatarUrl: data.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          status: data.status || 'active',
          role: data.role || 'customer',
          membershipTier: data.membershipTier || 'Standard',
          twoFactorEnabled: data.twoFactorEnabled ?? false,
          createdAt: data.createdAt || new Date().toISOString(),
          businessName: data.businessName,
          maritalStatus: data.maritalStatus,
          taxId: data.taxId,
          kycStatus: data.kycStatus || 'unverified',
          kycFullName: data.kycFullName || data.fullName,
          kycFirstName: data.kycFirstName || data.firstName,
          kycLastName: data.kycLastName || data.lastName,
          kycCountry: data.kycCountry || data.country,
          kycPhone: data.kycPhone || data.phone,
          kycEmail: data.kycEmail || data.email,
          kycDateOfBirth: data.kycDateOfBirth || data.dateOfBirth,
          kycDocumentType: data.kycDocumentType,
          kycDocumentNumber: data.kycDocumentNumber,
          kycDocumentImage: data.kycDocumentImage,
          kycDocumentBackImage: data.kycDocumentBackImage,
          kycLiveSelfieImage: data.kycLiveSelfieImage,
          kycStreetAddress: data.kycStreetAddress,
          kycProofOfAddressType: data.kycProofOfAddressType,
          kycProofOfAddressImage: data.kycProofOfAddressImage,
          kycSsn: data.kycSsn,
          kycSsnImage: data.kycSsnImage,
          kycItemReviews: data.kycItemReviews || null,
          kycRejectionReason: data.kycRejectionReason,
          kycSubmittedAt: data.kycSubmittedAt,
          kycVerifiedAt: data.kycVerifiedAt,
          kycReviewDurationMinutes: data.kycReviewDurationMinutes,
          emailVerified: data.emailVerified ?? false,
          dailyTransactionLimit: data.dailyTransactionLimit || 1000000,
        };
      }
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return null;
    }
  },

  /**
   * Backward-compatible alias for saving user
   */
  async saveUser(user: UserProfile): Promise<boolean> {
    const res = await this.saveUserProfile(user.id, user);
    return res.success;
  },

  /**
   * Backward-compatible alias for getting user
   */
  async getUser(userId: string): Promise<UserProfile | null> {
    return this.getUserProfile(userId);
  },

  /**
   * Save Transaction into Firestore ledger with fallback local backup
   */
  async saveTransaction(tx: Transaction): Promise<boolean> {
    // 1. Always backup locally to guarantee immediate visibility
    try {
      const existingStr = localStorage.getItem('monvera_permanent_transactions');
      const existingTxs: Transaction[] = existingStr ? JSON.parse(existingStr) : [];
      const updated = [tx, ...existingTxs.filter((t) => t.id !== tx.id)];
      localStorage.setItem('monvera_permanent_transactions', JSON.stringify(updated.slice(0, 100)));
    } catch {
      // LocalStorage notice
    }

    if (!db) return true;
    const path = `transactions/${tx.id}`;
    try {
      const txRef = doc(db, 'transactions', tx.id);
      await setDoc(
        txRef,
        {
          ...tx,
          syncedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return true; // Still return true if local backup succeeded
    }
  },

  /**
   * Save Investment into Firestore
   */
  async saveInvestment(inv: InvestmentPlan): Promise<boolean> {
    if (!db) return false;
    const path = `investments/${inv.id}`;
    try {
      const invRef = doc(db, 'investments', inv.id);
      await setDoc(invRef, {
        ...inv,
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return false;
    }
  },

  /**
   * Save Card into Firestore
   */
  async saveCard(card: CardItem): Promise<boolean> {
    if (!db) return false;
    const path = `cards/${card.id}`;
    try {
      const cardRef = doc(db, 'cards', card.id);
      await setDoc(cardRef, {
        ...card,
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return false;
    }
  },

  /**
   * Save Notification into Firestore
   */
  async saveNotification(notif: NotificationItem): Promise<boolean> {
    if (!db) return false;
    const path = `notifications/${notif.id}`;
    try {
      const notifRef = doc(db, 'notifications', notif.id);
      await setDoc(notifRef, {
        ...notif,
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return false;
    }
  },

  /**
   * Fetch all notifications for a specific user from Firestore
   */
  async getNotificationsForUser(userId: string): Promise<NotificationItem[]> {
    if (!userId || !db) return [];
    try {
      const notifCol = collection(db, 'notifications');
      const qUser = query(notifCol, where('userId', '==', userId));
      const snap = await getDocs(qUser);
      const notifs: NotificationItem[] = [];
      snap.forEach((d) => {
        const item = d.data() as NotificationItem;
        notifs.push({
          id: d.id || item.id,
          ...item,
        });
      });
      return notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      console.warn('[Firestore] Error fetching user notifications:', err);
      return [];
    }
  },

  /**
   * Save and update permanent user account balances in Firestore under accounts/{userId}
   */
  async saveAccountBalances(userId: string, balances: BalanceMetrics): Promise<boolean> {
    if (!userId) return false;
    // Local backup
    try {
      localStorage.setItem(`monvera_balances_${userId}`, JSON.stringify(balances));
    } catch {}

    if (!db) return true;
    const path = `accounts/${userId}`;
    try {
      const accRef = doc(db, 'accounts', userId);
      await setDoc(
        accRef,
        {
          userId,
          ...balances,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return true;
    }
  },

  /**
   * Compute verified ledger balances directly from immutable Firestore transactions
   */
  computeBalancesFromTransactions(
    userId: string,
    txs: Transaction[],
    baseAccounts: any[] = [],
    userAccountNumber?: string
  ): BalanceMetrics {
    let checking = 0;
    let savings = 0;
    let invested = 0;
    let accruedEarnings = 0;

    const userAccClean = (userAccountNumber || '').replace(/[-\s]/g, '');

    for (const tx of txs) {
      if (tx.status !== 'COMPLETED') continue;
      const amount = Number(tx.amount) || 0;

      const txRecipientAccClean = (tx.recipientAccountNumber || '').replace(/[-\s]/g, '');
      const txSenderAccClean = (tx.senderAccountNumber || '').replace(/[-\s]/g, '');

      const isSender =
        tx.senderUserId === userId ||
        (userAccClean && txSenderAccClean && txSenderAccClean === userAccClean);

      const isRecipient =
        tx.recipientUserId === userId ||
        (!tx.recipientUserId && tx.userId === userId) ||
        (userAccClean && txRecipientAccClean && txRecipientAccClean === userAccClean);

      if (tx.type === 'DEPOSIT' || tx.type === 'ADMIN_DEVELOPMENT_FUNDING') {
        if (isRecipient || isSender) {
          if (tx.metadata?.destinationAccountType === 'SAVINGS') {
            savings += amount;
          } else {
            checking += amount;
          }
        }
      } else if (tx.type === 'TRANSFER') {
        if (isSender && isRecipient) {
          // Internal account movement
          const desc = (tx.description || '').toLowerCase();
          if (desc.includes('checking to savings') || desc.includes('chk to sav')) {
            checking = Math.max(0, checking - amount);
            savings += amount;
          } else if (desc.includes('savings to checking') || desc.includes('sav to chk')) {
            savings = Math.max(0, savings - amount);
            checking += amount;
          }
        } else if (isRecipient) {
          // Inbound transfer from admin (Bennett Johnson) or another customer
          checking += amount;
        } else if (isSender) {
          // Outbound transfer sent to someone else
          checking = Math.max(0, checking - amount);
        }
      } else if (tx.type === 'WITHDRAWAL') {
        if (isSender || isRecipient) {
          if (tx.metadata?.sourceAccountType === 'SAVINGS') {
            savings = Math.max(0, savings - amount);
          } else {
            checking = Math.max(0, checking - amount);
          }
        }
      } else if (tx.type === 'FEE' || tx.type === 'CARD_PURCHASE') {
        if (isSender || isRecipient) {
          checking = Math.max(0, checking - amount);
        }
      } else if (tx.type === 'INVESTMENT') {
        const desc = (tx.description || '').toLowerCase();
        if (desc.includes('maturity') || desc.includes('payout') || desc.includes('profit')) {
          checking += amount;
        } else if (isSender || isRecipient) {
          invested += amount;
        }
      }
    }

    const total = checking + savings + invested + accruedEarnings;
    const available = checking;

    const accounts =
      baseAccounts.length > 0
        ? baseAccounts.map((a) => {
            if (a.type === 'CHECKING') {
              return { ...a, balance: checking, availableBalance: checking };
            }
            if (a.type === 'SAVINGS') {
              return { ...a, balance: savings, availableBalance: savings };
            }
            if (a.type === 'INVESTMENT') {
              return { ...a, balance: invested, investedBalance: invested };
            }
            return a;
          })
        : [
            {
              id: `acc_chk_${userId}`,
              userId,
              type: 'CHECKING',
              accountNumber: userAccountNumber || '1000000000',
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
              accountNumber: userAccountNumber ? `10${userAccountNumber.slice(2, -3)}991` : '1000000991',
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
      investedBalance: invested,
      accruedEarnings,
      totalBalance: total,
      availableBalance: available,
      pendingBalance: 0,
      accounts,
    };
  },

  /**
   * Fetch permanent user account balances from Firestore with dynamic ledger verification
   */
  async getAccountBalances(userId: string, userAccountNumber?: string): Promise<BalanceMetrics | null> {
    if (!userId) return null;
    let cachedMetrics: BalanceMetrics | null = null;
    try {
      const localStr = localStorage.getItem(`monvera_balances_${userId}`);
      if (localStr) cachedMetrics = JSON.parse(localStr);
    } catch {}

    if (!db) return cachedMetrics;
    const path = `accounts/${userId}`;
    try {
      const accRef = doc(db, 'accounts', userId);
      const snap = await getDoc(accRef);
      let data = snap.exists() ? snap.data() : null;

      // Resilient check: If accounts/{userId} is missing or empty, check legacy accounts/{userAccountNumber}
      if (!data && userAccountNumber) {
        const cleanAcc = userAccountNumber.replace(/[-\s]/g, '');
        if (cleanAcc && cleanAcc !== userId) {
          try {
            const legacyRef = doc(db, 'accounts', cleanAcc);
            const legacySnap = await getDoc(legacyRef);
            if (legacySnap.exists()) {
              const legacyData = legacySnap.data();
              // Seamlessly copy legacy balance into accounts/{userId} without deleting legacy document
              await setDoc(accRef, {
                userId,
                ...legacyData,
                migratedFromAccountNumberDoc: cleanAcc,
                updatedAt: new Date().toISOString(),
              }, { merge: true });
              data = legacyData;
            }
          } catch {}
        }
      }

      if (data) {
        const chk = Number(data.checkingBalance ?? 0);
        const sav = Number(data.savingsBalance ?? data.savings ?? 0);
        const inv = Number(data.investedBalance ?? data.investmentBalance ?? 0);
        const accrued = Number(data.accruedEarnings ?? 0);
        const total = Number(
          data.totalBalance ?? (chk + sav + inv + accrued)
        );
        const avail = Number(data.availableBalance ?? chk);
        const accountsList = (Array.isArray(data.accounts) && data.accounts.length > 0)
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
                accountNumber: userAccountNumber || '1000000000',
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
                accountNumber: userAccountNumber ? `10${userAccountNumber.slice(2, -3)}991` : '1000000991',
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

      // If document does not exist yet in Firestore, compute from verified transactions
      const txs = await this.getTransactionsForUser(userId, userAccountNumber);
      if (txs.length > 0) {
        const computed = this.computeBalancesFromTransactions(
          userId,
          txs,
          cachedMetrics?.accounts || [],
          userAccountNumber
        );
        // Persist computed result in background
        this.saveAccountBalances(userId, computed).catch(() => {});
        return computed;
      }
      return cachedMetrics;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return cachedMetrics;
    }
  },

  /**
   * Fetch user's permanent transactions from Firestore (both sent and received)
   */
  async getTransactionsForUser(userId: string, userAccountNumber?: string): Promise<Transaction[]> {
    if (!userId) return [];
    const txMap = new Map<string, Transaction>();

    // 1. Check local permanent cache
    try {
      const localStr = localStorage.getItem('monvera_permanent_transactions');
      if (localStr) {
        const localTxs: Transaction[] = JSON.parse(localStr);
        const cleanAcc = (userAccountNumber || '').replace(/[-\s]/g, '');
        localTxs.forEach((t) => {
          const tRecipClean = (t.recipientAccountNumber || '').replace(/[-\s]/g, '');
          const tSenderClean = (t.senderAccountNumber || '').replace(/[-\s]/g, '');
          if (
            t.senderUserId === userId ||
            t.recipientUserId === userId ||
            t.userId === userId ||
            (cleanAcc && (tRecipClean === cleanAcc || tSenderClean === cleanAcc))
          ) {
            txMap.set(t.id, t);
          }
        });
      }
    } catch {}

    if (!db) {
      return Array.from(txMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const path = 'transactions';
    try {
      const txCol = collection(db, 'transactions');
      const qSender = query(txCol, where('senderUserId', '==', userId));
      const qRecipient = query(txCol, where('recipientUserId', '==', userId));
      const qOwner = query(txCol, where('userId', '==', userId));

      const promises: Promise<any>[] = [
        getDocs(qSender).catch(() => ({ forEach: () => {} } as any)),
        getDocs(qRecipient).catch(() => ({ forEach: () => {} } as any)),
        getDocs(qOwner).catch(() => ({ forEach: () => {} } as any)),
      ];

      const cleanAcc = (userAccountNumber || '').replace(/[-\s]/g, '');
      if (cleanAcc) {
        promises.push(
          getDocs(query(txCol, where('recipientAccountNumber', '==', cleanAcc))).catch(
            () => ({ forEach: () => {} } as any)
          )
        );
        promises.push(
          getDocs(query(txCol, where('senderAccountNumber', '==', cleanAcc))).catch(
            () => ({ forEach: () => {} } as any)
          )
        );
      }

      // Also get all transactions to ensure zero missed disbursements
      promises.push(
        getDocs(txCol).catch(() => ({ forEach: () => {} } as any))
      );

      const snapshots = await Promise.all(promises);

      snapshots.forEach((snap) => {
        if (snap && typeof snap.forEach === 'function') {
          snap.forEach((d: any) => {
            const data = d.data() as Transaction;
            const tRecipClean = (data.recipientAccountNumber || '').replace(/[-\s]/g, '');
            const tSenderClean = (data.senderAccountNumber || '').replace(/[-\s]/g, '');
            if (
              data.senderUserId === userId ||
              data.recipientUserId === userId ||
              data.userId === userId ||
              (cleanAcc && (tRecipClean === cleanAcc || tSenderClean === cleanAcc))
            ) {
              txMap.set(data.id || d.id, data);
            }
          });
        }
      });

      return Array.from(txMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return Array.from(txMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
  },

  /**
   * Search for any Monvera recipient across all fields (username, account number, email, user ID)
   */
  async findRecipient(identifier: string): Promise<UserProfile | null> {
    if (!identifier) return null;
    const raw = identifier.trim();
    const cleanNoAt = raw.replace(/^@/, '').trim();
    const cleanDigits = cleanNoAt.replace(/[-\s]/g, '');
    const cleanLower = cleanNoAt.toLowerCase();

    // 0. Check localStorage cached directory first for instant zero-latency match
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const cachedRaw = localStorage.getItem('monvera_accounts_directory');
        if (cachedRaw) {
          const directory: UserProfile[] = JSON.parse(cachedRaw);
          if (Array.isArray(directory)) {
            const match = directory.find((u) => {
              const uAcc = (u.permanentAccountNumber || (u as any).accountNumber || '').replace(/[-\s]/g, '');
              const uUser = (u.username || '').replace(/^@/, '').toLowerCase();
              const uEmail = (u.email || '').toLowerCase();
              const uId = (u.id || (u as any).uid || '').toLowerCase();
              const uName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase().trim();
              return (
                (cleanDigits && uAcc === cleanDigits) ||
                (cleanLower && uUser === cleanLower) ||
                (cleanLower && uEmail === cleanLower) ||
                (raw && uId === raw.toLowerCase()) ||
                (cleanLower.length >= 3 && uName === cleanLower)
              );
            });
            if (match) return match;
          }
        }
      }
    } catch {}

    if (!db) return null;
    const usersCol = collection(db, 'users');

    // 1. Direct indexed queries for rapid matching with isolated error handling
    const queryQueries = [
      ...(cleanDigits ? [
        query(usersCol, where('permanentAccountNumber', '==', cleanDigits)),
        query(usersCol, where('accountNumber', '==', cleanDigits)),
      ] : []),
      ...(cleanLower ? [
        query(usersCol, where('usernameLower', '==', cleanLower)),
        query(usersCol, where('username', '==', cleanNoAt)),
        query(usersCol, where('username', '==', cleanLower)),
        query(usersCol, where('email', '==', cleanLower)),
      ] : []),
    ];

    for (const q of queryQueries) {
      try {
        const snap = await getDocs(q);
        if (!snap.empty) {
          const docData = snap.docs[0].data() as UserProfile;
          return {
            id: snap.docs[0].id || docData.id,
            ...docData,
          };
        }
      } catch {}
    }

    // 2. Check direct document ID lookup
    if (raw.length >= 6) {
      try {
        const directDoc = await getDoc(doc(db, 'users', raw));
        if (directDoc.exists()) {
          return { id: directDoc.id, ...directDoc.data() } as UserProfile;
        }
      } catch {}
    }

    // 3. Check accounts collection in Firestore
    if (cleanDigits) {
      try {
        const accCol = collection(db, 'accounts');
        const accSnap = await getDocs(accCol);
        for (const ad of accSnap.docs) {
          const aData = ad.data() as any;
          const accountsList: any[] = aData.accounts || [];
          const hasAcc = accountsList.some(
            (a) => (a.accountNumber || '').replace(/[-\s]/g, '') === cleanDigits
          );
          if (hasAcc) {
            const uid = ad.id;
            const uProfile = await this.getUserProfile(uid);
            if (uProfile) return uProfile;
          }
        }
      } catch {}
    }

    // 4. Comprehensive resilient fallback: scan users collection to match any field
    try {
      const allUsersSnap = await getDocs(usersCol);
      for (const d of allUsersSnap.docs) {
        const u = d.data() as UserProfile & Record<string, any>;
        const uAcc = (u.permanentAccountNumber || u.accountNumber || '').replace(/[-\s]/g, '');
        const uUser = (u.username || '').replace(/^@/, '').toLowerCase();
        const uEmail = (u.email || '').toLowerCase();
        const uId = (u.id || d.id || '').toLowerCase();
        const uName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase().trim();

        if (
          (cleanDigits && uAcc === cleanDigits) ||
          (cleanLower && uUser === cleanLower) ||
          (cleanLower && uEmail === cleanLower) ||
          (raw && uId === raw.toLowerCase()) ||
          (cleanLower.length >= 3 && uName.includes(cleanLower))
        ) {
          return {
            id: d.id || u.id,
            ...u,
          };
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
    }

    return null;
  },

  /**
   * Fetch ALL real registered users from Firestore users collection
   */
  async getAllUsers(): Promise<UserProfile[]> {
    if (!db) return [];
    try {
      const usersCol = collection(db, 'users');
      const snap = await getDocs(usersCol);
      const userList: UserProfile[] = [];

      snap.forEach((d) => {
        const data = d.data() as any;
        const uid = d.id || data.id || data.uid;
        const rawUsername = data.username || (data.email ? data.email.split('@')[0] : `user_${uid.slice(0, 6)}`);
        const cleanUsername = rawUsername.replace(/^@/, '').trim();
        const rawAcc = data.permanentAccountNumber || data.accountNumber || '';
        const cleanAcc = rawAcc.replace(/[-\s]/g, '');

        userList.push({
          id: uid,
          username: cleanUsername,
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          email: data.email || '',
          phone: data.phone || data.phoneNumber || '',
          permanentAccountNumber: cleanAcc || '1000000000',
          dateOfBirth: data.dateOfBirth,
          country: data.country || 'United States',
          avatarUrl: data.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          status: data.status || 'active',
          role: data.role || 'customer',
          membershipTier: data.membershipTier || 'Premier',
          twoFactorEnabled: data.twoFactorEnabled ?? false,
          createdAt: data.createdAt || new Date().toISOString(),
          businessName: data.businessName,
          maritalStatus: data.maritalStatus,
          taxId: data.taxId,
          kycStatus: data.kycStatus || 'unverified',
          kycFullName: data.kycFullName || data.fullName,
          kycFirstName: data.kycFirstName || data.firstName,
          kycLastName: data.kycLastName || data.lastName,
          kycCountry: data.kycCountry || data.country,
          kycPhone: data.kycPhone || data.phone,
          kycEmail: data.kycEmail || data.email,
          kycDateOfBirth: data.kycDateOfBirth || data.dateOfBirth,
          kycDocumentType: data.kycDocumentType,
          kycDocumentNumber: data.kycDocumentNumber,
          kycDocumentImage: data.kycDocumentImage,
          kycDocumentBackImage: data.kycDocumentBackImage,
          kycLiveSelfieImage: data.kycLiveSelfieImage,
          kycStreetAddress: data.kycStreetAddress,
          kycProofOfAddressType: data.kycProofOfAddressType,
          kycProofOfAddressImage: data.kycProofOfAddressImage,
          kycSsn: data.kycSsn,
          kycSsnImage: data.kycSsnImage,
          kycItemReviews: data.kycItemReviews || null,
          kycRejectionReason: data.kycRejectionReason,
          kycSubmittedAt: data.kycSubmittedAt,
          kycVerifiedAt: data.kycVerifiedAt,
          kycReviewDurationMinutes: data.kycReviewDurationMinutes,
          emailVerified: data.emailVerified ?? false,
          dailyTransactionLimit: data.dailyTransactionLimit || 1000000,
        });
      });

      return userList;
    } catch (err) {
      console.warn('[Firestore] Error fetching all users:', err);
      return [];
    }
  },

  /**
   * Subscribe to real-time updates for all registered users in Firestore
   */
  subscribeToUsers(onUpdate: (users: UserProfile[]) => void): () => void {
    if (!db) return () => {};
    try {
      const usersCol = collection(db, 'users');
      const unsubscribe = onSnapshot(
        usersCol,
        (snap) => {
          const userList: UserProfile[] = [];
          snap.forEach((d) => {
            const data = d.data() as any;
            const uid = d.id || data.id || data.uid;
            const rawUsername = data.username || (data.email ? data.email.split('@')[0] : `user_${uid.slice(0, 6)}`);
            const cleanUsername = rawUsername.replace(/^@/, '').trim();
            const rawAcc = data.permanentAccountNumber || data.accountNumber || '';
            const cleanAcc = rawAcc.replace(/[-\s]/g, '');

            userList.push({
              id: uid,
              username: cleanUsername,
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              email: data.email || '',
              phone: data.phone || data.phoneNumber || '',
              permanentAccountNumber: cleanAcc || '1000000000',
              dateOfBirth: data.dateOfBirth,
              country: data.country || 'United States',
              avatarUrl: data.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
              status: data.status || 'active',
              role: data.role || 'customer',
              membershipTier: data.membershipTier || 'Premier',
              twoFactorEnabled: data.twoFactorEnabled ?? false,
              createdAt: data.createdAt || new Date().toISOString(),
              businessName: data.businessName,
              maritalStatus: data.maritalStatus,
              taxId: data.taxId,
              kycStatus: data.kycStatus || 'unverified',
              kycFullName: data.kycFullName || data.fullName,
              kycFirstName: data.kycFirstName || data.firstName,
              kycLastName: data.kycLastName || data.lastName,
              kycCountry: data.kycCountry || data.country,
              kycPhone: data.kycPhone || data.phone,
              kycEmail: data.kycEmail || data.email,
              kycDateOfBirth: data.kycDateOfBirth || data.dateOfBirth,
              kycDocumentType: data.kycDocumentType,
              kycDocumentNumber: data.kycDocumentNumber,
              kycDocumentImage: data.kycDocumentImage,
              kycDocumentBackImage: data.kycDocumentBackImage,
              kycLiveSelfieImage: data.kycLiveSelfieImage,
              kycStreetAddress: data.kycStreetAddress,
              kycProofOfAddressType: data.kycProofOfAddressType,
              kycProofOfAddressImage: data.kycProofOfAddressImage,
              kycSsn: data.kycSsn,
              kycSsnImage: data.kycSsnImage,
              kycItemReviews: data.kycItemReviews || null,
              kycRejectionReason: data.kycRejectionReason,
              kycSubmittedAt: data.kycSubmittedAt,
              kycVerifiedAt: data.kycVerifiedAt,
              kycReviewDurationMinutes: data.kycReviewDurationMinutes,
              emailVerified: data.emailVerified ?? false,
              dailyTransactionLimit: data.dailyTransactionLimit || 1000000,
            });
          });
          onUpdate(userList);
        },
        (error) => {
          console.warn('[Firestore users subscription note]:', error);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to users:', err);
      return () => {};
    }
  },

  /**
   * Fetch all real registered users paired with their actual Firestore account balances
   */
  async getAllUsersWithBalances(): Promise<(UserProfile & { balanceMetrics?: BalanceMetrics })[]> {
    const users = await this.getAllUsers();
    const results: (UserProfile & { balanceMetrics?: BalanceMetrics })[] = [];

    for (const user of users) {
      const balances = await this.getAccountBalances(user.id);
      const metrics: BalanceMetrics = balances || {
        checkingBalance: 0,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 0,
        availableBalance: 0,
        pendingBalance: 0,
        accounts: [],
      };
      results.push({
        ...user,
        balanceMetrics: metrics,
      });
    }

    return results;
  },

  /**
   * Subscribe to real-time updates for all registered users and their account balances
   */
  subscribeToUsersWithBalances(
    onUpdate: (users: (UserProfile & { balanceMetrics?: BalanceMetrics })[]) => void
  ): () => void {
    if (!db) return () => {};
    try {
      const usersCol = collection(db, 'users');
      const unsubscribe = onSnapshot(
        usersCol,
        async (snap) => {
          const userList: (UserProfile & { balanceMetrics?: BalanceMetrics })[] = [];
          
          for (const d of snap.docs) {
            const data = d.data() as any;
            const uid = d.id || data.id || data.uid;
            const rawUsername = data.username || (data.email ? data.email.split('@')[0] : `user_${uid.slice(0, 6)}`);
            const cleanUsername = rawUsername.replace(/^@/, '').trim();
            const rawAcc = data.permanentAccountNumber || data.accountNumber || '';
            const cleanAcc = rawAcc.replace(/[-\s]/g, '');

            const profile: UserProfile = {
              id: uid,
              username: cleanUsername,
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              email: data.email || '',
              phone: data.phone || data.phoneNumber || '',
              permanentAccountNumber: cleanAcc || '1000000000',
              dateOfBirth: data.dateOfBirth,
              country: data.country || 'United States',
              avatarUrl: data.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
              status: data.status || 'active',
              role: data.role || 'customer',
              membershipTier: data.membershipTier || 'Premier',
              twoFactorEnabled: data.twoFactorEnabled ?? false,
              createdAt: data.createdAt || new Date().toISOString(),
              businessName: data.businessName,
              maritalStatus: data.maritalStatus,
              taxId: data.taxId,
              kycStatus: data.kycStatus || 'unverified',
              kycFullName: data.kycFullName || data.fullName,
              kycFirstName: data.kycFirstName || data.firstName,
              kycLastName: data.kycLastName || data.lastName,
              kycCountry: data.kycCountry || data.country,
              kycPhone: data.kycPhone || data.phone,
              kycEmail: data.kycEmail || data.email,
              kycDateOfBirth: data.kycDateOfBirth || data.dateOfBirth,
              kycDocumentType: data.kycDocumentType,
              kycDocumentNumber: data.kycDocumentNumber,
              kycDocumentImage: data.kycDocumentImage,
              kycDocumentBackImage: data.kycDocumentBackImage,
              kycLiveSelfieImage: data.kycLiveSelfieImage,
              kycStreetAddress: data.kycStreetAddress,
              kycProofOfAddressType: data.kycProofOfAddressType,
              kycProofOfAddressImage: data.kycProofOfAddressImage,
              kycSsn: data.kycSsn,
              kycSsnImage: data.kycSsnImage,
              kycItemReviews: data.kycItemReviews || null,
              kycRejectionReason: data.kycRejectionReason,
              kycSubmittedAt: data.kycSubmittedAt,
              kycVerifiedAt: data.kycVerifiedAt,
              kycReviewDurationMinutes: data.kycReviewDurationMinutes,
              emailVerified: data.emailVerified ?? false,
              dailyTransactionLimit: data.dailyTransactionLimit || 1000000,
            };

            const balances = await this.getAccountBalances(uid, cleanAcc);
            const metrics: BalanceMetrics = balances || {
              checkingBalance: 0,
              savingsBalance: 0,
              investedBalance: 0,
              accruedEarnings: 0,
              totalBalance: 0,
              availableBalance: 0,
              pendingBalance: 0,
              accounts: [],
            };

            userList.push({
              ...profile,
              balanceMetrics: metrics,
            });
          }

          onUpdate(userList);
        },
        (error) => {
          console.warn('[Firestore users with balances subscription note]:', error);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to users with balances:', err);
      return () => {};
    }
  },

  /**
   * Real-time listener for a user's account balances under accounts/{userId}
   */
  subscribeToAccountBalances(
    userId: string,
    userAccountNumber: string | undefined,
    onUpdate: (metrics: BalanceMetrics) => void
  ): () => void {
    if (!userId || !db) return () => {};
    try {
      const accRef = doc(db, 'accounts', userId);
      const unsubscribe = onSnapshot(
        accRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const chk = Number(data.checkingBalance ?? 0);
            const sav = Number(data.savingsBalance ?? data.savings ?? 0);
            const inv = Number(data.investedBalance ?? data.investmentBalance ?? 0);
            const accrued = Number(data.accruedEarnings ?? 0);
            const total = Number(data.totalBalance ?? (chk + sav + inv + accrued));
            const avail = Number(data.availableBalance ?? chk);
            const accountsList = (Array.isArray(data.accounts) && data.accounts.length > 0)
              ? data.accounts.map((a: any) => {
                  if (a.type === 'CHECKING') return { ...a, balance: chk, availableBalance: avail };
                  if (a.type === 'SAVINGS') return { ...a, balance: sav, availableBalance: sav };
                  if (a.type === 'INVESTMENT') return { ...a, balance: inv, investedBalance: inv };
                  return a;
                })
              : [
                  {
                    id: `acc_chk_${userId}`,
                    userId,
                    type: 'CHECKING',
                    accountNumber: userAccountNumber || '1000000000',
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
                    accountNumber: userAccountNumber ? `10${userAccountNumber.slice(2, -3)}991` : '1000000991',
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
              accounts: accountsList,
            };
            if (data.monthlyIncome !== undefined) (metrics as any).monthlyIncome = Number(data.monthlyIncome);
            if (data.monthlySpending !== undefined) (metrics as any).monthlySpending = Number(data.monthlySpending);

            onUpdate(metrics);
          }
        },
        (err) => {
          console.warn('[Firestore] Error in account balances realtime listener:', err);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to account balances:', err);
      return () => {};
    }
  },

  /**
   * Real-time listener for a user's profile under users/{userId}
   */
  subscribeToUserProfile(
    userId: string,
    onUpdate: (profile: UserProfile | null) => void
  ): () => void {
    if (!userId || !db) return () => {};
    try {
      const userRef = doc(db, 'users', userId);
      const unsubscribe = onSnapshot(
        userRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const profile: UserProfile = {
              id: data.id || userId,
              username: data.username || data.email?.split('@')[0] || 'customer',
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              email: data.email || '',
              phone: data.phone || '',
              permanentAccountNumber: data.permanentAccountNumber || '1000000000',
              dateOfBirth: data.dateOfBirth,
              country: data.country || 'United States',
              avatarUrl: data.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
              status: data.status || 'active',
              role: data.role || 'customer',
              membershipTier: data.membershipTier || 'Standard',
              twoFactorEnabled: data.twoFactorEnabled ?? false,
              createdAt: data.createdAt || new Date().toISOString(),
              businessName: data.businessName,
              maritalStatus: data.maritalStatus,
              taxId: data.taxId,
              kycStatus: data.kycStatus || 'unverified',
              kycFullName: data.kycFullName || data.fullName,
              kycFirstName: data.kycFirstName || data.firstName,
              kycLastName: data.kycLastName || data.lastName,
              kycCountry: data.kycCountry || data.country,
              kycPhone: data.kycPhone || data.phone,
              kycEmail: data.kycEmail || data.email,
              kycDateOfBirth: data.kycDateOfBirth || data.dateOfBirth,
              kycDocumentType: data.kycDocumentType,
              kycDocumentNumber: data.kycDocumentNumber,
              kycDocumentImage: data.kycDocumentImage,
              kycDocumentBackImage: data.kycDocumentBackImage,
              kycLiveSelfieImage: data.kycLiveSelfieImage,
              kycStreetAddress: data.kycStreetAddress,
              kycProofOfAddressType: data.kycProofOfAddressType,
              kycProofOfAddressImage: data.kycProofOfAddressImage,
              kycSsn: data.kycSsn,
              kycSsnImage: data.kycSsnImage,
              kycItemReviews: data.kycItemReviews || null,
              kycRejectionReason: data.kycRejectionReason,
              kycSubmittedAt: data.kycSubmittedAt,
              kycVerifiedAt: data.kycVerifiedAt,
              kycReviewDurationMinutes: data.kycReviewDurationMinutes,
              emailVerified: data.emailVerified ?? false,
              dailyTransactionLimit: data.dailyTransactionLimit || 1000000,
            };
            onUpdate(profile);
          } else {
            onUpdate(null);
          }
        },
        (err) => {
          console.warn('[Firestore] Error in user profile realtime listener:', err);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to user profile:', err);
      return () => {};
    }
  },

  /**
   * Fetch all real transactions in Firestore
   */
  async getAllTransactions(): Promise<Transaction[]> {
    if (!db) return [];
    try {
      const txCol = collection(db, 'transactions');
      const snap = await getDocs(txCol);
      const list: Transaction[] = [];
      snap.forEach((d) => {
        list.push(d.data() as Transaction);
      });
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      console.warn('[Firestore] Error fetching all transactions:', err);
      return [];
    }
  },

  /**
   * Subscribe in real-time to all Firestore transactions
   */
  subscribeToAllTransactions(onUpdate: (txs: Transaction[]) => void): () => void {
    if (!db) return () => {};
    try {
      const txCol = collection(db, 'transactions');
      const unsubscribe = onSnapshot(
        txCol,
        (snap) => {
          const list: Transaction[] = [];
          snap.forEach((d) => {
            list.push(d.data() as Transaction);
          });
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onUpdate(list);
        },
        (error) => {
          console.warn('[Firestore transactions subscription note]:', error);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to transactions:', err);
      return () => {};
    }
  },

  /**
   * Fetch all Support Tickets and Notifications from Firestore
   */
  async getAllSupportTickets(): Promise<NotificationItem[]> {
    if (!db) return [];
    try {
      const notifCol = collection(db, 'notifications');
      const snap = await getDocs(notifCol);
      const tickets: NotificationItem[] = [];
      snap.forEach((d) => {
        const item = d.data() as NotificationItem;
        if (item.type === 'SUPPORT' || item.supportTicketId || item.replies?.length) {
          tickets.push(item);
        }
      });
      return tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      console.warn('[Firestore] Error fetching support tickets:', err);
      return [];
    }
  },

  /**
   * Subscribe in real time to all Support Tickets across all customers
   */
  subscribeToSupportTickets(onUpdate: (tickets: NotificationItem[]) => void): () => void {
    if (!db) return () => {};
    try {
      const notifCol = collection(db, 'notifications');
      const unsubscribe = onSnapshot(
        notifCol,
        (snap) => {
          const tickets: NotificationItem[] = [];
          snap.forEach((d) => {
            const item = d.data() as NotificationItem;
            if (item.type === 'SUPPORT' || item.supportTicketId || item.replies?.length) {
              tickets.push(item);
            }
          });
          tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onUpdate(tickets);
        },
        (error) => {
          console.warn('[Firestore support tickets subscription note]:', error);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to support tickets:', err);
      return () => {};
    }
  },

  /**
   * Send a real-time support message reply to a ticket in Firestore
   */
  async sendSupportReply(
    ticketId: string,
    reply: {
      senderId: string;
      senderName: string;
      senderRole: 'CUSTOMER' | 'ADMIN' | 'SUPPORT_REP' | 'COMPLIANCE';
      senderAvatar?: string;
      message: string;
    },
    updatedStatus?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  ): Promise<{ success: boolean; error?: string }> {
    if (!db || !ticketId) return { success: false, error: 'Invalid ticket ID' };
    const path = `notifications/${ticketId}`;
    try {
      const docRef = doc(db, 'notifications', ticketId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return { success: false, error: 'Support ticket not found in Firestore' };
      }

      const existingData = snap.data() as NotificationItem;
      const currentReplies = existingData.replies || [];
      const newReply = {
        id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        senderId: reply.senderId,
        senderName: reply.senderName,
        senderRole: reply.senderRole,
        senderAvatar: reply.senderAvatar,
        message: reply.message.trim(),
        timestamp: new Date().toISOString(),
      };

      const updatedReplies = [...currentReplies, newReply];
      const newStatus = updatedStatus || (reply.senderRole === 'CUSTOMER' ? 'OPEN' : 'IN_PROGRESS');

      await setDoc(
        docRef,
        {
          ...existingData,
          replies: updatedReplies,
          supportStatus: newStatus,
          read: reply.senderRole === 'ADMIN' ? false : existingData.read, // Set unread for customer if admin replied
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return { success: true };
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return { success: false, error: err?.message || 'Failed to send support reply' };
    }
  },

  /**
   * Create a new formal support ticket or notice in Firestore
   */
  async createSupportTicket(params: {
    userId: string;
    title: string;
    message: string;
    severity?: 'info' | 'success' | 'warning' | 'error';
    adminAuthorName?: string;
    adminAuthorRole?: string;
    initialStatus?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  }): Promise<{ success: boolean; ticketId?: string; error?: string }> {
    if (!db || !params.userId) return { success: false, error: 'User ID is required' };
    const ticketId = `notif_sup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const path = `notifications/${ticketId}`;
    try {
      const docRef = doc(db, 'notifications', ticketId);
      const newTicket: NotificationItem = {
        id: ticketId,
        userId: params.userId,
        title: params.title.trim(),
        message: params.message.trim(),
        type: 'SUPPORT',
        severity: params.severity || 'info',
        read: false,
        createdAt: new Date().toISOString(),
        supportTicketId: ticketId,
        supportStatus: params.initialStatus || 'OPEN',
        supportRepName: params.adminAuthorName || 'Monvera Client Support',
        supportRepRole: params.adminAuthorRole || 'Compliance & Concierge Officer',
        supportRepAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        replies: [
          {
            id: `reply_${Date.now()}`,
            sender: params.adminAuthorName ? 'support' : 'user',
            senderId: params.userId,
            senderName: params.adminAuthorName || 'Monvera Official Operations',
            senderRole: params.adminAuthorName ? 'ADMIN' : 'CUSTOMER',
            message: params.message.trim(),
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      };

      await setDoc(docRef, newTicket);
      return { success: true, ticketId };
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return { success: false, error: err?.message || 'Failed to create support ticket' };
    }
  },

  /**
   * Save a WhatsApp Live Chat Message to Firestore and local backup
   */
  async saveChatMessage(msg: ChatMessage): Promise<boolean> {
    if (!msg || !msg.userId) return false;
    // Local backup
    try {
      const localKey = `monvera_chat_${msg.userId}`;
      const existingStr = localStorage.getItem(localKey);
      const list: ChatMessage[] = existingStr ? JSON.parse(existingStr) : [];
      const updated = [...list.filter((m) => m.id !== msg.id), msg];
      localStorage.setItem(localKey, JSON.stringify(updated.slice(-100)));
    } catch {}

    if (!db) return true;
    const path = `support_messages/${msg.id}`;
    try {
      const docRef = doc(db, 'support_messages', msg.id);
      await setDoc(docRef, {
        ...msg,
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return true;
    }
  },

  /**
   * Fetch all WhatsApp Live Chat messages for a user
   */
  async getChatMessagesForUser(userId: string): Promise<ChatMessage[]> {
    if (!userId) return [];
    let localList: ChatMessage[] = [];
    try {
      const localStr = localStorage.getItem(`monvera_chat_${userId}`);
      if (localStr) localList = JSON.parse(localStr);
    } catch {}

    if (!db) return localList.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    try {
      const msgCol = collection(db, 'support_messages');
      const q = query(msgCol, where('userId', '==', userId));
      const snap = await getDocs(q);
      const map = new Map<string, ChatMessage>();
      localList.forEach((m) => map.set(m.id, m));
      snap.forEach((d) => {
        const item = d.data() as ChatMessage;
        map.set(item.id || d.id, item);
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    } catch (err) {
      console.warn('[Firestore] Error loading chat messages:', err);
      return localList.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
  },

  /**
   * Subscribe to real-time WhatsApp Live Chat updates for a user
   */
  subscribeToChatMessages(userId: string, onUpdate: (messages: ChatMessage[]) => void): () => void {
    if (!userId) return () => {};
    if (!db) {
      this.getChatMessagesForUser(userId).then(onUpdate);
      return () => {};
    }
    try {
      const msgCol = collection(db, 'support_messages');
      const q = query(msgCol, where('userId', '==', userId));
      const unsubscribe = onSnapshot(
        q,
        (snap) => {
          const list: ChatMessage[] = [];
          snap.forEach((d) => {
            list.push(d.data() as ChatMessage);
          });
          list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          onUpdate(list);
        },
        (error) => {
          console.warn('[Firestore live chat subscription notice]:', error);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to live chat:', err);
      return () => {};
    }
  },

  /**
   * --- PERMANENT LOAN PERSISTENCE & SYNC ---
   */
  async saveLoanApplication(loan: LoanApplication): Promise<{ success: boolean; error?: string }> {
    if (!loan || !loan.id) return { success: false, error: 'Invalid loan payload' };

    // 1. Save to local permanent cache
    try {
      const localStr = localStorage.getItem('monvera_permanent_loans');
      const existing: LoanApplication[] = localStr ? JSON.parse(localStr) : [];
      const updated = [loan, ...existing.filter((l) => l.id !== loan.id)];
      localStorage.setItem('monvera_permanent_loans', JSON.stringify(updated));
    } catch {}

    if (!db) return { success: true };

    const path = `loans/${loan.id}`;
    try {
      const loanRef = doc(db, 'loans', loan.id);
      const cleanData: Record<string, any> = {
        id: loan.id,
        userId: loan.userId,
        applicantName: loan.applicantName,
        applicantEmail: loan.applicantEmail,
        applicantPhone: loan.applicantPhone || '',
        permanentAccountNumber: loan.permanentAccountNumber,
        amount: Number(loan.amount),
        termMonths: Number(loan.termMonths),
        monthlyPayment: Number(loan.monthlyPayment),
        interestRateAPR: Number(loan.interestRateAPR),
        purpose: loan.purpose || '',
        employmentOrBusinessDetails: loan.employmentOrBusinessDetails || '',
        annualIncomeOrRevenue: loan.annualIncomeOrRevenue ? Number(loan.annualIncomeOrRevenue) : 0,
        collateralDescription: loan.collateralDescription || '',
        status: loan.status,
        userTransactionVolume: Number(loan.userTransactionVolume || 0),
        eligibilityTier: loan.eligibilityTier || 'Starter Credit Tier',
        rejectionReason: loan.rejectionReason || '',
        approvedAt: loan.approvedAt || '',
        approvedBy: loan.approvedBy || '',
        rejectedAt: loan.rejectedAt || '',
        rejectedBy: loan.rejectedBy || '',
        disbursedAt: loan.disbursedAt || '',
        disbursedAmount: loan.disbursedAmount ? Number(loan.disbursedAmount) : 0,
        totalRepaid: loan.totalRepaid ? Number(loan.totalRepaid) : 0,
        remainingBalance: loan.remainingBalance !== undefined ? Number(loan.remainingBalance) : Number(loan.amount),
        createdAt: loan.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(loanRef, cleanData, { merge: true });
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return { success: false, error: 'Firestore loan save failed.' };
    }
  },

  async getLoansForUser(userId: string): Promise<LoanApplication[]> {
    if (!userId) return [];
    let localList: LoanApplication[] = [];
    try {
      const localStr = localStorage.getItem('monvera_permanent_loans');
      if (localStr) {
        const parsed: LoanApplication[] = JSON.parse(localStr);
        localList = parsed.filter((l) => l.userId === userId);
      }
    } catch {}

    if (!db) return localList;

    const path = 'loans';
    try {
      const colRef = collection(db, 'loans');
      const q = query(colRef, where('userId', '==', userId));
      const snap = await getDocs(q);
      const map = new Map<string, LoanApplication>();
      localList.forEach((l) => map.set(l.id, l));
      snap.forEach((d) => {
        const item = d.data() as LoanApplication;
        map.set(item.id || d.id, item);
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return localList;
    }
  },

  async getAllLoans(): Promise<LoanApplication[]> {
    let localList: LoanApplication[] = [];
    try {
      const localStr = localStorage.getItem('monvera_permanent_loans');
      if (localStr) localList = JSON.parse(localStr);
    } catch {}

    if (!db) return localList;

    const path = 'loans';
    try {
      const colRef = collection(db, 'loans');
      const snap = await getDocs(colRef);
      const map = new Map<string, LoanApplication>();
      localList.forEach((l) => map.set(l.id, l));
      snap.forEach((d) => {
        const item = d.data() as LoanApplication;
        map.set(item.id || d.id, item);
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return localList;
    }
  },

  subscribeToLoans(onUpdate: (loans: LoanApplication[]) => void): () => void {
    if (!db) {
      this.getAllLoans().then(onUpdate);
      return () => {};
    }
    try {
      const colRef = collection(db, 'loans');
      const unsubscribe = onSnapshot(
        colRef,
        (snap) => {
          const list: LoanApplication[] = [];
          snap.forEach((d) => list.push(d.data() as LoanApplication));
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onUpdate(list);
        },
        (error) => {
          console.warn('[Firestore loans subscription notice]:', error);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Error subscribing to loans:', err);
      return () => {};
    }
  },
};
