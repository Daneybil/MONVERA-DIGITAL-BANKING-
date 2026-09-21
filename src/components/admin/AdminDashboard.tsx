import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync, isNonExistentAccount } from '../../services/firestoreSync';
import {
  UserProfile,
  UserStatus,
  KycStatus,
  Transaction,
  AdminAuditLog,
  AdminSystemOverview,
  TransactionStatus,
  LoanApplication,
} from '../../types';
import {
  Shield,
  Coins,
  Users,
  Layers,
  Activity,
  ArrowRight,
  ArrowLeft,
  Plus,
  Lock,
  Unlock,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Zap,
  Building,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  Bell,
  FileText,
  Clock,
  Sparkles,
  MessageSquare,
  Home,
  Send,
  Banknote,
  Webhook,
} from 'lucide-react';
import { AdminOverviewView } from './AdminOverviewView';
import { AdminCustomersView } from './AdminCustomersView';
import { AdminKycView } from './AdminKycView';
import { AdminSupportView } from './AdminSupportView';
import { AdminTransactionsView } from './AdminTransactionsView';
import { AdminDepositsView } from './AdminDepositsView';
import { AdminWithdrawalsView } from './AdminWithdrawalsView';
import { AdminTransfersView } from './AdminTransfersView';
import { AdminDemoFundsView } from './AdminDemoFundsView';
import { AdminNotificationsView } from './AdminNotificationsView';
import { AdminAuditLogView } from './AdminAuditLogView';
import { AdminLoansView } from './AdminLoansView';
import { AdminWebhooksView } from './AdminWebhooksView';
import { AdminCustomerDetailsModal } from './AdminCustomerDetailsModal';

