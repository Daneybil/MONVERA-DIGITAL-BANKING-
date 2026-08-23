import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { firestoreSync } from '../services/firestoreSync';
import { UserProfile, NotificationItem } from '../types';
import { api, BalanceMetrics } from '../services/api';

export type AppView =
  | 'home'
  | 'login'
  | 'signup'
  | 'offers'
  | 'how-it-works'
  | 'privacy'
  | 'terms'
  | 'security-protocol'
  | 'dashboard'
  | 'accounts'
  | 'transactions'
  | 'send'
  | 'receive'
  | 'deposit'
  | 'withdraw'
  | 'investments'
  | 'cards'
  | 'security'
  | 'profile'
  | 'business'
  | 'admin';

interface AuthContextType {
  currentUser: UserProfile | null;
  balanceMetrics: BalanceMetrics | null;
  isLoading: boolean;
  availableUsers: UserProfile[];
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  notifications: NotificationItem[];
  unreadNotifsCount: number;
  login: (identifier: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  switchUser: (userId: string) => Promise<void>;
  registerUser: (data: {
    fullName?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    age?: string;
    country?: string;
    maritalStatus?: string;
    address?: string;
    taxId?: string;
    password?: string;
    isBusiness?: boolean;
    businessName?: string;
    username?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  refreshBalance: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  replyToSupport: (notificationId: string, message: string) => Promise<{ success: boolean; error?: string }>;
  updateUser: (user: UserProfile) => void;
  resendVerificationEmail: () => Promise<{ success: boolean; message?: string; error?: string }>;
  checkEmailVerification: () => Promise<boolean>;
  sendPasswordReset: (emailOrIdentifier: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  lastUpdateTimestamp: number;
  // Quick Action Modal Triggers
  activeModal: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_prompt' | 'auth_login' | 'auth_register' | null;
  openModal: (modal: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_prompt' | 'auth_login' | 'auth_register' | null) => void;
  closeModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getFirebaseErrorMessage(err: any): string {
  const code = err?.code || '';
  const message = err?.message || '';

  if (code === 'auth/email-already-in-use') {
    return 'This email is already registered. Please log in.';
  }
  if (code === 'auth/invalid-email') {
    return 'Please enter a valid email address.';
  }
  if (code === 'auth/weak-password') {
    return 'Password is too weak. Please use at least 6 characters.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
    return 'Invalid credentials. Please verify your email and password.';
  }
  if (code === 'auth/user-disabled') {
    return 'This Monvera account has been disabled. Please contact customer support.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed attempts. Access is temporarily locked. Please try again in a few minutes.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password authentication is not enabled in Firebase. Please enable it in Firebase Console under Authentication → Sign-in method → Email/Password.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network connection failed. Please check your internet connection and try again.';
  }
  if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
    return 'Database permission error. Please verify your Firestore security rules for this account.';
  }
  if (message) {
    return message.replace(/^Firebase:\s*/, '');
  }
  return 'An unexpected authentication error occurred. Please try again.';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [balanceMetrics, setBalanceMetrics] = useState<BalanceMetrics | null>(null);
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([]);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number>(Date.now());
  const [activeModal, setActiveModal] = useState<'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_prompt' | 'auth_login' | 'auth_register' | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await api.getUsers();
      if (res.users) {
        setAvailableUsers(res.users);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!currentUser) return;
    try {
      const metrics = await api.getBalanceMetrics(currentUser.id);
      if (metrics && metrics.accounts) {
        setBalanceMetrics(metrics);
        setLastUpdateTimestamp(Date.now());
      }
    } catch (err) {
      console.error('Failed to refresh balance:', err);
    }
  }, [currentUser]);

  const refreshNotifications = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.getNotifications(currentUser.id);
      if (res.notifications) {
        setNotifications(res.notifications);
        setLastUpdateTimestamp(Date.now());
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [currentUser]);

  // Real-time synchronization interval (every 4 seconds for instant reflection)
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      refreshBalance();
      refreshNotifications();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser, refreshBalance, refreshNotifications]);

  const getPersistedAvatar = (userId: string, defaultAvatar?: string) => {
    try {
      const stored = localStorage.getItem(`monvera_user_avatar_${userId}`);
      if (stored) return stored;
    } catch {
      // localStorage fallback
    }
    return defaultAvatar;
  };

  const switchUser = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      // Check if user exists in Firestore
      let userProfile = await firestoreSync.getUserProfile(userId);
      if (!userProfile) {
        const res = await api.getCurrentUser(userId);
        if (res.user) {
          userProfile = res.user;
        }
      }

      if (userProfile) {
        const persistedAvatar = getPersistedAvatar(userProfile.id, userProfile.avatarUrl);
        const resolvedUser = { ...userProfile, avatarUrl: persistedAvatar };
        setCurrentUser(resolvedUser);

        // Fetch balance metrics
        const res = await api.getCurrentUser(resolvedUser.id);
        if (res.balanceMetrics) {
          setBalanceMetrics(res.balanceMetrics);
        }
        const notifRes = await api.getNotifications(resolvedUser.id);
        if (notifRes.notifications) setNotifications(notifRes.notifications);
      }
    } catch (err) {
      console.error('Error switching user:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Firebase Auth State Listener & Initial Setup
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!isMounted) return;

      if (firebaseUser) {
        try {
          console.log('[Auth] Authenticated Firebase user detected:', firebaseUser.uid);
          let userProfile = await firestoreSync.getUserProfile(firebaseUser.uid);

          if (!userProfile) {
            // If user signed in but doc not yet synced, try api or fallback
            const res = await api.getCurrentUser(firebaseUser.uid);
            if (res.user) userProfile = res.user;
          }

          if (userProfile && isMounted) {
            const persistedAvatar = getPersistedAvatar(userProfile.id, userProfile.avatarUrl);
            const isEmailVerified = !!firebaseUser.emailVerified;
            const resolvedUser = { ...userProfile, emailVerified: isEmailVerified, avatarUrl: persistedAvatar };
            setCurrentUser(resolvedUser);

            // If email verification status changed in Firebase Auth, sync to Firestore
            if (userProfile.emailVerified !== isEmailVerified) {
              firestoreSync.saveUserProfile(userProfile.id, { ...userProfile, emailVerified: isEmailVerified }).catch(console.error);
            }

            // Sync with backend accounts
            const metricsRes = await api.getCurrentUser(resolvedUser.id);
            if (metricsRes.balanceMetrics && isMounted) {
              setBalanceMetrics(metricsRes.balanceMetrics);
            }
            const notifRes = await api.getNotifications(resolvedUser.id);
            if (notifRes.notifications && isMounted) setNotifications(notifRes.notifications);
          }
        } catch (err) {
          console.error('[Auth] Error fetching user profile on auth change:', err);
        }
      } else {
        // If not logged in and no demo user set yet, load demo profile for initial showcase
        try {
          await fetchUsers();
          const res = await api.getCurrentUser('usr_eleanor');
          if (res.user && isMounted) {
            const persistedAvatar = getPersistedAvatar(res.user.id, res.user.avatarUrl);
            const resolvedUser = { ...res.user, avatarUrl: persistedAvatar };
            setCurrentUser(resolvedUser);
            setBalanceMetrics(res.balanceMetrics);
            const notifRes = await api.getNotifications(res.user.id);
            if (notifRes.notifications && isMounted) setNotifications(notifRes.notifications);
          }
        } catch (err) {
          console.error('[Auth] Error fetching default preview user:', err);
        }
      }

      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [fetchUsers]);

