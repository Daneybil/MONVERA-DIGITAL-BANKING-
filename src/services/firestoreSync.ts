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
  runTransaction,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { UserProfile, Transaction, InvestmentPlan, InvestmentTermDays, LoanApplication, CardItem, NotificationItem, NotificationPreferences, ChatMessage } from '../types';
import type { BalanceMetrics } from './api';

// Double-investment prevention lock for concurrent clicks/requests
const inFlightInvestmentLocks = new Set<string>();

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

export const FAKE_ACCOUNT_IDS = new Set([
  'usr_eleanor',
  'usr_marcus',
  'usr_sophia',
  'usr_alexander',
  'usr_isabella',
  'usr_lucas',
  'usr_clara',
  'usr_tariq',
  'usr_elena',
  'usr_william',
  'usr_amara',
  'usr_julian',
]);

export function isNonExistentAccount(user: { id?: string; email?: string; firstName?: string; lastName?: string; role?: string }): boolean {
  if (!user) return true;
  if (user.id && FAKE_ACCOUNT_IDS.has(user.id)) return true;
  if (user.id === 'usr_admin' || user.role === 'super_admin') return true;
  if (user.email) {
    const em = user.email.toLowerCase().trim();
    if (
      em.endsWith('@vanceholdings.com') ||
      em.endsWith('@sterlingtech.io') ||
      em.endsWith('@falconcap.ae') ||
      em.endsWith('@apexventures.sg') ||
      em.endsWith('@milanolux.it') ||
      em.endsWith('@vanderbiltmaritime.nl') ||
      em.endsWith('@oswaldresearch.org') ||
      em.endsWith('@gulfenergyholdings.com') ||
      em.endsWith('@auroraglobal.ch') ||
      em.endsWith('@thornepartners.co.uk') ||
      em.endsWith('@lagosfin.ng') ||
      em.endsWith('@delacroixequity.fr') ||
      em.endsWith('@monvera.internal')
    ) {
      return true;
    }
  }
  if (user.firstName === 'Monvera' && user.lastName === 'Client') return true;
  return false;
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
        updatedAt: new Date().toISOString(),
      };

      if (profileData.fullName) {
        payload.fullName = profileData.fullName;
      } else if (profileData.firstName || profileData.lastName) {
        payload.fullName = `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim();
      }
      if (profileData.firstName !== undefined) payload.firstName = profileData.firstName;
      if (profileData.lastName !== undefined) payload.lastName = profileData.lastName;
      if (profileData.email !== undefined) payload.email = (profileData.email || '').toLowerCase().trim();
      if (profileData.phone !== undefined) payload.phone = profileData.phone;
      if (profileData.phoneNumber !== undefined) payload.phone = profileData.phoneNumber;
      if (profileData.country !== undefined) payload.country = profileData.country;
      if (profileData.dateOfBirth !== undefined) payload.dateOfBirth = profileData.dateOfBirth;
      if (profileData.age !== undefined) payload.age = profileData.age;
      if (profileData.maritalStatus !== undefined) payload.maritalStatus = profileData.maritalStatus;
      if (profileData.address !== undefined) payload.address = profileData.address;
      if (cleanAcc) {
        payload.permanentAccountNumber = cleanAcc;
        payload.accountNumber = cleanAcc;
      }
      if (cleanUsername) {
        payload.username = cleanUsername;
        payload.usernameLower = cleanUsername.toLowerCase();
      }
      if (profileData.role !== undefined) payload.role = profileData.role;
      if (profileData.status !== undefined) payload.status = profileData.status;
      if (profileData.membershipTier !== undefined) payload.membershipTier = profileData.membershipTier;
      if (profileData.twoFactorEnabled !== undefined) payload.twoFactorEnabled = profileData.twoFactorEnabled;
      if (profileData.emailVerified !== undefined) payload.emailVerified = profileData.emailVerified;
      if (profileData.dailyTransactionLimit !== undefined) payload.dailyTransactionLimit = profileData.dailyTransactionLimit;
      if (profileData.createdAt !== undefined) payload.createdAt = profileData.createdAt;
      if (profileData.businessName !== undefined) payload.businessName = profileData.businessName;
      if (profileData.taxId !== undefined) payload.taxId = profileData.taxId;
      if (profileData.avatarUrl !== undefined) payload.avatarUrl = profileData.avatarUrl;

      // KYC SPECIFIC FIELDS: Strictly preserve existing KYC documents & status.
      // Only write to Firestore when explicitly provided in profileData.
      if (profileData.kycStatus !== undefined) payload.kycStatus = profileData.kycStatus;
      if (profileData.kycFullName !== undefined) payload.kycFullName = profileData.kycFullName;
      if (profileData.kycFirstName !== undefined) payload.kycFirstName = profileData.kycFirstName;
      if (profileData.kycLastName !== undefined) payload.kycLastName = profileData.kycLastName;
      if (profileData.kycCountry !== undefined) payload.kycCountry = profileData.kycCountry;
      if (profileData.kycPhone !== undefined) payload.kycPhone = profileData.kycPhone;
      if (profileData.kycEmail !== undefined) payload.kycEmail = profileData.kycEmail;
      if (profileData.kycDateOfBirth !== undefined) payload.kycDateOfBirth = profileData.kycDateOfBirth;
      if (profileData.kycDocumentType !== undefined) payload.kycDocumentType = profileData.kycDocumentType;
      if (profileData.kycDocumentNumber !== undefined) payload.kycDocumentNumber = profileData.kycDocumentNumber;
      if (profileData.kycDocumentImage !== undefined) payload.kycDocumentImage = profileData.kycDocumentImage;
      if (profileData.kycDocumentBackImage !== undefined) payload.kycDocumentBackImage = profileData.kycDocumentBackImage;
      if (profileData.kycLiveSelfieImage !== undefined) payload.kycLiveSelfieImage = profileData.kycLiveSelfieImage;
      if (profileData.kycStreetAddress !== undefined) payload.kycStreetAddress = profileData.kycStreetAddress;
      if (profileData.kycProofOfAddressType !== undefined) payload.kycProofOfAddressType = profileData.kycProofOfAddressType;
      if (profileData.kycProofOfAddressImage !== undefined) payload.kycProofOfAddressImage = profileData.kycProofOfAddressImage;
      if (profileData.kycSsn !== undefined) payload.kycSsn = profileData.kycSsn;
      if (profileData.kycSsnImage !== undefined) payload.kycSsnImage = profileData.kycSsnImage;
      if (profileData.kycItemReviews !== undefined) payload.kycItemReviews = profileData.kycItemReviews;
      if (profileData.kycRejectionReason !== undefined) payload.kycRejectionReason = profileData.kycRejectionReason;
      if (profileData.kycSubmittedAt !== undefined) payload.kycSubmittedAt = profileData.kycSubmittedAt;
      if (profileData.kycVerifiedAt !== undefined) payload.kycVerifiedAt = profileData.kycVerifiedAt;
      if (profileData.kycReviewDurationMinutes !== undefined) payload.kycReviewDurationMinutes = profileData.kycReviewDurationMinutes;

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
   * Save Card into Firestore and local cache
   */
  async saveCard(card: CardItem): Promise<{ success: boolean; error?: string }> {
    if (!card || !card.id || !card.userId) return { success: false, error: 'Invalid card payload' };
    try {
      const raw = localStorage.getItem(`monvera_cards_${card.userId}`);
      const list: CardItem[] = raw ? JSON.parse(raw) : [];
      const updated = [card, ...list.filter((c) => c.id !== card.id)];
      localStorage.setItem(`monvera_cards_${card.userId}`, JSON.stringify(updated));
    } catch {}

    if (!db) return { success: true };
    const path = `cards/${card.id}`;
    try {
      const cardRef = doc(db, 'cards', card.id);
      await setDoc(cardRef, {
        ...card,
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return { success: true };
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return { success: false, error: err?.message || 'Failed to save card' };
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

      // Auto-reconcile notifications for active loans if missing
      try {
        const loansCol = collection(db, 'loans');
        const qLoans = query(loansCol, where('userId', '==', userId));
        const loansSnap = await getDocs(qLoans);
        loansSnap.forEach((lDoc) => {
          const lData = lDoc.data() as LoanApplication;
          if (lData.status === 'ACTIVE' || lData.status === 'APPROVED') {
            const hasLoanNotif = notifs.some(
              (n) =>
                n.referenceId === lData.id ||
                n.id.includes(lData.id) ||
                (n.title && n.title.includes('Loan Approved') && n.message?.includes(lData.amount?.toString()))
            );
            if (!hasLoanNotif) {
              const loanNotif: NotificationItem = {
                id: `notif_loan_appr_${lData.id}`,
                userId,
                title: '🎉 Loan Approved & Disbursed!',
                message: `Congratulations! Your loan application for $${Number(lData.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} has been approved and the capital has been credited directly into your Checking Account.`,
                type: 'TRANSACTION',
                severity: 'success',
                read: false,
                createdAt: lData.approvedAt || lData.updatedAt || new Date().toISOString(),
                referenceId: lData.id,
              };
              notifs.unshift(loanNotif);
              this.saveNotification(loanNotif).catch(() => {});
            }
          }
        });
      } catch (errNotifLoans) {
        console.warn('[Firestore] Note checking loan notifications:', errNotifLoans);
      }

      return notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      console.warn('[Firestore] Error fetching user notifications:', err);
      return [];
    }
  },

  /**
   * Default notification preferences for new users
   */
  getDefaultNotificationPreferences(userId: string): NotificationPreferences {
    return {
      userId,
      pushEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
      transactionAlerts: true,
      securityAlerts: true,
      updatedAt: new Date().toISOString(),
    };
  },

  /**
   * Fetch notification preferences for user
   */
  async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    if (!userId) return this.getDefaultNotificationPreferences('');
    try {
      const cached = localStorage.getItem(`monvera_notif_prefs_${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {}

    if (!db) return this.getDefaultNotificationPreferences(userId);

    try {
      // Check users/{userId}/notificationPreferences/settings
      const prefRef = doc(db, 'users', userId, 'notificationPreferences', 'settings');
      const snap = await getDoc(prefRef);
      if (snap.exists()) {
        const data = snap.data() as NotificationPreferences;
        try {
          localStorage.setItem(`monvera_notif_prefs_${userId}`, JSON.stringify(data));
        } catch {}
        return data;
      }

      // Check root fallback notification_preferences/{userId}
      const rootRef = doc(db, 'notification_preferences', userId);
      const rootSnap = await getDoc(rootRef);
      if (rootSnap.exists()) {
        const data = rootSnap.data() as NotificationPreferences;
        try {
          localStorage.setItem(`monvera_notif_prefs_${userId}`, JSON.stringify(data));
        } catch {}
        return data;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching notification preferences:', err);
    }

    const defaultPrefs = this.getDefaultNotificationPreferences(userId);
    this.saveNotificationPreferences(userId, defaultPrefs).catch(() => {});
    return defaultPrefs;
  },

  /**
   * Save notification preferences for user
   */
  async saveNotificationPreferences(userId: string, prefs: Partial<NotificationPreferences>): Promise<boolean> {
    if (!userId) return false;
    const current = await this.getNotificationPreferences(userId);
    const updated: NotificationPreferences = {
      ...current,
      ...prefs,
      userId,
      securityAlerts: true, // Security alerts are mandatory and cannot be disabled
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(`monvera_notif_prefs_${userId}`, JSON.stringify(updated));
    } catch {}

    if (!db) return true;

    try {
      const prefRef = doc(db, 'users', userId, 'notificationPreferences', 'settings');
      await setDoc(prefRef, updated, { merge: true });

      const rootRef = doc(db, 'notification_preferences', userId);
      await setDoc(rootRef, updated, { merge: true });

      return true;
    } catch (err) {
      console.warn('[Firestore] Error saving notification preferences:', err);
      return false;
    }
  },

  /**
   * Real-time subscription to user's notification preferences
   */
  subscribeToNotificationPreferences(userId: string, callback: (prefs: NotificationPreferences) => void): () => void {
    if (!userId || !db) {
      callback(this.getDefaultNotificationPreferences(userId || ''));
      return () => {};
    }

    try {
      const prefRef = doc(db, 'users', userId, 'notificationPreferences', 'settings');
      const unsubscribe = onSnapshot(prefRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data() as NotificationPreferences;
          try {
            localStorage.setItem(`monvera_notif_prefs_${userId}`, JSON.stringify(data));
          } catch {}
          callback(data);
        } else {
          callback(this.getDefaultNotificationPreferences(userId));
        }
      }, (err) => {
        console.warn('[Firestore] Preferences subscription note:', err);
      });

      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Preferences listener setup note:', err);
      callback(this.getDefaultNotificationPreferences(userId));
      return () => {};
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
          // Internal account movement or loan disbursement
          const desc = (tx.description || '').toLowerCase();
          if (desc.includes('checking to savings') || desc.includes('chk to sav')) {
            checking = Math.max(0, checking - amount);
            savings += amount;
          } else if (desc.includes('savings to checking') || desc.includes('sav to chk')) {
            savings = Math.max(0, savings - amount);
            checking += amount;
          } else if (desc.includes('loan') || desc.includes('disburs') || desc.includes('credit')) {
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
          const principal = Number(tx.metadata?.principal || 0);
          if (principal > 0) {
            invested = Math.max(0, invested - principal);
          }
        } else if (isSender || isRecipient) {
          checking = Math.max(0, checking - amount);
          invested += amount;
        }
      } else if (tx.type === 'INVESTMENT_MATURITY') {
        checking += amount;
        const principal = Number(tx.metadata?.principal || 0);
        if (principal > 0) {
          invested = Math.max(0, invested - principal);
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
        let chk = Number(data.checkingBalance ?? 0);
        let sav = Number(data.savingsBalance ?? data.savings ?? 0);
        let inv = Number(data.investedBalance ?? data.investmentBalance ?? 0);
        let accrued = Number(data.accruedEarnings ?? 0);
        let avail = Number(data.availableBalance ?? chk);
        let total = Number(data.totalBalance ?? (chk + sav + inv + accrued));
        let loanBal = Number(data.loanBalance ?? 0);

        // Reconciliation check: ensure all active approved loans for this user are credited
        try {
          const loansCol = collection(db, 'loans');
          const qLoans = query(loansCol, where('userId', '==', userId));
          const loansSnap = await getDocs(qLoans);
          if (!loansSnap.empty) {
            let uncreditedLoanSum = 0;
            let activeLoansTotal = 0;
            const creditedLoans: string[] = Array.isArray(data.creditedLoans) ? [...data.creditedLoans] : [];
            let needsSync = false;

            loansSnap.forEach((lDoc) => {
              const l = lDoc.data() as LoanApplication;
              if (l.status === 'ACTIVE' || l.status === 'APPROVED') {
                const repBal = Number(l.remainingBalance ?? l.totalRepaymentAmount ?? (l.amount * 1.20));
                activeLoansTotal += repBal;

                if (!creditedLoans.includes(l.id)) {
                  uncreditedLoanSum += Number(l.disbursedAmount || l.amount || 0);
                  creditedLoans.push(l.id);
                  needsSync = true;
                }
              }
            });

            if (activeLoansTotal !== loanBal && activeLoansTotal > 0) {
              loanBal = activeLoansTotal;
              needsSync = true;
            }

            if (uncreditedLoanSum > 0) {
              chk += uncreditedLoanSum;
              avail += uncreditedLoanSum;
              total += uncreditedLoanSum;
            }

            if (needsSync) {
              const updatedAccountsList = (Array.isArray(data.accounts) && data.accounts.length > 0)
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
                : undefined;

              const syncedMetrics = {
                userId,
                checkingBalance: chk,
                savingsBalance: sav,
                investedBalance: inv,
                accruedEarnings: accrued,
                totalBalance: total,
                availableBalance: avail,
                loanBalance: loanBal,
                pendingBalance: Number(data.pendingBalance ?? 0),
                ...(updatedAccountsList ? { accounts: updatedAccountsList } : {}),
                creditedLoans,
                updatedAt: new Date().toISOString(),
              };

              // Background non-blocking persistence back to Firestore accounts/{userId}
              setDoc(accRef, syncedMetrics, { merge: true }).catch(() => {});
            }
          }
        } catch (loanSyncErr) {
          console.warn('[Firestore] Loan balance reconciliation note:', loanSyncErr);
        }

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

      // Filter only real registered users from Firestore (excluding admin and non-existent accounts)
      const realUsers = userList.filter((u) => !isNonExistentAccount(u));

      // Synchronize with local storage safely without injecting any non-existent accounts
      if (typeof window !== 'undefined') {
        try {
          // Check local directory cache and sanitize it
          const localRaw = localStorage.getItem('monvera_accounts_directory');
          if (localRaw) {
            const localList: UserProfile[] = JSON.parse(localRaw);
            for (const lu of localList) {
              if (!lu || !lu.id || isNonExistentAccount(lu)) continue;
              const existingIdx = realUsers.findIndex(
                (u) =>
                  u.id === lu.id ||
                  (u.permanentAccountNumber && lu.permanentAccountNumber && u.permanentAccountNumber === lu.permanentAccountNumber)
              );
              if (existingIdx >= 0) {
                realUsers[existingIdx] = { ...realUsers[existingIdx], ...lu };
              } else {
                realUsers.push(lu);
                if (db) {
                  setDoc(doc(db, 'users', lu.id), lu, { merge: true }).catch(() => {});
                }
              }
            }
          }

          // Check if current user is logged in and not yet recorded
          const curUserRaw = localStorage.getItem('monvera_current_user');
          if (curUserRaw) {
            const cu = JSON.parse(curUserRaw);
            if (cu && cu.id && !isNonExistentAccount(cu)) {
              if (!realUsers.some((u) => u.id === cu.id || (u.permanentAccountNumber && u.permanentAccountNumber === cu.permanentAccountNumber))) {
                realUsers.push(cu);
              }
            }
          }

          // Persist the clean list of real accounts
          localStorage.setItem('monvera_accounts_directory', JSON.stringify(realUsers));
        } catch {}
      }

      return realUsers;
    } catch (err) {
      console.warn('[Firestore] Error fetching all users:', err);
      // Fallback to sanitized local accounts directory if Firestore network fails
      try {
        const localRaw = typeof window !== 'undefined' ? localStorage.getItem('monvera_accounts_directory') : null;
        if (localRaw) {
          const parsed: UserProfile[] = JSON.parse(localRaw);
          return parsed.filter((u) => !isNonExistentAccount(u));
        }
      } catch {}
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
      let balances = await this.getAccountBalances(user.id, user.permanentAccountNumber);
      if (!balances || balances.totalBalance === 0) {
        // Hydrate from localStorage cached balances if available
        if (typeof window !== 'undefined') {
          try {
            const raw =
              localStorage.getItem(`monvera_balances_${user.id}`) ||
              (user.permanentAccountNumber ? localStorage.getItem(`monvera_balances_${user.permanentAccountNumber}`) : null);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && (Number(parsed.totalBalance || 0) > 0 || Number(parsed.checkingBalance || 0) > 0)) {
                balances = parsed;
              }
            }
          } catch {}
        }
      }

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

            if (isNonExistentAccount(profile)) continue;

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
   * Save a WhatsApp Live Chat Message to Firestore, backend API, and local backup
   */
  async saveChatMessage(msg: ChatMessage): Promise<boolean> {
    if (!msg || !msg.userId) return false;
    // 1. Local backup for specific user
    try {
      const localKey = `monvera_chat_${msg.userId}`;
      const existingStr = localStorage.getItem(localKey);
      const list: ChatMessage[] = existingStr ? JSON.parse(existingStr) : [];
      const updated = [...list.filter((m) => m.id !== msg.id), msg];
      localStorage.setItem(localKey, JSON.stringify(updated.slice(-300)));

      // Also append to global admin live messages cache
      const globalKey = 'monvera_all_chat_messages';
      const gRaw = localStorage.getItem(globalKey);
      const gList: ChatMessage[] = gRaw ? JSON.parse(gRaw) : [];
      const gUpdated = [...gList.filter((m) => m.id !== msg.id), msg];
      localStorage.setItem(globalKey, JSON.stringify(gUpdated.slice(-1000)));

      // Instant 0ms cross-tab and cross-component broadcast
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('monvera_chat_update', { detail: msg }));
      }
    } catch {}

    // 2. Server API persistence
    try {
      if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
        fetch('/api/support/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        }).catch(() => {});
      }
    } catch {}

    // 3. Firestore Cloud Persistence
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
   * Permanently update a user's account status (active vs frozen) across Firestore & localStorage
   */
  async updateUserStatus(userId: string, status: 'active' | 'frozen'): Promise<boolean> {
    if (!userId) return false;
    try {
      // 1. Update localStorage accounts directory
      if (typeof window !== 'undefined') {
        const localDirRaw = localStorage.getItem('monvera_accounts_directory');
        if (localDirRaw) {
          const list: UserProfile[] = JSON.parse(localDirRaw);
          const updated = list.map((u) => (u.id === userId || u.email === userId ? { ...u, status } : u));
          localStorage.setItem('monvera_accounts_directory', JSON.stringify(updated));
        }

        // 2. Update persistent frozen accounts registry
        const frozenRaw = localStorage.getItem('monvera_frozen_accounts');
        const frozenSet = new Set<string>(frozenRaw ? JSON.parse(frozenRaw) : []);
        if (status === 'frozen') {
          frozenSet.add(userId);
        } else {
          frozenSet.delete(userId);
        }
        localStorage.setItem('monvera_frozen_accounts', JSON.stringify(Array.from(frozenSet)));

        // 3. Update current user in session if matches
        const currRaw = localStorage.getItem('monvera_current_user');
        if (currRaw) {
          const curr = JSON.parse(currRaw);
          if (curr.id === userId || curr.email === userId) {
            localStorage.setItem('monvera_current_user', JSON.stringify({ ...curr, status }));
          }
        }

        // 4. Notify all components immediately
        window.dispatchEvent(new CustomEvent('monvera_user_status_changed', { detail: { userId, status } }));
      }

      // 5. Update Firestore
      if (db) {
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, { status, statusUpdatedAt: new Date().toISOString() }, { merge: true });
      }
      return true;
    } catch (err) {
      console.error('[FirestoreSync] Failed to update user status:', err);
      return false;
    }
  },

  /**
   * Fetch all WhatsApp Live Chat messages for a user with 3-tier persistence (LocalStorage + Server API + Firestore)
   */
  async getChatMessagesForUser(userId: string): Promise<ChatMessage[]> {
    if (!userId) return [];
    const map = new Map<string, ChatMessage>();

    // 1. Read from localStorage first
    try {
      const localStr = localStorage.getItem(`monvera_chat_${userId}`);
      if (localStr) {
        const localList: ChatMessage[] = JSON.parse(localStr);
        localList.forEach((m) => {
          if (m && m.id) map.set(m.id, m);
        });
      }
    } catch {}

    // 2. Fetch from backend API
    try {
      if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
        const res = await fetch(`/api/support/messages?userId=${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.messages)) {
            data.messages.forEach((m: ChatMessage) => {
              if (m && m.id) map.set(m.id, m);
            });
          }
        }
      }
    } catch {}

    // 3. Fetch from Firestore if available
    if (db) {
      try {
        const msgCol = collection(db, 'support_messages');
        const q = query(msgCol, where('userId', '==', userId));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const item = d.data() as ChatMessage;
          if (item && (item.id || d.id)) {
            map.set(item.id || d.id, item);
          }
        });
      } catch (err) {
        console.warn('[Firestore] Error loading chat messages:', err);
      }
    }

    const merged = Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Save back to local cache
    try {
      localStorage.setItem(`monvera_chat_${userId}`, JSON.stringify(merged));
    } catch {}

    return merged;
  },

  /**
   * Subscribe to real-time WhatsApp Live Chat updates for a user
   */
  subscribeToChatMessages(userId: string, onUpdate: (messages: ChatMessage[]) => void): () => void {
    if (!userId) return () => {};

    // 1. Synchronous 0ms immediate emission from local cache so the user sees past chats instantly
    try {
      const localStr = localStorage.getItem(`monvera_chat_${userId}`);
      if (localStr) {
        const cached: ChatMessage[] = JSON.parse(localStr);
        if (cached && cached.length > 0) {
          onUpdate(cached.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
        }
      }
    } catch {}

    // 2. Async full multi-source refresh
    this.getChatMessagesForUser(userId).then((list) => {
      if (list && list.length > 0) onUpdate(list);
    });

    const handleLocalBroadcast = () => {
      this.getChatMessagesForUser(userId).then(onUpdate);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('monvera_chat_update', handleLocalBroadcast);
      window.addEventListener('storage', handleLocalBroadcast);
    }

    if (!db) {
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('monvera_chat_update', handleLocalBroadcast);
          window.removeEventListener('storage', handleLocalBroadcast);
        }
      };
    }

    try {
      const msgCol = collection(db, 'support_messages');
      const q = query(msgCol, where('userId', '==', userId));
      const unsubscribe = onSnapshot(
        q,
        (snap) => {
          const map = new Map<string, ChatMessage>();
          // Preserve all known local messages
          try {
            const raw = localStorage.getItem(`monvera_chat_${userId}`);
            if (raw) {
              const localList: ChatMessage[] = JSON.parse(raw);
              localList.forEach((m) => {
                if (m && m.id) map.set(m.id, m);
              });
            }
          } catch {}

          // Merge live snapshot messages
          snap.forEach((d) => {
            const item = d.data() as ChatMessage;
            if (item && (item.id || d.id)) {
              map.set(item.id || d.id, item);
            }
          });

          const list = Array.from(map.values()).sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          try {
            localStorage.setItem(`monvera_chat_${userId}`, JSON.stringify(list));
          } catch {}

          onUpdate(list);
        },
        (error) => {
          console.warn('[Firestore live chat subscription notice]:', error);
        }
      );
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('monvera_chat_update', handleLocalBroadcast);
          window.removeEventListener('storage', handleLocalBroadcast);
        }
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    } catch (err) {
      console.warn('[Firestore] Error subscribing to live chat:', err);
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('monvera_chat_update', handleLocalBroadcast);
          window.removeEventListener('storage', handleLocalBroadcast);
        }
      };
    }
  },

  /**
   * Subscribe to ALL WhatsApp Live Chat messages across all customers (For Admin Dashboard)
   */
  subscribeToAllChatMessages(onUpdate: (messages: ChatMessage[]) => void): () => void {
    const getLocalAll = (): ChatMessage[] => {
      try {
        const map = new Map<string, ChatMessage>();
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('monvera_chat_') || key === 'monvera_all_chat_messages')) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const msgs: ChatMessage[] = JSON.parse(raw);
              msgs.forEach((m) => {
                if (m && m.id) map.set(m.id, m);
              });
            }
          }
        }
        return Array.from(map.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      } catch {
        return [];
      }
    };

    const handleLocalBroadcast = () => {
      onUpdate(getLocalAll());
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('monvera_chat_update', handleLocalBroadcast);
      window.addEventListener('storage', handleLocalBroadcast);
    }

    if (!db) {
      onUpdate(getLocalAll());
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('monvera_chat_update', handleLocalBroadcast);
          window.removeEventListener('storage', handleLocalBroadcast);
        }
      };
    }

    try {
      const msgCol = collection(db, 'support_messages');
      const unsubscribe = onSnapshot(
        msgCol,
        (snap) => {
          const map = new Map<string, ChatMessage>();
          // 1. Add local fallback messages
          getLocalAll().forEach((m) => map.set(m.id, m));
          // 2. Add live Firestore docs
          snap.forEach((d) => {
            const m = d.data() as ChatMessage;
            if (m && m.id) map.set(m.id, m);
          });

          const list = Array.from(map.values()).sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          onUpdate(list);
        },
        (error) => {
          console.warn('[Firestore all chat messages subscription note]:', error);
          onUpdate(getLocalAll());
        }
      );
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('monvera_chat_update', handleLocalBroadcast);
          window.removeEventListener('storage', handleLocalBroadcast);
        }
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    } catch (err) {
      console.warn('[Firestore] Error subscribing to all chat messages:', err);
      onUpdate(getLocalAll());
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('monvera_chat_update', handleLocalBroadcast);
          window.removeEventListener('storage', handleLocalBroadcast);
        }
      };
    }
  },

  /**
   * Update real-time typing status in Firestore & Local storage
   */
  async setTypingStatus(userId: string, isTyping: boolean, role: 'user' | 'admin'): Promise<void> {
    if (!userId) return;
    const nowIso = new Date().toISOString();
    try {
      const localKey = `monvera_typing_${userId}`;
      const existing = localStorage.getItem(localKey);
      const parsed = existing ? JSON.parse(existing) : {};
      if (role === 'admin') {
        parsed.adminTyping = isTyping;
        parsed.lastAdminTyping = nowIso;
      } else {
        parsed.userTyping = isTyping;
        parsed.lastUserTyping = nowIso;
      }
      localStorage.setItem(localKey, JSON.stringify(parsed));
    } catch {}

    if (!db) return;
    try {
      const typeRef = doc(db, 'support_typing', userId);
      const payload: Record<string, any> = role === 'admin'
        ? { adminTyping: isTyping, lastAdminTyping: nowIso }
        : { userTyping: isTyping, lastUserTyping: nowIso };
      await setDoc(typeRef, payload, { merge: true });
    } catch (err) {
      // Non-blocking typing update
    }
  },

  /**
   * Subscribe to typing indicators for a specific conversation
   */
  subscribeToTypingStatus(
    userId: string,
    onUpdate: (status: { adminTyping: boolean; userTyping: boolean }) => void
  ): () => void {
    if (!userId) return () => {};

    const checkLocal = () => {
      try {
        const raw = localStorage.getItem(`monvera_typing_${userId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const now = Date.now();
          const lastA = parsed.lastAdminTyping ? new Date(parsed.lastAdminTyping).getTime() : 0;
          const lastU = parsed.lastUserTyping ? new Date(parsed.lastUserTyping).getTime() : 0;
          return {
            adminTyping: Boolean(parsed.adminTyping && now - lastA < 7000),
            userTyping: Boolean(parsed.userTyping && now - lastU < 7000),
          };
        }
      } catch {}
      return { adminTyping: false, userTyping: false };
    };

    if (!db) {
      onUpdate(checkLocal());
      const interval = setInterval(() => onUpdate(checkLocal()), 1500);
      return () => clearInterval(interval);
    }

    try {
      const typeRef = doc(db, 'support_typing', userId);
      const unsubscribe = onSnapshot(
        typeRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const now = Date.now();
            const lastA = data.lastAdminTyping ? new Date(data.lastAdminTyping).getTime() : 0;
            const lastU = data.lastUserTyping ? new Date(data.lastUserTyping).getTime() : 0;
            onUpdate({
              adminTyping: Boolean(data.adminTyping && now - lastA < 7000),
              userTyping: Boolean(data.userTyping && now - lastU < 7000),
            });
          } else {
            onUpdate(checkLocal());
          }
        },
        () => {
          onUpdate(checkLocal());
        }
      );
      return unsubscribe;
    } catch (err) {
      return () => {};
    }
  },

  /**
   * Mark messages as read for a customer conversation
   */
  async markChatMessagesAsRead(userId: string, reader: 'admin' | 'user'): Promise<void> {
    if (!userId) return;
    try {
      const localKey = `monvera_chat_${userId}`;
      const raw = localStorage.getItem(localKey);
      if (raw) {
        const list: ChatMessage[] = JSON.parse(raw);
        const updated = list.map((m) => {
          if (reader === 'admin' && m.sender === 'user') return { ...m, status: 'read' as const };
          if (reader === 'user' && m.sender === 'support') return { ...m, status: 'read' as const };
          return m;
        });
        localStorage.setItem(localKey, JSON.stringify(updated));
      }
    } catch {}

    if (!db) return;
    try {
      const msgCol = collection(db, 'support_messages');
      const targetSender = reader === 'admin' ? 'user' : 'support';
      const q = query(msgCol, where('userId', '==', userId), where('sender', '==', targetSender));
      const snap = await getDocs(q);
      snap.forEach((d) => {
        const data = d.data() as ChatMessage;
        if (data.status !== 'read') {
          setDoc(d.ref, { status: 'read' }, { merge: true }).catch(() => {});
        }
      });
    } catch {}
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

  /**
   * Fetch authenticated user's investments strictly isolated by userId
   */
  async getUserInvestments(userId: string): Promise<InvestmentPlan[]> {
    if (!userId) return [];
    let localList: InvestmentPlan[] = [];
    try {
      const localStr = localStorage.getItem(`monvera_investments_${userId}`);
      if (localStr) localList = JSON.parse(localStr);
    } catch {}

    if (!db) return localList;

    const path = 'investments';
    try {
      const colRef = collection(db, 'investments');
      const q = query(colRef, where('userId', '==', userId));
      const snap = await getDocs(q);
      const list: InvestmentPlan[] = [];
      snap.forEach((d) => {
        const item = d.data() as InvestmentPlan;
        list.push({ ...item, id: item.id || d.id });
      });

      list.sort((a, b) => new Date(b.createdAt || b.startDate).getTime() - new Date(a.createdAt || a.startDate).getTime());
      try {
        localStorage.setItem(`monvera_investments_${userId}`, JSON.stringify(list));
      } catch {}
      return list;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return localList;
    }
  },

  /**
   * Real-time subscription to user's investments
   */
  subscribeToUserInvestments(userId: string, callback: (investments: InvestmentPlan[]) => void): () => void {
    if (!userId || !db) {
      this.getUserInvestments(userId).then(callback);
      return () => {};
    }

    try {
      const colRef = collection(db, 'investments');
      const q = query(colRef, where('userId', '==', userId));
      const unsubscribe = onSnapshot(
        q,
        (snap) => {
          const list: InvestmentPlan[] = [];
          snap.forEach((d) => {
            const item = d.data() as InvestmentPlan;
            list.push({ ...item, id: item.id || d.id });
          });
          list.sort((a, b) => new Date(b.createdAt || b.startDate).getTime() - new Date(a.createdAt || a.startDate).getTime());
          try {
            localStorage.setItem(`monvera_investments_${userId}`, JSON.stringify(list));
          } catch {}
          callback(list);
        },
        (err) => {
          console.warn('[Firestore] Investment subscription note:', err);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn('[Firestore] Investment listener setup error:', err);
      this.getUserInvestments(userId).then(callback);
      return () => {};
    }
  },

  /**
   * Atomic Firestore Term Investment Creation Engine
   * Atomically reads balance, verifies sufficient funds, deducts checking, creates investment & ledger records
   */
  async createTermInvestmentDirect(params: {
    userId: string;
    termDays: InvestmentTermDays;
    amount: number;
    clientRequestId?: string;
    userAccountNumber?: string;
    fallbackBalances?: BalanceMetrics;
    fallbackUser?: any;
  }): Promise<{
    success: boolean;
    investment?: InvestmentPlan;
    balanceMetrics?: BalanceMetrics;
    error?: string;
  }> {
    const { userId, termDays, amount, clientRequestId, fallbackBalances } = params;

    // 1. Validate inputs
    if (!userId) {
      return { success: false, error: 'Customer ID is required.' };
    }

    const validTerms: InvestmentTermDays[] = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
    if (!validTerms.includes(Number(termDays) as InvestmentTermDays)) {
      return {
        success: false,
        error: `Invalid investment term. Supported Monvera terms are 60 to 360 days (${validTerms.join(', ')} days).`,
      };
    }

    const principal = Number(amount);
    if (isNaN(principal) || principal < 100) {
      return { success: false, error: 'Minimum term investment amount is $100.00.' };
    }

    // 2. Authentication check: if Firebase Auth user is present, ensure identity matches
    if (auth?.currentUser && auth.currentUser.uid !== userId) {
      return { success: false, error: 'Unauthorized: User identity does not match authenticated credentials.' };
    }

    // 3. Idempotency / Double-investment prevention (INVESTMENT FIX #4)
    const idempotencyKey = clientRequestId || `inv_req_${userId}_${termDays}_${principal}_${Math.floor(Date.now() / 15000)}`;
    if (inFlightInvestmentLocks.has(idempotencyKey)) {
      return { success: false, error: 'An investment request is already processing. Please wait.' };
    }
    inFlightInvestmentLocks.add(idempotencyKey);

    try {
      if (!db) {
        throw new Error('Firestore database instance is not available.');
      }

      const accRef = doc(db, 'accounts', userId);
      const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const invRef = doc(db, 'investments', invId);

      const txId = `tx_inv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const txRef = doc(db, 'transactions', txId);

      const notifId = `notif_inv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const notifRef = doc(db, 'notifications', notifId);

      // Financial calculations (Fixed 4.50% interest every 24 hours across 60-360 days)
      const fixedDailyRate = 4.5;
      const expectedYield = Number((principal * (fixedDailyRate / 100) * termDays).toFixed(2));
      const expectedMaturityValue = Number((principal + expectedYield).toFixed(2));
      const nowIso = new Date().toISOString();
      const maturityIso = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000).toISOString();

      const newPlan: InvestmentPlan = {
        id: invId,
        userId,
        planName: `Monvera ${termDays}-Day Term Investment`,
        termDays: Number(termDays) as InvestmentTermDays,
        amount: principal,
        apy: 4.5,
        dailyRate: fixedDailyRate,
        expectedYield,
        expectedMaturityValue,
        totalAccruedEarnings: 0,
        startDate: nowIso,
        maturityDate: maturityIso,
        status: 'ACTIVE',
        createdAt: nowIso,
      };

      const newTx: Transaction = {
        id: txId,
        referenceNumber: `MV-INV-${Math.floor(100000000 + Math.random() * 900000000)}`,
        type: 'INVESTMENT',
        amount: principal,
        currency: 'USD',
        status: 'COMPLETED',
        userId,
        senderUserId: userId,
        recipientUserId: userId,
        fee: 0.0,
        description: `Funded ${termDays}-Day Term Investment (4.50% interest / 24h)`,
        category: 'Investments',
        createdAt: nowIso,
        metadata: {
          investmentId: invId,
          termDays,
          dailyRate: fixedDailyRate,
          expectedYield,
          expectedMaturityValue,
        },
      };

      const newNotif: NotificationItem = {
        id: notifId,
        userId,
        title: 'Term Investment Activated',
        message: `Your $${principal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })} ${termDays}-Day term investment is now active and earning 4.50% interest every 24 hours.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: nowIso,
        referenceId: newTx.referenceNumber,
      };

      let updatedMetrics: BalanceMetrics | null = null;

      // ATOMIC TRANSACTION: Read authoritative balance, deduct, write investment & transaction
      await runTransaction(db, async (transaction) => {
        const accSnap = await transaction.get(accRef);
        let currentChecking = 0;
        let currentSavings = 0;
        let currentInvested = 0;
        let currentAccrued = 0;
        let existingAccountsList: any[] = [];

        if (accSnap.exists()) {
          const accData = accSnap.data();
          currentChecking = Number(accData.checkingBalance ?? accData.availableBalance ?? 0);
          currentSavings = Number(accData.savingsBalance ?? accData.savings ?? 0);
          currentInvested = Number(accData.investedBalance ?? accData.investmentBalance ?? 0);
          currentAccrued = Number(accData.accruedEarnings ?? 0);
          if (Array.isArray(accData.accounts)) {
            existingAccountsList = accData.accounts;
          }
        } else {
          const cached = fallbackBalances || (typeof window !== 'undefined' ? JSON.parse(localStorage.getItem(`monvera_balances_${userId}`) || 'null') : null);
          if (cached) {
            currentChecking = Number(cached.checkingBalance ?? cached.availableBalance ?? 0);
            currentSavings = Number(cached.savingsBalance ?? 0);
            currentInvested = Number(cached.investedBalance ?? 0);
            currentAccrued = Number(cached.accruedEarnings ?? 0);
            if (Array.isArray(cached.accounts)) {
              existingAccountsList = cached.accounts;
            }
          }
        }

        // Validate sufficient checking balance
        if (currentChecking < principal) {
          throw new Error(
            `Insufficient available checking balance ($${currentChecking.toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}). Please deposit or transfer funds to checking first.`
          );
        }

        const newChecking = Number((currentChecking - principal).toFixed(2));
        const newInvested = Number((currentInvested + principal).toFixed(2));
        const newTotal = Number((newChecking + currentSavings + newInvested + currentAccrued).toFixed(2));

        const updatedAccounts =
          existingAccountsList.length > 0
            ? existingAccountsList.map((a) => {
                if (a.type === 'CHECKING') {
                  return { ...a, balance: newChecking, availableBalance: newChecking };
                }
                if (a.type === 'INVESTMENT') {
                  return { ...a, balance: newInvested, investedBalance: newInvested };
                }
                return a;
              })
            : [
                {
                  id: `acc_chk_${userId}`,
                  userId,
                  type: 'CHECKING',
                  accountNumber: '1000000000',
                  routingNumber: '021000021',
                  currency: 'USD',
                  balance: newChecking,
                  availableBalance: newChecking,
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
                  accountNumber: '1000000991',
                  routingNumber: '021000021',
                  currency: 'USD',
                  balance: currentSavings,
                  availableBalance: currentSavings,
                  investedBalance: 0,
                  pendingBalance: 0,
                  interestRateAPY: 4.85,
                  status: 'ACTIVE',
                  nickname: 'Monvera High-Yield Treasury',
                },
              ];

        updatedMetrics = {
          checkingBalance: newChecking,
          savingsBalance: currentSavings,
          investedBalance: newInvested,
          accruedEarnings: currentAccrued,
          totalBalance: newTotal,
          availableBalance: newChecking,
          pendingBalance: 0,
          accounts: updatedAccounts,
        };

        // Writes inside transaction
        transaction.set(
          accRef,
          {
            userId,
            ...updatedMetrics,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(invRef, newPlan);
        transaction.set(txRef, newTx);
        transaction.set(notifRef, newNotif);
      });

      // Update local storage caches for fast UI response
      if (updatedMetrics) {
        try {
          localStorage.setItem(`monvera_balances_${userId}`, JSON.stringify(updatedMetrics));
          const currentInvs = await this.getUserInvestments(userId);
          const updatedInvs = [newPlan, ...currentInvs.filter((i) => i.id !== invId)];
          localStorage.setItem(`monvera_investments_${userId}`, JSON.stringify(updatedInvs));
        } catch {}
      }

      return {
        success: true,
        investment: newPlan,
        balanceMetrics: updatedMetrics || undefined,
      };
    } catch (err: any) {
      console.error('[Firestore] Investment creation error:', err);
      return {
        success: false,
        error: err?.message || 'Failed to create term investment.',
      };
    } finally {
      // Clear in-flight lock after a short delay
      setTimeout(() => inFlightInvestmentLocks.delete(idempotencyKey), 4000);
    }
  },

  /**
   * Atomic Firestore Term Investment Maturity Engine
   * Verifies status, calculates total maturity payout (principal + expectedYield), credits checking, marks matured
   */
  async matureInvestmentDirect(
    investmentId: string,
    userId: string
  ): Promise<{
    success: boolean;
    investment?: InvestmentPlan;
    payoutAmount?: number;
    balanceMetrics?: BalanceMetrics;
    error?: string;
  }> {
    if (!investmentId || !userId) {
      return { success: false, error: 'Investment ID and User ID are required.' };
    }

    if (!db) {
      return { success: false, error: 'Firestore database instance is not available.' };
    }

    const invRef = doc(db, 'investments', investmentId);
    const accRef = doc(db, 'accounts', userId);

    const txId = `tx_mat_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const txRef = doc(db, 'transactions', txId);

    const notifId = `notif_mat_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const notifRef = doc(db, 'notifications', notifId);

    let updatedInv: InvestmentPlan | null = null;
    let payoutTotal = 0;
    let updatedMetrics: BalanceMetrics | null = null;
    const nowIso = new Date().toISOString();

    try {
      await runTransaction(db, async (transaction) => {
        const invSnap = await transaction.get(invRef);
        if (!invSnap.exists()) {
          throw new Error('Investment record not found.');
        }

        const inv = invSnap.data() as InvestmentPlan;
        if (inv.userId !== userId) {
          throw new Error('Unauthorized: Investment does not belong to this account.');
        }
        if (inv.status === 'MATURED') {
          throw new Error('Investment is already matured and settled.');
        }

        payoutTotal = inv.expectedMaturityValue || Number((inv.amount + (inv.expectedYield || 0)).toFixed(2));

        const accSnap = await transaction.get(accRef);
        let currentChecking = 0;
        let currentSavings = 0;
        let currentInvested = 0;
        let currentAccrued = 0;
        let existingAccountsList: any[] = [];

        if (accSnap.exists()) {
          const accData = accSnap.data();
          currentChecking = Number(accData.checkingBalance ?? accData.availableBalance ?? 0);
          currentSavings = Number(accData.savingsBalance ?? accData.savings ?? 0);
          currentInvested = Number(accData.investedBalance ?? accData.investmentBalance ?? 0);
          currentAccrued = Number(accData.accruedEarnings ?? 0);
          if (Array.isArray(accData.accounts)) {
            existingAccountsList = accData.accounts;
          }
        }

        const newChecking = Number((currentChecking + payoutTotal).toFixed(2));
        const newInvested = Number(Math.max(0, currentInvested - inv.amount).toFixed(2));
        const newTotal = Number((newChecking + currentSavings + newInvested + currentAccrued).toFixed(2));

        updatedMetrics = {
          checkingBalance: newChecking,
          savingsBalance: currentSavings,
          investedBalance: newInvested,
          accruedEarnings: currentAccrued,
          totalBalance: newTotal,
          availableBalance: newChecking,
          pendingBalance: 0,
          accounts: existingAccountsList.map((a) => {
            if (a.type === 'CHECKING') return { ...a, balance: newChecking, availableBalance: newChecking };
            if (a.type === 'INVESTMENT') return { ...a, balance: newInvested, investedBalance: newInvested };
            return a;
          }),
        };

        updatedInv = {
          ...inv,
          status: 'MATURED',
          totalAccruedEarnings: inv.expectedYield,
        };

        const maturityTx: Transaction = {
          id: txId,
          referenceNumber: `MV-MAT-${Math.floor(100000000 + Math.random() * 900000000)}`,
          type: 'INVESTMENT',
          amount: payoutTotal,
          currency: 'USD',
          status: 'COMPLETED',
          userId,
          senderUserId: userId,
          recipientUserId: userId,
          fee: 0.0,
          description: `Maturity Settlement: ${inv.planName} (Principal $${inv.amount.toFixed(2)} + Yield $${inv.expectedYield.toFixed(2)})`,
          category: 'Investments',
          createdAt: nowIso,
          metadata: {
            investmentId: inv.id,
            principal: inv.amount,
            yield: inv.expectedYield,
            payoutAmount: payoutTotal,
          },
        };

        const maturityNotif: NotificationItem = {
          id: notifId,
          userId,
          title: 'Investment Matured & Settled',
          message: `Your ${inv.termDays}-Day term investment matured! $${payoutTotal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })} has been credited to your Checking account.`,
          type: 'TRANSACTION',
          severity: 'success',
          read: false,
          createdAt: nowIso,
          referenceId: maturityTx.referenceNumber,
        };

        transaction.set(accRef, { userId, ...updatedMetrics, updatedAt: nowIso }, { merge: true });
        transaction.set(invRef, updatedInv, { merge: true });
        transaction.set(txRef, maturityTx);
        transaction.set(notifRef, maturityNotif);
      });

      if (updatedMetrics) {
        try {
          localStorage.setItem(`monvera_balances_${userId}`, JSON.stringify(updatedMetrics));
        } catch {}
      }

      return {
        success: true,
        investment: updatedInv || undefined,
        payoutAmount: payoutTotal,
        balanceMetrics: updatedMetrics || undefined,
      };
    } catch (err: any) {
      console.error('[Firestore] Investment maturity error:', err);
      return {
        success: false,
        error: err?.message || 'Failed to settle matured investment.',
      };
    }
  },

  /**
   * --- CARD PERSISTENCE & ATOMIC ISSUANCE ENGINE ---
   */
  async getUserCards(userId: string): Promise<CardItem[]> {
    if (!userId) return [];
    let localCards: CardItem[] = [];
    try {
      const raw = localStorage.getItem(`monvera_cards_${userId}`);
      if (raw) localCards = JSON.parse(raw);
    } catch {}

    if (!db) return localCards;

    try {
      const cardCol = collection(db, 'cards');
      const q = query(cardCol, where('userId', '==', userId));
      const snap = await getDocs(q);
      const fsCards: CardItem[] = [];
      snap.forEach((d) => {
        fsCards.push(d.data() as CardItem);
      });

      const map = new Map<string, CardItem>();
      localCards.forEach((c) => {
        if (c && c.id) map.set(c.id, c);
      });
      fsCards.forEach((c) => {
        if (c && c.id) map.set(c.id, c);
      });
      const merged = Array.from(map.values());
      try {
        localStorage.setItem(`monvera_cards_${userId}`, JSON.stringify(merged));
      } catch {}
      return merged;
    } catch (err) {
      console.warn('[Firestore] Error fetching user cards:', err);
      return localCards;
    }
  },

  async toggleCardFreezeDirect(cardId: string, userId?: string): Promise<{ success: boolean; card?: CardItem; error?: string }> {
    let targetCard: CardItem | null = null;
    if (userId) {
      const userCards = await this.getUserCards(userId);
      targetCard = userCards.find((c) => c.id === cardId) || null;
    }

    if (!targetCard && db) {
      try {
        const snap = await getDoc(doc(db, 'cards', cardId));
        if (snap.exists()) targetCard = snap.data() as CardItem;
      } catch {}
    }

    if (!targetCard) return { success: false, error: 'Card not found.' };

    const newStatus: 'ACTIVE' | 'FROZEN' = targetCard.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';
    const updatedCard: CardItem = { ...targetCard, status: newStatus };

    await this.saveCard(updatedCard);

    const notif: NotificationItem = {
      id: `notif_card_toggle_${Date.now()}`,
      userId: targetCard.userId,
      title: `Card ${newStatus === 'FROZEN' ? 'Frozen' : 'Reactivated'}`,
      message: `Your ${targetCard.cardTier} (•••• ${targetCard.maskedNumber.slice(-4)}) has been ${
        newStatus === 'FROZEN' ? 'locked' : 'unlocked'
      }.`,
      type: 'SECURITY',
      severity: newStatus === 'FROZEN' ? 'warning' : 'success',
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.saveNotification(notif).catch(() => {});

    return { success: true, card: updatedCard };
  },

  async updateCardLimitsDirect(
    cardId: string,
    updates: {
      dailyLimit?: number;
      monthlyLimit?: number;
      international?: boolean;
      online?: boolean;
      atm?: boolean;
    },
    userId?: string
  ): Promise<{ success: boolean; card?: CardItem; error?: string }> {
    let targetCard: CardItem | null = null;
    if (userId) {
      const userCards = await this.getUserCards(userId);
      targetCard = userCards.find((c) => c.id === cardId) || null;
    }

    if (!targetCard && db) {
      try {
        const snap = await getDoc(doc(db, 'cards', cardId));
        if (snap.exists()) targetCard = snap.data() as CardItem;
      } catch {}
    }

    if (!targetCard) return { success: false, error: 'Card not found.' };

    const updatedCard: CardItem = {
      ...targetCard,
      spendingLimitDaily: updates.dailyLimit !== undefined ? updates.dailyLimit : targetCard.spendingLimitDaily,
      spendingLimitMonthly: updates.monthlyLimit !== undefined ? updates.monthlyLimit : targetCard.spendingLimitMonthly,
      internationalEnabled: updates.international !== undefined ? updates.international : targetCard.internationalEnabled,
      onlineEnabled: updates.online !== undefined ? updates.online : targetCard.onlineEnabled,
      atmEnabled: updates.atm !== undefined ? updates.atm : targetCard.atmEnabled,
    };

    await this.saveCard(updatedCard);
    return { success: true, card: updatedCard };
  },

  async createCardDirect(params: {
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
    fallbackBalances?: BalanceMetrics;
    fallbackUser?: any;
  }): Promise<{
    success: boolean;
    card?: CardItem;
    transaction?: Transaction;
    balanceMetrics?: BalanceMetrics;
    error?: string;
  }> {
    const { userId } = params;
    if (!userId) return { success: false, error: 'User ID is required.' };

    const issuanceFee = 2.0; // $2.00 card fee

    // Generate valid 16-digit card number
    const brand = params.brand || (params.cardTier?.toLowerCase().includes('mastercard') ? 'MASTERCARD' : 'VISA');
    const prefix = brand === 'MASTERCARD' ? '5' : '4';
    const part1 = prefix + Math.floor(100 + Math.random() * 900);
    const part2 = Math.floor(1000 + Math.random() * 9000).toString();
    const part3 = Math.floor(1000 + Math.random() * 9000).toString();
    const part4 = Math.floor(1000 + Math.random() * 9000).toString();
    const completeNumber = `${part1} ${part2} ${part3} ${part4}`;
    const maskedNumber = `•••• •••• •••• ${part4}`;

    const now = new Date();
    const expMonth = String(now.getMonth() + 1).padStart(2, '0');
    const expYear = String((now.getFullYear() + 5) % 100).padStart(2, '0');
    const expiryDate = `${expMonth}/${expYear}`;
    const cvv = String(Math.floor(100 + Math.random() * 900));

    const cardId = `crd_${userId}_${Date.now()}`;
    const holderName = (params.cardHolderName || 'VALUED CUSTOMER').toUpperCase().trim();
    const dailyLimit = params.spendingLimitDaily || 20000;
    const monthlyLimit = params.spendingLimitMonthly || 20000;
    const brandName = brand === 'MASTERCARD' ? 'Mastercard' : 'Visa';
    const defaultTier = params.cardTier || `Monvera ${brandName} Elite`;

    const newCard: CardItem = {
      id: cardId,
      userId,
      cardHolderName: holderName,
      cardNumber: completeNumber,
      maskedNumber,
      fullNumberMasked: completeNumber,
      expiryDate,
      cvvMasked: cvv,
      cardType: params.cardType || 'PHYSICAL',
      cardTier: defaultTier,
      brand,
      status: 'ACTIVE',
      spendingLimitDaily: dailyLimit,
      spendingLimitMonthly: monthlyLimit,
      currentDailySpend: 0,
      internationalEnabled: true,
      onlineEnabled: true,
      atmEnabled: true,
      contactlessEnabled: true,
      colorScheme: (params.colorScheme as any) || 'obsidian',
    };

    const nowIso = new Date().toISOString();
    const txId = `tx_card_fee_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cardFeeTx: Transaction = {
      id: txId,
      referenceNumber: `MV-CRD-${Math.floor(100000000 + Math.random() * 900000000)}`,
      type: 'FEE',
      amount: issuanceFee,
      currency: 'USD',
      status: 'COMPLETED',
      userId,
      senderUserId: userId,
      fee: 0,
      description: `Monvera ${brandName} Card Issuance Fee ($2.00)`,
      category: 'Transfers',
      createdAt: nowIso,
      metadata: { cardId, brand, cardTier: defaultTier },
    };

    const cardNotif: NotificationItem = {
      id: `notif_${Date.now()}_card_created`,
      userId,
      title: `${brandName} Card Issued & Activated`,
      message: `Your new ${newCard.cardTier} (${brandName} • ${completeNumber}) has been successfully created and linked with a $${dailyLimit.toLocaleString()} daily transaction limit. $2.00 card creation fee deducted.`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: nowIso,
      referenceId: cardFeeTx.referenceNumber,
    };

    if (db) {
      try {
        let updatedMetrics: BalanceMetrics | null = null;
        await runTransaction(db, async (transaction) => {
          const accRef = doc(db, 'accounts', userId);
          const accSnap = await transaction.get(accRef);

          let currentChecking = 0;
          let currentSavings = 0;
          let currentInvested = 0;
          let currentAccrued = 0;
          let currentTotal = 0;
          let accountsList: any[] = [];

          if (accSnap.exists()) {
            const data = accSnap.data();
            currentChecking = Number(data.checkingBalance) || 0;
            currentSavings = Number(data.savingsBalance) || 0;
            currentInvested = Number(data.investedBalance) || 0;
            currentAccrued = Number(data.accruedEarnings) || 0;
            currentTotal = Number(data.totalBalance) || 0;
            accountsList = Array.isArray(data.accounts) ? data.accounts : [];
          } else {
            const cached = params.fallbackBalances || (typeof window !== 'undefined' ? JSON.parse(localStorage.getItem(`monvera_balances_${userId}`) || 'null') : null);
            if (cached) {
              currentChecking = Number(cached.checkingBalance) || 0;
              currentSavings = Number(cached.savingsBalance) || 0;
              currentInvested = Number(cached.investedBalance) || 0;
              currentAccrued = Number(cached.accruedEarnings) || 0;
              currentTotal = Number(cached.totalBalance) || 0;
              accountsList = Array.isArray(cached.accounts) ? cached.accounts : [];
            }
          }

          if (currentChecking < issuanceFee) {
            throw new Error(
              `Insufficient funds. You have $${currentChecking.toFixed(
                2
              )} in checking, but a $${issuanceFee.toFixed(2)} card creation fee is required. Please deposit funds first.`
            );
          }

          const newChecking = Number((currentChecking - issuanceFee).toFixed(2));
          const newTotal = Number((currentTotal - issuanceFee).toFixed(2));

          const updatedAccounts = accountsList.map((a: any) => {
            if (a.type === 'CHECKING') {
              return {
                ...a,
                balance: newChecking,
                availableBalance: newChecking,
              };
            }
            return a;
          });

          updatedMetrics = {
            checkingBalance: newChecking,
            savingsBalance: currentSavings,
            investedBalance: currentInvested,
            accruedEarnings: currentAccrued,
            totalBalance: newTotal,
            availableBalance: newChecking,
            pendingBalance: 0,
            accounts: updatedAccounts,
          };

          const cardRef = doc(db, 'cards', cardId);
          const txRef = doc(db, 'transactions', txId);
          const notifRef = doc(db, 'notifications', cardNotif.id);

          transaction.set(accRef, { userId, ...updatedMetrics, updatedAt: nowIso }, { merge: true });
          transaction.set(cardRef, newCard);
          transaction.set(txRef, cardFeeTx);
          transaction.set(notifRef, cardNotif);
        });

        if (updatedMetrics) {
          try {
            localStorage.setItem(`monvera_balances_${userId}`, JSON.stringify(updatedMetrics));
          } catch {}
        }
        await this.saveCard(newCard);

        return {
          success: true,
          card: newCard,
          transaction: cardFeeTx,
          balanceMetrics: updatedMetrics || undefined,
        };
      } catch (err: any) {
        console.error('[Firestore] Card creation transaction error:', err);
        return {
          success: false,
          error: err?.message || 'Failed to issue card.',
        };
      }
    }

    await this.saveCard(newCard);
    return {
      success: true,
      card: newCard,
      transaction: cardFeeTx,
    };
  },
};
