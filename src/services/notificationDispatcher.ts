// Monvera Digital Banking — Client-Side Multi-Channel Notification Orchestrator
// Coordinates native browser push, triggers server SMS & email dispatchers, and enforces idempotency

import { pushNotificationService } from './pushNotificationService';
import { firestoreSync } from './firestoreSync';
import { NotificationPreferences } from '../types';

export interface DispatchNotificationEvent {
  transactionId: string;
  referenceNumber: string;
  type: 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY';
  userId: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  amount?: number;
  currency?: string;
  senderName?: string;
  accountMasked?: string;
}

class ClientNotificationDispatcher {
  private dispatchedEvents = new Set<string>();

  /**
   * Dispatch multi-channel notification for a successful transaction
   * Fail-safe: NEVER throws errors to the caller or affects financial balances
   */
  public async dispatchTransactionNotification(event: DispatchNotificationEvent): Promise<void> {
    const dedupeKey = `${event.transactionId || event.referenceNumber}_${event.type}`;
    if (this.dispatchedEvents.has(dedupeKey)) {
      console.log(`[Notification Dispatcher] Event ${dedupeKey} already triggered. Ignoring duplicate.`);
      return;
    }
    this.dispatchedEvents.add(dedupeKey);

    try {
      // 1. Fetch user's notification preferences from Firestore
      let prefs: NotificationPreferences = await firestoreSync.getNotificationPreferences(event.userId);

      // If user disabled transaction alerts entirely and this is not a critical security alert
      if (event.type !== 'SECURITY' && prefs.transactionAlerts === false) {
        console.log(`[Notification Dispatcher] Transaction alerts disabled by user preferences for ${event.userId}.`);
        return;
      }

      // 2. Client-side Native Push Alert (works in active/background browser tab immediately)
      if (prefs.pushEnabled !== false) {
        const isCredit = event.type === 'MONEY_RECEIVED';
        const formattedAmt = event.amount !== undefined
          ? `$${event.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          : '';
        const pushTitle = isCredit ? 'Money Received — Monvera' : 'Transfer Sent — Monvera';
        const pushBody = isCredit
          ? `You received ${formattedAmt} from ${event.senderName || 'Bennett Johnson'}. Ref: ${event.referenceNumber}.`
          : `You sent ${formattedAmt} to ${event.recipientName || 'Recipient'}. Ref: ${event.referenceNumber}.`;

        pushNotificationService.displayClientNotification(pushTitle, {
          body: pushBody,
          icon: '/favicon.svg',
          tag: event.referenceNumber,
        });
      }

      // 3. Trigger Server-side Multi-Channel Dispatch (SMS, Email, FCM)
      fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: event.transactionId,
          referenceNumber: event.referenceNumber,
          type: event.type,
          userId: event.userId,
          recipientName: event.recipientName,
          recipientEmail: event.recipientEmail,
          recipientPhone: event.recipientPhone,
          amount: event.amount,
          currency: event.currency || 'USD',
          senderName: event.senderName,
          accountMasked: event.accountMasked,
          preferences: prefs,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          console.warn('[Notification Dispatcher] Server dispatch responded with non-200 status');
        } else {
          const result = await res.json();
          console.log('[Notification Dispatcher] Multi-channel dispatch result:', result);
        }
      }).catch((err) => {
        console.warn('[Notification Dispatcher] Server dispatch network note:', err);
      });

    } catch (err) {
      console.warn('[Notification Dispatcher] Notification dispatch caught error safely:', err);
    }
  }
}

export const notificationDispatcher = new ClientNotificationDispatcher();
