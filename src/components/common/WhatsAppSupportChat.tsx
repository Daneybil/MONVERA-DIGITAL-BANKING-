import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreSync } from '../../services/firestoreSync';
import { ChatMessage } from '../../types';
import {
  MessageCircle,
  X,
  Send,
  Paperclip,
  Smile,
  Phone,
  Video,
  MoreVertical,
  CheckCheck,
  Shield,
  Sparkles,
  RefreshCw,
  Image as ImageIcon,
  FileText,
  Volume2,
  Play,
  Pause,
  ArrowDown,
  Lock,
  Headphones,
} from 'lucide-react';

const QUICK_PROMPTS = [
  { id: 'transfer_status', label: '💳 Check Transfer Status', text: 'Hello, I would like to check the status of my latest transfer/deposit.' },
  { id: 'admin_funds', label: '💰 Administrative Funding', text: 'Can you verify my recent account funds and balance update?' },
  { id: 'kyc_help', label: '🛡️ KYC & Verification Help', text: 'How do I ensure my account tier and KYC verification are fully approved?' },
  { id: 'card_pin', label: '🏧 Card Activation & PIN', text: 'I need assistance activating my Monvera Visa card or setting my PIN.' },
  { id: 'human_rep', label: '👤 Speak with Senior Officer', text: 'Please connect me with a senior private wealth specialist.' },
];

