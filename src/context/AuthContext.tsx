import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User as FirebaseUser,
  multiFactor,
  TotpMultiFactorGenerator,
  TotpSecret,
  getMultiFactorResolver,
  EmailAuthProvider,
  reauthenticateWithCredential,
  MultiFactorResolver,
  MultiFactorInfo,
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { firestoreSync } from '../services/firestoreSync';
import { pushNotificationService } from '../services/pushNotificationService';
import { UserProfile, NotificationItem } from '../types';
import { api, BalanceMetrics } from '../services/api';

export type { MultiFactorResolver, MultiFactorInfo, TotpSecret };

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
  | 'loans'
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
  login: (identifier: string, password?: string) => Promise<{
    success: boolean;
    error?: string;
    mfaRequired?: boolean;
    resolver?: MultiFactorResolver;
    hint?: MultiFactorInfo;
  }>;
  resolveTotpLogin: (
    resolver: MultiFactorResolver,
    code: string,
    hintUid: string,
    cleanPassword?: string
  ) => Promise<{ success: boolean; error?: string }>;
  reauthenticateUser: (password: string) => Promise<{ success: boolean; error?: string }>;
  getEnrolledTotpFactor: () => MultiFactorInfo | null;
  startTotpEnrollment: () => Promise<{
    success: boolean;
    totpSecret?: TotpSecret;
    qrCodeUrl?: string;
    secretKey?: string;
    error?: string;
    requiresReauth?: boolean;
  }>;
  finishTotpEnrollment: (
    totpSecret: TotpSecret,
    verificationCode: string,
    displayName?: string
  ) => Promise<{ success: boolean; error?: string }>;
  unenrollTotpMfa: () => Promise<{
    success: boolean;
    error?: string;
    requiresReauth?: boolean;
  }>;
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
  refreshProfile: () => Promise<void>;
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