  /**
   * Real Monvera User Login via Firebase Authentication & Firestore
   */
  const login = async (identifier: string, password?: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const cleanIdentifier = identifier.trim();
      const cleanPassword = password || '';

      if (!cleanIdentifier) {
        return { success: false, error: 'Please enter your email or Monvera Account Number.' };
      }
      if (!cleanPassword) {
        return { success: false, error: 'Please enter your account password.' };
      }

      let emailToAuth = cleanIdentifier;

      // If user entered Account Number or Username instead of Email
      if (!cleanIdentifier.includes('@')) {
        // Check if there is a known user in the system with this account number or username
        const matched = availableUsers.find(
          (u) =>
            u.permanentAccountNumber === cleanIdentifier.replace(/[-\s]/g, '') ||
            u.username.toLowerCase() === cleanIdentifier.toLowerCase()
        );
        if (matched && matched.email) {
          emailToAuth = matched.email;
        } else {
          // Attempt backend resolution
          const backendRes = await api.login(cleanIdentifier, cleanPassword);
          if (backendRes.success && backendRes.user && backendRes.balanceMetrics) {
            setCurrentUser(backendRes.user);
            setBalanceMetrics(backendRes.balanceMetrics);
            await refreshNotifications();
            if (backendRes.user.role === 'super_admin' || backendRes.user.role === 'admin') {
              setCurrentView('admin');
            } else {
              setCurrentView('dashboard');
            }
            setActiveModal(null);
            return { success: true };
          }
          return { success: false, error: 'No Monvera account found with that Account Number or Username.' };
        }
      }

      // 1. Authenticate with Firebase Authentication
      console.log(`[Auth] Authenticating ${emailToAuth} with Firebase Auth...`);
      const userCredential = await signInWithEmailAndPassword(auth, emailToAuth, cleanPassword);
      const firebaseUser = userCredential.user;
      const uid = firebaseUser.uid;
      console.log(`[Auth] Firebase Auth succeeded. UID: ${uid}`);

      // 2. Fetch User Profile from Firestore: users/{uid}
      let userProfile = await firestoreSync.getUserProfile(uid);

      // If not yet in Firestore (e.g. created previously), create baseline profile
      if (!userProfile) {
        console.log(`[Auth] Profile not found in Firestore for ${uid}. Initializing...`);
        const fallbackProfile: UserProfile = {
          id: uid,
          username: emailToAuth.split('@')[0] || `user_${uid.slice(0, 5)}`,
          firstName: emailToAuth.split('@')[0] || 'Valued',
          lastName: 'Customer',
          email: emailToAuth.toLowerCase(),
          phone: '+1 (555) 000-0000',
          permanentAccountNumber: `10${Math.floor(10000000 + Math.random() * 90000000)}`,
          country: 'United States',
          status: 'active',
          role: 'customer',
          membershipTier: 'Standard',
          twoFactorEnabled: false,
          createdAt: new Date().toISOString(),
          kycStatus: 'unverified',
          dailyTransactionLimit: 1000000,
        };
        // Fire-and-forget save in background to not block login speed
        firestoreSync.saveUserProfile(uid, fallbackProfile).catch(console.error);
        userProfile = fallbackProfile;
      }

      // 3. Fast Parallel State Hydration (Optimized for instant login)
      const persistedAvatar = getPersistedAvatar(userProfile.id, userProfile.avatarUrl);
      const finalUser: UserProfile = { ...userProfile, avatarUrl: persistedAvatar };

      // Set user immediately for responsive UI feedback
      setCurrentUser(finalUser);

      // Concurrently synchronize ledger and metrics in parallel
      const [backendSync, notifRes] = await Promise.all([
        api.register({
          uid,
          id: uid,
          firstName: finalUser.firstName,
          lastName: finalUser.lastName,
          email: finalUser.email,
          phone: finalUser.phone,
          country: finalUser.country,
          dateOfBirth: finalUser.dateOfBirth,
          maritalStatus: finalUser.maritalStatus,
          permanentAccountNumber: finalUser.permanentAccountNumber,
          password: cleanPassword,
        }).catch(() => ({ success: true, user: finalUser, balanceMetrics: null })),
        api.getNotifications(uid).catch(() => ({ notifications: [] }))
      ]);

      if (backendSync?.user) {
        setCurrentUser({ ...backendSync.user, avatarUrl: persistedAvatar });
      }

      if (backendSync?.balanceMetrics && backendSync.balanceMetrics.accounts) {
        setBalanceMetrics(backendSync.balanceMetrics);
      } else {
        // Fallback default banking accounts metrics
        setBalanceMetrics({
          checkingBalance: 24500.00,
          savingsBalance: 52140.50,
          investedBalance: 15000.00,
          accruedEarnings: 842.20,
          totalBalance: 92482.70,
          availableBalance: 76640.50,
          pendingBalance: 0,
          accounts: [
            {
              id: `acc_chk_${uid}`,
              accountNumber: finalUser.permanentAccountNumber || '1048291048',
              accountType: 'CHECKING',
              balance: 24500.00,
              currency: 'USD',
              isPrimary: true,
              status: 'ACTIVE',
              routingNumber: '021000021',
              interestRate: 0.05,
              dailyLimit: 50000,
              createdAt: finalUser.createdAt || new Date().toISOString()
            },
            {
              id: `acc_svg_${uid}`,
              accountNumber: `20${(finalUser.permanentAccountNumber || '1048291048').slice(2)}`,
              accountType: 'SAVINGS',
              balance: 52140.50,
              currency: 'USD',
              isPrimary: false,
              status: 'ACTIVE',
              routingNumber: '021000021',
              interestRate: 4.85,
              dailyLimit: 25000,
              createdAt: finalUser.createdAt || new Date().toISOString()
            }
          ]
        });
      }

      if (notifRes?.notifications) {
        setNotifications(notifRes.notifications);
      }

      if (finalUser.role === 'super_admin' || finalUser.role === 'admin') {
        setCurrentView('admin');
      } else {
        setCurrentView('dashboard');
      }
      setActiveModal(null);
      return { success: true };
    } catch (err: any) {
      console.error('[Firebase Auth Login Error]', err);
      const friendlyMsg = getFirebaseErrorMessage(err);
      return { success: false, error: friendlyMsg };
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Monvera Sign-Out
   */
  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('[Auth SignOut Error]', err);
    }
    setCurrentUser(null);
    setBalanceMetrics(null);
    setCurrentView('home');
  };

  /**
   * Real Monvera User Registration via Firebase Authentication & Firestore
   */
  const registerUser = async (data: {
    fullName?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    age?: string;
    country?: string;
    maritalStatus?: string;
    address?: string;
    taxId?: string;
    password?: string;
    isBusiness?: boolean;
    businessName?: string;
    username?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const cleanEmail = data.email.trim().toLowerCase();
      const cleanPassword = data.password || '';

      if (!cleanEmail || !cleanEmail.includes('@')) {
        return { success: false, error: 'Please enter a valid email address.' };
      }
      if (!cleanPassword || cleanPassword.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters long.' };
      }
      if (!data.firstName.trim() || !data.lastName.trim()) {
        return { success: false, error: 'First name and last name are required.' };
      }

      // Step 1: Create Account in Firebase Authentication using Email/Password
      console.log(`[Firebase Auth] Creating user account for ${cleanEmail}...`);
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
      const firebaseUser = userCredential.user;
      const uid = firebaseUser.uid;
      console.log(`[Firebase Auth] Successfully created Firebase Auth user. UID: ${uid}`);

      // Dispatch Firebase email verification link to customer
      try {
        await sendEmailVerification(firebaseUser);
        console.log(`[Firebase Auth] Email verification sent to: ${cleanEmail}`);
      } catch (emailErr) {
        console.warn('[Firebase Auth] sendEmailVerification note:', emailErr);
      }

      // Step 2: Generate Unique 10-digit Permanent Account Number (starts with 10)
      const permanentAccountNumber = `10${Math.floor(10000000 + Math.random() * 90000000)}`;

      // Step 3: Prepare complete Customer Profile for Firestore
      const userDocData: UserProfile & Record<string, any> = {
        uid: uid,
        id: uid,
        fullName: data.fullName || `${data.firstName.trim()} ${data.lastName.trim()}`,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: cleanEmail,
        phone: data.phone?.trim() || '+1 (555) 000-0000',
        country: data.country || 'United States',
        dateOfBirth: data.dateOfBirth || '1995-01-01',
        age: data.age || '',
        maritalStatus: data.maritalStatus || 'Single',
        address: data.address?.trim() || '',
        permanentAccountNumber,
        username:
          (data.username || `${data.firstName.toLowerCase()}${data.lastName.toLowerCase().charAt(0)}`).replace(
            /[^a-z0-9_]/g,
            ''
          ) || `user_${uid.slice(0, 6)}`,
        role: data.isBusiness ? 'business' : 'customer',
        status: 'active',
        kycStatus: 'unverified',
        emailVerified: false,
        membershipTier: data.isBusiness ? 'Business Platinum' : 'Premier',
        twoFactorEnabled: false,
        businessName: data.isBusiness ? data.businessName || `${data.firstName}'s Enterprise` : '',
        taxId: data.taxId || '',
        avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dailyTransactionLimit: 1000000,
      };

      // Step 4: Save Customer Profile Document to Firestore under users/{uid}
      console.log(`[Firestore] Saving customer profile to users/${uid}...`);
      const saveResult = await firestoreSync.saveUserProfile(uid, userDocData);

      if (!saveResult.success) {
        console.error(`[Firestore] Failed to write profile document for UID: ${uid}:`, saveResult.error);
        return {
          success: false,
          error: saveResult.error || 'Failed to record customer profile in Firestore database. Please try again.',
        };
      }

      console.log(`[Firestore] Document users/${uid} created successfully in Firestore.`);

      // Step 5: Initialize banking ledger and server state for this customer
      const serverRes = await api.register({
        uid,
        id: uid,
        firstName: userDocData.firstName,
        lastName: userDocData.lastName,
        email: userDocData.email,
        phone: userDocData.phone,
        country: userDocData.country,
        dateOfBirth: userDocData.dateOfBirth,
        maritalStatus: userDocData.maritalStatus,
        address: userDocData.address,
        taxId: userDocData.taxId,
        permanentAccountNumber,
        isBusiness: data.isBusiness,
        businessName: userDocData.businessName,
        password: cleanPassword,
      });

      const finalUser = serverRes.user || userDocData;
      const finalMetrics = serverRes.balanceMetrics || (await api.getBalanceMetrics(uid));

      setCurrentUser(finalUser);
      if (finalMetrics) setBalanceMetrics(finalMetrics);
      await fetchUsers();
      await refreshNotifications();

      setCurrentView('dashboard');
      setActiveModal(null);
      return { success: true };
    } catch (err: any) {
      console.error('[Firebase Auth Sign-Up Error]', err);
      const friendlyMsg = getFirebaseErrorMessage(err);
      return { success: false, error: friendlyMsg };
    } finally {
      setIsLoading(false);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (!currentUser) return;
    try {
      await api.markNotificationsRead(currentUser.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error('Error marking notifications:', err);
    }
  };

  const markNotificationAsRead = async (notificationId: string) => {
    if (!currentUser) return;
    try {
      await api.markSingleNotificationRead(notificationId, currentUser.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error('Error marking notification:', err);
    }
  };

  const replyToSupport = async (notificationId: string, message: string) => {
    if (!currentUser) return { success: false, error: 'User not authenticated' };
    try {
      const res = await api.replyToSupportMessage({
        notificationId,
        userId: currentUser.id,
        message,
      });
      if (res.success && res.notification) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? res.notification! : n))
        );
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to send reply' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  };

  // Auto-check email verification status when user focuses window
  useEffect(() => {
    const handleFocus = async () => {
      if (auth.currentUser && currentUser && !currentUser.emailVerified) {
        try {
          await auth.currentUser.reload();
          if (auth.currentUser.emailVerified) {
            const updated = { ...currentUser, emailVerified: true };
            setCurrentUser(updated);
            await firestoreSync.saveUserProfile(currentUser.id, updated);
          }
        } catch (e) {
          console.warn('[Auth] Window focus verification check note:', e);
        }
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentUser]);

  /**
   * Resend Firebase Authentication Verification Email to Current Customer
   */
  const resendVerificationEmail = async (): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      if (!auth.currentUser) {
        return { success: false, error: 'No active authentication session found. Please sign in.' };
      }
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        if (currentUser && !currentUser.emailVerified) {
          const updated = { ...currentUser, emailVerified: true };
          setCurrentUser(updated);
          await firestoreSync.saveUserProfile(currentUser.id, updated);
        }
        return { success: false, error: 'Your email address is already verified.' };
      }

      await sendEmailVerification(auth.currentUser);
      return {
        success: true,
        message: 'Verification email sent. Please check your email and click the verification link.',
      };
    } catch (err: any) {
      console.error('[Firebase Auth Resend Email Error]', err);
      if (err?.code === 'auth/too-many-requests') {
        return {
          success: false,
          error: 'Too many verification email requests. Please wait a few moments before trying again.',
        };
      }
      return {
        success: false,
        error: err?.message || 'Failed to send verification email. Please try again later.',
      };
    }
  };

  /**
   * Check / Reload Real Firebase Email Verification Status
   */
  const checkEmailVerification = async (): Promise<boolean> => {
    try {
      if (!auth.currentUser) return currentUser?.emailVerified ?? false;
      await auth.currentUser.reload();
      const isVerified = !!auth.currentUser.emailVerified;
      if (currentUser && currentUser.emailVerified !== isVerified) {
        const updated = { ...currentUser, emailVerified: isVerified };
        setCurrentUser(updated);
        await firestoreSync.saveUserProfile(currentUser.id, updated);
      }
      return isVerified;
    } catch (err) {
      console.warn('[Firebase Auth Check Email Status Error]', err);
      return currentUser?.emailVerified ?? false;
    }
  };

  /**
   * Send Real Firebase Authentication Password Reset Email
   */
  const sendPasswordReset = async (
    emailOrIdentifier: string
  ): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      let targetEmail = emailOrIdentifier.trim();
      if (!targetEmail) {
        return { success: false, error: 'Please provide your registered email or account number.' };
      }

      // If user provided username or account number, resolve to email
      if (!targetEmail.includes('@')) {
        const matched = availableUsers.find(
          (u) =>
            u.permanentAccountNumber === targetEmail.replace(/[-\s]/g, '') ||
            u.username?.toLowerCase() === targetEmail.toLowerCase()
        );
        if (matched && matched.email) {
          targetEmail = matched.email;
        } else if (currentUser && currentUser.email) {
          targetEmail = currentUser.email;
        }
      }

      if (!targetEmail.includes('@')) {
        return { success: false, error: 'Please enter a valid registered email address.' };
      }

      // 1. Send real Firebase password reset email
      await sendPasswordResetEmail(auth, targetEmail);
      console.log(`[Firebase Auth] Password reset email dispatched to ${targetEmail}`);

      // 2. Also register with server notification ledger
      try {
        await api.resetPassword({ emailOrAccount: targetEmail });
      } catch (backendErr) {
        console.warn('[Backend reset log note]:', backendErr);
      }

      return {
        success: true,
        message: `Password reset instructions sent to ${targetEmail}. Please check your inbox or spam folder.`,
      };
    } catch (err: any) {
      console.error('[Firebase Auth Password Reset Error]', err);
      const code = err?.code;
      if (code === 'auth/user-not-found') {
        return { success: false, error: 'No Monvera account found with this email address.' };
      }
      if (code === 'auth/invalid-email') {
        return { success: false, error: 'Please enter a valid email address.' };
      }
      if (code === 'auth/too-many-requests') {
        return { success: false, error: 'Too many requests. Please wait a few moments before trying again.' };
      }
      return { success: false, error: err?.message || 'Failed to dispatch password reset email. Please try again.' };
    }
  };

  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

  const updateUser = (user: UserProfile) => {
    if (user.avatarUrl) {
      try {
        localStorage.setItem(`monvera_user_avatar_${user.id}`, user.avatarUrl);
      } catch {
        // storage fallback
      }
    }
    setCurrentUser(user);
    setAvailableUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
    // Also sync to Firestore
    firestoreSync.saveUserProfile(user.id, user).catch((err) => {
      console.warn('[Firestore] Background update error:', err);
    });
  };

  const openModal = (
    modal: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_prompt' | 'auth_login' | 'auth_register' | null
  ) => {
    setActiveModal(modal);
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        balanceMetrics,
        isLoading,
        availableUsers,
        currentView,
        setCurrentView,
        notifications,
        unreadNotifsCount,
        login,
        logout,
        switchUser,
        registerUser,
        refreshBalance,
        refreshNotifications,
        markAllNotificationsAsRead,
        markNotificationAsRead,
        replyToSupport,
        updateUser,
        resendVerificationEmail,
        checkEmailVerification,
        sendPasswordReset,
        lastUpdateTimestamp,
        activeModal,
        openModal,
        closeModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
