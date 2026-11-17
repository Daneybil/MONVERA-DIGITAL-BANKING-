// Monvera Digital Banking — Client-Side Notification Orchestrator Guard
// Financial transaction notifications MUST originate strictly from verified backend ledger events.

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
  /**
   * Client-initiated transaction notification dispatch is intentionally disabled.
   * Preserved as a safe no-op for backward symbol compatibility; authoritative notifications
   * are created and dispatched strictly server-side after verified ledger commits.
   */
  public async dispatchTransactionNotification(_event: DispatchNotificationEvent): Promise<void> {
    console.warn(
      '[Notification Dispatcher] Client-initiated transaction notification dispatch is disabled. Notifications must originate from verified backend transactions.'
    );
  }
}

export const notificationDispatcher = new ClientNotificationDispatcher();