// Check if the current URL path or hash matches private admin access
const checkIsAdminPath = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const rawPath = window.location.pathname.toLowerCase().replace(/\/+$/, '').trim();
    const hash = window.location.hash.toLowerCase().replace(/^#\/?/, '').trim();
    const search = window.location.search.toLowerCase();

    return (
      rawPath === '/monveramv' ||
      rawPath === '/monvera-mv' ||
      rawPath === '/monvera_mv' ||
      rawPath === '/monvera/mv' ||
      hash === 'monveramv' ||
      hash === 'monvera-mv' ||
      hash === 'monvera_mv' ||
      hash === '/monveramv' ||
      search.includes('admin=monveramv') ||
      search.includes('monveramv')
    );
  } catch {
    return false;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [balanceMetrics, setBalanceMetrics] = useState<BalanceMetrics | null>(null);
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([]);
  const [currentView, setCurrentViewState] = useState<AppView>(() => {
    return checkIsAdminPath() ? 'admin' : 'home';
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number>(Date.now());
  const [activeModal, setActiveModal] = useState<'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_prompt' | 'auth_login' | 'auth_register' | null>(null);

  const setCurrentView = useCallback((view: AppView) => {
    setCurrentViewState(view);
    try {
      if (typeof window !== 'undefined') {
        if (view === 'admin') {
          if (window.location.pathname.toLowerCase() !== '/monveramv') {
            window.history.pushState(null, '', '/MonveraMV');
          }
        } else if (checkIsAdminPath()) {
          window.history.pushState(null, '', '/');
        }
      }
    } catch {
      // Safe fallback for restricted iframe contexts
    }
  }, []);

  // Listen to browser URL changes (e.g. user manually typing /MonveraMV or pressing back/forward)
  useEffect(() => {
    const handleUrlChange = () => {
      if (checkIsAdminPath()) {
        setCurrentViewState('admin');
      }
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);

    if (checkIsAdminPath()) {
      setCurrentViewState('admin');
    }

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

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
      // 1. Retrieve verified balances directly from permanent Firestore ledger
      const fsMetrics = await firestoreSync.getAccountBalances(currentUser.id, currentUser.permanentAccountNumber);
      if (fsMetrics && fsMetrics.accounts && fsMetrics.accounts.length > 0) {
        setBalanceMetrics(fsMetrics);
        cacheUserBalances(currentUser.id, fsMetrics);
        setLastUpdateTimestamp(Date.now());
        return;
      }

      // 2. Fetch backend metrics if Firestore is initializing
      const metrics = await api.getBalanceMetrics(currentUser.id, currentUser.permanentAccountNumber);
      if (metrics && metrics.accounts && metrics.accounts.length > 0) {
        setBalanceMetrics(metrics);
        cacheUserBalances(currentUser.id, metrics);
        setLastUpdateTimestamp(Date.now());
      }
    } catch (err) {
      console.error('Failed to refresh balance:', err);
    }
  }, [currentUser]);

  const refreshNotifications = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.getNotifications(currentUser.id, currentUser.permanentAccountNumber, currentUser.email);
      if (res.notifications) {
        setNotifications(res.notifications);
        setLastUpdateTimestamp(Date.now());
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [currentUser]);

  const refreshProfile = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      // 1. Authoritative Firestore document read (Firestore is the single source of truth)
      const fsProfile = await firestoreSync.getUserProfile(currentUser.id);
      if (fsProfile) {
        // Strict protection: verified status can NEVER be downgraded to pending or unverified
        const effectiveKycStatus = (currentUser.kycStatus === 'verified' && fsProfile.kycStatus !== 'verified')
          ? 'verified'
          : (fsProfile.kycStatus || currentUser.kycStatus);

        const hasChanges =
          effectiveKycStatus !== currentUser.kycStatus ||
          (effectiveKycStatus === 'verified' && currentUser.dailyTransactionLimit !== 1000000) ||
          (fsProfile.status && fsProfile.status !== currentUser.status);

        if (hasChanges) {
          setCurrentUser((prev) => {
            if (!prev) return fsProfile;
            return {
              ...prev,
              ...fsProfile,
              kycStatus: effectiveKycStatus,
              dailyTransactionLimit: effectiveKycStatus === 'verified' ? 1000000 : (fsProfile.dailyTransactionLimit || prev.dailyTransactionLimit),
              avatarUrl: getPersistedAvatar(fsProfile.id, fsProfile.avatarUrl || prev.avatarUrl),
            };
          });
        }
        // Authoritative return: when Firestore document exists, NEVER query backend server which may have stale in-memory state!
        return;
      }

      // 2. Only check backend server state if Firestore profile is not found
      const backendRes = await api.getCurrentUser(currentUser.id);
      if (backendRes?.user) {
        const backendKyc = (currentUser.kycStatus === 'verified' && backendRes.user.kycStatus !== 'verified')
          ? 'verified'
          : (backendRes.user.kycStatus || currentUser.kycStatus);

        if (backendKyc !== currentUser.kycStatus || backendRes.user.dailyTransactionLimit !== currentUser.dailyTransactionLimit) {
          setCurrentUser((prev) => {
            if (!prev) return backendRes.user;
            return {
              ...prev,
              ...backendRes.user,
              kycStatus: backendKyc,
              dailyTransactionLimit: backendKyc === 'verified' ? 1000000 : (backendRes.user.dailyTransactionLimit || prev.dailyTransactionLimit),
              avatarUrl: getPersistedAvatar(backendRes.user.id, backendRes.user.avatarUrl || prev.avatarUrl),
            };
          });
        }
      }
    } catch {}
  }, [currentUser?.id, currentUser?.kycStatus, currentUser?.dailyTransactionLimit, currentUser?.status]);

  // Real-time synchronization interval & Firestore onSnapshot listeners
  useEffect(() => {
    if (!currentUser?.id) return;

    const isTargetUser = (target: any): boolean => {
      if (!target) return false;
      if (!target.userId && !target.accountNumber && !target.email && !target.fallbackUserId) return true;
      if (target.userId === currentUser.id || target.fallbackUserId === currentUser.id) return true;
      const cleanTargetAcc = (target.accountNumber || '').replace(/[-\s]/g, '');
      const cleanUserAcc = (currentUser.permanentAccountNumber || '').replace(/[-\s]/g, '');
      if (cleanTargetAcc && cleanUserAcc && cleanTargetAcc === cleanUserAcc) return true;
      if (target.email && currentUser.email && target.email.toLowerCase().trim() === currentUser.email.toLowerCase().trim()) return true;
      return false;
    };

    // 1. Real-time Firestore account balance listener under accounts/{uid}
    const unsubBalance = firestoreSync.subscribeToAccountBalances(
      currentUser.id,
      currentUser.permanentAccountNumber,
      (newMetrics) => {
        setBalanceMetrics(newMetrics);
        cacheUserBalances(currentUser.id, newMetrics);
        setLastUpdateTimestamp(Date.now());
      }
    );

    // 2. Real-time Firestore profile listener under users/{uid} for instant KYC status reflection
    const unsubProfile = firestoreSync.subscribeToUserProfile(
      currentUser.id,
      (updatedProfile) => {
        if (updatedProfile) {
          setCurrentUser((prev) => {
            if (!prev) return updatedProfile;
            const effectiveKyc = (prev.kycStatus === 'verified' && updatedProfile.kycStatus !== 'verified')
              ? 'verified'
              : (updatedProfile.kycStatus || prev.kycStatus);
            return {
              ...prev,
              ...updatedProfile,
              kycStatus: effectiveKyc,
              dailyTransactionLimit: effectiveKyc === 'verified' ? 1000000 : (updatedProfile.dailyTransactionLimit || prev.dailyTransactionLimit),
              avatarUrl: getPersistedAvatar(updatedProfile.id, updatedProfile.avatarUrl || prev.avatarUrl),
            };
          });
        }
      }
    );

    // 3. Real-time Firestore loan listener: immediately reconcile active/approved loans into Checking Account balance & notification bell
    const unsubLoans = firestoreSync.subscribeToLoans((allLoans) => {
      if (!currentUser) return;
      const userCleanAcc = (currentUser.permanentAccountNumber || '').replace(/[-\s]/g, '');
      const userEmail = (currentUser.email || '').toLowerCase().trim();

      const userActiveLoans = allLoans.filter((l) => {
        const lCleanAcc = (l.permanentAccountNumber || '').replace(/[-\s]/g, '');
        const lEmail = (l.applicantEmail || '').toLowerCase().trim();
        const matches = l.userId === currentUser.id ||
          (userCleanAcc && lCleanAcc === userCleanAcc) ||
          (userEmail && lEmail === userEmail);
        return matches && (l.status === 'ACTIVE' || l.status === 'APPROVED');
      });

      if (userActiveLoans.length > 0) {
        refreshBalance();
        refreshNotifications();
      }
    });

    // 4. Real-time Firestore notification listener: immediately updates the notification bell in real-time
    const unsubNotifications = firestoreSync.subscribeToNotifications(
      currentUser.id,
      (newNotifs) => {
        if (newNotifs && newNotifs.length > 0) {
          setNotifications(newNotifs);
          setLastUpdateTimestamp(Date.now());
        }
      },
      currentUser.permanentAccountNumber,
      currentUser.email
    );

    // 5. Fallback interval for polling notifications, balances, and backup KYC status sync
    const interval = setInterval(() => {
      // Check if any pending 30-minute withdrawals need to be reversed and restored
      api.checkAndExecutePendingWithdrawalReversals(currentUser.id).catch(() => {});
      refreshBalance();
      refreshNotifications();
      refreshProfile();
    }, 3000);

    // 6. Silently sync FCM registration token if browser permission is already granted
    pushNotificationService.syncTokenForUser(currentUser.id).catch(() => {});

    // 7. Listen to foreground push notifications while tab is open
    const unsubPush = pushNotificationService.listenToForegroundMessages(() => {
      refreshNotifications();
      refreshBalance();
    });

    // 8. Instant multi-tab / same-window event listener for immediate zero-latency KYC reflection
    const handleKycStatusUpdated = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      if (currentUser?.id && detail.userId === currentUser.id) {
        refreshNotifications();
        if (detail.user) {
          setCurrentUser((prev) => ({
            ...(prev || {}),
            ...detail.user,
            avatarUrl: getPersistedAvatar(detail.userId, detail.user.avatarUrl || prev?.avatarUrl),
          }));
        } else if (detail.kycStatus) {
          setCurrentUser((prev) => ({
            ...(prev as any),
            kycStatus: detail.kycStatus,
            dailyTransactionLimit: detail.kycStatus === 'verified' ? 1000000 : (prev?.dailyTransactionLimit || 25000),
            status: 'active',
          }));
        }
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'monvera_kyc_sync_event' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          if (currentUser?.id && data.userId === currentUser.id) {
            refreshProfile();
          }
        } catch {}
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshProfile();
        refreshBalance();
        refreshNotifications();
      }
    };

    const handleBalanceUpdated = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      if (isTargetUser(detail)) {
        if (detail.balanceMetrics) {
          setBalanceMetrics(detail.balanceMetrics);
          cacheUserBalances(currentUser.id, detail.balanceMetrics);
          setLastUpdateTimestamp(Date.now());
        } else {
          refreshBalance();
        }
      }
    };

    const handleNotificationCreated = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      if (isTargetUser(detail)) {
        if (detail.notification) {
          setNotifications((prev) => {
            const exists = prev.some((n) => n.id === detail.notification.id);
            if (exists) return prev;
            return [detail.notification, ...prev];
          });
          setLastUpdateTimestamp(Date.now());
        }
        refreshNotifications();
      }
    };

    let syncChannel: BroadcastChannel | null = null;
    try {
      syncChannel = new BroadcastChannel('monvera_sync_channel');
      syncChannel.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        if (isTargetUser(data)) {
          if (data.balanceMetrics) {
            setBalanceMetrics(data.balanceMetrics);
            cacheUserBalances(currentUser.id, data.balanceMetrics);
            setLastUpdateTimestamp(Date.now());
          } else {
            refreshBalance();
          }
          if (data.notification) {
            setNotifications((prev) => {
              const exists = prev.some((n) => n.id === data.notification.id);
              if (exists) return prev;
              return [data.notification, ...prev];
            });
            setLastUpdateTimestamp(Date.now());
          }
          refreshNotifications();
        }
      };
    } catch {}

    window.addEventListener('monvera_kyc_status_updated', handleKycStatusUpdated);
    window.addEventListener('monvera_balance_updated', handleBalanceUpdated);
    window.addEventListener('monvera_notification_created', handleNotificationCreated);
    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('focus', refreshProfile);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubBalance();
      unsubProfile();
      unsubLoans();
      unsubNotifications();
      unsubPush();
      clearInterval(interval);
      if (syncChannel) {
        try {
          syncChannel.close();
        } catch {}
      }
      window.removeEventListener('monvera_kyc_status_updated', handleKycStatusUpdated);
      window.removeEventListener('monvera_balance_updated', handleBalanceUpdated);
      window.removeEventListener('monvera_notification_created', handleNotificationCreated);
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('focus', refreshProfile);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.id, currentUser?.permanentAccountNumber, currentUser?.email, refreshBalance, refreshNotifications, refreshProfile]);

  const getPersistedAvatar = (userId: string, defaultAvatar?: string) => {
    try {
      const stored = localStorage.getItem(`monvera_user_avatar_${userId}`);
      if (stored) return stored;
    } catch {
      // localStorage fallback
    }
    return defaultAvatar;
  };

  const cacheUserBalances = (userId: string, metrics: BalanceMetrics) => {
    try {
      if (typeof window === 'undefined' || !window.localStorage || !userId || !metrics) return;
      localStorage.setItem(`monvera_balances_${userId}`, JSON.stringify(metrics));
    } catch {}
  };

  const getCachedUserBalances = (userId: string): BalanceMetrics | null => {
    try {
      if (typeof window === 'undefined' || !window.localStorage || !userId) return null;
      const raw = localStorage.getItem(`monvera_balances_${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return null;
  };

  const cacheUserInDirectory = (user: UserProfile) => {
    try {
      if (typeof window === 'undefined' || !window.localStorage || !user) return;
      const existingRaw = localStorage.getItem('monvera_accounts_directory');
      let dir: UserProfile[] = existingRaw ? JSON.parse(existingRaw) : [];
      if (!Array.isArray(dir)) dir = [];
      const idx = dir.findIndex(
        (u) =>
          (u.id && u.id === user.id) ||
          (u.permanentAccountNumber && u.permanentAccountNumber === user.permanentAccountNumber)
      );
      if (idx >= 0) {
        dir[idx] = { ...dir[idx], ...user };
      } else {
        dir.push(user);
      }
      localStorage.setItem('monvera_accounts_directory', JSON.stringify(dir));
    } catch {}
  };

  const switchUser = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      // 1. Immediately hydrate cached balances to eliminate any 00 flicker
      const cachedBalances = getCachedUserBalances(userId);
      if (cachedBalances) {
        setBalanceMetrics(cachedBalances);
      }

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
        cacheUserInDirectory(resolvedUser);

        // Fetch verified balance metrics from Firestore ledger first
        const fsMetrics = await firestoreSync.getAccountBalances(resolvedUser.id, resolvedUser.permanentAccountNumber);
        if (fsMetrics && fsMetrics.accounts && fsMetrics.accounts.length > 0) {
          setBalanceMetrics(fsMetrics);
          cacheUserBalances(resolvedUser.id, fsMetrics);
        } else {
          const res = await api.getCurrentUser(resolvedUser.id);
          if (res.balanceMetrics) {
            setBalanceMetrics(res.balanceMetrics);
            cacheUserBalances(resolvedUser.id, res.balanceMetrics);
          }
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
          
          // Instant hydration from local cache to prevent any 00 flicker
          const cachedBalances = getCachedUserBalances(firebaseUser.uid);
          if (cachedBalances && isMounted) {
            setBalanceMetrics(cachedBalances);
          }

          let userProfile = await firestoreSync.getUserProfile(firebaseUser.uid);

          if (!userProfile) {
            // If user signed in but doc not yet synced, try api or fallback
            const res = await api.getCurrentUser(firebaseUser.uid);
            if (res.user) userProfile = res.user;
          }

          if (userProfile && isMounted) {
            const persistedAvatar = getPersistedAvatar(userProfile.id, userProfile.avatarUrl);
            const isEmailVerified = !!firebaseUser.emailVerified;
            let isMfaEnrolled = false;
            try {
              const enrolledFactors = multiFactor(firebaseUser).enrolledFactors;
              isMfaEnrolled = enrolledFactors.some((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
            } catch {}
            const resolvedUser = {
              ...userProfile,
              emailVerified: isEmailVerified,
              avatarUrl: persistedAvatar,
              twoFactorEnabled: isMfaEnrolled || userProfile.twoFactorEnabled,
            };
            
            // Concurrently fetch verified balances from Firestore
            const [fsMetrics, notifRes] = await Promise.all([
              firestoreSync.getAccountBalances(resolvedUser.id, resolvedUser.permanentAccountNumber).catch(() => null),
              api.getNotifications(resolvedUser.id).catch(() => ({ notifications: [] }))
            ]);

            if (fsMetrics && fsMetrics.accounts && fsMetrics.accounts.length > 0 && isMounted) {
              setBalanceMetrics(fsMetrics);
              cacheUserBalances(resolvedUser.id, fsMetrics);
            } else if (!cachedBalances && isMounted) {
              const metricsRes = await api.getCurrentUser(resolvedUser.id);
              if (metricsRes.balanceMetrics && isMounted) {
                setBalanceMetrics(metricsRes.balanceMetrics);
                cacheUserBalances(resolvedUser.id, metricsRes.balanceMetrics);
              }
            }

            setCurrentUser(resolvedUser);
            cacheUserInDirectory(resolvedUser);

            // If email verification status changed in Firebase Auth, sync to Firestore
            if (userProfile.emailVerified !== isEmailVerified) {
              firestoreSync.saveUserProfile(userProfile.id, { ...userProfile, emailVerified: isEmailVerified }).catch(console.error);
            }

            if (notifRes?.notifications && isMounted) setNotifications(notifRes.notifications);
          }
        } catch (err) {
          console.error('[Auth] Error fetching user profile on auth change:', err);
        }
      } else {
        // No authenticated session
        if (isMounted) {
          setCurrentUser(null);
          setBalanceMetrics(null);
          setNotifications([]);
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
   * Internal session hydrator that completes profile synchronization,
   * ledger verification, and navigation state setup.
   */
  const hydrateUserSession = async (
    firebaseUser: FirebaseUser,
    cleanPassword?: string,
    emailFallback?: string
  ): Promise<UserProfile> => {
    const uid = firebaseUser.uid;
    const emailToAuth = firebaseUser.email || emailFallback || '';
    console.log(`[Auth] Hydrating session for Firebase User UID: ${uid}`);

    // 1. Fetch User Profile from Firestore: users/{uid}
    let userProfile = await firestoreSync.getUserProfile(uid);

    // If not yet in Firestore, check directory cache or server before creating baseline
    if (!userProfile) {
      console.log(`[Auth] Profile not found in direct Firestore lookup for ${uid}. Searching cache...`);
      let cachedExisting: UserProfile | null = null;
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('monvera_accounts_directory');
          const directory: any[] = raw ? JSON.parse(raw) : [];
          cachedExisting = directory.find((u: any) => u.id === uid || u.email?.toLowerCase() === emailToAuth.toLowerCase()) || null;
        } catch {}
      }

      if (!cachedExisting) {
        try {
          const res = await api.getCurrentUser(uid);
          if (res?.user) cachedExisting = res.user;
        } catch {}
      }

      if (cachedExisting) {
        userProfile = cachedExisting;
        firestoreSync.saveUserProfile(uid, cachedExisting).catch(console.error);
      } else {
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
        firestoreSync.saveUserProfile(uid, fallbackProfile).catch(console.error);
        userProfile = fallbackProfile;
      }
    }

    // Check authoritative enrolled MFA factors in Firebase Auth
    let isMfaEnrolled = false;
    try {
      const enrolled = multiFactor(firebaseUser).enrolledFactors;
      isMfaEnrolled = enrolled.some((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    } catch {}

    const persistedAvatar = getPersistedAvatar(userProfile.id, userProfile.avatarUrl);
    const finalUser: UserProfile = {
      ...userProfile,
      avatarUrl: persistedAvatar,
      twoFactorEnabled: isMfaEnrolled || userProfile.twoFactorEnabled,
    };

    // Instant cache check so balance appears with zero lag
    const cachedBalances = getCachedUserBalances(uid);
    if (cachedBalances) {
      setBalanceMetrics(cachedBalances);
    }

    // Set user immediately for responsive UI feedback
    setCurrentUser(finalUser);
    cacheUserInDirectory(finalUser);

    // Concurrently synchronize ledger and metrics in parallel
    const [backendSync, notifRes, realFsMetrics] = await Promise.all([
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
        kycStatus: finalUser.kycStatus,
        kycDocumentType: finalUser.kycDocumentType,
        kycDocumentNumber: finalUser.kycDocumentNumber,
        kycVerifiedAt: finalUser.kycVerifiedAt,
        password: cleanPassword,
      }).catch(() => ({ success: true, user: finalUser, balanceMetrics: null })),
      api.getNotifications(uid).catch(() => ({ notifications: [] })),
      firestoreSync.getAccountBalances(uid, finalUser.permanentAccountNumber).catch(() => null)
    ]);

    if (backendSync?.user) {
      const isVerified = userProfile.kycStatus === 'verified' || backendSync.user.kycStatus === 'verified';
      const mergedUser: UserProfile = {
        ...backendSync.user,
        ...userProfile, // Firestore is the single source of truth for customer profile & KYC status
        kycStatus: isVerified ? 'verified' : (userProfile.kycStatus || backendSync.user.kycStatus),
        dailyTransactionLimit: isVerified ? 1000000 : (userProfile.dailyTransactionLimit || backendSync.user.dailyTransactionLimit),
        avatarUrl: persistedAvatar,
        twoFactorEnabled: isMfaEnrolled || userProfile.twoFactorEnabled,
      };
      setCurrentUser(mergedUser);
      cacheUserInDirectory(mergedUser);
    }

    if (realFsMetrics && realFsMetrics.accounts && realFsMetrics.accounts.length > 0) {
      setBalanceMetrics(realFsMetrics);
      cacheUserBalances(uid, realFsMetrics);
    } else if (backendSync?.balanceMetrics && backendSync.balanceMetrics.accounts && backendSync.balanceMetrics.accounts.length > 0) {
      setBalanceMetrics(backendSync.balanceMetrics);
      cacheUserBalances(uid, backendSync.balanceMetrics);
    } else if (!cachedBalances) {
      // Fallback baseline only if user has never transacted
      const initialZeroMetrics: BalanceMetrics = {
        checkingBalance: 0,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 0,
        availableBalance: 0,
        pendingBalance: 0,
        accounts: [
          {
            id: `acc_chk_${uid}`,
            userId: uid,
            type: 'CHECKING',
            accountNumber: finalUser.permanentAccountNumber || '1048291048',
            routingNumber: '021000021',
            currency: 'USD',
            balance: 0,
            availableBalance: 0,
            investedBalance: 0,
            pendingBalance: 0,
            interestRateAPY: 0.05,
            status: 'ACTIVE',
            nickname: 'Monvera Checking Account',
          },
          {
            id: `acc_svg_${uid}`,
            userId: uid,
            type: 'SAVINGS',
            accountNumber: `20${(finalUser.permanentAccountNumber || '1048291048').slice(2)}`,
            routingNumber: '021000021',
            currency: 'USD',
            balance: 0,
            availableBalance: 0,
            investedBalance: 0,
            pendingBalance: 0,
            interestRateAPY: 4.85,
            status: 'ACTIVE',
            nickname: 'Monvera Savings Account',
          }
        ]
      };
      setBalanceMetrics(initialZeroMetrics);
      cacheUserBalances(uid, initialZeroMetrics);
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
    return finalUser;
  };

  /**
   * Real Monvera User Login via Firebase Authentication & Firestore
   */
  const login = async (
    identifier: string,
    password?: string
  ): Promise<{
    success: boolean;
    error?: string;
    mfaRequired?: boolean;
    resolver?: MultiFactorResolver;
    hint?: MultiFactorInfo;
  }> => {
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
      await hydrateUserSession(userCredential.user, cleanPassword, emailToAuth);
      return { success: true };
    } catch (err: any) {
      console.error('[Firebase Auth Login Error]', err);
      if (err?.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, err);
        const totpHint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        return {
          success: false,
          mfaRequired: true,
          resolver,
          hint: totpHint || (resolver.hints[0] as MultiFactorInfo),
        };
      }
      const friendlyMsg = getFirebaseErrorMessage(err);
      return { success: false, error: friendlyMsg };
    } finally {
      setIsLoading(false);
    }
  };

/**
 * Resolve TOTP MFA Challenge during Sign-In
 */
const resolveTotpLogin = async (
  resolver: MultiFactorResolver,
  code: string,
  hintUid: string,
  cleanPassword?: string
): Promise<{ success: boolean; error?: string }> => {
  setIsLoading(true);
  try {
    const cleanCode = code.trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      return { success: false, error: 'Please enter the 6-digit code from your authenticator app.' };
    }
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(hintUid, cleanCode);
    const userCredential = await resolver.resolveSignIn(assertion);
    await hydrateUserSession(userCredential.user, cleanPassword);
    return { success: true };
  } catch (err: any) {
    console.error('[MFA Resolve Error]', err);
    if (err?.code === 'auth/invalid-verification-code' || err?.code === 'auth/invalid-mfa-code') {
      return { success: false, error: 'Invalid authenticator code. Please check your authenticator app and try again.' };
    }
    if (err?.code === 'auth/code-expired') {
      return { success: false, error: 'The verification code has expired. Please enter the current rolling code.' };
    }
    return { success: false, error: err?.message || 'Failed to verify authenticator code.' };
  } finally {
    setIsLoading(false);
  }
};

/**
 * Re-authenticate current user with password for sensitive operations (MFA enrollment/unenrollment)
 */
const reauthenticateUser = async (password: string): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!auth.currentUser || !auth.currentUser.email) {
      return { success: false, error: 'No active authenticated session.' };
    }
    const cred = EmailAuthProvider.credential(auth.currentUser.email, password);
    await reauthenticateWithCredential(auth.currentUser, cred);
    return { success: true };
  } catch (err: any) {
    console.error('[Reauth Error]', err);
    if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
      return { success: false, error: 'Incorrect account password.' };
    }
    return { success: false, error: err?.message || 'Re-authentication failed. Please check your password.' };
  }
};

/**
 * Check if the active Firebase User has an enrolled TOTP factor
 */
const getEnrolledTotpFactor = (): MultiFactorInfo | null => {
  if (!auth.currentUser) return null;
  try {
    const enrolled = multiFactor(auth.currentUser).enrolledFactors;
    return enrolled.find((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID) || null;
  } catch {
    return null;
  }
};

/**
 * Begin Real Firebase TOTP Multi-Factor Enrollment
 */
const startTotpEnrollment = async (): Promise<{
  success: boolean;
  totpSecret?: TotpSecret;
  qrCodeUrl?: string;
  secretKey?: string;
  error?: string;
  requiresReauth?: boolean;
}> => {
  if (!auth.currentUser) {
    return { success: false, error: 'You must be signed in to configure 2-Factor Authentication.' };
  }
  try {
    const multiFactorSession = await multiFactor(auth.currentUser).getSession();
    const totpSecret = await TotpMultiFactorGenerator.generateSecret(multiFactorSession);
    const email = auth.currentUser.email || currentUser?.email || 'customer@monvera.com';
    const qrCodeUrl = totpSecret.generateQrCodeUrl(email, 'Monvera Bank');
    return {
      success: true,
      totpSecret,
      qrCodeUrl,
      secretKey: totpSecret.secretKey,
    };
  } catch (err: any) {
    console.warn('[Firebase TOTP Setup Note]', err);
    if (err?.code === 'auth/requires-recent-login') {
      return {
        success: false,
        error: 'Recent authentication is required. Please re-enter your password to proceed.',
        requiresReauth: true,
      };
    }
    return {
      success: false,
      error: err?.message || 'Failed to initialize TOTP enrollment with Firebase.',
    };
  }
};

/**
 * Finalize Real Firebase TOTP Enrollment with verified 6-digit code
 */
const finishTotpEnrollment = async (
  totpSecret: TotpSecret,
  verificationCode: string,
  displayName: string = 'Google Authenticator'
): Promise<{ success: boolean; error?: string }> => {
  if (!auth.currentUser) {
    return { success: false, error: 'User is not logged in.' };
  }
  try {
    const cleanCode = verificationCode.replace(/\s+/g, '').trim();
    if (!cleanCode || cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      return { success: false, error: 'Please enter a valid 6-digit numeric verification code.' };
    }

    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, cleanCode);
    await multiFactor(auth.currentUser).enroll(assertion, displayName);

    if (currentUser) {
      const updatedUser: UserProfile = {
        ...currentUser,
        twoFactorEnabled: true,
      };
      setCurrentUser(updatedUser);
      cacheUserInDirectory(updatedUser);
      await firestoreSync.saveUserProfile(currentUser.id, { twoFactorEnabled: true }).catch(() => {});
    }

    return { success: true };
  } catch (err: any) {
    console.error('[Firebase TOTP Enrollment Error]', err);
    if (err?.code === 'auth/invalid-verification-code') {
      return {
        success: false,
        error: 'Invalid 6-digit authentication code. Please check Google Authenticator and try again.',
      };
    }
    if (err?.code === 'auth/requires-recent-login') {
      return {
        success: false,
        error: 'Your session has expired. Please re-enter your password and try again.',
      };
    }
    return {
      success: false,
      error: err?.message || 'Failed to complete TOTP enrollment.',
    };
  }
};

/**
 * Unenroll Real Firebase TOTP Multi-Factor Authentication
 */
const unenrollTotpMfa = async (): Promise<{
  success: boolean;
  error?: string;
  requiresReauth?: boolean;
}> => {
  if (!auth.currentUser) {
    return { success: false, error: 'User is not logged in.' };
  }
  try {
    const enrolled = multiFactor(auth.currentUser).enrolledFactors;
    const totpFactor = enrolled.find((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);

    if (totpFactor) {
      await multiFactor(auth.currentUser).unenroll(totpFactor);
    }

    if (currentUser) {
      const updatedUser: UserProfile = {
        ...currentUser,
        twoFactorEnabled: false,
      };
      setCurrentUser(updatedUser);
      cacheUserInDirectory(updatedUser);
      await firestoreSync.saveUserProfile(currentUser.id, { twoFactorEnabled: false }).catch(() => {});
    }

    return { success: true };
  } catch (err: any) {
    console.error('[Firebase TOTP Unenroll Error]', err);
    if (err?.code === 'auth/requires-recent-login') {
      return {
        success: false,
        error: 'Recent authentication is required. Please re-enter your password to disable 2FA.',
        requiresReauth: true,
      };
    }
    return {
      success: false,
      error: err?.message || 'Failed to unenroll Two-Factor Authentication.',
    };
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
      cacheUserInDirectory(finalUser);
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

  // Email verification helper without intrusive window focus listener

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
        resolveTotpLogin,
        reauthenticateUser,
        getEnrolledTotpFactor,
        startTotpEnrollment,
        finishTotpEnrollment,
        unenrollTotpMfa,
        logout,
        switchUser,
        registerUser,
        refreshProfile,
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