export const WhatsAppSupportChat: React.FC = () => {
  const { currentUser, balanceMetrics } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(1);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [callNotice, setCallNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const userId = currentUser?.id || 'guest_user';
  const userName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : 'Valued Customer';
  const userAcc = currentUser?.permanentAccountNumber || '1000000000';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Initial welcome seed and Firestore subscription
  useEffect(() => {
    if (!userId) return;

    // Default welcome messages
    const defaultWelcome: ChatMessage[] = [
      {
        id: 'msg_welcome_1',
        userId,
        sender: 'support',
        senderName: 'David Vance',
        senderRole: 'Senior Private Wealth Specialist',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        message: `Hello ${currentUser?.firstName || 'there'}! 👋 Welcome to Monvera Official Customer Support. I am David Vance, your dedicated Private Wealth Specialist.`,
        timestamp: new Date(Date.now() - 60000).toISOString(),
        status: 'read',
      },
      {
        id: 'msg_welcome_2',
        userId,
        sender: 'support',
        senderName: 'David Vance',
        senderRole: 'Senior Private Wealth Specialist',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        message: `How may I assist you today with your accounts (MVB •••• ${userAcc.slice(-4)}), transfers, deposits, or wealth management?`,
        timestamp: new Date().toISOString(),
        status: 'read',
      },
    ];

    // Subscribe to real-time chat messages
    const unsubscribe = firestoreSync.subscribeToChatMessages(userId, (liveList) => {
      if (liveList && liveList.length > 0) {
        setMessages(liveList);
      } else {
        firestoreSync.getChatMessagesForUser(userId).then((fetched) => {
          if (fetched && fetched.length > 0) {
            setMessages(fetched);
          } else {
            setMessages(defaultWelcome);
          }
        });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [userId, currentUser?.firstName, userAcc]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(scrollToBottom, 150);
    }
  }, [isOpen, messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text) return;

    setInputValue('');
    setShowAttachMenu(false);

    const userMsg: ChatMessage = {
      id: `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId,
      sender: 'user',
      senderName: userName,
      message: text,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    scrollToBottom();

    // Persist to Firestore
    await firestoreSync.saveChatMessage(userMsg);

    // Simulate Agent typing and auto-response
    setIsTyping(true);
    setTimeout(async () => {
      setIsTyping(false);
      const replyText = generateSupportReply(text, currentUser, balanceMetrics);

      const supportMsg: ChatMessage = {
        id: `msg_rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId,
        sender: 'support',
        senderName: 'David Vance',
        senderRole: 'Senior Private Wealth Specialist',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        message: replyText,
        timestamp: new Date().toISOString(),
        status: 'read',
      };

      setMessages((prev) => [...prev, supportMsg]);
      await firestoreSync.saveChatMessage(supportMsg);

      // Also create support ticket thread in background for admin review
      firestoreSync.createSupportTicket({
        userId,
        title: `Customer WhatsApp Inbound: ${text.slice(0, 40)}...`,
        message: text,
        adminAuthorName: 'David Vance',
        adminAuthorRole: 'Private Wealth Concierge',
        severity: 'info',
        initialStatus: 'IN_PROGRESS',
      }).catch(() => {});

      scrollToBottom();
    }, 1200);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileMsg: ChatMessage = {
      id: `msg_file_${Date.now()}`,
      userId,
      sender: 'user',
      senderName: userName,
      message: `📎 Attached Document: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      timestamp: new Date().toISOString(),
      status: 'sent',
      attachmentType: file.type.includes('image') ? 'image' : 'document',
    };

    setMessages((prev) => [...prev, fileMsg]);
    firestoreSync.saveChatMessage(fileMsg);
    setShowAttachMenu(false);

    setIsTyping(true);
    setTimeout(async () => {
      setIsTyping(false);
      const ackMsg: ChatMessage = {
        id: `msg_rep_${Date.now()}`,
        userId,
        sender: 'support',
        senderName: 'David Vance',
        senderRole: 'Senior Private Wealth Specialist',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        message: `Thank you for providing **${file.name}**. I have verified the attachment against our clearance records. Your document has been securely archived in your Monvera compliance vault.`,
        timestamp: new Date().toISOString(),
        status: 'read',
      };
      setMessages((prev) => [...prev, ackMsg]);
      firestoreSync.saveChatMessage(ackMsg);
      scrollToBottom();
    }, 1500);
  };

  const triggerCallSimulation = (type: 'Voice' | 'Video') => {
    setCallNotice(`Connecting secure ${type} call to David Vance (VIP Concierge Desk)...`);
    setTimeout(() => {
      setCallNotice(`Calling Line 1 (Monvera Federal Clearance Desk). Toll-Free VIP backup: 1-800-MONVERA.`);
      setTimeout(() => setCallNotice(null), 5000);
    }, 2000);
  };

  return (
    <>
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*,.pdf,.doc,.docx"
      />

      {/* --- WHATSAPP FLOATING LAUNCHER BUTTON (Bottom Right) --- */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
          {/* Label Pill on Desktop */}
          <div
            onClick={() => setIsOpen(true)}
            className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-950 text-white text-xs font-black shadow-xl border border-slate-700/80 cursor-pointer hover:bg-slate-900 transition-all hover:scale-105"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Monvera WhatsApp Support</span>
          </div>

          {/* Authentic WhatsApp Green Floating Button */}
          <button
            id="whatsapp-support-launcher-btn"
            onClick={() => setIsOpen(true)}
            className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-[0_8px_30px_rgb(37,211,102,0.4)] flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer group"
            title="Chat with Monvera Support on WhatsApp"
            aria-label="Open Monvera WhatsApp Support Chat"
          >
            {/* WhatsApp Signature Custom SVG */}
            <svg
              viewBox="0 0 24 24"
              width="32"
              height="32"
              fill="currentColor"
              className="drop-shadow-md group-hover:scale-105 transition-transform"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>

            {/* Unread Counter Badge */}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-600 border-2 border-white text-white font-extrabold text-xs flex items-center justify-center animate-bounce">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* --- AUTHENTIC WHATSAPP LIVE CHAT WINDOW --- */}
      {isOpen && (
        <div
          id="whatsapp-chat-window"
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-[410px] md:w-[440px] h-[580px] sm:h-[640px] max-h-[90vh] bg-[#EFEAE2] rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] border border-slate-300 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        >
          {/* 1. WHATSAPP HEADER (Dark Teal #075E54) */}
          <div className="bg-[#075E54] text-white px-4 py-3 sm:py-3.5 flex items-center justify-between shadow-md shrink-0 select-none">
            
            {/* Left: Avatar, Name, Verified Badge, Status */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                  alt="David Vance"
                  className="w-10 h-10 rounded-full object-cover border-2 border-[#25D366]"
                />
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#25D366] border-2 border-[#075E54]" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-sm sm:text-base text-white truncate">
                    David Vance
                  </span>
                  {/* Verified Gold Badge */}
                  <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-400 text-slate-950">
                    Official
                  </span>
                </div>
                <div className="text-[11px] text-emerald-200 flex items-center gap-1 truncate font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
                  <span>online • Monvera VIP Support</span>
                </div>
              </div>
            </div>

            {/* Right: Phone, Video, More, Close */}
            <div className="flex items-center gap-1 text-slate-200">
              <button
                onClick={() => triggerCallSimulation('Video')}
                className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                title="Monvera Video Verification"
              >
                <Video className="w-4 h-4 text-emerald-300" />
              </button>

              <button
                onClick={() => triggerCallSimulation('Voice')}
                className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                title="Monvera Toll-Free Concierge Voice Line"
              >
                <Phone className="w-4 h-4 text-emerald-300" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                  title="More Options"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showMoreMenu && (
                  <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-slate-800 text-xs font-bold z-50">
                    <button
                      onClick={() => {
                        setMessages([]);
                        setShowMoreMenu(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Clear Chat History</span>
                    </button>
                    <a
                      href="tel:18006668372"
                      onClick={() => setShowMoreMenu(false)}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-100 flex items-center gap-2 cursor-pointer text-emerald-700"
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span>Call Monvera: 1-800-MONVERA</span>
                    </a>
                  </div>
                )}
              </div>

              <button
                id="whatsapp-close-btn"
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer text-slate-200 hover:text-white"
                title="Minimize Support Chat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Call Notice Alert */}
          {callNotice && (
            <div className="bg-amber-100 text-amber-900 px-3.5 py-2 text-xs font-bold flex items-center justify-between border-b border-amber-300 animate-in slide-in-from-top-1">
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-amber-700 animate-bounce" />
                <span>{callNotice}</span>
              </div>
              <button onClick={() => setCallNotice(null)} className="text-amber-800 hover:text-amber-950 font-black">
                ✕
              </button>
            </div>
          )}

          {/* 2. CHAT CANVAS & WALLPAPER (Authentic WhatsApp Pattern Wallpaper) */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar"
            style={{
              backgroundColor: '#EFEAE2',
              backgroundImage: `radial-gradient(#d1c7b7 0.75px, transparent 0.75px)`,
              backgroundSize: '16px 16px',
            }}
          >
            {/* End-to-End Encryption Gold Banner */}
            <div className="mx-auto max-w-[92%] p-2.5 rounded-xl bg-[#FFF9C4] text-[#5D4037] text-[11px] font-bold leading-relaxed text-center shadow-xs border border-[#FFEE58] flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                <strong>End-to-End Bank Encryption:</strong> Messages are secured by Monvera 256-bit clearance security.
              </span>
            </div>

            {/* Date Pill */}
            <div className="flex justify-center">
              <span className="px-3 py-1 rounded-lg bg-white/80 text-slate-600 text-[10px] font-extrabold uppercase tracking-wider shadow-2xs border border-slate-300/60">
                Today
              </span>
            </div>

            {/* Quick Action Chips at the Top */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-black text-slate-700 uppercase tracking-wider px-1">
                Frequently Asked Banking Topics:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map((chip) => (
                  <button
                    key={chip.id}
                    onClick={() => handleSendMessage(chip.text)}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 text-xs font-bold shadow-xs border border-slate-300 hover:border-emerald-400 transition-all cursor-pointer text-left"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages Stream */}
            {messages.map((msg) => {
              const isSupport = msg.sender === 'support';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isSupport ? 'items-start' : 'items-end'} animate-in fade-in slide-in-from-bottom-1`}
                >
                  <div
                    className={`max-w-[88%] sm:max-w-[82%] px-3.5 py-2.5 rounded-2xl shadow-sm text-sm ${
                      isSupport
                        ? 'bg-white text-slate-900 rounded-tl-xs border border-slate-200'
                        : 'bg-[#D9FDD3] text-slate-950 rounded-tr-xs border border-[#b2f0a8]'
                    }`}
                  >
                    {/* Support Rep Header in bubble */}
                    {isSupport && (
                      <div className="flex items-center gap-1.5 mb-1 pb-1 border-b border-slate-100">
                        <span className="text-xs font-black text-[#075E54]">
                          {msg.senderName}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 font-mono">
                          • Specialist
                        </span>
                      </div>
                    )}

                    {/* Message Body (Bright & Bold Typography) */}
                    <div className="text-xs sm:text-[13px] font-bold leading-relaxed text-slate-900 whitespace-pre-wrap">
                      {msg.message}
                    </div>

                    {/* Attachment preview if any */}
                    {msg.attachmentType && (
                      <div className="mt-2 p-2 rounded-lg bg-slate-100 flex items-center gap-2 text-xs font-bold text-slate-800">
                        <FileText className="w-4 h-4 text-emerald-600" />
                        <span>Verified Document Attached</span>
                      </div>
                    )}

                    {/* Timestamp & WhatsApp Status Checkmarks */}
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {!isSupport && (
                        <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex items-center gap-2 p-3 rounded-2xl bg-white max-w-[140px] rounded-tl-xs shadow-xs border border-slate-200">
                <span className="text-xs font-bold text-slate-600">David is typing</span>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 3. ATTACHMENT POPUP */}
          {showAttachMenu && (
            <div className="bg-white border-t border-slate-200 p-2.5 flex items-center justify-around animate-in slide-in-from-bottom-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1 text-slate-700 hover:text-emerald-700 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-bold">Document</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1 text-slate-700 hover:text-purple-700 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-700">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-bold">Gallery / Proof</span>
              </button>
            </div>
          )}

          {/* 4. WHATSAPP INPUT FOOTER */}
          <div className="bg-[#F0F2F5] px-3 py-2.5 flex items-center gap-2 border-t border-slate-300 shrink-0">
            
            {/* Attachment Pin */}
            <button
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className="p-2 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer"
              title="Attach File or Statement"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* Input Field */}
            <div className="flex-1">
              <input
                id="whatsapp-chat-input"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type a message to Monvera Support..."
                className="w-full px-4 py-2.5 rounded-full bg-white text-slate-900 placeholder:text-slate-500 text-xs sm:text-sm font-bold border border-slate-300 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-2xs"
              />
            </div>

            {/* Send Circular WhatsApp Button */}
            <button
              id="whatsapp-chat-send-btn"
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim()}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md ${
                inputValue.trim()
                  ? 'bg-[#128C7E] hover:bg-[#075E54] text-white active:scale-95'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed'
              }`}
              title="Send Message"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>

        </div>
      )}
    </>
  );
};

/**
 * Intelligent context-aware auto-support logic for Monvera customer inquiries
 */
function generateSupportReply(text: string, currentUser: any, balanceMetrics: any): string {
  const query = text.toLowerCase();
  const userName = currentUser?.firstName || 'Customer';
  const checkingBal = balanceMetrics?.checkingBalance
    ? `$${Number(balanceMetrics.checkingBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : '$0.00';
  const totalBal = balanceMetrics?.totalBalance
    ? `$${Number(balanceMetrics.totalBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : '$0.00';

  if (query.includes('status') || query.includes('transfer') || query.includes('deposit') || query.includes('disappear') || query.includes('money')) {
    return `Hello ${userName}, I have reviewed your live ledger! 

✅ **Account Standing:** Active & Fully Funded
💰 **Current Checking Balance:** **${checkingBal}** (Total Portfolio: **${totalBal}**)
⚡ **Wire & Transfer Settlement:** All completed transfers are immutably recorded in your Firestore clearance ledger and remain permanently visible on your dashboard anytime you log in.

Is there any specific transfer reference number or transaction you would like me to inspect?`;
  }

  if (query.includes('admin') || query.includes('bennett') || query.includes('fund')) {
    return `Hello ${userName}, regarding administrative direct transfers and funding disbursements from Bennett Johnson:

All administrative direct transfers are executed via high-priority Fedwire clearance and credited directly to your checking account (MVB •••• ${currentUser?.permanentAccountNumber?.slice(-4) || '0000'}). Your balance of **${checkingBal}** is permanent, secured, and ready for immediate withdrawal, wire transfer, or investment.`;
  }

  if (query.includes('kyc') || query.includes('verif') || query.includes('tier') || query.includes('identity')) {
    return `Hello ${userName}, your KYC identity status is currently **${currentUser?.kycStatus?.toUpperCase() || 'VERIFIED'}** with Premier clearance! 

Your daily transfer limit is set to **$1,000,000.00 USD**. To download your verification clearance certificate or update your passport/tax ID, you can navigate to the **Profile & KYC** tab.`;
  }

  if (query.includes('card') || query.includes('pin') || query.includes('visa')) {
    return `Hello ${userName}, for your **Monvera Visa Infinite Card**:

💳 You can view your virtual card number, CVV, and 3D-Secure token directly in the **Cards** view. 
🔒 To change or reveal your 4-digit ATM PIN, click the **Set Card PIN** button in the Cards dashboard. Your card is fully active for worldwide POS and online transactions.`;
  }

  if (query.includes('invest') || query.includes('interest') || query.includes('yield') || query.includes('4.5')) {
    return `Hello ${userName}, our **4.5% Fixed Daily Yield Treasury** plan is actively compounding! 

You can allocate checking funds into any 30, 60, or 90-day plan to receive guaranteed daily interest payouts directly credited to your checking account every 24 hours at 00:00 UTC.`;
  }

  return `Thank you for reaching out, ${userName}! I have logged your inquiry with Monvera Private Wealth Concierge. 

Our operations desk is actively monitoring your account. You can also reach our 24/7 priority toll-free line at **1-800-MONVERA** or submit formal inquiries directly through this WhatsApp support channel. How else can I assist your financial operations today?`;
}
