import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreSync } from '../../services/firestoreSync';
import { ChatMessage } from '../../types';
import {
  X,
  Send,
  Paperclip,
  Phone,
  Video,
  MoreVertical,
  CheckCheck,
  Image as ImageIcon,
  FileText,
  Download,
  Lock,
  Headphones,
  Shield,
  LogIn,
  UserPlus,
  ExternalLink,
  Eye,
  GripVertical,
  Maximize2,
  Minimize2,
  Smartphone,
  Monitor,
  Wifi,
  Battery,
  ArrowDown,
  Sparkles,
} from 'lucide-react';

const QUICK_PROMPTS = [
  { id: 'transfer_status', label: '💳 Check Transfer Status', text: 'Hello, I would like to check the status of my latest transfer/deposit.' },
  { id: 'kyc_help', label: '🛡️ KYC & Verification Help', text: 'How do I ensure my account tier and KYC verification documents are fully approved?' },
  { id: 'card_pin', label: '🏧 Card Activation & PIN', text: 'I need assistance activating my Monvera Visa card or setting my PIN.' },
  { id: 'human_rep', label: '👤 Speak with Senior Officer', text: 'Please connect me with a senior private wealth specialist.' },
];

export const WhatsAppSupportChat: React.FC = () => {
  const { currentUser, openModal } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showAuthRequiredModal, setShowAuthRequiredModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [adminIsTyping, setAdminIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [phoneViewMode, setPhoneViewMode] = useState<'iphone' | 'wide'>('iphone');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState<boolean>(false);
  const isUserScrolledUpRef = useRef<boolean>(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState<string>(() => {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  // Floating movable position for WhatsApp Support Icon (persisted in localStorage)
  const [launcherPosition, setLauncherPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = localStorage.getItem('monvera_whatsapp_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch {}
    return null;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    hasMoved: boolean;
  }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
  });
  const launcherRef = useRef<HTMLDivElement | null>(null);

  // Keep icon in bounds if window resizes
  useEffect(() => {
    const handleResize = () => {
      setLauncherPosition((pos) => {
        if (!pos) return null;
        const width = launcherRef.current?.offsetWidth || 70;
        const height = launcherRef.current?.offsetHeight || 70;
        const maxX = window.innerWidth - width - 8;
        const maxY = window.innerHeight - height - 8;
        return {
          x: Math.min(Math.max(8, pos.x), Math.max(8, maxX)),
          y: Math.min(Math.max(8, pos.y), Math.max(8, maxY)),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if ('button' in e && e.button !== 0) return; // Only primary mouse button
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const el = launcherRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    dragRef.current = {
      startX: clientX,
      startY: clientY,
      initialX: rect.left,
      initialY: rect.top,
      hasMoved: false,
    };

    const handlePointerMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
      const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;
      const dx = currentX - dragRef.current.startX;
      const dy = currentY - dragRef.current.startY;

      if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > 5) {
        dragRef.current.hasMoved = true;
        setIsDragging(true);
      }

      if (dragRef.current.hasMoved) {
        if ('preventDefault' in moveEvent && moveEvent.cancelable) {
          moveEvent.preventDefault();
        }
        const width = el.offsetWidth || 70;
        const height = el.offsetHeight || 70;
        const maxX = window.innerWidth - width - 8;
        const maxY = window.innerHeight - height - 8;
        const nextX = Math.min(Math.max(8, dragRef.current.initialX + dx), maxX);
        const nextY = Math.min(Math.max(8, dragRef.current.initialY + dy), maxY);

        setLauncherPosition({ x: nextX, y: nextY });
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);

      if (dragRef.current.hasMoved) {
        setIsDragging(false);
        setLauncherPosition((pos) => {
          if (pos) {
            try {
              localStorage.setItem('monvera_whatsapp_pos', JSON.stringify(pos));
            } catch {}
          }
          return pos;
        });
      }
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);

  const userId = currentUser?.id || '';
  const userName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : 'Valued Customer';
  const userAcc = currentUser?.permanentAccountNumber || '1000000000';

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isUp = distanceFromBottom > 100;
    isUserScrolledUpRef.current = isUp;
    setShowScrollBottomBtn(isUp);
  };

  const scrollToBottom = (force = false) => {
    if (force || !isUserScrolledUpRef.current) {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setShowScrollBottomBtn(false);
      isUserScrolledUpRef.current = false;
    }
  };

  // Subscribe to real-time chat messages and admin typing status
  useEffect(() => {
    if (!currentUser || !currentUser.id) {
      setMessages([]);
      return;
    }

    const currentUserId = currentUser.id;

    // 1. Subscribe to Firestore & local chat messages
    const unsubscribeMsgs = firestoreSync.subscribeToChatMessages(currentUserId, (liveList) => {
      if (liveList && liveList.length > 0) {
        setMessages(liveList);
        // Calculate unread messages from support
        const unreadSupportMsgs = liveList.filter((m) => m.sender === 'support' && m.status !== 'read');
        setUnreadCount(unreadSupportMsgs.length);
      } else {
        // Welcome message if thread is completely fresh - permanently committed to memory
        const defaultWelcome: ChatMessage[] = [
          {
            id: `welcome_1_${currentUserId}`,
            userId: currentUserId,
            sender: 'support',
            senderName: 'Specialist',
            senderRole: 'Specialist',
            senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
            message: `Hello ${currentUser?.firstName || 'there'}! 👋 Welcome to Monvera Official Customer Support. I am your dedicated Private Wealth Specialist.`,
            timestamp: new Date().toISOString(),
            status: 'read',
          },
          {
            id: `welcome_2_${currentUserId}`,
            userId: currentUserId,
            sender: 'support',
            senderName: 'Specialist',
            senderRole: 'Specialist',
            senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
            message: `How may I assist you today with your accounts (MVB •••• ${userAcc.slice(-4)}), transfers, deposits, or document verification? You can also attach documents directly using the paperclip button.`,
            timestamp: new Date().toISOString(),
            status: 'read',
          },
        ];
        setMessages(defaultWelcome);
        firestoreSync.saveChatMessage(defaultWelcome[0]);
        firestoreSync.saveChatMessage(defaultWelcome[1]);
      }
    });

    // 2. Subscribe to typing status
    const unsubscribeTyping = firestoreSync.subscribeToTypingStatus(currentUserId, ({ adminTyping }) => {
      setAdminIsTyping(!!adminTyping);
    });

    return () => {
      if (typeof unsubscribeMsgs === 'function') unsubscribeMsgs();
      if (typeof unsubscribeTyping === 'function') unsubscribeTyping();
    };
  }, [currentUser?.id, currentUser?.firstName, userAcc]);

  // Mark messages as read when user opens the chat
  useEffect(() => {
    if (isOpen && currentUser?.id) {
      firestoreSync.markChatMessagesAsRead(currentUser.id, 'user').catch(() => {});
      setUnreadCount(0);
      setTimeout(scrollToBottom, 150);
    }
  }, [isOpen, currentUser?.id]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, adminIsTyping]);

  const handleOpenLauncher = () => {
    if (!currentUser) {
      setShowAuthRequiredModal(true);
    } else {
      setIsOpen(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (!currentUser?.id) return;

    // Report user is typing to Admin Dashboard
    firestoreSync.setTypingStatus(currentUser.id, true, 'user').catch(() => {});

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (currentUser?.id) {
        firestoreSync.setTypingStatus(currentUser.id, false, 'user').catch(() => {});
      }
    }, 2000);
  };

  const handleSendMessage = async (textToSend?: string) => {
    if (!currentUser?.id) return;

    const text = (textToSend || inputValue).trim();
    if (!text) return;

    setInputValue('');
    setShowAttachMenu(false);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    firestoreSync.setTypingStatus(currentUser.id, false, 'user').catch(() => {});

    const userMsg: ChatMessage = {
      id: `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      userAccountNumber: currentUser.permanentAccountNumber,
      sender: 'user',
      senderName: userName,
      senderRole: 'Customer',
      message: text,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    setMessages((prev) => [...prev, userMsg]);
    scrollToBottom();

    // Persist to Firestore: Admin dashboard receives this instantly!
    await firestoreSync.saveChatMessage(userMsg);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser?.id) return;

    setIsUploading(true);
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const isImg = file.type.startsWith('image/');

        const fileMsg: ChatMessage = {
          id: `msg_file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          userId: currentUser.id,
          userEmail: currentUser.email,
          userAccountNumber: currentUser.permanentAccountNumber,
          sender: 'user',
          senderName: userName,
          senderRole: 'Customer',
          message: file.name,
          timestamp: new Date().toISOString(),
          status: 'sent',
          attachmentUrl: dataUrl,
          attachmentType: isImg ? 'image' : 'document',
          attachmentName: file.name,
          attachmentSize: file.size,
        };

        setMessages((prev) => [...prev, fileMsg]);
        scrollToBottom();

        // Persist file attachment to Firestore for Admin to inspect and download
        await firestoreSync.saveChatMessage(fileMsg);
      } catch (err) {
        console.error('Failed to upload chat file:', err);
      } finally {
        setIsUploading(false);
        setShowAttachMenu(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setIsUploading(false);
      setShowAttachMenu(false);
    };

    reader.readAsDataURL(file);
  };

  const downloadFile = (url: string, name: string) => {
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = name || 'document';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to download file:', err);
      window.open(url, '_blank');
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const triggerCallSimulation = (type: 'Voice' | 'Video') => {
    setCallNotice(`Connecting secure ${type} clearance line to Monvera Executive Desk...`);
    setTimeout(() => {
      setCallNotice(`Calling Line 1 (Monvera Federal Clearance Desk). Toll-Free VIP backup: 1-800-MONVERA.`);
      setTimeout(() => setCallNotice(null), 5000);
    }, 2000);
  };

  return (
    <>
      {/* Hidden File Input for document/photo proof upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.txt"
      />

      {/* --- AUTHENTICATION REQUIRED MODAL (When unauthenticated visitor clicks support) --- */}
      {showAuthRequiredModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150 space-y-5">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                <Shield className="w-6 h-6 stroke-[2.5]" />
              </div>
              <button
                onClick={() => setShowAuthRequiredModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-black uppercase tracking-wider mb-2 border border-emerald-200">
                <Lock className="w-3 h-3 text-emerald-600" />
                <span>Verified Client Banking Access</span>
              </div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">
                Sign In to Access Monvera Support
              </h3>
              <p className="text-sm font-medium text-slate-600 mt-1.5 leading-relaxed">
                To protect client privacy and financial data, live chat and document upload with our Private Wealth Officers require an active Monvera account.
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                onClick={() => {
                  setShowAuthRequiredModal(false);
                  openModal('auth_login');
                }}
                className="w-full py-3.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-black text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-98"
              >
                <LogIn className="w-4 h-4 text-emerald-400" />
                <span>Sign In to Your Account</span>
              </button>

              <button
                onClick={() => {
                  setShowAuthRequiredModal(false);
                  openModal('auth_register');
                }}
                className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-extrabold text-sm flex items-center justify-center gap-2 border border-slate-300 transition-all cursor-pointer"
              >
                <UserPlus className="w-4 h-4 text-slate-600" />
                <span>Open a Monvera Account</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- IMAGE ZOOM PREVIEW MODAL --- */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs cursor-pointer animate-in fade-in duration-150"
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
              onClick={() => downloadFile(zoomedImage.src, zoomedImage.name)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Proof Image</span>
            </button>
          </div>
        </div>
      )}

      {/* --- MOVABLE FLOATING LAUNCHER BUTTON --- */}
      {!isOpen && (
        <div
          ref={launcherRef}
          onMouseDown={handlePointerDown}
          onTouchStart={handlePointerDown}
          style={
            launcherPosition
              ? {
                  position: 'fixed',
                  left: `${launcherPosition.x}px`,
                  top: `${launcherPosition.y}px`,
                  zIndex: 40,
                  touchAction: 'none',
                }
              : {
                  position: 'fixed',
                  bottom: '24px',
                  right: '24px',
                  zIndex: 40,
                  touchAction: 'none',
                }
          }
          className={`flex flex-col items-center gap-1.5 select-none group/launcher ${
            isDragging ? 'cursor-grabbing scale-105 opacity-95 transition-none' : 'cursor-grab'
          }`}
          title="Drag and shift anywhere on screen, or click to chat"
        >
          {/* Authentic WhatsApp Green Floating Button - Prominent & Bold */}
          <button
            id="whatsapp-support-launcher-btn"
            onClick={(e) => {
              if (dragRef.current.hasMoved) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              handleOpenLauncher();
            }}
            className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-[0_10px_35px_rgb(37,211,102,0.55)] border-3 border-white/80 flex items-center justify-center transition-all ${
              isDragging ? 'scale-105 shadow-[0_14px_40px_rgb(37,211,102,0.7)]' : 'hover:scale-110 active:scale-95'
            } group`}
            title="Chat with Monvera Support (Drag anywhere on screen)"
            aria-label="Open Monvera WhatsApp Support Chat"
          >
            <svg
              viewBox="0 0 24 24"
              width="38"
              height="38"
              fill="currentColor"
              className="drop-shadow-lg group-hover:scale-105 transition-transform pointer-events-none"
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

          {/* Bold, Highly Visible Pill Directly UNDER WhatsApp Icon */}
          <div
            onClick={(e) => {
              if (dragRef.current.hasMoved) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              handleOpenLauncher();
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/95 text-white border-2 border-[#25D366] shadow-xl hover:scale-105 transition-all cursor-pointer select-none"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#25D366]"></span>
            </span>
            <span className="text-[11px] sm:text-xs font-black tracking-wider text-white uppercase font-mono">
              WhatsApp
            </span>
          </div>
        </div>
      )}

      {/* --- LIVE CHAT WINDOW --- */}
      {isOpen && (
        <div
          id="whatsapp-chat-container"
          className={
            isExpanded
              ? 'fixed inset-2 sm:inset-6 z-50 flex flex-col items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200'
              : 'fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end gap-2 animate-in zoom-in-95 duration-200'
          }
        >
          {/* Top Control Bar: iPhone 17 Pro Max, DexView, Expand Noticeable Button, Close */}
          <div className="flex items-center gap-1.5 p-1.5 bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-700/80 shadow-2xl text-xs font-bold text-white z-20 select-none">
            {/* View Mode Toggle: iPhone 17 Pro Max vs DexView */}
            <div className="flex items-center bg-slate-950/90 rounded-xl p-0.5 border border-slate-800">
              <button
                type="button"
                onClick={() => setPhoneViewMode('iphone')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  phoneViewMode === 'iphone'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="iPhone 17 Pro Max WhatsApp View"
              >
                <Smartphone className="w-3.5 h-3.5 text-emerald-300" />
                <span>iPhone 17 Pro Max</span>
              </button>
              <button
                type="button"
                onClick={() => setPhoneViewMode('wide')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  phoneViewMode === 'wide'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="DexView / Spacious Desktop View"
              >
                <Monitor className="w-3.5 h-3.5 text-cyan-300" />
                <span>DexView</span>
              </button>
            </div>

            {/* Highly Noticeable Full Expansion / Minimize Button */}
            <button
              type="button"
              id="whatsapp-expand-toggle-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              className="relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black shadow-md transition-all cursor-pointer active:scale-95 group"
              title={isExpanded ? 'Minimize chat screen' : 'Expand chat to full screen view'}
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Minimize</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Expand Chat</span>
                  <span className="relative flex h-2 w-2 ml-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950"></span>
                  </span>
                </>
              )}
            </button>

            {/* Close Button */}
            <button
              type="button"
              id="whatsapp-close-btn"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Minimize / Close Support Chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* CHAT WINDOW: iPhone 17 Pro Max Chassis OR DexView Desktop Window */}
          {phoneViewMode === 'iphone' ? (
            <div
              id="whatsapp-iphone-chassis"
              className={
                isExpanded
                  ? 'w-full max-w-[460px] h-[88vh] max-h-[850px] relative bg-gradient-to-b from-[#2e2f33] via-[#1c1d20] to-[#121315] rounded-[52px] p-3 sm:p-3.5 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] border-4 border-[#43454c] flex flex-col transition-all'
                  : 'w-[360px] sm:w-[410px] md:w-[430px] h-[680px] sm:h-[720px] max-h-[85vh] relative bg-gradient-to-b from-[#2e2f33] via-[#1c1d20] to-[#121315] rounded-[52px] p-3 sm:p-3.5 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] border-4 border-[#43454c] flex flex-col transition-all'
              }
            >
              {/* Hardware Side Buttons */}
              <div className="w-1 h-7 bg-slate-600 rounded-l-md absolute -left-[7px] top-28" />
              <div className="w-1 h-12 bg-slate-600 rounded-l-md absolute -left-[7px] top-40" />
              <div className="w-1 h-12 bg-slate-600 rounded-l-md absolute -left-[7px] top-56" />
              <div className="w-1 h-16 bg-slate-600 rounded-r-md absolute -right-[7px] top-36" />

              {/* Inner Screen Display */}
              <div className="rounded-[40px] overflow-hidden bg-[#EFEAE2] flex-1 flex flex-col relative border border-black/40 shadow-inner">
                {/* iOS Top Status Bar + Dynamic Island */}
                <div className="bg-[#075E54] pt-2 px-5 pb-1 flex items-center justify-between text-white text-xs select-none shrink-0 border-b border-emerald-800/40">
                  <span className="font-bold text-[11px] font-mono tracking-tight text-slate-100">{currentTime}</span>
                  {/* Dynamic Island Pill */}
                  <div className="w-28 h-5 bg-black rounded-full flex items-center justify-between px-2.5 text-[9px] text-emerald-400 font-mono shadow-inner">
                    <span className="w-2 h-2 rounded-full bg-slate-900 border border-slate-700"></span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span className="text-[8px] text-emerald-300 font-bold uppercase tracking-widest">VIP</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-200">
                    <span className="text-[10px] font-black font-mono">5G</span>
                    <Wifi className="w-3 h-3" />
                    <Battery className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* WhatsApp Header */}
                <div className="bg-[#075E54] text-white px-3.5 py-2.5 flex items-center justify-between shadow-md shrink-0 select-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative">
                      <img
                        src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                        alt="David Vance"
                        className="w-9 h-9 rounded-full object-cover border-2 border-[#25D366]"
                      />
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#25D366] border-2 border-[#075E54]" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-sm text-white truncate">David Vance</span>
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-400 text-slate-950">
                          Official
                        </span>
                      </div>
                      <div className="text-[10px] text-emerald-200 flex items-center gap-1 truncate font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
                        <span>online • Monvera VIP Support</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 text-slate-200">
                    <button
                      type="button"
                      onClick={() => triggerCallSimulation('Video')}
                      className="p-1.5 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                      title="Monvera Video Verification"
                    >
                      <Video className="w-4 h-4 text-emerald-300" />
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerCallSimulation('Voice')}
                      className="p-1.5 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                      title="Monvera Toll-Free Concierge Voice Line"
                    >
                      <Phone className="w-4 h-4 text-emerald-300" />
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        className="p-1.5 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                        title="More Options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {showMoreMenu && (
                        <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-slate-800 text-xs font-bold z-50">
                          <a
                            href="tel:18006668372"
                            onClick={() => setShowMoreMenu(false)}
                            className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-2 cursor-pointer text-emerald-700"
                          >
                            <Headphones className="w-3.5 h-3.5" />
                            <span>1-800-MONVERA</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Call Notice Alert */}
                {callNotice && (
                  <div className="bg-amber-100 text-amber-900 px-3 py-1.5 text-xs font-bold flex items-center justify-between border-b border-amber-300 animate-in slide-in-from-top-1">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-amber-700 animate-bounce" />
                      <span>{callNotice}</span>
                    </div>
                    <button onClick={() => setCallNotice(null)} className="text-amber-800 hover:text-amber-950 font-black">
                      ✕
                    </button>
                  </div>
                )}

                {/* Message Stream with smooth scrolling */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleMessagesScroll}
                  className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar overscroll-contain relative"
                  style={{
                    backgroundColor: '#EFEAE2',
                    backgroundImage: `radial-gradient(#d1c7b7 0.75px, transparent 0.75px)`,
                    backgroundSize: '16px 16px',
                  }}
                >
                  {/* End-to-End Encryption Banner */}
                  <div className="mx-auto max-w-[95%] p-2 rounded-xl bg-[#FFF9C4] text-[#5D4037] text-[10px] font-bold leading-relaxed text-center shadow-2xs border border-[#FFEE58] flex items-center justify-center gap-1.5">
                    <Lock className="w-3 h-3 text-amber-700 shrink-0" />
                    <span>
                      <strong>End-to-End Encryption:</strong> Secured with 256-bit banking verification.
                    </span>
                  </div>

                  {/* Quick Topics */}
                  <div className="space-y-1 pt-1">
                    <div className="text-[10px] font-black text-slate-700 uppercase tracking-wider px-1">
                      Quick Topics:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {QUICK_PROMPTS.map((chip) => (
                        <button
                          key={chip.id}
                          onClick={() => handleSendMessage(chip.text)}
                          className="px-2 py-1 rounded-lg bg-white hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 text-[11px] font-bold shadow-2xs border border-slate-300 hover:border-emerald-400 transition-all cursor-pointer text-left"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Messages */}
                  {messages.map((msg) => {
                    const isSupport = msg.sender === 'support';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isSupport ? 'items-start' : 'items-end'} animate-in fade-in slide-in-from-bottom-1`}
                      >
                        <div
                          className={`max-w-[88%] px-3 py-2 rounded-2xl shadow-xs text-xs sm:text-[13px] ${
                            isSupport
                              ? 'bg-white text-slate-900 rounded-tl-xs border border-slate-200'
                              : 'bg-[#D9FDD3] text-slate-950 rounded-tr-xs border border-[#b2f0a8]'
                          }`}
                        >
                          {/* Sender Header */}
                          {isSupport ? (
                            <div className="flex items-center gap-1 mb-0.5 pb-0.5 border-b border-slate-100">
                              <span className="text-[11px] font-black text-[#075E54]">Specialist</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1 mb-0.5 pb-0.5 border-b border-emerald-200/60">
                              <span className="text-[11px] font-black text-emerald-950">{msg.senderName || userName}</span>
                            </div>
                          )}

                          {/* Message Body */}
                          {msg.message && (
                            <div className="font-bold leading-relaxed text-slate-900 whitespace-pre-wrap">
                              {msg.message}
                            </div>
                          )}

                          {/* Image Attachment */}
                          {msg.attachmentUrl && msg.attachmentType === 'image' && (
                            <div className="mt-1.5 space-y-1">
                              <div
                                onClick={() => setZoomedImage({ src: msg.attachmentUrl!, name: msg.attachmentName || 'Proof Image' })}
                                className="relative group rounded-xl overflow-hidden border border-slate-200 cursor-pointer max-h-44 bg-slate-950"
                              >
                                <img
                                  src={msg.attachmentUrl}
                                  alt={msg.attachmentName || 'Attachment'}
                                  className="w-full h-auto object-cover max-h-40 group-hover:opacity-90 transition-opacity"
                                />
                                <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                  <Eye className="w-5 h-5 drop-shadow-md" />
                                </div>
                              </div>
                              <button
                                onClick={() => downloadFile(msg.attachmentUrl!, msg.attachmentName || 'Proof_Image.jpg')}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold transition-colors cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                <span>Download Image</span>
                              </button>
                            </div>
                          )}

                          {/* Document Attachment */}
                          {msg.attachmentUrl && msg.attachmentType === 'document' && (
                            <div className="mt-1.5 p-2 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between gap-2 text-xs font-bold text-slate-800">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
                                  <FileText className="w-3.5 h-3.5 stroke-[2.5]" />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-black text-slate-900 text-[11px]">{msg.attachmentName || 'Proof Document'}</div>
                                  <div className="text-[9px] text-slate-500 font-mono">{formatFileSize(msg.attachmentSize)}</div>
                                </div>
                              </div>
                              <button
                                onClick={() => downloadFile(msg.attachmentUrl!, msg.attachmentName || 'document.pdf')}
                                className="p-1 rounded-lg bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-300 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                title="Download Document"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          {/* Timestamp & Status */}
                          <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-500">
                            <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {!isSupport && <CheckCheck className="w-3 h-3 text-[#53bdeb]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Typing Indicator */}
                  {adminIsTyping && (
                    <div className="flex items-center gap-1.5 p-2.5 rounded-2xl bg-white max-w-[190px] rounded-tl-xs shadow-xs border border-slate-200 animate-in fade-in duration-150">
                      <span className="text-[11px] font-bold text-slate-700">Monvera Support is typing</span>
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Floating Jump to Latest Button */}
                {showScrollBottomBtn && (
                  <button
                    type="button"
                    onClick={() => scrollToBottom(true)}
                    className="absolute bottom-16 right-4 z-20 px-3 py-1.5 rounded-full bg-slate-900/90 text-white text-xs font-black shadow-lg border border-slate-700 flex items-center gap-1.5 hover:bg-slate-800 transition-all animate-bounce cursor-pointer"
                  >
                    <ArrowDown className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Latest</span>
                  </button>
                )}

                {/* Attachment Menu */}
                {showAttachMenu && (
                  <div className="bg-white border-t border-slate-200 p-2.5 flex items-center justify-around animate-in slide-in-from-bottom-2 shadow-md">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-1 text-slate-700 hover:text-emerald-700 cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shadow-xs">
                        <FileText className="w-4 h-4 stroke-[2.5]" />
                      </div>
                      <span className="text-[10px] font-black">Document</span>
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-1 text-slate-700 hover:text-purple-700 cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700 shadow-xs">
                        <ImageIcon className="w-4 h-4 stroke-[2.5]" />
                      </div>
                      <span className="text-[10px] font-black">Photo / ID</span>
                    </button>
                  </div>
                )}

                {/* Input Footer */}
                <div className="bg-[#F0F2F5] px-2.5 py-2 flex items-center gap-1.5 border-t border-slate-300 shrink-0">
                  <button
                    onClick={() => setShowAttachMenu(!showAttachMenu)}
                    className="p-1.5 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer"
                    title="Attach Document or Proof"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <div className="flex-1">
                    <input
                      id="whatsapp-chat-input"
                      type="text"
                      value={inputValue}
                      onChange={handleInputChange}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={isUploading ? 'Uploading proof document...' : 'Type a message...'}
                      disabled={isUploading}
                      className="w-full px-3.5 py-2 rounded-full bg-white text-slate-900 placeholder:text-slate-500 text-xs font-bold border border-slate-300 focus:outline-none focus:border-emerald-500 shadow-2xs"
                    />
                  </div>
                  <button
                    id="whatsapp-send-btn"
                    onClick={() => handleSendMessage()}
                    disabled={!inputValue.trim() || isUploading}
                    className="w-8 h-8 rounded-full bg-[#075E54] hover:bg-[#064e46] text-white flex items-center justify-center shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    title="Send Message"
                  >
                    <Send className="w-3.5 h-3.5 ml-0.5" />
                  </button>
                </div>

                {/* iOS Home Indicator Bar */}
                <div className="py-1 bg-[#F0F2F5] flex justify-center shrink-0">
                  <div className="w-28 h-1 bg-slate-400/50 rounded-full" />
                </div>
              </div>
            </div>
          ) : (
            /* DexView Desktop Spacious Chat Window */
            <div
              id="whatsapp-dexview-window"
              className={
                isExpanded
                  ? 'w-full max-w-5xl h-[88vh] max-h-[850px] bg-[#EFEAE2] rounded-3xl shadow-2xl border border-slate-400 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200'
                  : 'w-[calc(100vw-24px)] sm:w-[580px] md:w-[700px] lg:w-[820px] h-[660px] sm:h-[700px] max-h-[85vh] bg-[#EFEAE2] rounded-3xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200'
              }
            >
              {/* DexView Header */}
              <div className="bg-[#075E54] text-white px-4 py-3 flex items-center justify-between shadow-md shrink-0 select-none">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative">
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                      alt="David Vance"
                      className="w-11 h-11 rounded-full object-cover border-2 border-[#25D366]"
                    />
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#25D366] border-2 border-[#075E54]" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-base text-white truncate">David Vance</span>
                      <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-950">
                        Official Specialist
                      </span>
                    </div>
                    <div className="text-xs text-emerald-200 flex items-center gap-1.5 truncate font-medium">
                      <span className="w-2 h-2 rounded-full bg-[#25D366] animate-pulse" />
                      <span>Online • Monvera Private Banking VIP Desk</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-slate-200">
                  <button
                    type="button"
                    onClick={() => triggerCallSimulation('Video')}
                    className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                    title="Monvera Video Verification"
                  >
                    <Video className="w-5 h-5 text-emerald-300" />
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerCallSimulation('Voice')}
                    className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                    title="Monvera Toll-Free Concierge Voice Line"
                  >
                    <Phone className="w-5 h-5 text-emerald-300" />
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowMoreMenu(!showMoreMenu)}
                      className="p-2 hover:bg-emerald-900/60 rounded-full transition-colors cursor-pointer"
                      title="More Options"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    {showMoreMenu && (
                      <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-slate-800 text-xs font-bold z-50">
                        <a
                          href="tel:18006668372"
                          onClick={() => setShowMoreMenu(false)}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-100 flex items-center gap-2 cursor-pointer text-emerald-700"
                        >
                          <Headphones className="w-4 h-4" />
                          <span>Call Monvera: 1-800-MONVERA</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Call Notice Alert */}
              {callNotice && (
                <div className="bg-amber-100 text-amber-900 px-4 py-2 text-xs font-bold flex items-center justify-between border-b border-amber-300 animate-in slide-in-from-top-1">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-amber-700 animate-bounce" />
                    <span>{callNotice}</span>
                  </div>
                  <button onClick={() => setCallNotice(null)} className="text-amber-800 hover:text-amber-950 font-black">
                    ✕
                  </button>
                </div>
              )}

              {/* DexView Messages Canvas */}
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 custom-scrollbar overscroll-contain relative"
                style={{
                  backgroundColor: '#EFEAE2',
                  backgroundImage: `radial-gradient(#d1c7b7 0.75px, transparent 0.75px)`,
                  backgroundSize: '16px 16px',
                }}
              >
                {/* End-to-End Encryption Banner */}
                <div className="mx-auto max-w-[90%] p-2.5 rounded-xl bg-[#FFF9C4] text-[#5D4037] text-xs font-bold leading-relaxed text-center shadow-xs border border-[#FFEE58] flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    <strong>End-to-End Bank Encryption:</strong> Messages, identity credentials, and proof documents are secured with 256-bit compliance clearance.
                  </span>
                </div>

                {/* Quick Topics */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-xs font-black text-slate-700 uppercase tracking-wider px-1">
                    Frequently Asked Topics:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PROMPTS.map((chip) => (
                      <button
                        key={chip.id}
                        onClick={() => handleSendMessage(chip.text)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 text-xs font-bold shadow-xs border border-slate-300 hover:border-emerald-400 transition-all cursor-pointer text-left"
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
                        className={`max-w-[85%] sm:max-w-[78%] px-4 py-3 rounded-2xl shadow-sm text-sm ${
                          isSupport
                            ? 'bg-white text-slate-900 rounded-tl-xs border border-slate-200'
                            : 'bg-[#D9FDD3] text-slate-950 rounded-tr-xs border border-[#b2f0a8]'
                        }`}
                      >
                        {isSupport ? (
                          <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-slate-100">
                            <span className="text-xs font-black text-[#075E54]">Private Wealth Specialist</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2 mb-1.5 pb-1 border-b border-emerald-200/60">
                            <span className="text-xs font-black text-emerald-950">{msg.senderName || userName}</span>
                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-700 text-white font-mono">
                              Customer
                            </span>
                          </div>
                        )}

                        {msg.message && (
                          <div className="text-sm font-bold leading-relaxed text-slate-900 whitespace-pre-wrap">
                            {msg.message}
                          </div>
                        )}

                        {/* Image Attachment */}
                        {msg.attachmentUrl && msg.attachmentType === 'image' && (
                          <div className="mt-2 space-y-1.5">
                            <div
                              onClick={() => setZoomedImage({ src: msg.attachmentUrl!, name: msg.attachmentName || 'Proof Image' })}
                              className="relative group rounded-xl overflow-hidden border border-slate-200 cursor-pointer max-h-56 bg-slate-950"
                            >
                              <img
                                src={msg.attachmentUrl}
                                alt={msg.attachmentName || 'Attachment'}
                                className="w-full h-auto object-cover max-h-52 group-hover:opacity-90 transition-opacity"
                              />
                              <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                <Eye className="w-6 h-6 drop-shadow-md" />
                              </div>
                            </div>
                            <button
                              onClick={() => downloadFile(msg.attachmentUrl!, msg.attachmentName || 'Proof_Image.jpg')}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Image</span>
                            </button>
                          </div>
                        )}

                        {/* Document Attachment */}
                        {msg.attachmentUrl && msg.attachmentType === 'document' && (
                          <div className="mt-2 p-3 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between gap-3 text-xs font-bold text-slate-800">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
                                <FileText className="w-4 h-4 stroke-[2.5]" />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-black text-slate-900 text-xs sm:text-sm">{msg.attachmentName || 'Proof Document'}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{formatFileSize(msg.attachmentSize)}</div>
                              </div>
                            </div>
                            <button
                              onClick={() => downloadFile(msg.attachmentUrl!, msg.attachmentName || 'document.pdf')}
                              className="p-2 rounded-lg bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-300 shadow-2xs transition-colors shrink-0 cursor-pointer"
                              title="Download Document"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        )}

                        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {!isSupport && <CheckCheck className="w-4 h-4 text-[#53bdeb]" />}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Typing Indicator */}
                {adminIsTyping && (
                  <div className="flex items-center gap-2 p-3 rounded-2xl bg-white max-w-[220px] rounded-tl-xs shadow-xs border border-slate-200 animate-in fade-in duration-150">
                    <span className="text-xs font-bold text-slate-700">Monvera Support is typing</span>
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#25D366] animate-bounce" />
                      <span className="w-2 h-2 rounded-full bg-[#25D366] animate-bounce [animation-delay:0.2s]" />
                      <span className="w-2 h-2 rounded-full bg-[#25D366] animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Floating Jump to Latest Button */}
              {showScrollBottomBtn && (
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className="absolute bottom-20 right-6 z-20 px-3.5 py-2 rounded-full bg-slate-900/90 text-white text-xs font-black shadow-lg border border-slate-700 flex items-center gap-2 hover:bg-slate-800 transition-all animate-bounce cursor-pointer"
                >
                  <ArrowDown className="w-4 h-4 text-emerald-400" />
                  <span>Latest Messages</span>
                </button>
              )}

              {/* Attachment Menu */}
              {showAttachMenu && (
                <div className="bg-white border-t border-slate-200 p-3 flex items-center justify-around animate-in slide-in-from-bottom-2 shadow-md">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 text-slate-700 hover:text-emerald-700 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 shadow-xs">
                      <FileText className="w-5 h-5 stroke-[2.5]" />
                    </div>
                    <span className="text-xs font-black">Document / PDF</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 text-slate-700 hover:text-purple-700 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-purple-100 flex items-center justify-center text-purple-700 shadow-xs">
                      <ImageIcon className="w-5 h-5 stroke-[2.5]" />
                    </div>
                    <span className="text-xs font-black">Proof Photo / ID</span>
                  </button>
                </div>
              )}

              {/* DexView Input Footer */}
              <div className="bg-[#F0F2F5] px-4 py-3 flex items-center gap-3 border-t border-slate-300 shrink-0">
                <button
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  className="p-2 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer"
                  title="Attach Document or Proof"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <div className="flex-1">
                  <input
                    id="whatsapp-dexview-input"
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={isUploading ? 'Uploading proof document...' : 'Type a message to Monvera Support...'}
                    disabled={isUploading}
                    className="w-full px-4 py-2.5 rounded-full bg-white text-slate-900 placeholder:text-slate-500 text-sm font-bold border border-slate-300 focus:outline-none focus:border-emerald-500 shadow-2xs"
                  />
                </div>
                <button
                  id="whatsapp-dexview-send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || isUploading}
                  className="w-10 h-10 rounded-full bg-[#075E54] hover:bg-[#064e46] text-white flex items-center justify-center shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  title="Send Message"
                >
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
