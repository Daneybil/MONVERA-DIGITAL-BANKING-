import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { UserProfile, Transaction, InvestmentPlan, CardItem, NotificationItem } from '../types';
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
        kycFirstName: profileData.kycFirstName || profileData.firstName || '',
        kycLastName: profileData.kycLastName || profileData.lastName || '',
        kycCountry: profileData.kycCountry || profileData.country || 'United States',
        kycDocumentType: profileData.kycDocumentType || '',
        kycDocumentNumber: profileData.kycDocumentNumber || '',
        kycDocumentImage: profileData.kycDocumentImage || '',
        kycLiveSelfieImage: profileData.kycLiveSelfieImage || '',
        kycStreetAddress: profileData.kycStreetAddress || profileData.address || '',
        kycProofOfAddressImage: profileData.kycProofOfAddressImage || '',
        kycSsn: profileData.kycSsn || '',
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
          kycFirstName: data.kycFirstName,
          kycLastName: data.kycLastName,
          kycCountry: data.kycCountry,
          kycDocumentType: data.kycDocumentType,
          kycDocumentNumber: data.kycDocumentNumber,
          kycDocumentImage: data.kycDocumentImage,
          kycLiveSelfieImage: data.kycLiveSelfieImage,
          kycStreetAddress: data.kycStreetAddress,
          kycProofOfAddressImage: data.kycProofOfAddressImage,
          kycSsn: data.kycSsn,
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
   * Save Transaction into Firestore ledger
   */
  async saveTransaction(tx: Transaction): Promise<boolean> {
    if (!db) return false;
    const path = `transactions/${tx.id}`;
    try {
      const txRef = doc(db, 'transactions', tx.id);
      await setDoc(txRef, {
        ...tx,
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return false;
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
   * Save and update permanent user account balances in Firestore under accounts/{userId}
   */
  async saveAccountBalances(userId: string, balances: BalanceMetrics): Promise<boolean> {
    if (!db || !userId) return false;
    const path = `accounts/${userId}`;
    try {
      const accRef = doc(db, 'accounts', userId);
      await setDoc(accRef, {
        userId,
        ...balances,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return false;
    }
  },

  /**
   * Fetch permanent user account balances from Firestore
   */
  async getAccountBalances(userId: string): Promise<BalanceMetrics | null> {
    if (!db || !userId) return null;
    const path = `accounts/${userId}`;
    try {
      const accRef = doc(db, 'accounts', userId);
      const snap = await getDoc(accRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          checkingBalance: Number(data.checkingBalance ?? 0),
          savingsBalance: Number(data.savingsBalance ?? 0),
          investedBalance: Number(data.investedBalance ?? 0),
          accruedEarnings: Number(data.accruedEarnings ?? 0),
          totalBalance: Number(data.totalBalance ?? (Number(data.checkingBalance ?? 0) + Number(data.savingsBalance ?? 0) + Number(data.investedBalance ?? 0))),
          availableBalance: Number(data.availableBalance ?? Number(data.checkingBalance ?? 0)),
          pendingBalance: Number(data.pendingBalance ?? 0),
          accounts: data.accounts || [],
        };
      }
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return null;
    }
  },

  /**
   * Fetch user's permanent transactions from Firestore
   */
  async getTransactionsForUser(userId: string): Promise<Transaction[]> {
    if (!db || !userId) return [];
    const path = 'transactions';
    try {
      const txCol = collection(db, 'transactions');
      const q = query(txCol, where('senderUserId', '==', userId));
      const snap = await getDocs(q);
      const txs: Transaction[] = [];
      snap.forEach((d) => {
        txs.push(d.data() as Transaction);
      });
      return txs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return [];
    }
  },

  /**
   * Search for any Monvera recipient across all fields (username, account number, email, user ID)
   */
  async findRecipient(identifier: string): Promise<UserProfile | null> {
    if (!db || !identifier) return null;
    const raw = identifier.trim();
    const cleanNoAt = raw.replace(/^@/, '').trim();
    const cleanDigits = cleanNoAt.replace(/[-\s]/g, '');
    const cleanLower = cleanNoAt.toLowerCase();

    const usersCol = collection(db, 'users');

    try {
      // 1. Direct indexed queries for rapid matching
      const queryList = [
        query(usersCol, where('permanentAccountNumber', '==', cleanDigits)),
        query(usersCol, where('accountNumber', '==', cleanDigits)),
        query(usersCol, where('usernameLower', '==', cleanLower)),
        query(usersCol, where('username', '==', cleanNoAt)),
        query(usersCol, where('username', '==', cleanLower)),
        query(usersCol, where('email', '==', cleanLower)),
      ];

      for (const q of queryList) {
        const snap = await getDocs(q);
        if (!snap.empty) {
          const docData = snap.docs[0].data() as UserProfile;
          return {
            id: snap.docs[0].id || docData.id,
            ...docData,
          };
        }
      }

      // Check direct document ID lookup
      if (raw.length >= 8) {
        const directDoc = await getDoc(doc(db, 'users', raw));
        if (directDoc.exists()) {
          return { id: directDoc.id, ...directDoc.data() } as UserProfile;
        }
      }

      // 2. Comprehensive resilient fallback: scan users collection to match any case-insensitive field
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

      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
      return null;
    }
  },
};
