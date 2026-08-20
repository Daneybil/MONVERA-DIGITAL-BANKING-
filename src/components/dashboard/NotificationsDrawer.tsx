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
  ArrowRight,
  MessageSquare,
  Send,
  Headphones,
  Clock,
  Sparkles,
  CheckCheck,
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
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [isSubmittingReply, setIsSubmittingReply] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const filteredNotifications = notifications.filter((n) => {
    if (selectedFilter === 'ALL') return true;
    return n.type === selectedFilter;
  });

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
        return CheckCircle2;
      case 'SUPPORT':
        return Headphones;
      case 'SECURITY':
        return ShieldCheck;
      case 'INVESTMENT':
        return CheckCircle2;
      default:
        return Info;
    }
  };

  return (
    <div
      id="notifications-drawer-backdrop"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="notifications-drawer-panel"
        className="w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col animate-slideInRight"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg">Notification Center</h3>
                <p className="text-xs text-slate-500 font-medium">
                  {unreadNotifsCount} unread alert{unreadNotifsCount !== 1 ? 's' : ''} & support updates
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadNotifsCount > 0 && (
                <button
                  onClick={markAllNotificationsAsRead}
                  className="text-xs font-bold text-sky-700 hover:text-sky-900 px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-colors flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-slate-500 flex items-center justify-center border border-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {[
              { id: 'ALL', label: 'All' },
              { id: 'SUPPORT', label: 'Support & Tickets' },
              { id: 'TRANSACTION', label: 'Transactions' },
              { id: 'SECURITY', label: 'Security' },
              { id: 'INVESTMENT', label: 'Investments' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedFilter(tab.id as any)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
                  selectedFilter === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-200/80 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {filteredNotifications.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Bell className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-slate-800">No Notifications</div>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                No alerts found under this category. Transaction confirmations and support replies will appear here.
              </p>
            </div>
          ) : (
            filteredNotifications.map((n) => {
              const Icon = getIcon(n.type);
              const isSupport = n.type === 'SUPPORT';

              return (
                <div
                  key={n.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all space-y-3 ${
                    !n.read
                      ? 'bg-sky-50/40 border-sky-200 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  {/* Top Bar: Icon, Title, Date & Mark Read */}
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isSupport
                          ? 'bg-purple-100 text-purple-700 border border-purple-200'
                          : n.severity === 'success'
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          : n.severity === 'warning'
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'bg-slate-100 text-slate-800 border border-slate-200'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-2 min-w-0">
                          <h4 className={`text-sm font-bold truncate ${!n.read ? 'text-slate-900' : 'text-slate-700'}`}>
                            {n.title}
                          </h4>
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full bg-sky-600 shrink-0" title="Unread" />
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono shrink-0">
                          {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                    </div>
                  </div>

                  {/* Support Ticket Thread (if Support message) */}
                  {isSupport && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      {n.ticketId && (
                        <div className="flex items-center justify-between text-[11px] font-mono text-purple-800 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-200">
                          <span>Ticket ID: {n.ticketId}</span>
                          <span className="font-bold uppercase tracking-wider">{n.status || 'OPEN'}</span>
                        </div>
                      )}

                      {/* Reply History */}
                      {n.replies && n.replies.length > 0 && (
                        <div className="space-y-2 pl-2">
                          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                            Conversation History ({n.replies.length})
                          </span>
                          {n.replies.map((reply) => (
                            <div
                              key={reply.id}
                              className={`p-3 rounded-xl text-xs space-y-1 ${
                                reply.senderRole === 'USER'
                                  ? 'bg-sky-50/80 border border-sky-100 ml-4'
                                  : 'bg-slate-100 border border-slate-200 mr-4'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-[11px]">
                                <span className={reply.senderRole === 'USER' ? 'text-sky-900' : 'text-purple-900'}>
                                  {reply.senderName} ({reply.senderRole === 'USER' ? 'You' : 'Monvera Concierge'})
                                </span>
                                <span className="text-[10px] text-slate-400 font-normal font-mono">
                                  {new Date(reply.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-slate-700 leading-relaxed">{reply.message}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply Input Box */}
                      <div className="space-y-2 pt-1">
                        <div className="relative">
                          <textarea
                            rows={2}
                            placeholder="Type a response to Monvera Support..."
                            value={replyDrafts[n.id] || ''}
                            onChange={(e) =>
                              setReplyDrafts((prev) => ({ ...prev, [n.id]: e.target.value }))
                            }
                            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-purple-500 bg-slate-50"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleSendReply(n.id)}
                            disabled={!replyDrafts[n.id]?.trim() || isSubmittingReply[n.id]}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 disabled:opacity-50 flex items-center space-x-1.5 transition-all shadow-xs"
                          >
                            <Send className="w-3 h-3" />
                            <span>{isSubmittingReply[n.id] ? 'Sending...' : 'Send Reply'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Footer actions for regular alerts */}
                  {!n.read && (
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => markNotificationAsRead(n.id)}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center space-x-1 transition-colors"
                      >
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Mark as read</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
