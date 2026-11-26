import React, { useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bell, ChevronRight, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  buildNotificationNavTargetFromNormalized,
  type NormalizedPushNotification,
} from '../../utils/pushNotificationPayload';

const AUTO_DISMISS_MS = 12_000;

const PushToastItem: React.FC<{
  item: NormalizedPushNotification;
  onDismiss: (id: string) => void;
  onReadMore: (item: NormalizedPushNotification) => void;
}> = ({ item, onDismiss, onReadMore }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(item.id);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  const isDebit = item.direction === 'DEBIT';
  const isCredit = item.direction === 'CREDIT';

  const iconContainerClass = isDebit
    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
    : isCredit
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : 'bg-sky-500/15 text-sky-400 border-sky-500/30';

  const badgeClass = isDebit
    ? 'text-rose-300 bg-rose-500/15 border-rose-500/30'
    : isCredit
    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
    : 'text-sky-300 bg-sky-500/15 border-sky-500/30';

  const badgeLabel = isDebit ? 'Debit' : isCredit ? 'Credit' : 'Alert';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="foreground-push-toast"
      className="pointer-events-auto rounded-2xl bg-slate-900/95 backdrop-blur-md border border-slate-700/90 shadow-2xl shadow-slate-950/60 p-4 text-slate-100 transition-all"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${iconContainerClass}`}
        >
          {isDebit ? (
            <ArrowUpRight className="w-5 h-5" />
          ) : isCredit ? (
            <ArrowDownLeft className="w-5 h-5" />
          ) : (
            <Bell className="w-5 h-5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeClass}`}
              >
                {badgeLabel}
              </span>
              <h4 className="text-sm font-bold text-white truncate">{item.title}</h4>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed break-words">{item.body}</p>

          <div className="mt-3 flex items-center justify-between gap-2">
            {item.referenceId ? (
              <span className="text-[10px] font-mono text-slate-400 truncate">
                Ref: {item.referenceId}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-slate-500">Monvera Live Alert</span>
            )}

            <button
              type="button"
              onClick={() => onReadMore(item)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-xs"
            >
              <span>Read More</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ForegroundPushToast: React.FC = () => {
  const {
    currentUser,
    foregroundPushNotifications,
    dismissForegroundPushNotification,
    navigateToNotificationTarget,
  } = useAuth();

  if (!currentUser || !foregroundPushNotifications || foregroundPushNotifications.length === 0) {
    return null;
  }

  const handleReadMore = (item: NormalizedPushNotification) => {
    const navTarget = buildNotificationNavTargetFromNormalized(item);
    dismissForegroundPushNotification(item.id);
    navigateToNotificationTarget(navTarget);
  };

  return (
    <div
      aria-label="Live Push Notifications"
      className="fixed top-4 right-4 z-[90] w-[calc(100vw-2rem)] max-w-sm space-y-2.5 pointer-events-none"
    >
      {foregroundPushNotifications.map((item) => (
        <PushToastItem
          key={item.id}
          item={item}
          onDismiss={dismissForegroundPushNotification}
          onReadMore={handleReadMore}
        />
      ))}
    </div>
  );
};
