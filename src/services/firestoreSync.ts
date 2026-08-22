import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { UserProfile, Transaction, InvestmentPlan, CardItem, NotificationItem } from '../types';

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
        permanentAccountNumber: profileData.permanentAccountNumber || '',
        username: profileData.username || (profileData.email ? profileData.email.split('@')[0] : `user_${uid.slice(0, 6)}`),
        role: profileData.role || 'customer',
        status: profileData.status || 'active',
        kycStatus: profileData.kycStatus || 'unverified',
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

      console.log(`[Firestore] Writing customer profile to ${path}...`, payload);
      await setDoc(userRef, payload, { merge: true });
      console.log(`[Firestore] Profile written successfully for UID: ${uid} in users/${uid}`);
      return { success: true };
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
      const code = err?.code || 'unknown';
      const message = err?.message || String(err);
      console.error(`[Firestore Write Failed] users/${uid}: [${code}] ${message}`);
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
          emailVerified: data.emailVerified ?? false,
          kycDocumentType: data.kycDocumentType,
          kycDocumentNumber: data.kycDocumentNumber,
          kycSubmittedAt: data.kycSubmittedAt,
          kycVerifiedAt: data.kycVerifiedAt,
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
};
