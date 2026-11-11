import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  X,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  Check,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  MessageSquare,
  Send,
  Headphones,
  Clock,
  Sparkles,
  CheckCheck,
  ExternalLink,
  Receipt,
  Landmark,
  TrendingUp,
  DollarSign,
  Sliders,
} from 'lucide-react';
import { NotificationItem } from '../../types';
import { NotificationSettingsModal } from './NotificationSettingsModal';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({ isOpen, onClose }) => {
  const {
    notifications,
    markAllNotificationsAsRead,
    markNotificationAsRead,
    replyToSupport,
    unreadNotifsCount,
    setCurrentView,
    openModal,
  } = useAuth();
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | 'TRANSACTION' | 'SYSTEM' | 'INVESTMENT' | 'SECURITY' | 'SUPPORT'>('ALL');
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [isSubmittingReply, setIsSubmittingReply] = useState<Record<string, boolean>>({});
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  if (!isOpen) return null;

  const filteredNotifications = notifications.filter((n) => {
    if (selectedFilter === 'ALL') return true;
    return n.type === selectedFilter;
  });

  const resolveNavigationTarget = (n: NotificationItem): {
    label: string;
    actionView?: 'dashboard' | 'transactions' | 'investments' | 'loans' | 'cards' | 'profile';
    actionModal?: 'deposit' | 'send' | 'receive' | 'withdraw' | 'invest';
    actionSection?: string;
    actionRecordId?: string;
    referenceNumber?: string;
  } => {
    const titleLower = (n.title || '').toLowerCase();
    const msgLower = (n.message || '').toLowerCase();
    const eventType = (n.metadata?.eventType || '').toUpperCase();

    const actionView = n.actionView;
    const actionModal = n.actionModal;
    const actionSection = n.actionSection;
    const actionRecordId = n.actionRecordId || n.referenceId;
    const referenceNumber = n.metadata?.referenceNumber || n.referenceId;

    if (actionModal === 'withdraw') {
      const label =
        actionSection === 'ACTIVATION'
          ? 'Open Card Activation'
          : actionSection === 'BANK_ACTIVATION'
          ? 'Open Bank Activation'
          : 'Open Bank Linking';
      return { label, actionModal: 'withdraw', actionSection, actionRecordId, referenceNumber };
    }

    if (actionView === 'transactions' || (n.type === 'TRANSACTION' && !actionModal)) {
      return { label: 'View in Transactions', actionView: 'transactions', actionSection, actionRecordId, referenceNumber };
    }
    if (actionView === 'loans' || eventType.startsWith('LOAN_') || titleLower.includes('loan')) {
      return { label: 'View Loan Application', actionView: 'loans', actionSection, actionRecordId, referenceNumber };
    }
    if (actionView === 'investments' || n.type === 'INVESTMENT') {
      return { label: 'View Investments', actionView: 'investments', actionSection, actionRecordId, referenceNumber };
    }
    if (actionView === 'cards' || eventType.includes('CARD_')) {
      return { label: 'View My Cards', actionView: 'cards', actionSection, actionRecordId, referenceNumber };
    }
    if (actionView === 'profile' || eventType.startsWith('KYC_') || titleLower.includes('kyc') || msgLower.includes('kyc')) {
      const isKyc = actionSection === 'kyc' || eventType.startsWith('KYC_') || titleLower.includes('kyc');
      return {
        label: isKyc ? 'Open KYC Verification' : 'Open Profile & Security',
        actionView: 'profile',
        actionSection: isKyc ? 'kyc' : actionSection,
        actionRecordId,
        referenceNumber,
      };
    }

    if (titleLower.includes('bank') && (titleLower.includes('activat') || titleLower.includes('verif'))) {
      return { label: 'Open Bank Activation', actionModal: 'withdraw', actionSection: 'BANK_ACTIVATION', actionRecordId, referenceNumber };
    }
    if (titleLower.includes('bank') && (titleLower.includes('link') || msgLower.includes('bank account'))) {
      return { label: 'Open Bank Linking', actionModal: 'withdraw', actionSection: 'BANK', actionRecordId, referenceNumber };
    }
    if (titleLower.includes('card activation')) {
      return { label: 'Open Card Activation', actionModal: 'withdraw', actionSection: 'ACTIVATION', actionRecordId, referenceNumber };
    }
    if (n.type === 'SECURITY') {
      return { label: 'Open Security Settings', actionView: 'profile', actionSection, actionRecordId, referenceNumber };
    }

    return { label: 'Go to Dashboard', actionView: 'dashboard', actionSection, actionRecordId, referenceNumber };
  };

  const handleNavigateNotification = (n: NotificationItem) => {
    if (!n.read) {
      markNotificationAsRead(n.id);
    }
    const target = resolveNavigationTarget(n);
    try {
      const payload = {
        notificationId: n.id,
        actionView: target.actionView,
        actionModal: target.actionModal,
        actionSection: target.actionSection,
        actionRecordId: target.actionRecordId,
        referenceNumber: target.referenceNumber,
        timestamp: Date.now(),
      };
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('monvera_notification_nav_target', JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent('monvera_notification_navigate', { detail: payload }));
      }
    } catch {}

    setSelectedNotification(null);
    onClose();

    if (target.actionModal) {
      openModal(target.actionModal);
    } else if (target.actionView) {
      setCurrentView(target.actionView);
    }
  };

  const handleSelectNotification = (n: NotificationItem) => {
    setSelectedNotification(n);
    if (!n.read) {
      markNotificationAsRead(n.id);
    }
  };

  const handleSendReply = async (notificationId: string) => {
    const text = replyDrafts[notificationId]?.trim();
    if (!text) return;

    setIsSubmittingReply((prev) => ({ ...prev, [notificationId]: true }));
    try {
      await replyToSupport(notificationId, text);
      setReplyDrafts((prev) => ({ ...prev, [notificationId]: '' }));
    } catch (err) {
      console.error('Failed to send support reply:', err);
    } finally {
      setIsSubmittingReply((prev) => ({ ...prev, [notificationId]: false }));
    }
  };

  const getIcon = (type: string, n?: NotificationItem) => {
    if (n?.actionView === 'loans' || n?.metadata?.eventType?.startsWith('LOAN_') || n?.actionModal === 'withdraw') {
      return Landmark;
    }
    switch (type) {
      case 'TRANSACTION':
        return DollarSign;
      case 'SUPPORT':
        return Headphones;
      case 'SECURITY':
        return ShieldCheck;
      case 'INVESTMENT':
        return TrendingUp;
      case 'SYSTEM':
        return Landmark;
      default:
        return Info;
    }
  };

  const formatMoney = (amount?: number, currency = 'USD') => {
    if (typeof amount !== 'number' || Number.isNaN(amount)) return null;
    return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  };

  const detailTarget = selectedNotification ? resolveNavigationTarget(selectedNotification) : null;
  const meta = selectedNotification?.metadata;

  return (
    <div
      id="notifications-drawer-backdrop"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSelectedNotification(null);
          onClose();
        }
      }}
    >
      <div
        id="notifications-drawer-panel"
        className="w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col animate-slideInRight"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b-2 border-slate-200 bg-slate-50 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            {selectedNotification ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedNotification(null)}
                  className="w-10 h-10 rounded-xl bg-white hover:bg-slate-200 text-slate-900 flex items-center justify-center border-2 border-slate-300 transition-colors shadow-xs cursor-pointer"
                  title="Back to all notifications"
                >
                  <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
                </button>
                <div>
                  <h3 className="font-extrabold text-slate-950 text-xl tracking-tight">Notification Details</h3>
                  <p className="text-xs font-extrabold text-slate-700 font-mono">
                    ID: {selectedNotification.id.slice(0, 18)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-950 text-sky-400 flex items-center justify-center shadow-md">
                  <Bell className="w-6 h-6 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-950 text-2xl tracking-tight">Notification Center</h3>
                  <p className="text-sm font-extrabold text-sky-950">
                    {unreadNotifsCount} unread alert{unreadNotifsCount !== 1 ? 's' : ''} & system updates
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettingsModal(true)}
                className="text-xs font-extrabold text-slate-800 hover:text-slate-950 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
                title="Notification Preferences"
              >
                <Sliders className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">Preferences</span>
              </button>
              {!selectedNotification && unreadNotifsCount > 0 && (
                <button
                  onClick={markAllNotificationsAsRead}
                  className="text-xs font-extrabold text-sky-950 hover:text-sky-900 px-3.5 py-2 rounded-xl bg-sky-100 hover:bg-sky-200 border-2 border-sky-300 transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4 stroke-[2.5]" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedNotification(null);
                  onClose();
                }}
                className="w-10 h-10 rounded-xl bg-white hover:bg-slate-200 text-slate-900 flex items-center justify-center border-2 border-slate-300 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>
          </div>

          {/* Filter Tabs (Only shown in list mode) */}
          {!selectedNotification && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {[
                { id: 'ALL', label: 'All Alerts' },
                { id: 'TRANSACTION', label: 'Transactions' },
                { id: 'SYSTEM', label: 'Loans & Account' },
                { id: 'INVESTMENT', label: 'Investments' },
                { id: 'SECURITY', label: 'Security & KYC' },
                { id: 'SUPPORT', label: 'Support & Concierge' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedFilter(tab.id as any)}
                  className={`px-3.5 py-2 text-xs font-extrabold rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                    selectedFilter === tab.id
                      ? 'bg-slate-950 text-white shadow-md border-2 border-slate-950'
                      : 'bg-white text-slate-950 hover:bg-slate-100 border-2 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {selectedNotification ? (
            /* --- DETAIL VIEW OF SPECIFIC NOTIFICATION --- */
            <div className="space-y-5 animate-fadeIn">
              {/* Top Banner Card */}
              <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 text-white space-y-4 shadow-xl border-2 border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                        selectedNotification.type === 'SECURITY'
                          ? 'bg-sky-500/30 text-sky-300 border-2 border-sky-400'
                          : selectedNotification.type === 'INVESTMENT'
                          ? 'bg-emerald-500/30 text-emerald-300 border-2 border-emerald-400'
                          : selectedNotification.severity === 'warning'
                          ? 'bg-amber-500/30 text-amber-300 border-2 border-amber-400'
                          : selectedNotification.severity === 'error'
                          ? 'bg-rose-500/30 text-rose-300 border-2 border-rose-400'
                          : 'bg-white/20 text-white border-2 border-white/30'
                      }`}
                    >
                      {React.createElement(getIcon(selectedNotification.type, selectedNotification), { className: 'w-6 h-6 stroke-[2.5]' })}
                    </div>
                    <div>
                      <span className="text-xs font-mono font-black uppercase tracking-wider text-sky-400 block">
                        {selectedNotification.type} NOTIFICATION
                      </span>
                      <h4 className="text-lg sm:text-xl font-extrabold text-white leading-tight">
                        {selectedNotification.title}
                      </h4>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/20 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-100 font-bold">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-300 stroke-[2.5]" />
                    <span>
                      {new Date(selectedNotification.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </span>
                  {(meta?.referenceNumber || selectedNotification.referenceId) && (
                    <span className="font-mono text-xs font-black bg-sky-900/80 border border-sky-400 px-3 py-1 rounded-lg text-sky-100">
                      Ref: {meta?.referenceNumber || selectedNotification.referenceId}
                    </span>
                  )}
                </div>
              </div>

              {/* Complete Notification Message */}
              <div className="p-6 rounded-3xl bg-slate-50 border-2 border-slate-200 space-y-3 shadow-xs">
                <h5 className="text-xs font-black uppercase tracking-wider text-slate-900">
                  Message Details & Notice
                </h5>
                <p className="text-base sm:text-lg font-bold text-slate-950 leading-relaxed">
                  {selectedNotification.message}
                </p>
              </div>

              {/* Structured Banking Record Metadata */}
              {meta && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {meta.customerName && (
                    <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">Customer Name</span>
                      <div className="text-sm font-extrabold text-slate-950">{meta.customerName}</div>
                    </div>
                  )}
                  {meta.accountNumberMasked && (
                    <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">Account</span>
                      <div className="text-sm font-mono font-extrabold text-slate-950">{meta.accountNumberMasked}</div>
                    </div>
                  )}
                  {(meta.transactionType || meta.applicationType || meta.requestType) && (
                    <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">
                        {meta.transactionType ? 'Transaction Type' : meta.applicationType ? 'Application Type' : 'Request Type'}
                      </span>
                      <div className="text-sm font-extrabold text-slate-950">
                        {meta.transactionType || meta.applicationType || meta.requestType}
                      </div>
                    </div>
                  )}
                  {(typeof meta.amount === 'number' || meta.direction) && (
                    <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">
                        {meta.direction ? `${meta.direction} Amount` : 'Amount'}
                      </span>
                      <div
                        className={`text-sm font-mono font-black ${
                          meta.direction === 'CREDIT'
                            ? 'text-emerald-700'
                            : meta.direction === 'DEBIT'
                            ? 'text-rose-700'
                            : 'text-slate-950'
                        }`}
                      >
                        {meta.direction === 'CREDIT' ? '+' : meta.direction === 'DEBIT' ? '-' : ''}
                        {formatMoney(meta.amount, meta.currency || 'USD') || meta.direction}
                      </div>
                    </div>
                  )}
                  {meta.status && (
                    <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">Status</span>
                      <div className="text-sm font-black text-slate-950">{meta.status}</div>
                    </div>
                  )}
                  {meta.referenceNumber && (
                    <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">Reference ID</span>
                      <div className="text-xs font-mono font-extrabold text-slate-950 break-all">{meta.referenceNumber}</div>
                    </div>
                  )}
                  {meta.reason && (
                    <div className="sm:col-span-2 p-4 rounded-2xl bg-rose-50 border-2 border-rose-200 space-y-1 shadow-xs">
                      <span className="text-[11px] font-black text-rose-800 uppercase tracking-wider block">Reason / Review Note</span>
                      <div className="text-sm font-bold text-rose-950">{meta.reason}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Metadata Attributes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-200 space-y-1.5 shadow-xs">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider block">Notice Status</span>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>Processed & Logged</span>
                  </div>
                </div>
                <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-200 space-y-1.5 shadow-xs">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider block">Security Tier</span>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-slate-950">
                    <ShieldCheck className="w-5 h-5 text-sky-600 shrink-0" />
                    <span>Monvera 256-Bit TLS</span>
                  </div>
                </div>
              </div>

              {/* Support Thread if applicable */}
              {selectedNotification.type === 'SUPPORT' && (
                <div className="p-5 sm:p-6 rounded-3xl bg-purple-50 border-2 border-purple-300 space-y-4 shadow-sm">
                  <h5 className="text-xs font-black uppercase tracking-wider text-purple-950">
                    Concierge Dialogue
                  </h5>
                  {selectedNotification.replies && selectedNotification.replies.length > 0 && (
                    <div className="space-y-3">
                      {selectedNotification.replies.map((reply) => (
                        <div
                          key={reply.id}
                          className="p-4 rounded-2xl text-sm space-y-1.5 bg-white border-2 border-purple-200 shadow-xs"
                        >
                          <div className="flex items-center justify-between font-black text-xs">
                            <span className="text-purple-950">{reply.senderName}</span>
                            <span className="text-xs text-slate-600 font-mono font-bold">
                              {new Date(reply.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-slate-950 font-bold leading-relaxed">{reply.message}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reply Input */}
                  <div className="space-y-3">
                    <textarea
                      rows={3}
                      placeholder="Type your reply to Monvera Concierge..."
                      value={replyDrafts[selectedNotification.id] || ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [selectedNotification.id]: e.target.value }))
                      }
                      className="w-full text-sm font-bold text-slate-950 placeholder:text-slate-500 p-4 rounded-2xl border-2 border-purple-300 focus:outline-hidden focus:ring-2 focus:ring-purple-600 bg-white"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleSendReply(selectedNotification.id)}
                        disabled={!replyDrafts[selectedNotification.id]?.trim() || isSubmittingReply[selectedNotification.id]}
                        className="px-6 py-3 rounded-2xl text-sm font-extrabold text-white bg-purple-800 hover:bg-purple-900 disabled:opacity-50 flex items-center space-x-2 transition-all shadow-md cursor-pointer"
                      >
                        <Send className="w-4 h-4 stroke-[2.5]" />
                        <span>{isSubmittingReply[selectedNotification.id] ? 'Sending...' : 'Send Reply'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                {detailTarget && (
                  <button
                    id="notification-navigate-action-btn"
                    onClick={() => handleNavigateNotification(selectedNotification)}
                    className="w-full py-4 px-6 rounded-2xl text-sm font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 border-2 border-emerald-500 transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer"
                  >
                    <span>{detailTarget.label}</span>
                    <ExternalLink className="w-4 h-4 stroke-[2.5]" />
                  </button>
                )}
                <button
                  onClick={() => setSelectedNotification(null)}
                  className="w-full py-4 px-6 rounded-2xl text-sm font-extrabold text-slate-950 bg-slate-200 hover:bg-slate-300 border-2 border-slate-300 transition-colors text-center shadow-xs cursor-pointer"
                >
                  Back to All Notifications
                </button>
              </div>
            </div>
          ) : (
            /* --- NOTIFICATIONS LIST VIEW --- */
            filteredNotifications.length === 0 ? (
              <div className="text-center py-20 space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto border-2 border-slate-200 shadow-sm">
                  <Bell className="w-8 h-8 stroke-[2.5]" />
                </div>
                <div className="text-lg font-black text-slate-950">No Notifications</div>
                <p className="text-sm font-bold text-slate-700 max-w-xs mx-auto leading-relaxed">
                  No alerts found under this category. Transaction confirmations, deposits, withdrawals, loans, KYC updates, and account updates will appear here.
                </p>
              </div>
            ) : (
              filteredNotifications.map((n) => {
                const Icon = getIcon(n.type, n);
                const isSupport = n.type === 'SUPPORT';
                const navTarget = resolveNavigationTarget(n);
                const amountDisplay = formatMoney(n.metadata?.amount, n.metadata?.currency || 'USD');

                return (
                  <div
                    key={n.id}
                    onClick={() => handleSelectNotification(n)}
                    className={`p-5 sm:p-6 rounded-3xl border-2 transition-all cursor-pointer hover:border-slate-500 space-y-3.5 group shadow-xs ${
                      !n.read
                        ? 'bg-sky-50 border-sky-300 hover:bg-sky-100/70 shadow-sm'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {/* Top Bar: Icon, Title, Date */}
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105 shadow-xs ${
                          isSupport
                            ? 'bg-purple-100 text-purple-900 border-2 border-purple-300'
                            : n.severity === 'success'
                            ? 'bg-emerald-100 text-emerald-900 border-2 border-emerald-300'
                            : n.severity === 'error'
                            ? 'bg-rose-100 text-rose-900 border-2 border-rose-300'
                            : n.severity === 'warning'
                            ? 'bg-amber-100 text-amber-900 border-2 border-amber-300'
                            : 'bg-slate-100 text-slate-950 border-2 border-slate-300'
                        }`}
                      >
                        <Icon className="w-5 h-5 stroke-[2.5]" />
                      </div>

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2 min-w-0">
                            <h4 className="text-base sm:text-lg font-black text-slate-950 truncate tracking-tight">
                              {n.title}
                            </h4>
                            {!n.read && (
                              <span className="w-2.5 h-2.5 rounded-full bg-sky-600 shrink-0 shadow-xs" title="Unread" />
                            )}
                          </div>
                          <span className="text-[11px] font-black text-slate-700 font-mono shrink-0">
                            {new Date(n.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-slate-900 line-clamp-2 leading-relaxed">
                          {n.message}
                        </p>
                        {(amountDisplay || n.metadata?.status || n.metadata?.referenceNumber) && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {amountDisplay && (
                              <span
                                className={`text-[11px] font-mono font-black px-2 py-0.5 rounded-md border ${
                                  n.metadata?.direction === 'CREDIT'
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                    : n.metadata?.direction === 'DEBIT'
                                    ? 'bg-rose-100 text-rose-900 border-rose-300'
                                    : 'bg-slate-100 text-slate-900 border-slate-300'
                                }`}
                              >
                                {n.metadata?.direction === 'CREDIT' ? '+' : n.metadata?.direction === 'DEBIT' ? '-' : ''}
                                {amountDisplay}
                              </span>
                            )}
                            {n.metadata?.status && (
                              <span className="text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-300">
                                {n.metadata.status}
                              </span>
                            )}
                            {n.metadata?.referenceNumber && (
                              <span className="text-[10px] font-mono font-bold text-slate-600">
                                Ref: {n.metadata.referenceNumber}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom action indicator */}
                    <div className="flex items-center justify-between pt-2.5 border-t-2 border-slate-200/80 text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigateNotification(n);
                        }}
                        className="font-mono text-xs font-black text-emerald-800 hover:text-emerald-950 hover:underline uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                      >
                        <span>{navTarget.label}</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                      <span className="font-extrabold text-sky-800 group-hover:text-sky-950 flex items-center gap-1.5">
                        <span>Read full notice</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform stroke-[2.5]" />
                      </span>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      </div>

      <NotificationSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </div>
  );
};

