import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, NotificationItem } from '../types';
import { api, BalanceMetrics } from '../services/api';

export type AppView =
  | 'home'
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
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    country?: string;
    isBusiness?: boolean;
    businessName?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  refreshBalance: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  replyToSupport: (notificationId: string, message: string) => Promise<{ success: boolean; error?: string }>;
  lastUpdateTimestamp: number;
  // Quick Action Modal Triggers
  activeModal: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_login' | 'auth_register' | null;
  openModal: (modal: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_login' | 'auth_register' | null) => void;
  closeModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [balanceMetrics, setBalanceMetrics] = useState<BalanceMetrics | null>(null);
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([]);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number>(Date.now());
  const [activeModal, setActiveModal] = useState<'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_login' | 'auth_register' | null>(null);

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
      setBalanceMetrics(metrics);
      setLastUpdateTimestamp(Date.now());
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

  // Real-time synchronization interval (every 4 seconds for instant transfer reflection)
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      refreshBalance();
      refreshNotifications();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser, refreshBalance, refreshNotifications]);

  const switchUser = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      const res = await api.getCurrentUser(userId);
      if (res.user) {
        setCurrentUser(res.user);
        setBalanceMetrics(res.balanceMetrics);
        const notifRes = await api.getNotifications(res.user.id);
        if (notifRes.notifications) setNotifications(notifRes.notifications);
      }
    } catch (err) {
      console.error('Error switching user:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load: fetch users & set default demo customer (Eleanor Vance)
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      await fetchUsers();
      try {
        const res = await api.getCurrentUser('usr_eleanor');
        if (res.user) {
          setCurrentUser(res.user);
          setBalanceMetrics(res.balanceMetrics);
          const notifRes = await api.getNotifications(res.user.id);
          if (notifRes.notifications) setNotifications(notifRes.notifications);
        }
      } catch (err) {
        console.error('Initial user fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [fetchUsers]);

  const login = async (identifier: string, password?: string) => {
    setIsLoading(true);
    try {
      const res = await api.login(identifier, password);
      if (res.success && res.user && res.balanceMetrics) {
        setCurrentUser(res.user);
        setBalanceMetrics(res.balanceMetrics);
        await refreshNotifications();
        if (res.user.role === 'super_admin' || res.user.role === 'admin') {
          setCurrentView('admin');
        } else {
          setCurrentView('dashboard');
        }
        setActiveModal(null);
        return { success: true };
      }
      return { success: false, error: res.error || 'Authentication failed' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network connection failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setCurrentUser(null);
    setBalanceMetrics(null);
    setCurrentView('home');
  };

  const registerUser = async (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    country?: string;
    isBusiness?: boolean;
    businessName?: string;
  }) => {
    setIsLoading(true);
    try {
      const res = await api.register(data);
      if (res.success && res.user && res.balanceMetrics) {
        setCurrentUser(res.user);
        setBalanceMetrics(res.balanceMetrics);
        await fetchUsers();
        await refreshNotifications();
        setCurrentView('dashboard');
        setActiveModal(null);
        return { success: true };
      }
      return { success: false, error: res.error || 'Registration failed' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error occurred' };
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

  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

  const openModal = (modal: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest' | 'auth_login' | 'auth_register' | null) => {
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