export const AdminDashboard: React.FC = () => {
  const { currentUser, balanceMetrics: currentAuthBalanceMetrics, refreshBalance, refreshNotifications, setCurrentView, openModal, updateUser } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('overview');
  const [metrics, setMetrics] = useState<AdminSystemOverview | null>(null);
  const [customers, setCustomers] = useState<(UserProfile & { balanceMetrics?: any })[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<(UserProfile & { balanceMetrics?: any }) | null>(null);
  const [pendingLiveChatsCount, setPendingLiveChatsCount] = useState<number>(0);
  const [adminLoans, setAdminLoans] = useState<LoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Helper to merge Firestore users and server customers seamlessly without duplicate accounts
  const mergeCustomers = (
    firestoreUsers: (UserProfile & { balanceMetrics?: any })[],
    serverUsers: (UserProfile & { balanceMetrics?: any })[],
    loggedInUser?: UserProfile | null
  ): (UserProfile & { balanceMetrics?: any })[] => {
    const userMap = new Map<string, UserProfile & { balanceMetrics?: any }>();
    const seenAccountNums = new Set<string>();

    const frozenRaw = typeof window !== 'undefined' ? localStorage.getItem('monvera_frozen_accounts') : null;
    const frozenIds = new Set<string>(frozenRaw ? JSON.parse(frozenRaw) : []);

    // Ensure customer balances are 100% synchronized with what is on the user dashboard
    const resolveCustomerBalances = (
      userId: string,
      accNum?: string,
      incomingMetrics?: any
    ): any => {
      let checking = Number(incomingMetrics?.checkingBalance || 0);
      let savings = Number(incomingMetrics?.savingsBalance || 0);
      let invested = Number(incomingMetrics?.investedBalance || 0);
      let accrued = Number(incomingMetrics?.accruedEarnings || 0);
      let total = Number(incomingMetrics?.totalBalance || (checking + savings + invested + accrued));

      // Always check localStorage for live balance on user dashboard
      if (typeof window !== 'undefined') {
        try {
          const candidates = [
            localStorage.getItem(`monvera_balances_${userId}`),
            accNum ? localStorage.getItem(`monvera_balances_${accNum}`) : null,
          ];
          for (const raw of candidates) {
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed) {
              const lChk = Number(parsed.checkingBalance || 0);
              const lSav = Number(parsed.savingsBalance || 0);
              const lInv = Number(parsed.investedBalance || 0);
              const lAcc = Number(parsed.accruedEarnings || 0);
              const lTot = Number(parsed.totalBalance || (lChk + lSav + lInv + lAcc));
              if (lTot > 0 || lChk > 0) {
                checking = lChk;
                savings = lSav;
                invested = lInv;
                accrued = lAcc;
                total = lTot;
                break;
              }
            }
          }
        } catch {}
      }

      return {
        checkingBalance: checking,
        savingsBalance: savings,
        investedBalance: invested,
        accruedEarnings: accrued,
        totalBalance: total || (checking + savings + invested + accrued),
        availableBalance: Number(incomingMetrics?.availableBalance || checking),
        pendingBalance: Number(incomingMetrics?.pendingBalance || 0),
        accounts: incomingMetrics?.accounts || [],
      };
    };

    const firestoreCustomerIds = new Set<string>();

    const registerCustomer = (u: UserProfile & { balanceMetrics?: any }, source: 'firestore' | 'local' | 'auth' | 'server') => {
      if (!u || !u.id) return;
      // Admin is executive staff; customers table displays banking clients
      if (u.id === 'usr_admin' || u.role === 'super_admin') return;
      if (isNonExistentAccount(u)) return;

      if (source === 'firestore') {
        firestoreCustomerIds.add(u.id);
      }

      const emailKey = (u.email || '').toLowerCase().trim();
      const accKey = (u.permanentAccountNumber || '').replace(/[-\s]/g, '');
      const shouldBeFrozen = frozenIds.has(u.id) || (emailKey && frozenIds.has(emailKey)) || u.status === 'frozen';
      if (shouldBeFrozen) {
        u.status = 'frozen';
      }

      // Check if already in map by ID
      if (userMap.has(u.id)) {
        const existing = userMap.get(u.id)!;
        const isExistingFirestore = firestoreCustomerIds.has(u.id);
        const isIncomingFirestore = source === 'firestore';

        // Authoritative KYC resolution: Firestore is the single source of truth (KYC FIX #1, #2)
        let effectiveKycStatus: KycStatus = 'unverified';
        if (isIncomingFirestore) {
          effectiveKycStatus = u.kycStatus || 'unverified';
        } else if (isExistingFirestore) {
          effectiveKycStatus = existing.kycStatus || 'unverified';
        } else if (existing.kycStatus === 'verified' || u.kycStatus === 'verified') {
          effectiveKycStatus = 'verified';
        } else {
          effectiveKycStatus = u.kycStatus || existing.kycStatus || 'unverified';
        }

        const mergedObj = {
          ...existing,
          ...u,
          status: ((shouldBeFrozen || existing.status === 'frozen' || u.status === 'frozen') ? 'frozen' : (u.status || existing.status || 'active')) as UserStatus,
          kycStatus: effectiveKycStatus,
          kycVerifiedAt: (effectiveKycStatus === 'verified')
            ? (u.kycVerifiedAt || existing.kycVerifiedAt || new Date().toISOString())
            : (u.kycVerifiedAt || existing.kycVerifiedAt),
          kycDocumentImage: u.kycDocumentImage || existing.kycDocumentImage,
          kycDocumentBackImage: u.kycDocumentBackImage || existing.kycDocumentBackImage,
          kycProofOfAddressImage: u.kycProofOfAddressImage || existing.kycProofOfAddressImage,
          kycLiveSelfieImage: u.kycLiveSelfieImage || existing.kycLiveSelfieImage,
          kycSsn: u.kycSsn || existing.kycSsn,
          kycSsnImage: u.kycSsnImage || existing.kycSsnImage,
          kycDocumentNumber: u.kycDocumentNumber || existing.kycDocumentNumber,
          kycDocumentType: u.kycDocumentType || existing.kycDocumentType,
          balanceMetrics: resolveCustomerBalances(u.id, accKey, u.balanceMetrics || existing.balanceMetrics),
        };
        userMap.set(u.id, mergedObj);
        return;
      }

      // Check if already in map by unique permanent account number (if non-default)
      if (accKey && accKey !== '1000000000' && accKey !== '1000000001' && seenAccountNums.has(accKey)) {
        for (const [id, ex] of userMap.entries()) {
          const exAcc = (ex.permanentAccountNumber || '').replace(/[-\s]/g, '');
          if (exAcc && exAcc === accKey) {
            const isExFirestore = firestoreCustomerIds.has(id);
            const resolvedKyc = (isExFirestore ? ex.kycStatus : (ex.kycStatus === 'verified' || u.kycStatus === 'verified' ? 'verified' : (u.kycStatus || ex.kycStatus || 'unverified'))) as KycStatus;
            userMap.set(id, {
              ...ex,
              ...u,
              kycStatus: resolvedKyc,
              kycVerifiedAt: resolvedKyc === 'verified' ? (ex.kycVerifiedAt || u.kycVerifiedAt) : undefined,
              kycDocumentImage: u.kycDocumentImage || ex.kycDocumentImage,
              kycDocumentBackImage: u.kycDocumentBackImage || ex.kycDocumentBackImage,
              kycProofOfAddressImage: u.kycProofOfAddressImage || ex.kycProofOfAddressImage,
              kycLiveSelfieImage: u.kycLiveSelfieImage || ex.kycLiveSelfieImage,
              kycSsn: u.kycSsn || ex.kycSsn,
              kycSsnImage: u.kycSsnImage || ex.kycSsnImage,
              balanceMetrics: resolveCustomerBalances(id, accKey, u.balanceMetrics || ex.balanceMetrics),
            });
            return;
          }
        }
      }

      // Add as distinct customer account (never deduplicate by email so all registered accounts are visible)
      u.balanceMetrics = resolveCustomerBalances(u.id, accKey, u.balanceMetrics);
      userMap.set(u.id, u);
      if (accKey) seenAccountNums.add(accKey);
      // NOTE: No stale write-backs to Firestore from merge process (KYC FIX #2)
    };

    // 1. First add real users from Firestore (authoritative cloud database)
    for (const fsUser of firestoreUsers) {
      if (!isNonExistentAccount(fsUser)) {
        registerCustomer(fsUser, 'firestore');
      }
    }

    // 2. Read local persistent accounts directory from localStorage (only verified real accounts)
    try {
      const localDirRaw = typeof window !== 'undefined' ? localStorage.getItem('monvera_accounts_directory') : null;
      if (localDirRaw) {
        const localList: UserProfile[] = JSON.parse(localDirRaw);
        for (const lu of localList) {
          if (!isNonExistentAccount(lu)) {
            registerCustomer(lu, 'local');
          }
        }
      }
    } catch {}

    // 3. Include currently logged-in user if available and is a customer
    if (loggedInUser && loggedInUser.id && loggedInUser.id !== 'usr_admin' && loggedInUser.role !== 'super_admin') {
      registerCustomer(
        {
          ...loggedInUser,
          balanceMetrics: currentAuthBalanceMetrics || (loggedInUser as any).balanceMetrics,
        },
        'auth'
      );
    }

    // 4. Include server users if any
    for (const sUser of serverUsers) {
      registerCustomer(sUser, 'server');
    }

    return Array.from(userMap.values());
  };

  const loadAllAdminData = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, custRes, txRes, logsRes, firestoreUsers, tickets, loansRes] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminCustomers(),
        api.getTransactions(),
        api.getAdminAuditLogs(),
        firestoreSync.getAllUsersWithBalances(),
        firestoreSync.getAllSupportTickets(),
        api.getLoans().catch(() => ({ loans: [] })),
      ]);

      const merged = mergeCustomers(firestoreUsers || [], custRes.customers || [], currentUser);
      setCustomers(merged);
      setSupportTickets(tickets || []);
      if (loansRes?.loans) setAdminLoans(loansRes.loans);

      const totalUserDeposits = merged.reduce((acc, c) => acc + (c.balanceMetrics?.totalBalance || 0), 0);

      if (overviewRes) {
        setMetrics({
          ...overviewRes,
          totalCustomers: merged.length,
          activeAccounts: merged.length * 3,
          totalPlatformDeposits: totalUserDeposits > 0 ? totalUserDeposits : overviewRes.totalPlatformDeposits,
        });
      } else {
        setMetrics({
          totalCustomers: merged.length,
          activeAccounts: merged.length * 3,
          totalPlatformDeposits: totalUserDeposits,
          totalPlatformWithdrawals: 0,
          totalPlatformTransfers: 0,
          totalPlatformInvestments: 0,
          pendingTransactionsCount: 0,
          failedTransactionsCount: 0,
          devFundingPoolBalance: 1000000000,
          systemReserveRatio: 100,
          activeNodesCount: 8,
        });
      }

      if (txRes.transactions) setTransactions(txRes.transactions);
      if (logsRes.auditLogs) setAuditLogs(logsRes.auditLogs);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load and real-time subscription to newly registered users in Firestore
  useEffect(() => {
    loadAllAdminData();

    // Subscribe to Firestore users with balances collection so new signups appear automatically
    const unsubscribeUsers = firestoreSync.subscribeToUsersWithBalances((firestoreUsers) => {
      if (firestoreUsers) {
        setCustomers(() => {
          const merged = mergeCustomers(firestoreUsers, [], currentUser);
          setMetrics((prevMetrics) =>
            prevMetrics
              ? {
                  ...prevMetrics,
                  totalCustomers: merged.length,
                  activeAccounts: merged.length * 3,
                }
              : null
          );
          return merged;
        });
      }
    });

    // Subscribe to Support Tickets
    const unsubscribeTickets = firestoreSync.subscribeToSupportTickets((liveTickets) => {
      if (liveTickets) {
        setSupportTickets(liveTickets);
      }
    });

    // Subscribe to Live Customer Chat Messages (alerts admin when any customer sends a message)
    const unsubscribeChats = firestoreSync.subscribeToAllChatMessages((liveMessages) => {
      if (liveMessages) {
        const unrepliedCustomerMsgs = liveMessages.filter(
          (m) => m.sender === 'user' && m.status !== 'read'
        );
        const uniquePendingUsers = new Set(unrepliedCustomerMsgs.map((m) => m.userId));
        setPendingLiveChatsCount(uniquePendingUsers.size);
      }
    });

    // Subscribe to Loans (alerts admin with a blinking notification when loans arrive)
    const unsubscribeLoans = firestoreSync.subscribeToLoans((liveLoans) => {
      if (liveLoans) {
        setAdminLoans(liveLoans);
      }
    });

    return () => {
      if (unsubscribeUsers) unsubscribeUsers();
      if (unsubscribeTickets) unsubscribeTickets();
      if (unsubscribeChats) unsubscribeChats();
      if (unsubscribeLoans) unsubscribeLoans();
    };
  }, []);

  const handleToggleFreezeUser = async (userId: string, reason: string) => {
    try {
      const existing = customers.find((c) => c.id === userId);
      const nextStatus = existing?.status === 'frozen' ? 'active' : 'frozen';

      // Immediate optimistic update in state
      setCustomers((prev) => prev.map((c) => (c.id === userId ? { ...c, status: nextStatus } : c)));
      if (selectedCustomer?.id === userId) {
        setSelectedCustomer((prev) => (prev ? { ...prev, status: nextStatus } : null));
      }

      const res = await api.toggleCustomerStatus(userId, {
        adminId: currentUser?.id,
        reason: reason || 'Administrative compliance audit',
        targetStatus: nextStatus,
      });
      if (res.success) {
        await loadAllAdminData();
        await refreshNotifications();
      }
    } catch (err) {
      console.error('Error toggling customer freeze status:', err);
    }
  };

  const handleApproveKyc = async (userId: string, passedCustomer?: UserProfile & { balanceMetrics?: any }) => {
    const existingCust = passedCustomer || customers.find((c) => c.id === userId);
    const now = new Date().toISOString();

    // 1. Instant optimistic UI update (0ms lag for Admin)
    const optimisticVerified = existingCust
      ? {
          ...existingCust,
          kycStatus: 'verified' as const,
          status: 'active' as const,
          dailyTransactionLimit: 1000000,
          kycVerifiedAt: now,
          kycRejectionReason: '',
          kycItemReviews: {
            identity: { status: 'approved' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin' },
            proofOfAddress: { status: 'approved' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin' },
            liveness: { status: 'approved' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin' },
            ...(existingCust.kycSsn
              ? { ssn: { status: 'approved' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin' } }
              : {}),
          },
        }
      : null;

    if (optimisticVerified) {
      setCustomers((prev) => prev.map((c) => (c.id === userId ? { ...c, ...optimisticVerified } : c)));
      if (selectedCustomer?.id === userId) {
        setSelectedCustomer((prev) => (prev ? { ...prev, ...optimisticVerified } : null));
      }
    }

    // 2. If the approved user happens to be the currently active session, update currentUser immediately
    if (currentUser?.id === userId && optimisticVerified) {
      updateUser({
        ...currentUser,
        kycStatus: 'verified',
        status: 'active',
        dailyTransactionLimit: 1000000,
        kycVerifiedAt: now,
        kycRejectionReason: '',
      });
    }

    try {
      // 3. Authoritative approval via API service (persists directly to Firestore and verifies the write)
      const res = await api.adminApproveKyc(
        { userId, adminId: currentUser?.id || 'usr_admin', userProfile: (existingCust || optimisticVerified) as any }
      );
      if (res.success && res.user) {
        if (currentUser?.id === userId) {
          updateUser(res.user);
        }
        setCustomers((prev) => prev.map((c) => (c.id === userId ? { ...c, ...res.user } : c)));
        if (selectedCustomer?.id === userId) {
          setSelectedCustomer((prev) => (prev ? { ...prev, ...res.user } : null));
        }
      } else {
        console.error('[AdminDashboard] KYC approval failed:', res.error);
        // Rollback optimistic update on failure
        if (existingCust) {
          setCustomers((prev) => prev.map((c) => (c.id === userId ? existingCust : c)));
          if (selectedCustomer?.id === userId) {
            setSelectedCustomer(existingCust);
          }
          if (currentUser?.id === userId) {
            updateUser(existingCust);
          }
        }
      }
      refreshNotifications().catch(() => {});
    } catch (err) {
      console.error('Error approving KYC:', err);
      if (existingCust) {
        setCustomers((prev) => prev.map((c) => (c.id === userId ? existingCust : c)));
        if (selectedCustomer?.id === userId) {
          setSelectedCustomer(existingCust);
        }
        if (currentUser?.id === userId) {
          updateUser(existingCust);
        }
      }
    }
  };

  const handleRejectKyc = async (userId: string, reason: string, passedCustomer?: UserProfile & { balanceMetrics?: any }) => {
    const existingCust = passedCustomer || customers.find((c) => c.id === userId);
    const now = new Date().toISOString();

    const optimisticRejected = existingCust
      ? {
          ...existingCust,
          kycStatus: 'action_required' as const,
          kycRejectionReason: reason,
          dailyTransactionLimit: 25000,
          kycItemReviews: {
            identity: { status: 'rejected' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin', reason },
            proofOfAddress: { status: 'rejected' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin', reason },
            liveness: { status: 'rejected' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin', reason },
            ...(existingCust.kycSsn
              ? { ssn: { status: 'rejected' as const, reviewedAt: now, reviewedBy: currentUser?.id || 'usr_admin', reason } }
              : {}),
          },
        }
      : null;

    if (optimisticRejected) {
      setCustomers((prev) => prev.map((c) => (c.id === userId ? { ...c, ...optimisticRejected } : c)));
      if (selectedCustomer?.id === userId) {
        setSelectedCustomer((prev) => (prev ? { ...prev, ...optimisticRejected } : null));
      }
    }

    if (currentUser?.id === userId && optimisticRejected) {
      updateUser({
        ...currentUser,
        kycStatus: 'action_required',
        kycRejectionReason: reason,
        dailyTransactionLimit: 25000,
      });
    }

    try {
      const res = await api.adminRejectKyc(
        { userId, reason, adminId: currentUser?.id || 'usr_admin', userProfile: (existingCust || optimisticRejected) as any }
      );
      if (res.success && res.user) {
        if (currentUser?.id === userId) {
          updateUser(res.user);
        }
        setCustomers((prev) => prev.map((c) => (c.id === userId ? { ...c, ...res.user } : c)));
        if (selectedCustomer?.id === userId) {
          setSelectedCustomer((prev) => (prev ? { ...prev, ...res.user } : null));
        }
      } else {
        console.error('[AdminDashboard] KYC rejection failed:', res.error);
        if (existingCust) {
          setCustomers((prev) => prev.map((c) => (c.id === userId ? existingCust : c)));
          if (selectedCustomer?.id === userId) {
            setSelectedCustomer(existingCust);
          }
          if (currentUser?.id === userId) {
            updateUser(existingCust);
          }
        }
      }
      refreshNotifications().catch(() => {});
    } catch (err) {
      console.error('Error rejecting KYC:', err);
      if (existingCust) {
        setCustomers((prev) => prev.map((c) => (c.id === userId ? existingCust : c)));
        if (selectedCustomer?.id === userId) {
          setSelectedCustomer(existingCust);
        }
        if (currentUser?.id === userId) {
          updateUser(existingCust);
        }
      }
    }
  };

  const handleReviewKycItem = async (
    userId: string,
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn',
    status: 'approved' | 'rejected',
    reason?: string,
    passedCustomer?: UserProfile & { balanceMetrics?: any }
  ) => {
    const existingCust = passedCustomer || customers.find((c) => c.id === userId);
    try {
      const res = await api.adminReviewKycItem({
        userId,
        itemName,
        status,
        reason,
        adminId: currentUser?.id || 'usr_admin',
        userProfile: existingCust as any,
      });
      if (res.success && res.user) {
        if (currentUser?.id === userId) {
          updateUser(res.user);
        }
        setCustomers((prev) => prev.map((c) => (c.id === userId ? { ...c, ...res.user } : c)));
        if (selectedCustomer?.id === userId) {
          setSelectedCustomer((prev) => (prev ? { ...prev, ...res.user } : null));
        }
      }
      refreshNotifications().catch(() => {});
    } catch (err) {
      console.error('Error reviewing KYC item:', err);
    }
  };

  const handleUpdateTransactionStatus = async (
    txId: string,
    status: TransactionStatus,
    reason: string
  ) => {
    try {
      const res = await api.adminUpdateTransactionStatus(
        txId,
        status,
        reason,
        currentUser?.id || 'usr_admin'
      );
      if (res.success) {
        await loadAllAdminData();
        await refreshBalance();
        await refreshNotifications();
      }
    } catch (err) {
      console.error('Error updating transaction status:', err);
    }
  };

  const handleAdminTransfer = async (params: {
    targetUserId: string;
    amount: number;
    description: string;
  }) => {
    try {
      const res = await api.sendAdminTransfer({
        adminId: currentUser?.id || 'usr_admin',
        targetUserId: params.targetUserId,
        amount: params.amount,
        description: params.description,
      });

      if (res.success) {
        await loadAllAdminData();
        await refreshBalance();
        await refreshNotifications();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to complete administrative transfer.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Server error' };
    }
  };

  const handleIssueDevFunding = async (params: {
    targetUserId: string;
    amount: number;
    reason: string;
    targetAccountType: 'CHECKING' | 'SAVINGS';
  }) => {
    try {
      const res = await api.issueAdminDevFunding({
        adminId: currentUser?.id || 'usr_admin',
        targetUserId: params.targetUserId,
        amount: params.amount,
        reason: params.reason,
        targetAccountType: params.targetAccountType,
      });

      if (res.success) {
        await loadAllAdminData();
        await refreshBalance();
        await refreshNotifications();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to issue sandbox funding.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Server error' };
    }
  };

  const handleTopUpPool = async (amount: number) => {
    try {
      const res = await api.topUpDevFundingPool({
        adminId: currentUser?.id || 'usr_admin',
        amount,
        reason: 'Authorized Reserve Capital Injection',
      });
      if (res.success) {
        await loadAllAdminData();
        return { success: true };
      }
      return { success: false, error: 'Failed to replenish pool' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Server error' };
    }
  };

  const pendingKycCount = customers.filter((c) => c.kycStatus === 'pending').length;
  const pendingTxCount = transactions.filter((t) => t.status === 'PENDING').length;
  const openTicketsCount = supportTickets.filter((t) => t.supportStatus === 'OPEN' || !t.supportStatus).length;
  const pendingLoansCount = adminLoans.filter((l) => l.status === 'PENDING').length;
  const totalLoansCount = adminLoans.length;

  const navTabs = [
    { id: 'overview', label: 'Overview', icon: Building },
    { id: 'customers', label: 'Customers', icon: Users, badge: customers.length },
    { id: 'kyc', label: 'KYC & Compliance', icon: ShieldCheck, alertBadge: pendingKycCount },
    { id: 'support', label: 'Support & Live Chat', icon: MessageSquare, alertBadge: pendingLiveChatsCount > 0 ? pendingLiveChatsCount : (openTicketsCount > 0 ? openTicketsCount : undefined) },
    { id: 'transactions', label: 'Transactions', icon: RefreshCw, alertBadge: pendingTxCount },
    { id: 'deposits', label: 'Deposits', icon: ArrowDownLeft },
    { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpRight },
    { id: 'transfers', label: 'Transfers', icon: Zap },
    {
      id: 'loans',
      label: 'Loan Monvera',
      icon: Banknote,
      alertBadge: pendingLoansCount > 0 ? pendingLoansCount : undefined,
      hasBlinkingAlert: pendingLoansCount > 0 || totalLoansCount > 0,
      blinkingText: pendingLoansCount > 0 ? `${pendingLoansCount} NEW` : (totalLoansCount > 0 ? `${totalLoansCount} LOANS` : undefined),
    },
    { id: 'demo_funds', label: 'Sandbox Test Funds', icon: Coins },
    { id: 'webhooks', label: 'Webhooks & API', icon: Webhook },
    { id: 'notifications', label: 'Sentinel Alerts', icon: Bell },
    { id: 'audit', label: 'Audit Trail', icon: FileText },
  ];

  return (
    <div id="monvera-admin-command-center" className="min-h-screen bg-slate-100/60 pb-16">
      
      {/* Top Professional Master Navigation Bar */}
      <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20 gap-4">
            
            {/* Brand / Admin Identity */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black shadow-md">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-black text-white tracking-tight">MONVERA</h1>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-400/25 border border-amber-400/50 text-amber-300">
                    BANKING CONTROL CENTER
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Administrative Clearance Level 4</span>
                </div>
              </div>
            </div>

            {/* Quick System Tools */}
            <div className="flex items-center gap-2.5 sm:gap-3.5">
              {/* Send Money Button (Prominent, matching reference) */}
              <button
                id="admin-header-send-money-btn"
                onClick={() => openModal('send')}
                className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md hover:shadow-lg transition-all cursor-pointer border border-emerald-500/60 active:scale-95"
                title="Send Money to Customer Account"
              >
                <Send className="w-4 h-4 text-white stroke-[2.5]" />
                <span>Send Money</span>
              </button>

              {/* Back to Member Portal / Public Website Button */}
              <button
                id="admin-return-portal-btn"
                onClick={() => {
                  setCurrentView(currentUser ? 'dashboard' : 'home');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 text-xs font-black border border-slate-700 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Return to Member Dashboard"
              >
                <ArrowLeft className="w-4 h-4 text-amber-400 stroke-[3]" />
                <span className="font-extrabold">{currentUser ? 'Back to Dashboard' : 'Back to Home'}</span>
              </button>

              <div className="hidden md:flex items-center gap-2 text-xs text-slate-300 font-mono font-semibold">
                <span>Last Sync:</span>
                <span className="text-white font-bold">{lastRefreshed.toLocaleTimeString()}</span>
              </div>

              <button
                onClick={loadAllAdminData}
                disabled={isLoading}
                className="p-2 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <div className="flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-800">
                <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-black text-amber-400">
                  {currentUser?.firstName?.[0] || 'B'}
                </div>
                <div className="hidden lg:block text-left">
                  <div className="font-bold text-xs text-white">{currentUser?.firstName || 'Bennett'} {currentUser?.lastName || 'Johnson'}</div>
                  <div className="text-[11px] font-medium text-amber-400/90">Chief Executive Admin</div>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-Navigation Bar Tabs */}
          <nav className="flex items-center gap-1.5 overflow-x-auto py-2.5 border-t border-slate-800/80 no-scrollbar">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-400 text-slate-950 shadow-md font-extrabold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80 font-bold'
                  }`}
                >
                  <Icon className={`w-4.5 h-4.5 ${isActive ? 'text-slate-950 stroke-[2.5]' : 'text-slate-400 stroke-[2]'}`} />
                  <span>{tab.label}</span>

                  {tab.hasBlinkingAlert && (
                    <span
                      className="relative inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white shadow-md animate-pulse ml-0.5"
                      title="New loan activity / messages"
                    >
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-200 opacity-90"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                      </span>
                      <span>{tab.blinkingText || 'ALERT'}</span>
                    </span>
                  )}

                  {tab.alertBadge !== undefined && tab.alertBadge > 0 && !tab.hasBlinkingAlert && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-black ${
                        isActive
                          ? 'bg-slate-950 text-amber-400'
                          : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {tab.alertBadge}
                    </span>
                  )}

                  {tab.badge !== undefined && tab.alertBadge === undefined && !tab.hasBlinkingAlert && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                        isActive
                          ? 'bg-slate-950/20 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* Navigation Breadcrumb Bar with Quick Back Action */}
        <div className="mb-6 flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                setCurrentView(currentUser ? 'dashboard' : 'home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-black transition-colors cursor-pointer shadow-2xs"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-slate-600 stroke-[2.5]" />
              <span>Back to User Banking Portal</span>
            </button>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {navTabs.find((t) => t.id === activeTab)?.label || 'Control Center'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openModal('send')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-xs transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Money</span>
            </button>
          </div>
        </div>

        {activeTab === 'overview' && (
          <AdminOverviewView
            metrics={metrics}
            customers={customers}
            transactions={transactions}
            auditLogs={auditLogs}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onSelectCustomer={(cust) => setSelectedCustomer(cust)}
            onOpenSendMoney={() => openModal('send')}
          />
        )}

        {activeTab === 'customers' && (
          <AdminCustomersView
            customers={customers}
            onSelectCustomer={(cust) => setSelectedCustomer(cust)}
            onToggleStatus={handleToggleFreezeUser}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'kyc' && (
          <AdminKycView
            customers={customers}
            onApproveKyc={handleApproveKyc}
            onRejectKyc={handleRejectKyc}
            onReviewKycItem={handleReviewKycItem}
            onSelectCustomer={(cust) => setSelectedCustomer(cust)}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'support' && (
          <AdminSupportView
            customers={customers}
            onSelectCustomer={(cust) => setSelectedCustomer(cust)}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'transactions' && (
          <AdminTransactionsView
            transactions={transactions}
            onUpdateStatus={handleUpdateTransactionStatus}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'deposits' && (
          <AdminDepositsView
            transactions={transactions}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'withdrawals' && (
          <AdminWithdrawalsView
            transactions={transactions}
            onUpdateStatus={handleUpdateTransactionStatus}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'transfers' && (
          <AdminTransfersView
            transactions={transactions}
            customers={customers}
            onAdminTransfer={handleAdminTransfer}
            onOpenSendMoney={() => openModal('send')}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'loans' && (
          <AdminLoansView />
        )}

        {activeTab === 'demo_funds' && (
          <AdminDemoFundsView
            metrics={metrics}
            customers={customers}
            transactions={transactions}
            onIssueFunding={handleIssueDevFunding}
            onTopUpPool={handleTopUpPool}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'notifications' && (
          <AdminNotificationsView
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'webhooks' && (
          <AdminWebhooksView
            customers={customers}
            onRefreshData={loadAllAdminData}
          />
        )}

        {activeTab === 'audit' && (
          <AdminAuditLogView
            auditLogs={auditLogs}
            onRefreshData={loadAllAdminData}
          />
        )}
      </main>

      {/* Customer Full Dossier Modal */}
      {selectedCustomer && (
        <AdminCustomerDetailsModal
          customer={selectedCustomer}
          isOpen={!!selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          transactions={transactions}
          onToggleStatus={handleToggleFreezeUser}
          onApproveKyc={handleApproveKyc}
          onRejectKyc={handleRejectKyc}
          onReviewKycItem={handleReviewKycItem}
          onRefreshData={loadAllAdminData}
        />
      )}
    </div>
  );
};
