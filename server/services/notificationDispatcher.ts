// Monvera Digital Banking — Server-Side Multi-Channel Notification Dispatcher
// Dispatches Push, SMS, and Email with strict deduplication and financial isolation

import { smsService, SmsDispatchResult } from './smsService';
import { emailService, EmailDispatchResult } from './emailService';

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
  preferences?: {
    pushEnabled?: boolean;
    smsEnabled?: boolean;
    emailEnabled?: boolean;
    transactionAlerts?: boolean;
    securityAlerts?: boolean;
  };
  pushTokens?: string[];
}

export interface DispatchResultSummary {
  transactionId: string;
  referenceNumber: string;
  push: { attempted: boolean; delivered: boolean; status: string };
  sms: SmsDispatchResult;
  email: EmailDispatchResult;
}

class ServerNotificationDispatcher {
  private processedEvents = new Set<string>();

  /**
   * Dispatch multi-channel notifications in background
   */
  public async dispatch(event: DispatchNotificationEvent): Promise<DispatchResultSummary> {
    const eventKey = `${event.transactionId || event.referenceNumber}_${event.type}`;
    if (this.processedEvents.has(eventKey)) {
      console.log(`[Notification Dispatcher] Event ${eventKey} already processed. Skipping duplicate dispatch.`);
      return {
        transactionId: event.transactionId,
        referenceNumber: event.referenceNumber,
        push: { attempted: false, delivered: false, status: 'DUPLICATE_IGNORED' },
        sms: { success: true, delivered: false, status: 'DUPLICATE_IGNORED' },
        email: { success: true, delivered: false, status: 'DUPLICATE_IGNORED' },
      };
    }
    this.processedEvents.add(eventKey);

    const prefs = event.preferences || {
      pushEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
      transactionAlerts: true,
      securityAlerts: true,
    };

    // If transaction alerts are disabled and event is not a critical security alert, skip optional channels
    if (event.type !== 'SECURITY' && prefs.transactionAlerts === false) {
      console.log(`[Notification Dispatcher] Transaction alerts disabled by user preferences for ${event.userId}.`);
      return {
        transactionId: event.transactionId,
        referenceNumber: event.referenceNumber,
        push: { attempted: false, delivered: false, status: 'DISABLED_BY_USER' },
        sms: { success: true, delivered: false, status: 'DISABLED_BY_USER' },
        email: { success: true, delivered: false, status: 'DISABLED_BY_USER' },
      };
    }

    // 1. Dispatch Push Notification
    let pushResult = { attempted: false, delivered: false, status: 'SKIPPED' };
    if (prefs.pushEnabled !== false) {
      pushResult.attempted = true;
      pushResult = await this.sendPush(event);
    } else {
      pushResult = { attempted: false, delivered: false, status: 'DISABLED_BY_USER' };
    }

    // 2. Dispatch SMS
    let smsResult: SmsDispatchResult = { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
    if (prefs.smsEnabled !== false && event.recipientPhone) {
      smsResult = await smsService.sendTransactionSms({
        to: event.recipientPhone,
        type: event.type,
        amount: event.amount,
        currency: event.currency || 'USD',
        senderName: event.senderName,
        recipientName: event.recipientName,
        referenceNumber: event.referenceNumber,
      });
    } else if (prefs.smsEnabled === false) {
      smsResult = { success: true, delivered: false, status: 'DUPLICATE_IGNORED', error: 'Disabled by user preference' };
    } else {
      smsResult = { success: true, delivered: false, status: 'INVALID_PHONE', error: 'No phone number on profile' };
    }

    // 3. Dispatch Transactional Email
    let emailResult: EmailDispatchResult = { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
    if (prefs.emailEnabled !== false && event.recipientEmail) {
      emailResult = await emailService.sendTransactionalEmail({
        to: event.recipientEmail,
        recipientName: event.recipientName,
        type: event.type,
        amount: event.amount,
        currency: event.currency || 'USD',
        senderName: event.senderName,
        referenceNumber: event.referenceNumber,
        accountMasked: event.accountMasked,
      });
    } else if (prefs.emailEnabled === false) {
      emailResult = { success: true, delivered: false, status: 'DUPLICATE_IGNORED', error: 'Disabled by user preference' };
    } else {
      emailResult = { success: true, delivered: false, status: 'INVALID_EMAIL', error: 'No email address on profile' };
    }

    return {
      transactionId: event.transactionId,
      referenceNumber: event.referenceNumber,
      push: pushResult,
      sms: smsResult,
      email: emailResult,
    };
  }

  /**
   * Send push notification via FCM server API if configured
   */
  private async sendPush(event: DispatchNotificationEvent): Promise<{ attempted: boolean; delivered: boolean; status: string }> {
    const fcmServerKey = process.env.FCM_SERVER_KEY;
    const tokens = event.pushTokens || [];

    if (!tokens.length && !fcmServerKey) {
      return { attempted: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
    }

    if (!tokens.length) {
      return { attempted: true, delivered: false, status: 'NO_ACTIVE_TOKENS' };
    }

    if (fcmServerKey) {
      try {
        const title = event.type === 'MONEY_RECEIVED' ? 'Money Received — Monvera' : 'Transaction Alert — Monvera';
        const body = event.type === 'MONEY_RECEIVED'
          ? `You received $${(event.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} from ${event.senderName || 'Bennett Johnson'}.`
          : `Account transaction confirmed: Ref ${event.referenceNumber}.`;

        const res = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            Authorization: `key=${fcmServerKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registration_ids: tokens,
            notification: {
              title,
              body,
              icon: '/favicon.svg',
            },
            data: {
              referenceId: event.referenceNumber,
              url: '/dashboard',
            },
          }),
        });

        if (res.ok) {
          console.log(`[Push Service] FCM Push delivered to ${tokens.length} tokens.`);
          return { attempted: true, delivered: true, status: 'SENT' };
        } else {
          const errText = await res.text();
          console.warn(`[Push Service] FCM Push API note: ${errText}`);
          return { attempted: true, delivered: false, status: 'FAILED' };
        }
      } catch (err: any) {
        console.warn('[Push Service] Push dispatch note:', err?.message || err);
        return { attempted: true, delivered: false, status: 'FAILED' };
      }
    }

    // FCM server key not provided; tokens stored and ready
    return { attempted: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
  }
}

export const serverNotificationDispatcher = new ServerNotificationDispatcher();
