import React, { useState, useEffect, useRef } from 'react';
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
  CheckCheck,
  Mail,
  Phone,
  ShieldCheck,
  Building,
  Lock,
  Paperclip,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Sparkles,
  X,
  Check,
  Maximize2,
  Minimize2,
  Camera,
  FileQuestion,
} from 'lucide-react';
import { NotificationItem, UserProfile, ChatMessage } from '../../types';
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

  // Mode: 'chat' (Real-time WhatsApp / customer chat) or 'tickets' (Compliance notices & tickets)
  const [activeMode, setActiveMode] = useState<'chat' | 'tickets'>('chat');

  // --- LIVE CHAT STATE ---
  const [allChatMessages, setAllChatMessages] = useState<ChatMessage[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [chatReplyInput, setChatReplyInput] = useState('');
  const [customerIsTyping, setCustomerIsTyping] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatFilter, setChatFilter] = useState<'all' | 'pending' | 'verified'>('all');
  const [zoomedImage, setZoomedImage] = useState<{ src: string; name: string } | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [isExpandedChat, setIsExpandedChat] = useState(false);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);

  // Keyboard shortcut: Esc to exit expanded view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpandedChat) {
        setIsExpandedChat(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpandedChat]);

  const proofTemplates = [
    {
      id: 'issue_screenshot',
      title: 'Issue / Error Screenshot',
      tag: 'Technical Error',
      description: 'Request a screenshot or photo proof showing the exact error or issue experienced by the user.',
      message: (name: string) =>
        `Hello ${name}, could you please upload a clear screenshot or photo proof of the issue or error you are experiencing? You can click the paperclip icon in this chat to attach the image so our technical desk can resolve it immediately.`,
    },
    {
      id: 'transaction_receipt',
      title: 'Wire / Transaction Slip',
      tag: 'Payment Clearance',
      description: 'Request proof of deposit, wire transfer slip, or payment confirmation document.',
      message: (name: string) =>
        `Hello ${name}, please attach an official transaction receipt, deposit slip, or wire transfer confirmation proof for this transfer to enable immediate compliance clearance.`,
    },
    {
      id: 'identity_kyc',
      title: 'Government ID Verification',
      tag: 'KYC Compliance',
      description: 'Request a clear photo of passport, driver\'s license, or national ID card.',
      message: (name: string) =>
        `Hello ${name}, to verify your account security and lift feature restrictions, please upload a clear, uncropped photo of your valid government-issued ID (Passport, Driver's License, or National ID) via this chat.`,
    },
    {
      id: 'address_utility',
      title: 'Proof of Address Statement',
      tag: 'Address Verification',
      description: 'Request a utility bill or bank statement showing the customer\'s registered address.',
      message: (name: string) =>
        `Hello ${name}, please provide proof of address by attaching a recent utility bill or bank statement (dated within the last 90 days) displaying your full legal name and residential address.`,
    },
    {
      id: 'account_unfreeze',
      title: 'Account Security Unfreeze Proof',
      tag: 'Account Hold',
      description: 'Request identity verification to lift an administrative freeze on the user account.',
      message: (name: string) =>
        `Hello ${name}, your account is currently under administrative compliance review. Please upload photo proof of your government ID along with a brief explanation of your transaction so we can immediately authorize unfreezing your account.`,
    },
  ];

  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const adminTypingTimeoutRef = useRef<any>(null);

  // --- TICKETS / NOTICES STATE ---
  const [tickets, setTickets] = useState<NotificationItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketReplyMessage, setTicketReplyMessage] = useState('');
  const [isSendingTicketReply, setIsSendingTicketReply] = useState(false);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'>('ALL');
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');

  // Create notice modal state
  const [isCreateNoticeOpen, setIsCreateNoticeOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');
  const [newNoticeTitle, setNewNoticeTitle] = useState('');
  const [newNoticeMessage, setNewNoticeMessage] = useState('');
  const [newNoticeSeverity, setNewNoticeSeverity] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [isCreatingNotice, setIsCreatingNotice] = useState(false);

  // Quick reply presets for live chat
  const chatQuickReplies = [
    'Your submitted KYC documents have been reviewed and approved by compliance.',
    'Thank you for contacting Monvera Support. We have verified your wire settlement request.',
    'Please attach a high-resolution photo of your government-issued ID or utility statement for address proof.',
    'Your administrative clearance is complete and your transactional limits have been restored.',
  ];

  // 1. Subscribe to all Live Chat Messages in real-time
  useEffect(() => {
    const unsubscribeChat = firestoreSync.subscribeToAllChatMessages((liveList) => {
      if (liveList) {
        setAllChatMessages(liveList);
      }
    });

    return () => {
      if (typeof unsubscribeChat === 'function') unsubscribeChat();
    };
  }, []);

  // 2. Subscribe to Support Tickets in real-time
  useEffect(() => {
    const fetchInitialTickets = async () => {
      const allTickets = await firestoreSync.getAllSupportTickets();
      if (allTickets && allTickets.length > 0) {
        setTickets(allTickets);
        if (!selectedTicketId) setSelectedTicketId(allTickets[0].id);
      }
    };
    fetchInitialTickets();

    const unsubscribeTickets = firestoreSync.subscribeToSupportTickets((liveTickets) => {
      if (liveTickets && liveTickets.length > 0) {
        setTickets(liveTickets);
        setSelectedTicketId((curr) => curr || liveTickets[0].id);
      }
    });

    return () => {
      if (typeof unsubscribeTickets === 'function') unsubscribeTickets();
    };
  }, []);

  // 3. Group chat messages by user ID to build active conversation threads
  const chatThreads = React.useMemo(() => {
    const threadsMap = new Map<
      string,
      {
        userId: string;
        customer?: UserProfile & { balanceMetrics?: any };
        lastMessage: ChatMessage;
        unreadCount: number;
        totalMessages: number;
      }
    >();

    for (const msg of allChatMessages) {
      if (!msg.userId) continue;
      const current = threadsMap.get(msg.userId);

      const isUnreadUserMsg = msg.sender === 'user' && msg.status !== 'read';

      if (!current) {
        const foundCustomer = customers.find((c) => c.id === msg.userId);
        threadsMap.set(msg.userId, {
          userId: msg.userId,
          customer: foundCustomer,
          lastMessage: msg,
          unreadCount: isUnreadUserMsg ? 1 : 0,
          totalMessages: 1,
        });
      } else {
        const isNewer = new Date(msg.timestamp).getTime() > new Date(current.lastMessage.timestamp).getTime();
        threadsMap.set(msg.userId, {
          ...current,
          lastMessage: isNewer ? msg : current.lastMessage,
          unreadCount: isUnreadUserMsg ? current.unreadCount + 1 : current.unreadCount,
          totalMessages: current.totalMessages + 1,
        });
      }
    }

    // Also include any customer who hasn't messaged yet so Admin can initiate conversations if needed
    for (const cust of customers) {
      if (!cust.id || cust.role === 'admin' || cust.id === 'usr_admin') continue;
      if (!threadsMap.has(cust.id)) {
        threadsMap.set(cust.id, {
          userId: cust.id,
          customer: cust,
          lastMessage: {
            id: `init_${cust.id}`,
            userId: cust.id,
            sender: 'support',
            senderName: 'Specialist',
            message: 'No messages yet in this conversation.',
            timestamp: cust.createdAt || new Date().toISOString(),
            status: 'read',
          },
          unreadCount: 0,
          totalMessages: 0,
        });
      }
    }

    const threadList = Array.from(threadsMap.values());

    // Sort: Unread/pending customer messages first, then by latest timestamp
    return threadList.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
      return new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime();
    });
  }, [allChatMessages, customers]);

  // Set default selected customer if none selected
  useEffect(() => {
    if (!selectedCustomerId && chatThreads.length > 0) {
      setSelectedCustomerId(chatThreads[0].userId);
    }
  }, [selectedCustomerId, chatThreads]);

  // 4. Subscribe to typing status of the selected customer
  useEffect(() => {
    if (!selectedCustomerId) return;

    const unsubscribe = firestoreSync.subscribeToTypingStatus(selectedCustomerId, ({ userTyping }) => {
      setCustomerIsTyping(!!userTyping);
    });

    // Mark messages as read by admin
    firestoreSync.markChatMessagesAsRead(selectedCustomerId, 'admin').catch(() => {});

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [selectedCustomerId]);

  // Filter threads by search term and filter pill
  const filteredChatThreads = chatThreads.filter((t) => {
    const term = chatSearchQuery.toLowerCase();
    const cust = t.customer;
    const name = cust ? `${cust.firstName} ${cust.lastName}`.toLowerCase() : t.userId.toLowerCase();
    const email = (cust?.email || '').toLowerCase();
    const acc = (cust?.permanentAccountNumber || '').toLowerCase();
    const msg = (t.lastMessage.message || '').toLowerCase();

    const matchesSearch = name.includes(term) || email.includes(term) || acc.includes(term) || msg.includes(term);

    if (!matchesSearch) return false;

    if (chatFilter === 'pending') {
      return t.unreadCount > 0 || (t.lastMessage.sender === 'user' && t.lastMessage.status !== 'read');
    }
    if (chatFilter === 'verified') {
      return cust?.kycStatus === 'verified';
    }
    return true;
  });

  // Selected customer object & their messages
  const selectedCustomerThread = chatThreads.find((t) => t.userId === selectedCustomerId);
  const selectedCustomer = selectedCustomerThread?.customer || customers.find((c) => c.id === selectedCustomerId);

  const activeCustomerMessages = allChatMessages
    .filter((m) => m.userId === selectedCustomerId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Scroll to bottom when new message arrives or selected customer changes
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeCustomerMessages, customerIsTyping, selectedCustomerId]);

  // Admin typing handler: notifies user's widget that "Monvera Support is typing..."
  const handleAdminInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setChatReplyInput(e.target.value);
    if (!selectedCustomerId) return;

    firestoreSync.setTypingStatus(selectedCustomerId, true, 'admin').catch(() => {});

    if (adminTypingTimeoutRef.current) clearTimeout(adminTypingTimeoutRef.current);
    adminTypingTimeoutRef.current = setTimeout(() => {
      if (selectedCustomerId) {
        firestoreSync.setTypingStatus(selectedCustomerId, false, 'admin').catch(() => {});
      }
    }, 2500);
  };

  // Send admin live reply
  const handleSendLiveReply = async (textOverride?: string) => {
    if (!selectedCustomerId) return;
    const text = (textOverride || chatReplyInput).trim();
    if (!text) return;

    setChatReplyInput('');
    if (adminTypingTimeoutRef.current) clearTimeout(adminTypingTimeoutRef.current);
    firestoreSync.setTypingStatus(selectedCustomerId, false, 'admin').catch(() => {});

    const supportMsg: ChatMessage = {
      id: `msg_admin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: selectedCustomerId,
      sender: 'support',
      senderName: 'Specialist',
      senderRole: 'Specialist',
      senderAvatar: currentUser?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      message: text,
      timestamp: new Date().toISOString(),
      status: 'read',
    };

    // Save to Firestore
    await firestoreSync.saveChatMessage(supportMsg);
    // Mark customer's prior messages as read
    await firestoreSync.markChatMessagesAsRead(selectedCustomerId, 'admin');
  };

  // Admin upload proof/document to customer
  const handleAdminFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCustomerId) return;

    setIsUploadingProof(true);
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const isImg = file.type.startsWith('image/');

        const fileMsg: ChatMessage = {
          id: `msg_file_admin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          userId: selectedCustomerId,
          sender: 'support',
          senderName: 'Specialist',
          senderRole: 'Specialist',
          senderAvatar: currentUser?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
          message: `Official Clearance Document: ${file.name}`,
          timestamp: new Date().toISOString(),
          status: 'read',
          attachmentUrl: dataUrl,
          attachmentType: isImg ? 'image' : 'document',
          attachmentName: file.name,
          attachmentSize: file.size,
        };

        await firestoreSync.saveChatMessage(fileMsg);
        await firestoreSync.markChatMessagesAsRead(selectedCustomerId, 'admin');
      } catch (err) {
        console.error('Failed to send admin attachment:', err);
      } finally {
        setIsUploadingProof(false);
        if (fileUploadInputRef.current) fileUploadInputRef.current.value = '';
      }
    };

    reader.onerror = () => setIsUploadingProof(false);
    reader.readAsDataURL(file);
  };

  // Download document or proof
  const handleDownloadFile = (url: string, name: string) => {
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = name || 'document';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download error:', err);
      window.open(url, '_blank');
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // --- TICKET ACTIONS ---
  const handleSendTicketReply = async (ticketId: string) => {
    if (!ticketReplyMessage.trim()) return;
    setIsSendingTicketReply(true);
    try {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      const adminName = 'Specialist';
      const adminAvatar = currentUser?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';

      await firestoreSync.sendSupportReply(
        ticketId,
        {
          senderId: currentUser?.id || 'usr_admin',
          senderName: 'Specialist',
          senderRole: 'SUPPORT_REP',
          senderAvatar: adminAvatar,
          message: ticketReplyMessage.trim(),
        },
        'IN_PROGRESS'
      );
      setTicketReplyMessage('');
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      console.error('Error replying to ticket:', err);
    } finally {
      setIsSendingTicketReply(false);
    }
  };

  const handleCreateNoticeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId || !newNoticeTitle.trim() || !newNoticeMessage.trim()) return;

    setIsCreatingNotice(true);
    try {
      const adminName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : 'Executive Compliance';
      await firestoreSync.createSupportTicket({
        userId: targetUserId,
        title: newNoticeTitle.trim(),
        message: newNoticeMessage.trim(),
        adminAuthorName: adminName,
        adminAuthorRole: 'Private Wealth Concierge',
        severity: newNoticeSeverity,
        initialStatus: 'OPEN',
      });

      setIsCreateNoticeOpen(false);
      setNewNoticeTitle('');
      setNewNoticeMessage('');
      setTargetUserId('');
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      console.error('Error issuing notice:', err);
    } finally {
      setIsCreatingNotice(false);
    }
  };

  const pendingChatCount = chatThreads.filter((t) => t.unreadCount > 0).length;

  return (
    <div className="space-y-5">
      {/* Hidden File Input for Admin Proof Document Upload */}
      <input
        type="file"
        ref={fileUploadInputRef}
        onChange={handleAdminFileUpload}
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.txt"
      />

      {/* Image Zoom Modal */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs cursor-pointer animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-2xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl p-4 flex flex-col items-center gap-3 cursor-default"
          >
            <div className="flex items-center justify-between w-full pb-2 border-b border-slate-200">
              <span className="text-xs font-black text-slate-800 truncate">{zoomedImage.name}</span>
              <button
                onClick={() => setZoomedImage(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoomedImage.src}
              alt={zoomedImage.name}
              className="max-h-[70vh] object-contain rounded-xl border border-slate-200"
            />
            <button
              onClick={() => handleDownloadFile(zoomedImage.src, zoomedImage.name)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Full Resolution</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Header & Mode Toggle Bar */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-600 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Monvera Private Wealth Concierge Desk</span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Customer Support & Live Messaging
          </h2>
          <p className="text-xs sm:text-sm font-medium text-slate-500 mt-1">
            Real-time two-way messaging, document proof review, and compliance broadcast notices.
          </p>
        </div>

        {/* Mode Toggle Switch */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-100 border border-slate-200 self-stretch sm:self-auto">
          <button
            onClick={() => setActiveMode('chat')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
              activeMode === 'chat'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            <span>Live WhatsApp Chat</span>
            {pendingChatCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold animate-pulse">
                {pendingChatCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMode('tickets')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
              activeMode === 'tickets'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4 text-amber-600" />
            <span>Compliance Tickets & Notices</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-extrabold">
              {tickets.length}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. LIVE WHATSAPP CHAT DESK */}
      {/* ========================================================================= */}
      {activeMode === 'chat' && (
        <div
          className={
            isExpandedChat
              ? 'fixed inset-2 sm:inset-4 md:inset-6 z-50 bg-slate-950/85 backdrop-blur-md rounded-2xl sm:rounded-3xl p-3 sm:p-5 shadow-2xl flex flex-col border border-slate-700 overflow-hidden'
              : 'grid grid-cols-1 lg:grid-cols-12 gap-5 h-[740px]'
          }
        >
          {isExpandedChat && (
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs sm:text-sm font-black tracking-wider text-white uppercase font-mono">
                  Monvera Support Desk • Expanded View
                </span>
                <span className="text-[11px] text-slate-400 hidden md:inline">
                  (Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-400 font-mono text-[10px]">Esc</kbd> to minimize)
                </span>
              </div>
              <button
                onClick={() => setIsExpandedChat(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 text-xs font-black border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                title="Exit expanded screen"
              >
                <Minimize2 className="w-4 h-4" />
                <span>Minimize Screen</span>
              </button>
            </div>
          )}

          <div className={isExpandedChat ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 h-full flex-1 min-h-0 overflow-hidden' : 'contents'}>
            {/* Left Column: Customer Conversation Threads List */}
            <div className="lg:col-span-4 xl:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
            {/* Thread Header & Search */}
            <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                  Active Conversations ({chatThreads.length})
                </span>
                {pendingChatCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-extrabold border border-amber-300">
                    {pendingChatCount} pending reply
                  </span>
                )}
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search customer, email, account..."
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-2xs"
                />
              </div>

              {/* Quick Filters */}
              <div className="flex gap-1.5 pt-0.5">
                <button
                  onClick={() => setChatFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                    chatFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setChatFilter('pending')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer flex items-center gap-1 ${
                    chatFilter === 'pending'
                      ? 'bg-amber-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span>Pending Reply</span>
                  {pendingChatCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  )}
                </button>
                <button
                  onClick={() => setChatFilter('verified')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                    chatFilter === 'verified'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Verified
                </button>
              </div>
            </div>

            {/* Conversation List Stream */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
              {filteredChatThreads.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-500">No conversations match your filter.</p>
                </div>
              ) : (
                filteredChatThreads.map((thread) => {
                  const cust = thread.customer;
                  const isSelected = selectedCustomerId === thread.userId;
                  const fullName = cust ? `${cust.firstName} ${cust.lastName}`.trim() : thread.userId;
                  const accMask = cust?.permanentAccountNumber
                    ? `•••• ${cust.permanentAccountNumber.slice(-4)}`
                    : '•••• 1000';
                  const isPending = thread.unreadCount > 0;

                  return (
                    <div
                      key={thread.userId}
                      onClick={() => setSelectedCustomerId(thread.userId)}
                      className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-50/80 border-l-4 border-emerald-600'
                          : isPending
                          ? 'bg-amber-50/40 hover:bg-amber-50/70 border-l-4 border-amber-400'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Avatar with Online Dot */}
                      <div className="relative shrink-0 mt-0.5">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-800 to-slate-900 text-amber-400 font-black text-xs flex items-center justify-center border-2 border-white shadow-xs">
                          {cust?.avatarUrl ? (
                            <img
                              src={cust.avatarUrl}
                              alt={fullName}
                              className="w-full h-full rounded-full object-cover"
                            />
                          ) : (
                            <span>{fullName.slice(0, 2).toUpperCase()}</span>
                          )}
                        </div>
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black text-slate-900 truncate">
                            {fullName}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                            {new Date(thread.lastMessage.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-bold text-slate-500 font-mono">
                            {accMask}
                          </span>
                          {cust?.kycStatus === 'verified' && (
                            <span className="inline-flex items-center text-[9px] font-black px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                              Verified
                            </span>
                          )}
                        </div>

                        {/* Last Message Snippet */}
                        <p className="text-[11px] font-medium text-slate-600 truncate mt-1">
                          {thread.lastMessage.sender === 'support' ? (
                            <span className="text-emerald-700 font-bold">You: </span>
                          ) : null}
                          {thread.lastMessage.attachmentType ? (
                            <span className="font-bold text-slate-700">📎 [Document / Photo Attached]</span>
                          ) : (
                            thread.lastMessage.message
                          )}
                        </p>
                      </div>

                      {/* Pending Badge */}
                      {isPending && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black shrink-0 animate-pulse">
                          Reply
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Active Live Chat Window */}
          <div className="lg:col-span-8 xl:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
            {selectedCustomer ? (
              <>
                {/* Active Chat Header */}
                <div className="p-4 bg-slate-900 text-white flex items-center justify-between shadow-sm shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <div className="w-11 h-11 rounded-full bg-amber-400 text-slate-950 font-black text-sm flex items-center justify-center border-2 border-emerald-400 shadow-xs">
                        {selectedCustomer.avatarUrl ? (
                          <img
                            src={selectedCustomer.avatarUrl}
                            alt={selectedCustomer.firstName}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <span>{selectedCustomer.firstName?.slice(0, 1) || 'C'}</span>
                        )}
                      </div>
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm sm:text-base font-black text-white truncate">
                          {selectedCustomer.firstName} {selectedCustomer.lastName}
                        </span>
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            selectedCustomer.kycStatus === 'verified'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {selectedCustomer.kycStatus === 'verified' ? 'Verified Client' : 'Pending KYC'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 flex items-center gap-2 mt-0.5 truncate">
                        <span>{selectedCustomer.email}</span>
                        <span>•</span>
                        <span className="font-mono">
                          MVB •••• {selectedCustomer.permanentAccountNumber?.slice(-4) || '1000'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions: Request Proof, View customer profile, Expand/Minimize screen */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsProofModalOpen(true)}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                      title="Ask user to send proof of their issue or verification documents"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Request Proof</span>
                    </button>

                    {onSelectCustomer && (
                      <button
                        onClick={() => onSelectCustomer(selectedCustomer)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                      >
                        <User className="w-3.5 h-3.5 text-amber-400" />
                        <span className="hidden md:inline">Inspect Profile</span>
                      </button>
                    )}

                    <button
                      onClick={() => setIsExpandedChat(!isExpandedChat)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white hover:text-amber-400 text-xs font-black border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                      title={isExpandedChat ? 'Collapse screen' : 'Expand full screen'}
                    >
                      {isExpandedChat ? (
                        <>
                          <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                          <span className="hidden sm:inline">Minimize</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="hidden sm:inline">Expand</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Messages Stream Canvas */}
                <div
                  className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 custom-scrollbar"
                  style={{
                    backgroundColor: '#F8FAFC',
                    backgroundImage: `radial-gradient(#e2e8f0 0.8px, transparent 0.8px)`,
                    backgroundSize: '16px 16px',
                  }}
                >
                  {/* Security Notice */}
                  <div className="mx-auto max-w-lg p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-bold text-center shadow-2xs flex items-center justify-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>
                      256-Bit Encrypted Session • Real-time synchronization active with client's WhatsApp widget.
                    </span>
                  </div>

                  {activeCustomerMessages.map((msg) => {
                    const isSupport = msg.sender === 'support';

                    if (isSupport) {
                      // Support / Admin Reply (Right aligned, balanced)
                      return (
                        <div
                          key={msg.id}
                          className="flex items-end justify-end gap-2.5 max-w-[88%] sm:max-w-[78%] md:max-w-[70%] ml-auto animate-in fade-in"
                        >
                          <div className="bg-gradient-to-br from-emerald-800 to-emerald-900 text-white border border-emerald-700/80 rounded-2xl rounded-br-xs shadow-xs px-4 py-3 space-y-1.5 min-w-[180px]">
                            {/* Header */}
                            <div className="flex items-center justify-end gap-2 pb-1 border-b border-emerald-700/60">
                              <span className="text-xs font-extrabold text-white truncate">
                                Specialist
                              </span>
                            </div>

                            {/* Message Body */}
                            {msg.message && (
                              <div className="text-xs sm:text-[13px] font-semibold text-white leading-relaxed whitespace-pre-wrap break-words">
                                {msg.message}
                              </div>
                            )}

                            {/* Image Attachment */}
                            {msg.attachmentUrl && msg.attachmentType === 'image' && (
                              <div className="mt-2 space-y-1.5">
                                <div
                                  onClick={() => setZoomedImage({ src: msg.attachmentUrl!, name: msg.attachmentName || 'Proof' })}
                                  className="relative rounded-xl overflow-hidden border border-emerald-600/60 max-h-52 bg-slate-950 cursor-pointer group"
                                >
                                  <img
                                    src={msg.attachmentUrl}
                                    alt={msg.attachmentName || 'Attachment'}
                                    className="w-full h-auto object-cover max-h-48 group-hover:opacity-90 transition-opacity"
                                  />
                                  <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                    <Eye className="w-5 h-5 drop-shadow-md" />
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDownloadFile(msg.attachmentUrl!, msg.attachmentName || 'proof.jpg')}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black bg-emerald-900/80 hover:bg-emerald-950 text-amber-300 border border-emerald-600/50 transition-colors cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download File</span>
                                </button>
                              </div>
                            )}

                            {/* Document Attachment */}
                            {msg.attachmentUrl && msg.attachmentType === 'document' && (
                              <div className="mt-2 p-2.5 rounded-xl border border-emerald-600/60 bg-emerald-950/60 text-white flex items-center justify-between gap-3 text-xs font-bold">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="p-2 rounded-lg bg-emerald-900 text-amber-300 shrink-0">
                                    <FileText className="w-4 h-4 stroke-[2.5]" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-black">{msg.attachmentName || 'Document'}</div>
                                    <div className="text-[10px] font-mono text-emerald-300">{formatSize(msg.attachmentSize)}</div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDownloadFile(msg.attachmentUrl!, msg.attachmentName || 'document.pdf')}
                                  className="p-1.5 rounded-lg border border-emerald-500 bg-emerald-800 hover:bg-emerald-700 text-white shadow-2xs transition-colors shrink-0 cursor-pointer"
                                  title="Download Document"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            )}

                            {/* Footer Timestamp & Status */}
                            <div className="flex items-center justify-end gap-1.5 text-[10px] text-emerald-200 font-bold pt-1">
                              <span>
                                {new Date(msg.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <CheckCheck className="w-3.5 h-3.5 text-amber-300" />
                            </div>
                          </div>

                          {/* Admin Avatar */}
                          <div className="w-8 h-8 rounded-full bg-slate-900 text-amber-400 text-xs font-black flex items-center justify-center shrink-0 mb-1 border border-emerald-500 shadow-2xs overflow-hidden">
                            {currentUser?.avatarUrl ? (
                              <img src={currentUser.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span>AD</span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Customer Message (Left aligned, balanced)
                    return (
                      <div
                        key={msg.id}
                        className="flex items-end justify-start gap-2.5 max-w-[88%] sm:max-w-[78%] md:max-w-[70%] animate-in fade-in"
                      >
                        {/* Customer Avatar */}
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-800 text-xs font-black flex items-center justify-center shrink-0 mb-1 border border-slate-300 shadow-2xs overflow-hidden">
                          {selectedCustomer.avatarUrl ? (
                            <img src={selectedCustomer.avatarUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span>{selectedCustomer.firstName?.slice(0, 1) || 'C'}</span>
                          )}
                        </div>

                        <div className="bg-white text-slate-900 border border-slate-200/90 rounded-2xl rounded-bl-xs shadow-xs px-4 py-3 space-y-1.5 min-w-[180px]">
                          {/* Header */}
                          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                            <span className="text-xs font-extrabold text-slate-900 truncate">
                              {msg.senderName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}
                            </span>
                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 font-mono tracking-wider">
                              Customer
                            </span>
                          </div>

                          {/* Message Body */}
                          {msg.message && (
                            <div className="text-xs sm:text-[13px] font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap break-words">
                              {msg.message}
                            </div>
                          )}

                          {/* Image Attachment */}
                          {msg.attachmentUrl && msg.attachmentType === 'image' && (
                            <div className="mt-2 space-y-1.5">
                              <div
                                onClick={() => setZoomedImage({ src: msg.attachmentUrl!, name: msg.attachmentName || 'Proof' })}
                                className="relative rounded-xl overflow-hidden border border-slate-300 max-h-52 bg-slate-950 cursor-pointer group"
                              >
                                <img
                                  src={msg.attachmentUrl}
                                  alt={msg.attachmentName || 'Attachment'}
                                  className="w-full h-auto object-cover max-h-48 group-hover:opacity-90 transition-opacity"
                                />
                                <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                  <Eye className="w-5 h-5 drop-shadow-md" />
                                </div>
                              </div>
                              <button
                                onClick={() => handleDownloadFile(msg.attachmentUrl!, msg.attachmentName || 'proof.jpg')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer border border-slate-200"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download Proof Photo</span>
                              </button>
                            </div>
                          )}

                          {/* Document Attachment */}
                          {msg.attachmentUrl && msg.attachmentType === 'document' && (
                            <div className="mt-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 flex items-center justify-between gap-3 text-xs font-bold">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
                                  <FileText className="w-4 h-4 stroke-[2.5]" />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-black">{msg.attachmentName || 'Document'}</div>
                                  <div className="text-[10px] font-mono text-slate-500">{formatSize(msg.attachmentSize)}</div>
                                </div>
                              </div>
                              <button
                                onClick={() => handleDownloadFile(msg.attachmentUrl!, msg.attachmentName || 'document.pdf')}
                                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-emerald-50 text-slate-800 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                title="Download Document"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          )}

                          {/* Footer Timestamp */}
                          <div className="flex items-center justify-end text-[10px] text-slate-400 font-bold pt-1">
                            <span>
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Customer typing indicator */}
                  {customerIsTyping && (
                    <div className="flex items-center gap-2 p-3 rounded-2xl bg-white max-w-[220px] rounded-tl-xs shadow-2xs border border-slate-200 animate-in fade-in">
                      <span className="text-xs font-black text-slate-700">
                        {selectedCustomer.firstName} is typing
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}

                  <div ref={chatMessagesEndRef} />
                </div>

                {/* Quick Presets Bar */}
                <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 flex items-center gap-2 overflow-x-auto whitespace-nowrap custom-scrollbar">
                  <button
                    onClick={() => setIsProofModalOpen(true)}
                    className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer shrink-0"
                    title="Request proof of issue from client"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Request Proof</span>
                  </button>

                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 pl-1">
                    Quick Responses:
                  </span>
                  {chatQuickReplies.map((qr, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendLiveReply(qr)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 text-slate-800 hover:text-emerald-900 border border-slate-300 text-xs font-bold transition-all cursor-pointer shrink-0"
                    >
                      {qr.slice(0, 32)}...
                    </button>
                  ))}
                </div>

                {/* Reply Footer Input */}
                <div className="p-3.5 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0">
                  {/* Proof Attachment Button */}
                  <button
                    onClick={() => fileUploadInputRef.current?.click()}
                    disabled={isUploadingProof}
                    className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer shrink-0 border border-slate-200"
                    title="Upload Proof Document / Image to Client"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  {/* Ask for Proof Button */}
                  <button
                    onClick={() => setIsProofModalOpen(true)}
                    className="px-3 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-black text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-2xs"
                    title="Tell user to send proof of their issue"
                  >
                    <Camera className="w-4 h-4 text-amber-700" />
                    <span className="hidden sm:inline">Ask for Proof</span>
                  </button>

                  <input
                    type="text"
                    placeholder={`Reply directly to ${selectedCustomer.firstName}...`}
                    value={chatReplyInput}
                    onChange={handleAdminInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendLiveReply();
                      }
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs sm:text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />

                  <button
                    onClick={() => handleSendLiveReply()}
                    disabled={!chatReplyInput.trim()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span>Send Reply</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <MessageSquare className="w-12 h-12 text-slate-300" />
                <h3 className="text-base font-black text-slate-800">No Customer Selected</h3>
                <p className="text-xs font-medium text-slate-500 max-w-sm">
                  Select an active customer conversation from the left pane to view full chat history and reply in real time.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ========================================================================= */}
      {/* 2. COMPLIANCE TICKETS & BROADCAST NOTICES */}
      {/* ========================================================================= */}
      {activeMode === 'tickets' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[720px]">
          {/* Left Column: Tickets list */}
          <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                  Compliance Inquiries ({tickets.length})
                </span>
                <button
                  onClick={() => setIsCreateNoticeOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Issue Notice</span>
                </button>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search notices & tickets..."
                  value={ticketSearchQuery}
                  onChange={(e) => setTicketSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>

              <div className="flex gap-1.5">
                {(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setTicketStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                      ticketStatusFilter === st
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {st === 'ALL' ? 'All' : st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
              {tickets.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <Shield className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-500">No compliance notices created yet.</p>
                </div>
              ) : (
                tickets
                  .filter((t) => {
                    const matchSt = ticketStatusFilter === 'ALL' ? true : t.supportStatus === ticketStatusFilter;
                    const matchQ =
                      t.title.toLowerCase().includes(ticketSearchQuery.toLowerCase()) ||
                      t.message.toLowerCase().includes(ticketSearchQuery.toLowerCase());
                    return matchSt && matchQ;
                  })
                  .map((ticket) => {
                    const isSelected = selectedTicketId === ticket.id;
                    const customer = customers.find((c) => c.id === ticket.userId);

                    return (
                      <div
                        key={ticket.id}
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className={`p-4 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-50/80 border-l-4 border-amber-500'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-slate-900 truncate">
                            {ticket.title}
                          </span>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                              ticket.supportStatus === 'RESOLVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {ticket.supportStatus || 'OPEN'}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-slate-500 line-clamp-2 mt-1">
                          {ticket.message}
                        </p>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[10px] font-bold text-slate-400">
                          <span>Client: {customer ? `${customer.firstName} ${customer.lastName}` : ticket.userId}</span>
                          <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Right Column: Ticket Dossier & Reply */}
          <div className="lg:col-span-7 xl:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
            {selectedTicketId ? (
              (() => {
                const currentTicket = tickets.find((t) => t.id === selectedTicketId);
                if (!currentTicket) return null;
                const customer = customers.find((c) => c.id === currentTicket.userId);

                return (
                  <div className="flex-1 flex flex-col h-full">
                    {/* Ticket Header */}
                    <div className="p-5 border-b border-slate-200 bg-slate-50/70">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono">
                              ID: {currentTicket.id.slice(0, 12)}
                            </span>
                            <span className="text-xs font-bold text-slate-500">
                              Recipient: {customer ? `${customer.firstName} ${customer.lastName} (${customer.email})` : currentTicket.userId}
                            </span>
                          </div>
                          <h3 className="text-lg font-black text-slate-900">{currentTicket.title}</h3>
                        </div>

                        {/* Mark Resolved action */}
                        {currentTicket.supportStatus !== 'RESOLVED' && (
                          <button
                            onClick={async () => {
                              await firestoreSync.sendSupportReply(
                                currentTicket.id,
                                {
                                  senderId: currentUser?.id || 'usr_admin',
                                  senderName: 'Specialist',
                                  senderRole: 'SUPPORT_REP',
                                  message: 'Case review finalized. Ticket marked as RESOLVED.',
                                },
                                'RESOLVED'
                              );
                              if (onRefreshData) await onRefreshData();
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Mark Resolved</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Ticket Body & Thread */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                      {/* Original Notice */}
                      <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200 text-xs sm:text-sm font-bold text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {currentTicket.message}
                      </div>

                      {/* Replies */}
                      {currentTicket.replies?.map((rep) => {
                        const isStaff = rep.senderRole === 'ADMIN' || rep.sender === 'support';
                        return (
                          <div
                            key={rep.id}
                            className={`p-4 rounded-2xl text-xs sm:text-sm ${
                              isStaff
                                ? 'bg-amber-50 border border-amber-200 text-amber-950 ml-6'
                                : 'bg-blue-50 border border-blue-200 text-blue-950 mr-6'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1 text-[11px] font-black">
                              <span>{rep.senderName} ({rep.senderRole || 'User'})</span>
                              <span className="text-slate-400 font-normal">
                                {new Date(rep.createdAt || rep.timestamp || Date.now()).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="font-medium whitespace-pre-wrap">{rep.message}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Ticket Reply Footer */}
                    <div className="p-4 border-t border-slate-200 bg-white flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Add compliance note or customer reply..."
                        value={ticketReplyMessage}
                        onChange={(e) => setTicketReplyMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSendTicketReply(currentTicket.id);
                          }
                        }}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        onClick={() => handleSendTicketReply(currentTicket.id)}
                        disabled={isSendingTicketReply || !ticketReplyMessage.trim()}
                        className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <Send className="w-4 h-4" />
                        <span>Send</span>
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
                <Shield className="w-10 h-10 text-slate-300" />
                <p className="text-xs font-bold text-slate-500">Select a notice to view history and replies.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- CREATE NOTICE MODAL --- */}
      {isCreateNoticeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shadow-xs">
                  <Shield className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Issue Compliance Notice</h3>
                  <p className="text-xs font-medium text-slate-500">Sends formal notification to user's dashboard</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateNoticeOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNoticeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Target Customer
                </label>
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Select Customer Account --</option>
                  {customers
                    .filter((c) => c.role !== 'admin' && c.id !== 'usr_admin')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} ({c.email}) • {c.permanentAccountNumber || 'Account'}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Notice Title
                </label>
                <input
                  type="text"
                  placeholder="e.g., Mandatory KYC Dossier Update Required"
                  value={newNoticeTitle}
                  onChange={(e) => setNewNoticeTitle(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Severity Tier
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['info', 'success', 'warning', 'error'] as const).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setNewNoticeSeverity(sev)}
                      className={`py-2 px-2 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer border ${
                        newNoticeSeverity === sev
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Notice Message
                </label>
                <textarea
                  rows={4}
                  placeholder="Enter the official message..."
                  value={newNoticeMessage}
                  onChange={(e) => setNewNoticeMessage(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateNoticeOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingNotice}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isCreatingNotice ? 'Publishing...' : 'Publish Notice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- REQUEST PROOF MODAL --- */}
      {isProofModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-xl bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center font-black">
                  <Camera className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Request Proof from {selectedCustomer.firstName}
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    Select a verification request template to send directly or draft into the chat.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsProofModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
              {proofTemplates.map((template) => {
                const generatedMsg = template.message(selectedCustomer.firstName);
                return (
                  <div
                    key={template.id}
                    className="p-4 rounded-2xl border border-slate-200 hover:border-amber-400 bg-slate-50/70 hover:bg-amber-50/30 transition-all space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900">{template.title}</span>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                          {template.tag}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-slate-600 leading-relaxed">
                      "{generatedMsg}"
                    </p>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setChatReplyInput(generatedMsg);
                          setIsProofModalOpen(false);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold transition-all cursor-pointer shadow-2xs"
                      >
                        Insert into Reply Box
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleSendLiveReply(generatedMsg);
                          setIsProofModalOpen(false);
                        }}
                        className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Send Request Now</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
