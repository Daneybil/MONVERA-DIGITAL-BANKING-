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
} from 'lucide-react';
import { NotificationItem } from '../../types';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({ isOpen, onClose }) => {
  const { notifications, markAllNotificationsAsRead, markNotificationAsRead, replyToSupport, unreadNotifsCount } =
    useAuth();
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | 'TRANSACTION' | 'SUPPORT' | 'SECURITY' | 'INVESTMENT'>('ALL');
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [isSubmittingReply, setIsSubmittingReply] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const filteredNotifications = notifications.filter((n) => {
    if (selectedFilter === 'ALL') return true;
    return n.type === selectedFilter;
  });

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

  const getIcon = (type: string) => {
    switch (type) {
      case 'TRANSACTION':
        return DollarSign;
      case 'SUPPORT':
        return Headphones;
      case 'SECURITY':
        return ShieldCheck;
      case 'INVESTMENT':
        return TrendingUp;
      default:
        return Info;
    }
  };

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
            <div className="space-y-6 animate-fadeIn">
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
                          : 'bg-white/20 text-white border-2 border-white/30'
                      }`}
                    >
                      {React.createElement(getIcon(selectedNotification.type), { className: 'w-6 h-6 stroke-[2.5]' })}
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
                  {selectedNotification.referenceId && (
                    <span className="font-mono text-xs font-black bg-sky-900/80 border border-sky-400 px-3 py-1 rounded-lg text-sky-100">
                      Ref: {selectedNotification.referenceId}
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
              <div className="pt-2 flex items-center gap-3">
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
                  No alerts found under this category. Transaction confirmations, deposits, withdrawals, and account updates will appear here.
                </p>
              </div>
            ) : (
              filteredNotifications.map((n) => {
                const Icon = getIcon(n.type);
                const isSupport = n.type === 'SUPPORT';

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
                          <span className="text-xs font-black text-slate-700 font-mono shrink-0">
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-slate-900 line-clamp-2 leading-relaxed">
                          {n.message}
                        </p>
                      </div>
                    </div>

                    {/* Bottom action indicator */}
                    <div className="flex items-center justify-between pt-2.5 border-t-2 border-slate-200/80 text-xs">
                      <span className="font-mono text-xs font-black text-slate-800 uppercase tracking-wider">
                        {n.type} ALERT
                      </span>
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
    </div>
  );
};

