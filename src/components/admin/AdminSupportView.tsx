import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  User,
  Search,
  Filter,
  Plus,
  Shield,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Info,
  CheckCheck,
  Check,
  Mail,
  Phone,
  ShieldCheck,
  Building,
  Lock,
} from 'lucide-react';
import { NotificationItem, NotificationReply, UserProfile } from '../../types';
import { firestoreSync } from '../../services/firestoreSync';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface AdminSupportViewProps {
  customers: (UserProfile & { balanceMetrics?: any })[];
  onSelectCustomer?: (customer: UserProfile & { balanceMetrics?: any }) => void;
  onRefreshData?: () => Promise<void>;
}

export const AdminSupportView: React.FC<AdminSupportViewProps> = ({
  customers,
  onSelectCustomer,
  onRefreshData,
}) => {
  const { currentUser } = useAuth();

  const [tickets, setTickets] = useState<NotificationItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // New Notice Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');
  const [newNoticeTitle, setNewNoticeTitle] = useState('');
  const [newNoticeMessage, setNewNoticeMessage] = useState('');
  const [newNoticeSeverity, setNewNoticeSeverity] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [isCreatingNotice, setIsCreatingNotice] = useState(false);

  // Quick reply presets
  const quickReplies = [
    'Hello, your verification documents have been processed and approved by compliance.',
    'Thank you for contacting Monvera Support. We are reviewing your wire settlement now.',
    'Please submit a clear, high-resolution photo of your government-issued ID to complete KYC.',
    'Your account security check is complete and all transactional limits are active.',
  ];

  // Initial fetch and real-time Firestore subscription
  useEffect(() => {
    const fetchTickets = async () => {
      const allTickets = await firestoreSync.getAllSupportTickets();
      if (allTickets && allTickets.length > 0) {
        setTickets(allTickets);
        if (!selectedTicketId && allTickets.length > 0) {
          setSelectedTicketId(allTickets[0].id);
        }
      } else {
        // Fallback from server API notifications
        try {
          const res = await api.getNotifications();
          if (res.notifications) {
            const supportList = res.notifications.filter(
              (n) => n.type === 'SUPPORT' || n.supportTicketId || (n.replies && n.replies.length > 0)
            );
            setTickets(supportList);
            if (!selectedTicketId && supportList.length > 0) {
              setSelectedTicketId(supportList[0].id);
            }
          }
        } catch (e) {
          console.warn('Error fetching support tickets:', e);
        }
      }
    };

    fetchTickets();

    const unsubscribe = firestoreSync.subscribeToSupportTickets((liveTickets) => {
      if (liveTickets && liveTickets.length > 0) {
        setTickets(liveTickets);
        setSelectedTicketId((curr) => curr || liveTickets[0].id);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || tickets[0] || null;
  const targetCustomer = selectedTicket
    ? customers.find((c) => c.id === selectedTicket.userId || c.permanentAccountNumber === selectedTicket.userId)
    : null;

  // Filter tickets
  const filteredTickets = tickets.filter((t) => {
    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'RESOLVED'
        ? t.supportStatus === 'RESOLVED' || t.supportStatus === 'CLOSED'
        : statusFilter === 'IN_PROGRESS'
        ? t.supportStatus === 'IN_PROGRESS'
        : t.supportStatus === 'OPEN' || !t.supportStatus;

    const matchesSearch =
      (t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.message || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.supportRepName && t.supportRepName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (targetCustomer &&
        (`${targetCustomer.firstName || ''} ${targetCustomer.lastName || ''}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (targetCustomer.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (targetCustomer.permanentAccountNumber || '').includes(searchQuery)));

    return matchesStatus && matchesSearch;
  });

  const handleSendReply = async () => {
    if (!replyMessage.trim() || !selectedTicket) return;
    setIsSending(true);

    const adminName = currentUser
      ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || 'Monvera Compliance Executive'
      : 'Monvera Executive Support';

    const replyPayload = {
      senderId: currentUser?.id || 'usr_admin',
      senderName: adminName,
      senderRole: 'ADMIN' as const,
      senderAvatar: currentUser?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      message: replyMessage.trim(),
    };

    try {
      // 1. Send via Firestore real-time sync
      await firestoreSync.sendSupportReply(selectedTicket.id, replyPayload, 'IN_PROGRESS');

      // 2. Also record in Server API
      await api.replyToSupport(selectedTicket.id, replyMessage.trim());

      setReplyMessage('');
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      console.error('Error sending support reply:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleUpdateStatus = async (status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED') => {
    if (!selectedTicket) return;
    try {
      const adminName = currentUser
        ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || 'Monvera Admin'
        : 'Monvera Operations';

      await firestoreSync.sendSupportReply(
        selectedTicket.id,
        {
          senderId: currentUser?.id || 'usr_admin',
          senderName: adminName,
          senderRole: 'ADMIN',
          message: `[System Update]: Ticket status marked as ${status}.`,
        },
        status
      );

      setTickets((prev) =>
        prev.map((t) => (t.id === selectedTicket.id ? { ...t, supportStatus: status } : t))
      );
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleCreateNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId || !newNoticeTitle.trim() || !newNoticeMessage.trim()) return;
    setIsCreatingNotice(true);

    try {
      const adminName = currentUser
        ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || 'Monvera Official Operations'
        : 'Monvera Official Operations';

      const res = await firestoreSync.createSupportTicket({
        userId: targetUserId,
        title: newNoticeTitle.trim(),
        message: newNoticeMessage.trim(),
        severity: newNoticeSeverity,
        adminAuthorName: adminName,
        adminAuthorRole: 'Executive Officer',
        initialStatus: 'OPEN',
      });

      if (res.success && res.ticketId) {
        setSelectedTicketId(res.ticketId);
        setIsCreateModalOpen(false);
        setNewNoticeTitle('');
        setNewNoticeMessage('');
        setTargetUserId('');
        if (onRefreshData) await onRefreshData();
      }
    } catch (err) {
      console.error('Error creating notice:', err);
    } finally {
      setIsCreatingNotice(false);
    }
  };

  const openCount = tickets.filter((t) => t.supportStatus === 'OPEN' || !t.supportStatus).length;
  const inProgressCount = tickets.filter((t) => t.supportStatus === 'IN_PROGRESS').length;
  const resolvedCount = tickets.filter((t) => t.supportStatus === 'RESOLVED' || t.supportStatus === 'CLOSED').length;

  return (
    <div className="space-y-6">
      {/* Header & Stats Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
            <span>Customer Support & Live Communications Hub</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 text-blue-800 border border-blue-200">
              REAL-TIME DESK
            </span>
          </h2>
          <p className="text-sm font-semibold text-slate-500 mt-0.5">
            Two-way persistent communications, regulatory inquiries, and official announcements with registered account holders
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold shadow-xs transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4 text-amber-400" />
            <span>Send Direct Notice / Ticket</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Conversations</div>
            <div className="text-2xl font-black text-slate-900 mt-1">{tickets.length}</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-100 text-slate-700">
            <MessageSquare className="w-5 h-5 stroke-[2.5]" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200 bg-amber-50/40 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">Awaiting Response</div>
            <div className="text-2xl font-black text-amber-950 mt-1">{openCount}</div>
          </div>
          <div className="p-3 rounded-xl bg-amber-500 text-slate-950 font-black">
            <Clock className="w-5 h-5 stroke-[2.5]" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-blue-200 bg-blue-50/40 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-blue-800">In Active Progress</div>
            <div className="text-2xl font-black text-blue-950 mt-1">{inProgressCount}</div>
          </div>
          <div className="p-3 rounded-xl bg-blue-600 text-white">
            <RefreshCw className="w-5 h-5 stroke-[2.5]" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">Resolved Cases</div>
            <div className="text-2xl font-black text-emerald-950 mt-1">{resolvedCount}</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-600 text-white">
            <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
          </div>
        </div>
      </div>

      {/* Main Support Interface Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Tickets & Thread Directory (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col h-[750px]">
          
          {/* Search & Filter Top Bar */}
          <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/80">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ticket subject, client name, account..."
                className="w-full pl-9.5 pr-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 text-slate-900 placeholder:text-slate-400 shadow-2xs"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Ticket List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredTickets.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs font-semibold">
                No support tickets found matching criteria.
              </div>
            ) : (
              filteredTickets.map((t) => {
                const isSelected = t.id === selectedTicket?.id;
                const cust = customers.find((c) => c.id === t.userId || c.permanentAccountNumber === t.userId);
                const lastReply = t.replies && t.replies.length > 0 ? t.replies[t.replies.length - 1] : null;
                const replyCount = t.replies ? t.replies.length : 0;

                const isOpen = t.supportStatus === 'OPEN' || !t.supportStatus;
                const isInProg = t.supportStatus === 'IN_PROGRESS';
                const isResolved = t.supportStatus === 'RESOLVED' || t.supportStatus === 'CLOSED';

                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`p-4 cursor-pointer transition-all border-l-4 ${
                      isSelected
                        ? 'bg-slate-50 border-l-slate-900 shadow-2xs'
                        : isOpen
                        ? 'border-l-amber-500 hover:bg-slate-50/60'
                        : isInProg
                        ? 'border-l-blue-500 hover:bg-slate-50/60'
                        : 'border-l-transparent hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 font-black text-xs flex items-center justify-center shrink-0">
                          {cust ? `${cust.firstName[0]}${cust.lastName[0]}` : 'CU'}
                        </div>
                        <div>
                          <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                            <span>{cust ? `${cust.firstName} ${cust.lastName}` : `Account ${t.userId.slice(0, 8)}`}</span>
                            {cust && <span className="text-[10px] text-slate-400 font-mono">@{cust.username}</span>}
                          </div>
                          <div className="text-[10px] text-slate-500 font-semibold">
                            Acc: {cust?.permanentAccountNumber || t.userId}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isOpen
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : isInProg
                            ? 'bg-blue-100 text-blue-900 border border-blue-300'
                            : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        }`}
                      >
                        {t.supportStatus || 'OPEN'}
                      </span>
                    </div>

                    <div className="mt-2.5">
                      <h4 className="text-xs font-bold text-slate-900 truncate">{t.title}</h4>
                      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 font-medium">
                        {lastReply ? lastReply.message : t.message}
                      </p>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-slate-400" />
                        {replyCount} messages
                      </span>
                      <span>{new Date(lastReply?.timestamp || t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Live Chat Conversation Canvas (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col h-[750px]">
          {selectedTicket ? (
            <>
              {/* Conversation Top Header */}
              <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-900 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    {targetCustomer?.avatarUrl ? (
                      <img
                        src={targetCustomer.avatarUrl}
                        alt="Customer"
                        className="w-12 h-12 rounded-2xl object-cover border-2 border-slate-700"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 font-black flex items-center justify-center text-sm shadow-xs">
                        {targetCustomer ? `${targetCustomer.firstName[0]}${targetCustomer.lastName[0]}` : 'CU'}
                      </div>
                    )}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
                        targetCustomer?.status === 'frozen' ? 'bg-rose-500' : 'bg-emerald-400'
                      }`}
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-extrabold text-white">
                        {targetCustomer ? `${targetCustomer.firstName} ${targetCustomer.lastName}` : 'Client Account'}
                      </h3>
                      {targetCustomer && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-800 text-amber-400 border border-slate-700">
                          {targetCustomer.membershipTier || 'Premier'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-300 font-semibold flex items-center gap-2 mt-0.5">
                      <span>Acc: {targetCustomer?.permanentAccountNumber || selectedTicket.userId}</span>
                      <span>•</span>
                      <span>{targetCustomer?.email || 'Registered Client'}</span>
                    </div>
                  </div>
                </div>

                {/* Header Action Tools */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                  {targetCustomer && onSelectCustomer && (
                    <button
                      onClick={() => onSelectCustomer(targetCustomer)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition-colors flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                      <span>Full Dossier</span>
                    </button>
                  )}

                  {/* Status Tag Selector */}
                  <select
                    value={selectedTicket.supportStatus || 'OPEN'}
                    onChange={(e) => handleUpdateStatus(e.target.value as any)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 text-white font-bold text-xs border border-slate-700 focus:outline-hidden cursor-pointer"
                  >
                    <option value="OPEN">Mark Open</option>
                    <option value="IN_PROGRESS">Mark In Progress</option>
                    <option value="RESOLVED">Mark Resolved</option>
                  </select>
                </div>
              </div>

              {/* Ticket Subject Card */}
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Subject:</span>
                  <h4 className="text-xs font-black text-slate-900">{selectedTicket.title}</h4>
                </div>
                <div className="text-[11px] text-slate-500 font-mono font-semibold">
                  Ref: {selectedTicket.supportTicketId || selectedTicket.id}
                </div>
              </div>

              {/* Live Messages Thread */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-100/40">
                {/* Initial Ticket Message */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 font-black text-xs flex items-center justify-center shrink-0 shadow-2xs">
                    {targetCustomer ? `${targetCustomer.firstName[0]}${targetCustomer.lastName[0]}` : 'C'}
                  </div>
                  <div className="max-w-[80%] bg-white p-4 rounded-2xl rounded-tl-xs border border-slate-200 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-black text-slate-900">
                        {targetCustomer ? `${targetCustomer.firstName} ${targetCustomer.lastName}` : 'Client'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        {new Date(selectedTicket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {selectedTicket.message}
                    </p>
                  </div>
                </div>

                {/* Subsequent Conversation Replies */}
                {selectedTicket.replies?.slice(1).map((reply, idx) => {
                  const isAdmin = reply.senderRole === 'ADMIN' || reply.senderRole === 'COMPLIANCE' || reply.senderRole === 'SUPPORT_REP';

                  return (
                    <div
                      key={reply.id || idx}
                      className={`flex items-start gap-3 ${isAdmin ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      <div
                        className={`w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center shrink-0 shadow-2xs ${
                          isAdmin
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-900 text-amber-400'
                        }`}
                      >
                        {isAdmin ? <Shield className="w-4 h-4 stroke-[2.5]" /> : 'C'}
                      </div>

                      <div
                        className={`max-w-[80%] p-4 rounded-2xl shadow-2xs space-y-1 border ${
                          isAdmin
                            ? 'bg-slate-900 text-white rounded-tr-xs border-slate-800'
                            : 'bg-white text-slate-900 rounded-tl-xs border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-black ${isAdmin ? 'text-amber-400' : 'text-slate-900'}`}>
                              {reply.senderName}
                            </span>
                            {isAdmin && (
                              <span className="px-1.5 py-0.2 rounded-sm text-[9px] font-black uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/30">
                                MONVERA EXEC
                              </span>
                            )}
                          </div>
                          <span className={`text-[10px] font-semibold ${isAdmin ? 'text-slate-400' : 'text-slate-400'}`}>
                            {new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <p
                          className={`text-xs font-medium leading-relaxed whitespace-pre-wrap ${
                            isAdmin ? 'text-slate-200' : 'text-slate-700'
                          }`}
                        >
                          {reply.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quick Canned Responses Bar */}
              <div className="p-2.5 bg-slate-50 border-t border-slate-200 overflow-x-auto flex items-center gap-2 no-scrollbar">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-2 shrink-0 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Templates:
                </span>
                {quickReplies.map((qr, i) => (
                  <button
                    key={i}
                    onClick={() => setReplyMessage(qr)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-slate-400 text-slate-700 hover:text-slate-900 text-[11px] font-semibold whitespace-nowrap shadow-2xs transition-colors"
                  >
                    {qr.slice(0, 35)}...
                  </button>
                ))}
              </div>

              {/* Bottom Reply Composer Form */}
              <div className="p-4 border-t border-slate-200 bg-white space-y-3">
                <div className="relative">
                  <textarea
                    rows={3}
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Type official reply to client... (Delivered to client in real-time)"
                    className="w-full p-3.5 pr-28 text-xs font-semibold rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/15 focus:border-slate-800 text-slate-900 placeholder:text-slate-400 shadow-2xs resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                  />

                  <button
                    onClick={handleSendReply}
                    disabled={isSending || !replyMessage.trim()}
                    className="absolute right-3 bottom-3.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSending ? 'Sending...' : 'Send'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                  <span className="flex items-center gap-1 text-slate-400">
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                    Real-time encrypted dispatch via Monvera Communications Relay
                  </span>
                  <span className="text-[10px] text-slate-400">Press Enter to send</span>
                </div>
              </div>
            </>
          ) : (
            <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center h-full">
              <MessageSquare className="w-12 h-12 stroke-[1.5] text-slate-300 mb-3" />
              <h3 className="font-black text-slate-700 text-base">No Ticket Selected</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Select a conversation thread from the left queue or initiate an official direct notice to an account holder.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Direct Notice / New Support Ticket Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-slate-200 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Create Official Client Notice</h3>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  Direct compliance notice or customer support ticket dispatched to the client's inbox
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNotice} className="space-y-4">
              {/* Target Customer Dropdown */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Target Customer Account
                </label>
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
                >
                  <option value="">Select registered account...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName} ({c.permanentAccountNumber}) — {c.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notice Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Notice Subject / Inquiry Title
                </label>
                <input
                  type="text"
                  value={newNoticeTitle}
                  onChange={(e) => setNewNoticeTitle(e.target.value)}
                  required
                  placeholder="e.g. Account Clearance & KYC Verification Confirmation"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              {/* Priority / Severity */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Classification Level
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['info', 'success', 'warning', 'error'] as const).map((sev) => (
                    <button
                      type="button"
                      key={sev}
                      onClick={() => setNewNoticeSeverity(sev)}
                      className={`py-2 rounded-xl text-xs font-extrabold capitalize border transition-all ${
                        newNoticeSeverity === sev
                          ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notice Body */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Official Communication Message
                </label>
                <textarea
                  rows={4}
                  value={newNoticeMessage}
                  onChange={(e) => setNewNoticeMessage(e.target.value)}
                  required
                  placeholder="Write clear instructions or notification details for the account holder..."
                  className="w-full p-3.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingNotice || !targetUserId || !newNoticeTitle.trim() || !newNoticeMessage.trim()}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 font-black text-xs shadow-xs transition-colors disabled:opacity-50"
                >
                  {isCreatingNotice ? 'Dispatching...' : 'Dispatch Official Notice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
