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
   * Fetch user's permanent transactions from Firestore (both sent and received)
   */
  async getTransactionsForUser(userId: string): Promise<Transaction[]> {
    if (!db || !userId) return [];
    const path = 'transactions';
    try {
      const txCol = collection(db, 'transactions');
      const qSender = query(txCol, where('senderUserId', '==', userId));
      const qRecipient = query(txCol, where('recipientUserId', '==', userId));

      const [snapSender, snapRecipient] = await Promise.all([
        getDocs(qSender),
        getDocs(qRecipient).catch(() => ({ forEach: () => {} } as any)),
      ]);

      const txMap = new Map<string, Transaction>();
      snapSender.forEach((d: any) => {
        const data = d.data() as Transaction;
        txMap.set(data.id || d.id, data);
      });
      if (snapRecipient && typeof snapRecipient.forEach === 'function') {
        snapRecipient.forEach((d: any) => {
          const data = d.data() as Transaction;
          txMap.set(data.id || d.id, data);
        });
      }

      return Array.from(txMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
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

            const balances = await this.getAccountBalances(uid);
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
};
